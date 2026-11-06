/**
 * 工业级智能验证码提取引擎 (FlareMail Code Extractor v2.0)
 * 采用多层级流水线（结构化特征码 -> HTML标签特征 -> 跨行语义上下文 -> 主题高置信 -> 候选评分排噪）
 */

export function extractVerificationCode(subject = '', textBody = '', htmlBody = '') {
  // 1. 结构化特征码优先匹配（如 Google 专属 G-123456，连字符 123-456 等）
  const combinedAll = `${subject}\n${textBody}\n${stripHtmlToText(htmlBody)}`;
  const formattedCandidate = extractFormattedCode(combinedAll);
  if (formattedCandidate) {
    return formattedCandidate;
  }

  // 2. 如果有 HTML 内容，优先从 HTML 特征标签（h1/h2/strong/b/code/style letter-spacing）提取高置信候选
  if (htmlBody) {
    const htmlCandidate = extractFromHtmlElements(htmlBody);
    if (htmlCandidate) {
      return htmlCandidate;
    }
  }

  // 3. 基于语义关键词上下文的多行/跨符号精准匹配（应对正文换行显示验证码）
  const contextCandidate = extractByContextKeywords(combinedAll);
  if (contextCandidate) {
    return contextCandidate;
  }

  // 4. 从邮件主题（Subject）提取高置信验证码
  const subjectCandidate = extractFromSubject(subject);
  if (subjectCandidate) {
    return subjectCandidate;
  }

  // 5. 全文独立大字号/孤立数字候选评分机制兜底（根据上下文距离与版权词进行正负权重计算）
  const fallbackCandidate = extractByScoringCandidates(combinedAll);
  if (fallbackCandidate) {
    return fallbackCandidate;
  }

  return null;
}

/**
 * 阶段 1：结构化特征码 (如 G-123456, 123-456)
 */
function extractFormattedCode(text) {
  // Google 风格验证码: G-123456 或 G-XXXXXX
  const googleMatch = text.match(/\b(G-[0-9]{4,8})\b/i);
  if (googleMatch) {
    return googleMatch[1].toUpperCase();
  }

  // 常见 3-3 分割: 123-456 或 4-4: 1234-5678
  const hyphenMatch = text.match(/(?:code|verify|is|为|：|:)?\s*\b([0-9]{3}-[0-9]{3}|[0-9]{4}-[0-9]{4})\b/i);
  if (hyphenMatch) {
    return hyphenMatch[1];
  }

  return null;
}

/**
 * 阶段 2：从 HTML 的突出显示标签提取
 * 针对现代邮件客户端将验证码放在 <b>, <strong>, <h1>~<h3>, <code> 或大字号样式中的场景
 */
function extractFromHtmlElements(html) {
  const tagPatterns = [
    /<(?:b|strong|h[1-4]|code)[^>]*>\s*([A-Za-z0-9\s-]{4,10})\s*<\/(?:b|strong|h[1-4]|code)>/gi,
    // 注意：属性值以引号闭合，匹配时必须允许闭合引号出现在 ">" 之前
    /style=["'][^"']*(?:font-size\s*:\s*(?:[1-4][0-9]px|1\.[5-9]em|2em|xx-large)|letter-spacing\s*:\s*[2-9]px)[^"']*["']?\s*>\s*([A-Za-z0-9\s-]{4,10})\s*</gi,
    /class=["'][^"']*(?:verification.*?code|code.*?verification|code|otp|token|pin|verify)[^"']*["']?\s*>\s*([A-Za-z0-9\s-]{4,10})\s*</gi
  ];

  for (const pattern of tagPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const raw = match[1].replace(/\s+/g, ''); // 清除字距排版中的干扰空格
      if (isValidCode(raw.replace(/^[A-Z]-/, ''))) {
        return cleanCode(raw);
      }
    }
  }
  return null;
}

/**
 * 阶段 3：语义上下文强相关提取（支持跨行识别）
 */
function extractByContextKeywords(text) {
  const keywords = [
    '验证码', '校验码', '动态码', '动态密码', '确认码', '安全码', '授权码', '认证码', '激活码',
    'verification\\s*code', 'verify\\s*code', 'security\\s*code', 'auth\\s*code',
    'one-time\\s*code', 'passcode', 'otp', 'pin', 'token'
  ];
  const kwRegex = new RegExp(`(?:${keywords.join('|')})`, 'i');

  const lines = text.split(/[\r\n]+/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!kwRegex.test(line)) continue;

    const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';

    // A. 验证码独占下一行（最强信号）：如 "code is:\n 034540"
    if (nextLine && /^[A-Za-z0-9-]{4,10}$/.test(nextLine)) {
      const raw = nextLine.replace(/^[A-Z]-/, '').replace(/-/g, '');
      if (isValidCode(raw)) {
        return nextLine;
      }
    }

    const searchScope = line + ' ' + nextLine;

    // B. 作用域内的纯数字候选（次强信号）
    const digitMatch = searchScope.match(/\b\d{4,8}\b/);
    if (digitMatch && isValidCode(digitMatch[0])) {
      return digitMatch[0];
    }

    // C. 数字字母混合候选（弱信号）：必须含数字，排除纯字母单词与问候语后的收件人名
    const candidates = searchScope.match(/([A-Za-z0-9]{4,8}|[A-Za-z0-9]{3}-[A-Za-z0-9]{3}|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}|[A-Z]-\d{6})/g) || [];
    for (const c of candidates) {
      if (!/\d/.test(c)) continue; // 纯字母几乎都是普通单词，直接跳过
      const raw = c.replace(/^[A-Z]-/, '').replace(/-/g, '');
      if (!isValidCode(raw)) continue;
      // 排除问候语后紧跟的收件人名（Hello f9h2msu6,）
      const pos = searchScope.indexOf(c);
      if (pos > 0 && /(?:hello|hi|dear|welcome)[,:\s]+$/i.test(searchScope.slice(Math.max(0, pos - 12), pos))) {
        continue;
      }
      return c;
    }
  }

  // 动作引导句式: "输入 123456 完成验证" / "Enter 123456 to continue"
  const actionMatch = text.match(/(?:输入|enter|use|with)\s*[:：=]?\s*([A-Za-z0-9-]{4,10})\s*(?:完成|验证|进行|to\s*verify|to\s*confirm|as\s*your)/i);
  if (actionMatch) {
    const raw = actionMatch[1].replace(/^[A-Z]-/, '').replace(/-/g, '');
    if (isValidCode(raw)) {
      return actionMatch[1];
    }
  }

  return null;
}

/**
 * 阶段 4：主题高置信提取
 */
function extractFromSubject(subject) {
  if (!subject) return null;

  const prefixMatch = subject.match(/(?:^|[^A-Za-z0-9])([A-Z]-\d{6}|\d{6}|\d{4}|\d{8})(?:[^A-Za-z0-9]|$)/);
  if (prefixMatch && isValidCode(prefixMatch[1].replace(/^[A-Z]-/, ''))) {
    return prefixMatch[1];
  }

  return null;
}

/**
 * 阶段 5：孤立数字候选评分机制（兜底排噪）
 */
function extractByScoringCandidates(text) {
  const matches = text.match(/\b\d{4,8}\b/g);
  if (!matches || matches.length === 0) return null;

  const scores = new Map();

  for (const num of matches) {
    if (!isValidCode(num)) continue;

    let score = 10;
    if (num.length === 6) score += 30; // 6位验证码概率最高
    else if (num.length === 4) score += 15;
    else if (num.length === 8) score += 10;

    const index = text.indexOf(num);
    if (index !== -1) {
      const surrounding = text.substring(Math.max(0, index - 60), Math.min(text.length, index + 60 + num.length));
      // 周围 60 字符内存在验证提示词，大幅加分
      if (/(?:code|verify|verification|valid|expire|pin|otp|验证码|安全|校验|有效|动态码|密码)/i.test(surrounding)) {
        score += 40;
      }
      // 周围存在版权/声明词，扣减权重排除年份误判
      if (/(?:©|copyright|all\s*rights|reserved|since|版权所有|年)/i.test(surrounding)) {
        score -= 50;
      }
    }

    scores.set(num, (scores.get(num) || 0) + score);
  }

  if (scores.size === 0) return null;

  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted[0] && sorted[0][1] >= 20) {
    return sorted[0][0];
  }

  return null;
}

/**
 * 严格防误判校验（排除年份、整百数、全重复字符、常见单词）
 */
function isValidCode(str) {
  if (!str) return false;
  const s = str.trim();

  // 长度区间限定 4~8 位
  if (s.length < 4 || s.length > 8) return false;

  // 必须只包含数字或英文字母
  if (!/^[A-Za-z0-9]+$/.test(s)) return false;

  // 排除公历年份 (1950 ~ 2050)
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 1950 && num <= 2050) {
    return false;
  }

  // 排除整千整百数字（如 1000, 2000, 3000）
  if (/^[0-9]000$/.test(s)) return false;

  // 排除全重复无意义字符（如 0000, 1111, 888888, aaaaaa）
  if (/^(\w)\1+$/i.test(s)) return false;

  // 排除常见英语单词与品牌名
  const ignoredWords = [
    'NULL', 'TRUE', 'FALSE', 'TEST', 'INFO', 'POST', 'USER', 'MAIL', 'HTML', 'HTTP',
    'GOOGLE', 'GITHUB', 'NOTION', 'STEAM', 'APPLE', 'DISCORD', 'MICROSOFT', 'TWITTER', 'OPENAI',
    'CODEX', 'VERIFICATION', 'CODE', 'EMAIL', 'MIRROR', 'HELLO', 'WELCOME', 'THANKS', 'PLEASE',
    'CONFIRM', 'VERIFY', 'ACTIVATE', 'SECURITY', 'AUTH', 'TOKEN', 'PASSCODE', 'OTP', 'PIN',
    'VALID', 'EXPIRE', 'MINUTE', 'MINUTES', 'HOUR', 'HOURS', 'IGNORE', 'REQUEST', 'SENT', 'REPLY'
  ];
  if (ignoredWords.includes(s.toUpperCase())) return false;

  // 优先数字验证码：若候选全是字母且存在纯数字备选，倾向拒绝纯字母（避免品牌词误判）
  if (/^[A-Za-z]+$/.test(s)) {
    // 这里无法直接访问其他候选，交给评分阶段处理；但可加一条：纯字母且长度不等于6时更严格
    if (s.length !== 6) return false; // 常见字母验证码多为6位（如 G-123456 已在格式阶段处理）
  }

  return true;
}

function cleanCode(str) {
  return str.trim();
}

/**
 * 辅助函数：快速剥离 HTML 标签转纯文本
 */
function stripHtmlToText(html) {
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
