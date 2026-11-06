/**
 * 邮件接收与 MIME 解包逻辑
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
  putRule
} from './rule-store.js';
import { extractWithAI } from './ai-extractor.js';

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

  // 4. 提取验证码（三层流水线：本地正则 -> KV 已学习规则 -> AI 大模型兜底）
  let verificationCode = extractVerificationCode(subject, textBody, htmlBody);
  let aiExtracted = false;

  if (!verificationCode) {
    // 第 2 层：KV 已学习规则匹配（按发信方域名/From 地址检索规则）
    const fromDomain = extractDomain(fromAddress);
    const senderHash = await hashSender(fromAddress);
    const key = ruleKey(fromDomain, senderHash);
    const rule = await getRule(env, key);

    if (rule) {
      const matched = matchRule(rule, { subject, textBody, htmlBody });
      if (matched && matched.code) {
        verificationCode = matched.code;
        // 记录命中并持久化（hits+1、lastHitAt），不阻塞主流程
        ctx.waitUntil(recordHit(env, key, rule, matched.patternIndex));
      }
    }
  }

  if (!verificationCode) {
    // 第 3 层：AI 大模型兜底提取（仅前两层都失败时调用）
    const aiResult = await extractWithAI(env, { subject, textBody, htmlBody });
    aiExtracted = aiResult.usedAI;
    if (aiResult.code) {
      verificationCode = aiResult.code;

      // 自学习：AI 成功提取后，将模式持久化为 KV 规则，下次同类邮件直接命中
      // 仅当 KV 中不存在该发信方的规则时自动生成（与设计 5.1 一致）
      const existingRule = await getRule(env, key);
      if (!existingRule) {
        const newRule = buildRuleFromAI({
          sender: fromAddress,
          domain: fromDomain,
          subject,
          textBody,
          htmlBody,
          code: aiResult.code
        });
        ctx.waitUntil(putRule(env, key, newRule));
      }
    }
  }

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
 * 从 From 地址中提取邮箱域名（如 security@example.com -> example.com）
 * 失败时返回 'unknown'，避免 KV key 污染
 */
function extractDomain(fromAddress) {
  if (!fromAddress) return 'unknown';
  const match = String(fromAddress).match(/@([^@\s>]+)$/i);
  return match ? match[1].toLowerCase().trim() : 'unknown';
}
