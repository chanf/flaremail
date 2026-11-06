/**
 * KV 规则存储与命中匹配模块 (FlareMail Rule Store v1.0)
 *
 * 三层流水线第 2 层：按发信方域名/From 地址检索已学习规则，
 * 尝试 HTML class、正文关键词、标题模板三种 pattern，
 * 耗时 <1ms，免费。命中后直接返回，流程结束。
 *
 * KV 键名：rule:{domain}:{senderHash}
 *   domain：邮箱后缀域名（如 tpxul.com）
 *   senderHash：发信方 From 地址的 SHA-256 前 16 位（十六进制）
 */

// 规则默认 90 天无命中自动过期（Cloudflare KV expirationTtl 单位：秒）
const RULE_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * 从 From 地址中提取邮箱域名（如 security@example.com -> example.com）
 * 失败时返回 'unknown'，避免 KV key 污染
 */
export function extractDomain(fromAddress) {
  if (!fromAddress) return 'unknown';
  const match = String(fromAddress).match(/@([^@\s>]+)$/i);
  return match ? match[1].toLowerCase().trim() : 'unknown';
}

/**
 * 计算发信方 From 地址的 SHA-256 前 16 位（十六进制），用于区分不同发信方
 */
export async function hashSender(sender) {
  if (!sender) return 'unknown';
  const msgUint8 = new TextEncoder().encode(String(sender).toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * 构造 KV 键名：rule:{domain}:{senderHash}
 */
export function ruleKey(domain, senderHash) {
  const d = (domain || 'unknown').toLowerCase().trim();
  return `rule:${d}:${senderHash}`;
}

/**
 * 从 KV 读取规则
 */
export async function getRule(env, key) {
  if (!env || !env.MAIL_KV) return null;
  const raw = await env.MAIL_KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 将规则写入 KV，默认 90 天 TTL
 */
export async function putRule(env, key, rule) {
  if (!env || !env.MAIL_KV) return false;
  rule.updatedAt = Date.now();
  rule.version = (rule.version || 0) + 1;
  rule.totalHits = rule.patterns
    ? rule.patterns.reduce((sum, p) => sum + (p.hits || 0), 0)
    : 0;
  await env.MAIL_KV.put(key, JSON.stringify(rule), {
    expirationTtl: RULE_TTL_SECONDS
  });
  return true;
}

/**
 * 严格防误判校验（排除年份、整百数、全重复字符、常见单词）
 */
function isValidCode(str) {
  if (!str) return false;
  const s = str.trim();
  if (s.length < 4 || s.length > 8) return false;
  if (!/^[A-Za-z0-9]+$/.test(s)) return false;

  // 排除公历年份 (1950 ~ 2050)
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 1950 && num <= 2050) return false;

  // 排除整千整百数字（如 1000, 2000, 3000）
  if (/^[0-9]000$/.test(s)) return false;

  // 排除全重复无意义字符（如 0000, 1111, 888888, aaaaaa）
  if (/^(\w)\1+$/i.test(s)) return false;

  // 排除常见英语单词与品牌名
  const ignoredWords = [
    'NULL', 'TRUE', 'FALSE', 'TEST', 'INFO', 'POST', 'USER', 'MAIL', 'HTML', 'HTTP',
    'GOOGLE', 'GITHUB', 'NOTION', 'STEAM', 'APPLE', 'DISCORD', 'MICROSOFT', 'TWITTER', 'OPENAI'
  ];
  if (ignoredWords.includes(s.toUpperCase())) return false;

  return true;
}

/**
 * 在文本窗口内按正则寻找验证码候选（4-8 位数字/字母）
 * 返回原始匹配 token（如 G-123456 或 123456），或 null
 */
function findCodeInText(text) {
  if (!text) return null;
  const candidates = text.match(
    /\b([A-Za-z0-9]{4,8}|[A-Za-z0-9]{3}-[A-Za-z0-9]{3}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}|[A-Z]-\d{4,8})\b/g
  );
  if (!candidates) return null;
  for (const c of candidates) {
    const raw = c.replace(/^[A-Z]-/i, '').replace(/-/g, '');
    if (isValidCode(raw)) return c;
  }
  return null;
}

/**
 * 剥离 HTML 标签为纯文本
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
 * 从 HTML 中按 class 选择器提取可见文本（轻量正则实现，避免依赖 DOM）
 */
function extractByClass(html, className) {
  if (!html) return '';
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<[A-Za-z]+\\b[^>]*class=[\"'][^\"']*\\b${escaped}\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/[A-Za-z]+>`,
    'gi'
  );
  const parts = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    const inner = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (inner) parts.push(inner);
  }
  return parts.join(' ');
}

/**
 * 尝试单个 pattern 提取验证码（纯函数，不产生副作用）
 * 返回 { code, confidence } 或 null
 */
function tryPattern(pattern, { subject, textBody, htmlBody }) {
  const type = pattern.type;
  const confidence = pattern.confidence || 0;

  if (type === 'html-class') {
    const selector = pattern.selector || '';
    const className = selector.replace(/^\./, '').trim();
    if (!className) return null;
    const htmlText = extractByClass(htmlBody || '', className);
    if (!htmlText) return null;
    const code = findCodeInText(htmlText);
    return code ? { code, confidence } : null;
  }

  if (type === 'keyword-context') {
    const keyword = pattern.keyword || '';
    const regexStr = pattern.regex || '(\\d{4,8})';
    if (!keyword) return null;
    const text = (textBody || '') + '\n' + stripHtml(htmlBody || '');
    const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx === -1) return null;
    const windowSize = 120;
    const windowText = text.substring(
      Math.max(0, idx - windowSize),
      Math.min(text.length, idx + keyword.length + windowSize)
    );
    let regex;
    try {
      regex = new RegExp(regexStr, 'gi');
    } catch {
      regex = /(\d{4,8})/g;
    }
    const m = windowText.match(regex);
    if (m) {
      const raw = m[0].replace(/^[A-Z]-/i, '').replace(/-/g, '');
      if (isValidCode(raw)) return { code: m[0], confidence };
    }
    return null;
  }

  if (type === 'subject-template') {
    const patternStr = pattern.pattern || pattern.regex;
    if (!patternStr) return null;
    let regex;
    try {
      regex = new RegExp(patternStr, 'gi');
    } catch {
      return null;
    }
    const m = (subject || '').match(regex);
    if (m) {
      const raw = m[0].replace(/^[A-Z]-/i, '').replace(/-/g, '');
      if (isValidCode(raw)) return { code: m[0], confidence };
    }
    return null;
  }

  return null;
}

/**
 * 命中匹配逻辑（纯函数，不持久化）：
 * 1. 按 confidence * log(hits + 1) 对 patterns 排序
 * 2. 依次尝试，第一个成功提取到 code 的 pattern 即为结果
 * 3. 全部失败返回 null
 *
 * 返回 { code, patternIndex, confidence } 或 null
 */
export function matchRule(rule, { subject, textBody, htmlBody }) {
  if (!rule || !rule.patterns || rule.patterns.length === 0) return null;

  const indexed = rule.patterns.map((p, i) => ({ p, origIdx: i }));
  indexed.sort((x, y) => {
    const sa = (x.p.confidence || 0) * Math.log((x.p.hits || 0) + 1);
    const sb = (y.p.confidence || 0) * Math.log((y.p.hits || 0) + 1);
    return sb - sa;
  });

  for (const { p, origIdx } of indexed) {
    const result = tryPattern(p, { subject, textBody, htmlBody });
    if (result && result.code) {
      return { code: result.code, patternIndex: origIdx, confidence: result.confidence };
    }
  }

  return null;
}

/**
 * 记录命中并持久化到 KV（在 matchRule 命中成功后由调用方调用）
 * 将对应 pattern 的 hits + 1、lastHitAt 更新，并略微提升置信度
 */
export async function recordHit(env, key, rule, patternIndex) {
  if (!rule || !rule.patterns) return;
  const p = rule.patterns[patternIndex];
  if (!p) return;
  p.hits = (p.hits || 0) + 1;
  p.lastHitAt = Date.now();
  p.confidence = Math.min(0.99, (p.confidence || 0.8) + 0.01);
  await putRule(env, key, rule);
}

/**
 * 根据 AI 成功提取的上下文，推断 pattern 类型并构建初始规则值
 * 用于自学习：AI 成功提取后，将模式持久化为 KV 规则，下次同类邮件直接命中
 * 返回规则值对象（不含 senderHash，由调用方拼入 KV key）
 */
export function buildRuleFromAI({ sender, domain, subject, textBody, htmlBody, code }) {
  const now = Date.now();
  const patterns = [];

  // 场景：代码出现在邮件主题中 → subject-template
  if (subject && subject.includes(code)) {
    const escaped = subject
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '([A-Za-z0-9]{4,8})');
    patterns.push({
      type: 'subject-template',
      pattern: escaped,
      confidence: 0.9,
      hits: 1,
      lastHitAt: now
    });
  }

  // 场景：代码紧跟关键词（如 "验证码：123456"） → keyword-context
  const text = (textBody || '') + '\n' + stripHtml(htmlBody || '');
  const keywordRegex = /(验证码|校验码|动态码|verification\s*code|security\s*code|auth\s*code|your\s*code|code\s*is|code\s*[:：])/i;
  const kwMatch = text.match(keywordRegex);
  if (kwMatch) {
    patterns.push({
      type: 'keyword-context',
      keyword: kwMatch[0],
      regex: '([A-Za-z0-9]{4,8})',
      confidence: 0.85,
      hits: 1,
      lastHitAt: now
    });
  }

  // 场景：代码位于带 class 的 HTML 标签内 → html-class
  if (htmlBody) {
    const classRegex = /class=[\"']([^\"']*?)[\"'][^>]*>[\s\S]*?<\/[A-Za-z]+>/gi;
    let cm;
    while ((cm = classRegex.exec(htmlBody)) !== null) {
      const classList = cm[1].split(/\s+/);
      const interesting = classList.find(c =>
        /(verification|code|otp|token|pin|verify|security)/i.test(c)
      );
      if (interesting) {
        patterns.push({
          type: 'html-class',
          selector: `.${interesting}`,
          attribute: 'innerText',
          confidence: 0.95,
          hits: 1,
          lastHitAt: now
        });
        break;
      }
    }
  }

  // 兜底：若均未推断出，以 code 本身做低置信 keyword-context
  if (patterns.length === 0) {
    patterns.push({
      type: 'keyword-context',
      keyword: code,
      regex: '([A-Za-z0-9]{4,8})',
      confidence: 0.5,
      hits: 1,
      lastHitAt: now
    });
  }

  return {
    sender,
    domain: (domain || 'unknown').toLowerCase().trim(),
    patterns,
    updatedAt: now,
    totalHits: patterns.reduce((sum, p) => sum + (p.hits || 0), 0),
    version: 1
  };
}
