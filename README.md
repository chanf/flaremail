# ⚡ FlareMail (火花瞬邮)

> **基于 Cloudflare Workers + Email Routing 的极速无服务器临时邮箱与验证码接收系统**

![FlareMail Logo](public/logo.png)

FlareMail 是一款 100% 运行在 Cloudflare 全球边缘计算网络上的开源临时邮箱系统。用户打开网页即可获得随机邮箱，自动捕获全域收信，智能提取验证码，并在生命周期结束后物理销毁，保护隐私免受骚扰。

---

## 🌟 核心特性

- 💰 **100% 零服务器成本**：完全依托 Cloudflare 免费计划，零 VPS、零 Docker、零数据库账单。
- ⚡ **边缘闪电响应**：邮件直达 Cloudflare Email Routing 并触发 Email Worker 毫秒级解包。
- 🎯 **智能验证码提取**：结合语义上下文与边界正则，自动高亮识别 Google、GitHub、Steam、微软等 4~8 位数字/字母验证码。
- 🔒 **严格鉴权与隐私保护**：采用客户端 Session Token 签名防暴力探测；依托 Cloudflare KV 原生 `expirationTtl` 自动物理销毁。
- 📦 **一体化极简交付**：单 Worker 整合「现代化响应式前端 UI + RESTful API + 邮件接收处理」，一条命令完成全球部署。

---

## 📁 项目目录结构

```
flaremail/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自动化持续部署
├── public/
│   └── logo.png                # FlareMail 官方品牌 Logo 图标
├── src/
│   ├── index.js                # 主入口 (分发 email 与 fetch 流量)
│   ├── email-handler.js        # 邮件流接收与 PostalMime 解包
│   ├── api-handler.js          # RESTful API 接口处理
│   ├── code-extractor.js       # 智能验证码提取引擎
│   ├── auth.js                 # Session Token 生成与 SHA-256 鉴权
│   └── ui.js                   # FlareMail 现代化前端界面 (内置 WebP Logo)
├── wrangler.toml               # Cloudflare Worker 配置文件
├── package.json                # npm 依赖与构建指令
├── .gitignore                  # Git 忽略配置
└── README.md                   # 项目文档与部署指南
```

---

## 🚀 极速部署指南（5分钟上线）

### 1. 域名与 Email Routing 准备
1. 准备一个在 Cloudflare 解析托管的域名（如 `yourdomain.com`）。
2. 在 Cloudflare 控制台打开该域名 -> **Email (电子邮件)** -> **Email Routing (路由)** -> 点击 **启用 (Enable)**。
3. 按照提示一键注入 MX 与 TXT (SPF) 记录，确认状态为 **Active**。

### 2. 安装项目依赖
```bash
npm install
```

### 3. 创建 Cloudflare KV
```bash
# 登录账号
npx wrangler login

# 创建生产与本地预览环境 KV
npx wrangler kv:namespace create MAIL_KV
npx wrangler kv:namespace create MAIL_KV --preview
```

### 4. 配置 `wrangler.toml`
将上一步生成的 KV ID 填入 `wrangler.toml`，并修改 `DOMAIN` 为你的真实域名：
```toml
name = "flaremail"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "MAIL_KV"
id = "你的生产_KV_ID"
preview_id = "你的预览_KV_ID"

[vars]
DOMAIN = "yourdomain.com"
MAIL_TTL_SECONDS = 1800
```

### 5. 一键发布上线
```bash
npm run deploy
```
发布成功后，控制台会输出访问链接，如 `https://flaremail.<子域>.workers.dev`。可在 Worker 设置中直接绑定专属自定义二级域名（如 `mail.yourdomain.com`）。

### 6. 控制台关联 Email Routing
1. 打开 Cloudflare 控制台 -> **Email (电子邮件)** -> **Email Routing** -> **Routing Rules (路由规则)**。
2. 找到 **Catch-all address** 规则，点击编辑：
   - **Action**：选择 **Send to a Worker**
   - **Worker**：选中 **`flaremail`**
   - 保存生效！

---

## 📄 开源许可证
MIT License.
