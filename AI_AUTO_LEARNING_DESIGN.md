# FlareMail AI 自学习验证码提取系统设计方案

## 1. 总体设计目标

现有验证码提取基于正则和静态规则，面对不同邮件服务商（Google、GitHub、Steam、微软等）千差万别的 HTML 结构和文本格式，准确率有上限。本方案引入 **AI 大模型 + 规则自学习** 机制，实现：

- **首层**：现有正则/结构化提取（免费、毫秒级）
- **次层**：KV 中已学习的发信方专属规则（免费、毫秒级）
- **兜底层**：AI 大模型智能分析（仅当前两层都失败时调用，有成本和延迟）
- **自学习**：AI 成功提取后，将模式持久化为 KV 规则，下次同类邮件直接命中，无需再调用 AI

## 2. 三层流水线架构

```
邮件到达
  │
  ▼
┌─────────────────────────────────────────┐
│  第 1 层：本地正则/结构化提取            │
│  (code-extractor.js, 现有逻辑)            │
│  - 耗时 <1ms，免费                        │
│  - 命中 → 直接返回，流程结束              │
└─────────────────────────────────────────┘
  │ 未命中
  ▼
┌─────────────────────────────────────────┐
│  第 2 层：KV 已学习规则匹配              │
│  (rule-store.js)                         │
│  - 按发信方域名/From 地址检索规则        │
│  - 尝试 HTML class、正文关键词、标题模板 │
│  - 耗时 <1ms，免费                        │
│  - 命中 → 直接返回，流程结束              │
└─────────────────────────────────────────┘
  │ 未命中
  ▼
┌─────────────────────────────────────────┐
│  第 3 层：AI 大模型智能提取              │
│  (ai-extractor.js)                       │
│  - 仅在前两层都失败时调用                │
│  - 有 token 成本和网络延迟                │
│  - 成功后 → 写入 KV 规则，供后续复用     │
└─────────────────────────────────────────┘
  │
  ▼
返回提取结果（或 null）
```

## 3. KV 规则存储设计

### 3.1 键名格式

```
rule:{domain}:{senderHash}
```

- `domain`：邮箱后缀域名（如 `tpxul.com`）
- `senderHash`：发信方 `From` 地址的 SHA-256 前 16 位，用于区分不同发信方

示例：`rule:tpxul.com:a3f7b2c1d4e5f6a7`

### 3.2 规则值结构

```json
{
  "sender": "security@example.com",
  "domain": "example.com",
  "patterns": [
    {
      "type": "html-class",
      "selector": ".verification-code",
      "attribute": "innerText",
      "confidence": 0.95,
      "hits": 42,
      "lastHitAt": 1749200000000
    },
    {
      "type": "keyword-context",
      "keyword": "Your verification code is",
      "regex": "(\\d{6})",
      "confidence": 0.85,
      "hits": 15,
      "lastHitAt": 1749190000000
    },
    {
      "type": "subject-template",
      "pattern": "\\[Example\\] (\\d{6}) is your code",
      "confidence": 0.9,
      "hits": 8,
      "lastHitAt": 1749180000000
    }
  ],
  "updatedAt": 1749200000000,
  "totalHits": 65,
  "version": 1
}
```

### 3.3 规则命中逻辑

1. 根据当前邮件的 `domain` 和 `from` 地址计算 `senderHash`，检索 KV
2. 如果不存在规则，返回空，进入 AI 兜底层
3. 如果存在，按 `confidence * log(hits + 1)` 排序，依次尝试每个 `pattern`
4. 第一个成功提取到 code 的 pattern 即为结果，并将其 `hits + 1`、`lastHitAt` 更新
5. 所有 pattern 都失败，进入 AI 兜底层

## 4. AI 提取模块设计

### 4.1 调用时机

仅在第 1 层和第 2 层都未命中时调用，避免不必要的 token 消耗和延迟。

### 4.2 输入脱敏（隐私保护）

发送给 AI 前，对邮件内容进行脱敏：

- 移除所有附件、图片 base64、超链接
- 保留邮件主题（Subject）
- 正文仅保留前 2000 字符，移除 IP 地址、手机号、邮箱地址、订单号等敏感字段
- 移除 HTML 标签，仅保留可见文本

### 4.3 提示词模板

```
你是一个验证码提取助手。请从以下邮件内容中提取验证码。

邮件主题：{subject}
邮件正文：{body}

规则：
1. 验证码通常是 4-8 位的数字或字母数字组合
2. 可能出现在 "验证码："、"code is"、"your code" 等关键词附近
3. 排除年份（1900-2099）、订单号、手机号、版本号等非验证码数字
4. 如果找不到明确的验证码，返回 null
5. 只返回验证码字符串，不要解释

输出格式（JSON）：
{"code": "123456" 或 null, "confidence": 0.0-1.0, "reason": "简短说明"}
```

### 4.4 结果处理

- AI 返回有效 code → 放行，同时触发规则学习
- AI 返回 null 或置信度过低（<0.6） → 返回 null，不写入规则
- AI 调用失败（超时、网络错误、配额耗尽） → 返回 null，不中断主流程

## 5. 自学习机制

### 5.1 规则生成时机

当 AI 成功提取到 code，且当前 KV 中不存在该发信方的规则时，自动生成一条新规则。

### 5.2 规则类型推断

根据提取成功时的上下文，自动判断 pattern 类型：

| 场景 | 推断类型 | 示例 |
|------|---------|------|
| 代码位于带 class 的 HTML 标签内 | `html-class` | `class="verification-code"` |
| 代码紧跟关键词（如 "验证码：123456"） | `keyword-context` | 关键词 + 正则 |
| 代码出现在邮件主题中 | `subject-template` | 主题模板正则 |

### 5.3 规则更新

- 命中成功：`hits += 1`，`lastHitAt = now`，可微调 `confidence`
- 连续 N 次（如 5 次）命中失败：降低 `confidence`，或标记为废弃
- 不同发信方共享同一 domain 时，可按 `senderHash` 隔离，避免互相干扰

### 5.4 规则清理

- 设置 KV 过期时间（如 90 天无命中自动过期）
- 提供手动清理接口，供管理员删除失效规则

## 6. 文件结构变更

```
src/
├── index.js              # 主入口，无变更
├── email-handler.js      # 修改：插入三层流水线调用逻辑
├── code-extractor.js     # 第 1 层：现有正则提取（保留）
├── rule-store.js         # 新增：KV 规则读写、命中匹配、置信度计算
├── ai-extractor.js       # 新增：AI API 调用、脱敏、提示词构建
├── auth.js               # 无变更
├── api-handler.js        # 新增：规则管理 API（查看、清理、手动触发）
└── ui.js                 # 可选新增：前端展示已学习规则列表
```

## 7. 配置项（需通过环境变量注入，不提交到 Git）

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `AI_PROVIDER` | AI 服务商 | `openai` / `zhipu` / `deepseek` / `cloudflare` |
| `AI_API_KEY` | API 密钥 | `sk-xxx...` |
| `AI_API_BASE` | API 接口地址 | `https://api.openai.com/v1` |
| `AI_MODEL` | 模型名称 | `gpt-3.5-turbo` / `glm-4` 等 |
| `AI_MAX_DAILY_CALLS` | 每日最大 AI 调用次数 | `100` |
| `AI_CONFIDENCE_THRESHOLD` | 接受 AI 结果的最低置信度 | `0.6` |

这些配置必须通过 Cloudflare 密钥存储或 `wrangler.toml` 的 `[vars]` 配置，**严禁写入代码或提交到 Git**。

## 8. 接口设计（可选）

### 8.1 查看已学习规则

```
GET /api/rules?email={email}
Headers: X-Session-Token: {token}
```

### 8.2 手动删除规则

```
DELETE /api/rules/{domain}/{senderHash}
Headers: X-Session-Token: {token}
```

### 8.3 强制触发 AI 重新学习

```
POST /api/rules/learn?email={email}&messageId={messageId}
Headers: X-Session-Token: {token}
```

## 9. 成本与风险控制

| 控制点 | 措施 |
|--------|------|
| 调用频率 | 每日最大调用次数限制，超出后仅保留第 1、2 层 |
| 单次成本 | 只发送脱敏后的前 2000 字符，控制 token 数 |
| 失败降级 | AI 超时或错误时不阻塞邮件接收流程 |
| 隐私保护 | 正文脱敏，不发送附件和敏感字段 |
| 规则膨胀 | KV 规则设置 TTL（如 90 天），自动清理失效规则 |

## 10. 实施顺序

1. **Phase 1**：新增 `rule-store.js`，实现 KV 规则读写和基础匹配
2. **Phase 2**：新增 `ai-extractor.js`，实现 AI 调用、脱敏、提示词
3. **Phase 3**：修改 `email-handler.js`，插入三层流水线
4. **Phase 4**：新增规则管理 API（可选，用于调试和运维）
5. **Phase 5**：前端 UI 展示已学习规则（可选）

每阶段完成后需部署验证：`npm run deploy`

---

> **安全提醒**：`AI_API_KEY`、`AI_API_BASE` 等敏感配置必须通过 Cloudflare 密钥或环境变量注入，**绝对不要写入代码或提交到 Git 仓库**。
