/**
 * 邮件接收与 MIME 解包逻辑
 *
 * 验证码提取采用「发件方登记制」：
 * - 每个发件方（From 地址）首次来信时，必须调用 AI 提取验证码，
 *   并由 AI 结果生成该发件方的提取规则，登记到 KV；
 * - 该发件方后续来信直接用已登记规则提取，不再过 AI；
 * - 已登记规则未命中（模板变化）时，重新过 AI 更新规则（自愈）；
 * - AI 失败 / 每日超限时，降级用本地正则兜底（不登记规则）。
 */
import PostalMime from 'postal-mime';
import { extractVerificationCode } from './code-extractor.js';
import {
  hashSender,
  ruleKey,
  getRule,
  matchRule,
  recordHit,
  buildRuleFromAI,
  putRule,
  extractDomain
} from './rule-store.js';
import { extractWithAI, saveAiLog } from './ai-extractor.js';

export async function handleIncomingEmail(message, env, ctx) {
  const toAddress = message.to.toLowerCase().trim();
  const fromAddress = message.from;

  // 1. 安全活跃校验：检查该邮箱前缀是否由用户创建并处于有效期内
  const sessionRaw = await env.MAIL_KV.get(`session:${toAddress}`);
  if (!sessionRaw) {
    // 丢弃非活跃或未创建邮箱的邮件，防止被全域扫号消耗 KV 配额
    return;
  }

  // 2. 读取原始邮件二进制流
  const rawStream = await new Response(message.raw).arrayBuffer();

  let subject = '(无主题)';
  let senderName = fromAddress;
  let textBody = '';
  let htmlBody = '';

  // 3. MIME 内容解析
  try {
    const parser = new PostalMime();
    const parsed = await parser.parse(rawStream);
    subject = parsed.subject || '(无主题)';
    senderName = parsed.from?.name || fromAddress;
    textBody = parsed.text || '';
    htmlBody = parsed.html || '';
  } catch (err) {
    // 降级兜底解析：纯文本简单提取
    const decoder = new TextDecoder('utf-8');
    const rawText = decoder.decode(rawStream);
    const subjectMatch = rawText.match(/Subject:\s*([^\r\n]+)/i);
    if (subjectMatch) subject = subjectMatch[1];
    textBody = rawText.slice(0, 5000);
  }

  // 4. 按发件方登记制提取验证码
  const result = await extractCodeForSender(env, {
    fromAddress,
    subject,
    textBody,
    htmlBody
  }, (p) => ctx.waitUntil(p));

  const verificationCode = result.code;

  // 5. 组装邮件实体
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const mailPayload = {
    id: messageId,
    to: toAddress,
    from: fromAddress,
    sender_name: senderName,
    subject: subject,
    verification_code: verificationCode,
    summary: textBody.slice(0, 120).replace(/\s+/g, ' ').trim() || '(无摘要内容)',
    content_text: textBody,
    content_html: htmlBody,
    received_at: Date.now()
  };

  const ttl = parseInt(env.MAIL_TTL_SECONDS || '1800', 10);

  // 6. 异步写入存储（通过 ctx.waitUntil 保证不阻塞邮件响应）
  ctx.waitUntil((async () => {
    // 写入具体邮件详情
    await env.MAIL_KV.put(
      `mail:${toAddress}:${messageId}`,
      JSON.stringify(mailPayload),
      { expirationTtl: ttl }
    );

    // 更新该邮箱的邮件索引列表
    const listRaw = await env.MAIL_KV.get(`list:${toAddress}`);
    let idList = listRaw ? JSON.parse(listRaw) : [];
    idList.unshift(messageId);
    if (idList.length > 50) idList = idList.slice(0, 50); // 最多保留 50 封

    await env.MAIL_KV.put(
      `list:${toAddress}`,
      JSON.stringify(idList),
      { expirationTtl: ttl }
    );
  })());
}

/**
 * 发件方登记制提取核心（独立导出，便于测试）：
 * 1. 查该发件方已登记规则 → 命中直接返回（不过 AI）
 * 2. 首次（无规则）或规则未命中 → 调用 AI 提取并登记/更新规则
 * 3. AI 失败/超限 → 降级本地正则兜底（不登记）
 *
 * 返回 { code, source: 'rule'|'ai'|'regex'|null, relearn: boolean, ai: aiResult }
 */
export async function extractCodeForSender(env, { fromAddress, subject, textBody, htmlBody }, waitUntil = () => {}) {
  const fromDomain = extractDomain(fromAddress);
  const senderHash = await hashSender(fromAddress);
  const key = ruleKey(fromDomain, senderHash);

  // 1. 查该发件方已登记规则
  const rule = await getRule(env, key);
  if (rule) {
    const matched = matchRule(rule, { subject, textBody, htmlBody });
    if (matched && matched.code) {
      // 命中：记录命中（hits+1、lastHitAt），不阻塞主流程
      waitUntil(recordHit(env, key, rule, matched.patternIndex));
      return { code: matched.code, source: 'rule', relearn: false, ai: null };
    }
  }

  // 2. 首次（无规则）或规则未命中（模板变化）→ 过 AI 学习/重新学习
  const aiResult = await extractWithAI(env, { subject, textBody, htmlBody });

  if (aiResult.code) {
    // 登记新规则 / 覆盖更新旧规则（自愈模板变化）；hint 为 AI 给出的紧邻上下文短语
    const newRule = buildRuleFromAI({
      sender: fromAddress,
      domain: fromDomain,
      subject,
      textBody,
      htmlBody,
      code: aiResult.code,
      hint: aiResult.hint
    });
    waitUntil(putRule(env, key, newRule));

    waitUntil(saveAiLog(env, {
      type: 'extract',
      from: fromAddress,
      domain: fromDomain,
      subject,
      aiExtracted: true,
      extractedCode: aiResult.code,
      confidence: aiResult.confidence || 0,
      provider: aiResult.provider || 'external',
      reason: (rule
        ? '规则未命中（模板变化），AI 重新学习并更新登记：'
        : '首次收到该发件方，AI 提取并登记规则：')
        + `[${aiResult.provider === 'workers-ai' ? 'Workers AI 兜底' : '外部供应商'}] ${aiResult.reason || ''}`,
      dailyLimitReached: false,
      timestamp: Date.now()
    }));

    return { code: aiResult.code, source: 'ai', relearn: !!rule, ai: aiResult };
  }

  // 3. AI 失败/超限 → 降级本地正则兜底（不登记规则，下次继续尝试 AI）
  const fallbackCode = extractVerificationCode(subject, textBody, htmlBody);

  waitUntil(saveAiLog(env, {
    type: 'extract',
    from: fromAddress,
    domain: fromDomain,
    subject,
    aiExtracted: aiResult.usedAI,
    extractedCode: null,
    confidence: 0,
    reason: (aiResult.reason || 'AI 提取失败') + (fallbackCode ? `；已降级正则兜底提取到 ${fallbackCode}` : '；正则兜底也未提取到'),
    dailyLimitReached: !aiResult.usedAI && aiResult.reason === 'AI 每日调用次数已达上限',
    timestamp: Date.now()
  }));

  return { code: fallbackCode || null, source: fallbackCode ? 'regex' : null, relearn: !!rule, ai: aiResult };
}
