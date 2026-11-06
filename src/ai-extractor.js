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

// 提示词模板（发件方登记制：AI 除提取验证码外，还需给出用于后续规则匹配的上下文短语）
const SYSTEM_PROMPT = `你是一个验证码提取助手。请从以下邮件内容中提取验证码，并给出用于下次同发件方邮件的提取线索。

规则：
1. 验证码通常是 4-8 位的数字或字母数字组合
2. 可能出现在 "验证码："、"code is"、"your code" 等关键词附近
3. 排除年份（1900-2099）、订单号、手机号、版本号等非验证码数字
4. 如果找不到明确的验证码，返回 null
5. 只返回 JSON，不要解释

输出格式（JSON）：
{"code": "123456" 或 null, "confidence": 0.0-1.0, "reason": "简短说明", "hint": "紧挨在验证码之前的原文短语"}

hint 字段要求：
- 从邮件原文中照抄紧挨在验证码前面的那段文字（5~20 个字符，如 "动态口令为"、"Your verification code is"、"验证码："）
- 不要包含验证码本身，不要改写、不要翻译
- 找不到时返回空字符串 ""`;

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
 * AI API POST 请求（带限流重试）：对 429 / 5xx 指数退避重试，最多 3 次尝试。
 * Cloudflare Workers 出口 IP 为共享池，上游（如 api.agnes-ai.cn 的 Cloudflare）
 * 按 IP 限流（error 1015）时，退避重试通常可穿过瞬时限流。
 * 返回 { ok: true, res } 或 { ok: false, status, text }
 */
async function aiPostWithRetry(url, apiKey, payload, signal) {
  const delays = [0, 1000, 3000]; // 首次 + 1s + 3s 退避
  let lastStatus = 0;
  let lastText = '';

  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) {
      await new Promise(r => setTimeout(r, delays[i]));
      if (signal && signal.aborted) break;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal
      });

      if (res.ok) return { ok: true, res };

      lastStatus = res.status;
      lastText = await res.text().catch(() => '');
      // 仅对限流/服务端错误重试；其他 4xx（鉴权、参数）直接失败
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      // 网络/超时中断：若是外部 signal 主动中止则退出，否则记为 5xx 类继续重试
      if (signal && signal.aborted) { lastStatus = 0; lastText = 'aborted'; break; }
      lastStatus = 503;
      lastText = err.message;
    }
  }

  return { ok: false, status: lastStatus, text: lastText };
}

// ── Cloudflare Workers AI 内置兜底通道 ──
const DEFAULT_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// 简易熔断器：外部供应商连续失败 3 次后，5 分钟内直接跳过（避免每封邮件都吃重试延迟），
// 到期自动恢复尝试，成功即复位。
const EXTERNAL_CIRCUIT = { fails: 0, blockedUntil: 0 };

function externalAIBlocked() {
  return Date.now() < EXTERNAL_CIRCUIT.blockedUntil;
}

function noteExternalResult(ok) {
  if (ok) {
    EXTERNAL_CIRCUIT.fails = 0;
    EXTERNAL_CIRCUIT.blockedUntil = 0;
    return;
  }
  EXTERNAL_CIRCUIT.fails += 1;
  if (EXTERNAL_CIRCUIT.fails >= 3) {
    EXTERNAL_CIRCUIT.blockedUntil = Date.now() + 5 * 60 * 1000;
  }
}

/**
 * 调用 Cloudflare Workers AI（env.AI 绑定，无外部依赖、无出口限流问题）。
 * 返回 { code, confidence, reason, hint, provider } 或 null
 */
async function callWorkersAI(env, subject, body) {
  if (!env || !env.AI) return null;
  const model = env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  try {
    const data = await env.AI.run(model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(subject, body) }
      ],
      max_tokens: 200
    });
    const text = typeof data === 'string' ? data : (data?.response || data?.result?.response || null);
    if (!text) return null;
    const parsed = parseAiResponse(text);
    if (!parsed) return null;
    const code = parsed.code === null || parsed.code === undefined ? null : String(parsed.code);
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0;
    const hint = typeof parsed.hint === 'string' ? parsed.hint.trim().slice(0, 30) : '';
    const threshold = parseFloat(env.AI_CONFIDENCE_THRESHOLD || String(DEFAULT_CONFIDENCE_THRESHOLD));
    if (!code || confidence < threshold) return null;
    return { code, confidence, reason: parsed.reason || '', hint, provider: 'workers-ai' };
  } catch {
    return null;
  }
}

/**
 * 调用 AI 大模型 API（OpenAI 兼容 Chat Completions）。
 * 支持供应商：openai / zhipu / deepseek / cloudflare（均通过 AI_API_BASE 切换端点）。
 * 返回 { code, confidence, reason, hint }；
 * HTTP 层失败返回 { error: 'http', status, text }（供熔断器区分网络失败）；
 * 请求成功但无可提取结果返回 null。
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
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s 总超时（含重试退避），避免阻塞邮件流程

  try {
    const { ok, res, status, text } = await aiPostWithRetry(url, apiKey, payload, controller.signal);
    if (!ok) {
      // 配额耗尽、鉴权失败、限流等 HTTP 层失败 —— 交给熔断器与兜底通道处理
      return { error: 'http', status, text };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || null;
    if (!content) return null;

    const parsed = parseAiResponse(content);
    if (!parsed) return null;

    const code = parsed.code === null || parsed.code === undefined ? null : String(parsed.code);
    const confidence = Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0;
    const reason = parsed.reason || '';
    const hint = typeof parsed.hint === 'string' ? parsed.hint.trim().slice(0, 30) : '';

    // 置信度低于阈值，拒绝结果（不写入规则）
    const threshold = parseFloat(env.AI_CONFIDENCE_THRESHOLD || String(DEFAULT_CONFIDENCE_THRESHOLD));
    if (!code || confidence < threshold) {
      return null;
    }

    return { code, confidence, reason, hint, provider: 'external' };
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

  // 1. 外部供应商（Agnes 等，带熔断跳过）
  if (!externalAIBlocked()) {
    const ext = await callAI(env, subject, body);
    if (ext && ext.error === 'http') {
      noteExternalResult(false); // HTTP 层失败 → 计入熔断
    } else if (ext) {
      noteExternalResult(true);
      return { ...ext, usedAI: true };
    } else {
      noteExternalResult(true); // 请求成功但未提取到 → 供应商可用
    }
  }

  // 2. Workers AI 内置兜底（不受出口 IP 限流影响）
  const fallback = await callWorkersAI(env, subject, body);
  if (fallback) {
    return { ...fallback, usedAI: true };
  }

  return { code: null, confidence: 0, usedAI: true, reason: 'AI 提取失败或未找到验证码' };
}

/**
 * AI 工作日志持久化（写入 Cloudflare KV，供管理页面查询）
 * key: ailog:{id}，TTL 7 天自动过期，避免 KV 无限增长
 */
const AI_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function saveAiLog(env, logEntry) {
  if (!env || !env.MAIL_KV) return;
  try {
    const id = `ailog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const key = `ailog:${id}`;
    await env.MAIL_KV.put(key, JSON.stringify(logEntry), {
      expirationTtl: AI_LOG_TTL_SECONDS
    });
    return id;
  } catch {
    // 静默失败，不影响主邮件流程
  }
}

export { pingAI };

const PING_USER_PROMPT = '请即兴创作一首关于验证码的四行中文小诗，只返回诗的内容，不要任何解释或前言。';

/**
 * Ping AI：对两条通道各测一次，返回每条通道的状态与胜出通道的诗。
 * force=true 时忽略外部供应商熔断，强制实测。
 * 返回 { ok, provider: 'external'|'workers-ai'|null, response, detail: { external, workersAI } }
 */
async function pingAI(env, { force = false } = {}) {
  const detail = { external: null, workersAI: null };

  // 通道 1：外部供应商（Agnes 等）
  if (!env.AI_API_KEY) {
    detail.external = { ok: false, error: 'AI_API_KEY 未配置' };
  } else if (externalAIBlocked() && !force) {
    detail.external = { ok: false, error: '熔断中：近期连续失败，5 分钟后自动恢复尝试（可加 ?force=1 强制实测）' };
  } else {
    const apiBase = env.AI_API_BASE || 'https://api.openai.com/v1';
    const model = env.AI_MODEL || 'gpt-3.5-turbo';
    const url = apiBase.replace(/\/$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s 总超时（含重试退避）
    try {
      const { ok, res, status, text } = await aiPostWithRetry(url, env.AI_API_KEY, {
        model,
        messages: [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: PING_USER_PROMPT }
        ],
        temperature: 0.8,
        max_tokens: 200
      }, controller.signal);
      if (ok) {
        const data = await res.json();
        const response = data?.choices?.[0]?.message?.content || '';
        detail.external = { ok: true, response: response.trim() };
        noteExternalResult(true);
      } else {
        detail.external = { ok: false, error: `HTTP ${status}: ${text}` };
        noteExternalResult(false);
      }
    } catch (err) {
      detail.external = { ok: false, error: err.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 通道 2：Cloudflare Workers AI（内置兜底）
  if (!env.AI) {
    detail.workersAI = { ok: false, error: '未绑定 Workers AI（wrangler.toml 缺少 [ai] binding）' };
  } else {
    try {
      const model = env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
      const data = await env.AI.run(model, {
        messages: [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: PING_USER_PROMPT }
        ],
        max_tokens: 200
      });
      const response = (typeof data === 'string' ? data : (data?.response || data?.result?.response || '')).trim();
      detail.workersAI = response
        ? { ok: true, response, model }
        : { ok: false, error: '空响应' };
    } catch (err) {
      detail.workersAI = { ok: false, error: err.message };
    }
  }

  let winnerKey = null;
  if (detail.external?.ok) winnerKey = 'external';
  else if (detail.workersAI?.ok) winnerKey = 'workersAI';

  return {
    ok: !!winnerKey,
    provider: winnerKey === 'workersAI' ? 'workers-ai' : winnerKey,
    response: winnerKey ? detail[winnerKey].response : '',
    detail
  };
}
