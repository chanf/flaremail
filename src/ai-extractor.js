/**
 * AI 大模型验证码提取模块 (FlareMail AI Extractor v1.0)
 *
 * 三层流水线第 3 层（兜底层）：仅在第 1 层（正则）和第 2 层（KV 规则）
 * 都失败时调用。有 token 成本和网络延迟。
 *
 * 功能：
 * - 对邮件内容进行脱敏（隐私保护）
 * - 构建提示词并调用 OpenAI 兼容的 Chat Completions API
 * - 支持 openai / zhipu / deepseek / cloudflare 等供应商（通过 AI_PROVIDER / AI_API_BASE 切换）
 * - 每日最大调用次数限制（AI_MAX_DAILY_CALLS），超限后仅保留第 1、2 层
 * - 成功后返回 { code, confidence }，置信度低于阈值则拒绝
 * - 调用失败/超时时降级返回 null，不中断主流程
 */

// 可接受的 AI 结果最低置信度（可通过环境变量 AI_CONFIDENCE_THRESHOLD 覆盖）
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;
// 默认每日最大 AI 调用次数
const DEFAULT_MAX_DAILY_CALLS = 100;
// 每日计数器的 KV key 前缀，自然过期（TTL 24 小时）
const DAILY_CALLS_KEY_PREFIX = 'ai:calls:';

// 提示词模板（与 AI_AUTO_LEARNING_DESIGN.md 第 4.3 节一致）
const SYSTEM_PROMPT = `你是一个验证码提取助手。请从以下邮件内容中提取验证码。

规则：
1. 验证码通常是 4-8 位的数字或字母数字组合
2. 可能出现在 "验证码："、"code is"、"your code" 等关键词附近
3. 排除年份（1900-2099）、订单号、手机号、版本号等非验证码数字
4. 如果找不到明确的验证码，返回 null
5. 只返回验证码字符串，不要解释

输出格式（JSON）：
{"code": "123456" 或 null, "confidence": 0.0-1.0, "reason": "简短说明"}`;

/**
 * 构建用户提示词
 */
function buildUserPrompt(subject, body) {
  return `邮件主题：${subject || '(无主题)'}\n邮件正文：${body || '(无正文)'}`;
}

/**
 * 解析 AI 返回的 JSON 文本，容错处理 Markdown 代码块包裹
 */
function parseAiResponse(text) {
  if (!text) return null;
  let cleaned = String(text).trim();
  // 去除 ```json ... ``` 或 ``` ... ``` 包裹
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object') {
      return obj;
    }
  } catch {
    // 尝试提取首个 { ... } 块
    const braceStart = cleaned.indexOf('{');
    const braceEnd = cleaned.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(cleaned.substring(braceStart, braceEnd + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 内容脱敏（隐私保护，与 AI_AUTO_LEARNING_DESIGN.md 第 4.2 节一致）：
 * - 移除所有附件、图片 base64、超链接
 * - 保留邮件主题（Subject，由调用方单独传入）
 * - 正文仅保留前 2000 字符
 * - 移除 IP 地址、手机号、邮箱地址、订单号等敏感字段
 * - 移除 HTML 标签，仅保留可见文本
 */
export function sanitizeBody(subject, textBody, htmlBody) {
  let body = textBody || stripHtml(htmlBody || '');
  if (!body) body = '';

  // 移除 base64 图片/附件数据（data: URIs 中的 base64 段）
  body = body.replace(/data:[^;,]+;base64,[A-Za-z0-9+/=\s]{20,}/gi, '[附件已脱敏]');

  // 移除超链接（保留可见文本，去掉 href）
  body = body.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1');

  // 移除 HTML 标签，仅保留可见文本（double-safe：textBody 本应已是纯文本，这里再兜底）
  body = stripHtml(body);

  // 仅保留前 2000 字符，控制 token 数与成本
  body = body.slice(0, 2000);

  // 脱敏敏感字段
  body = body.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]');                                  // IP 地址
  body = body.replace(/\b(?:1[3-9]\d{9}|86-?1[3-9]\d{9})\b/g, '[手机号]');                                // 中国手机号
  body = body.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]');                        // 邮箱地址
  body = body.replace(/\b(?:订单[号码]?[：: ]?[A-Za-z0-9]{6,}|order[-\s]?[#: ]?[A-Za-z0-9]{6,})\b/gi, '[订单号]'); // 订单号

  // 压缩空白
  body = body.replace(/\s+/g, ' ').trim();

  return body;
}

/**
 * 剥离 HTML 标签为纯文本（轻量实现，避免依赖 DOM）
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 取得今日日期字符串（YYYY-MM-DD，本地时区），用于每日调用计数分桶
 */
function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 检查并递增今日 AI 调用计数。未超过限额返回 true；否则返回 false。
 * 计数器存储在 KV，键为 ai:calls:{YYYY-MM-DD}，TTL 26 小时自动过期。
 */
export async function checkAndIncrementDailyCalls(env) {
  if (!env || !env.MAIL_KV) return true; // 无 KV 时不限制（降级放行，交给调用方自身判断）

  const maxCalls = parseInt(env.AI_MAX_DAILY_CALLS || String(DEFAULT_MAX_DAILY_CALLS), 10);
  const key = `${DAILY_CALLS_KEY_PREFIX}${todayKey()}`;

  let current = 0;
  const raw = await env.MAIL_KV.get(key);
  if (raw) {
    current = parseInt(raw, 10) || 0;
  }

  if (current >= maxCalls) {
    return false; // 超限
  }

  // 原子性不是 KV 强保证，但足够用于流量节流；写入并设 TTL
  await env.MAIL_KV.put(key, String(current + 1), { expirationTtl: 26 * 60 * 60 });
  return true;
}

/**
 * 调用 AI 大模型 API（OpenAI 兼容 Chat Completions）。
 * 支持供应商：openai / zhipu / deepseek / cloudflare（均通过 AI_API_BASE 切换端点）。
 * 返回 { code: string|null, confidence: number, reason: string } 或 null（调用失败/无结果）。
 */
export async function callAI(env, subject, body) {
  const apiKey = env.AI_API_KEY;
  const apiBase = env.AI_API_BASE || 'https://api.openai.com/v1';
  const model = env.AI_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    // 未配置密钥，降级不调用
    return null;
  }

  const prompt = buildUserPrompt(subject, body);
  const payload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    max_tokens: 200
  };

  let url = apiBase.replace(/\/$/, '') + '/chat/completions';
  // 某些供应商（如 Cloudflare AI Gateway / Workers AI）端点形态不同，此处保留通用兼容路径；
  // 若 AI_API_BASE 已包含完整路径则直接使用。
  if (apiBase.includes('/chat/completions')) {
    url = apiBase.replace(/\/$/, '');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s 超时，避免阻塞邮件流程

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      // 配额耗尽、鉴权失败等，降级返回 null，不中断主流程
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || null;
    if (!text) return null;

    const parsed = parseAiResponse(text);
    if (!parsed) return null;

    const code = parsed.code === null || parsed.code === undefined ? null : String(parsed.code);
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0;
    const reason = parsed.reason || '';

    // 置信度低于阈值，拒绝结果（不写入规则）
    const threshold = parseFloat(env.AI_CONFIDENCE_THRESHOLD || String(DEFAULT_CONFIDENCE_THRESHOLD));
    if (!code || confidence < threshold) {
      return null;
    }

    return { code, confidence, reason };
  } catch {
    // 超时、网络错误、解析异常等，降级返回 null
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 对外主入口：AI 兜底提取。
 * 返回 { code: string|null, confidence: number, usedAI: boolean }。
 * 流程：
 * 1. 检查每日调用限额；超限则不调用 AI，返回 { code: null, confidence: 0, usedAI: false }
 * 2. 脱敏邮件内容
 * 3. 调用 AI；成功返回结果；失败/低置信返回 null
 */
export async function extractWithAI(env, { subject, textBody, htmlBody }) {
  const canCall = await checkAndIncrementDailyCalls(env);
  if (!canCall) {
    return { code: null, confidence: 0, usedAI: false, reason: 'AI 每日调用次数已达上限' };
  }

  const body = sanitizeBody(subject, textBody, htmlBody);
  const result = await callAI(env, subject, body);
  if (!result) {
    return { code: null, confidence: 0, usedAI: true, reason: 'AI 提取失败或未找到验证码' };
  }

  return { code: result.code, confidence: result.confidence, usedAI: true, reason: result.reason };
}
