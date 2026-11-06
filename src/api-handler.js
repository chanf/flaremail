/**
 * RESTful HTTP API 处理模块
 */
import { generateRandomString, hashToken, verifySession } from './auth.js';
import {
  hashSender,
  ruleKey,
  getRule,
  putRule,
  matchRule,
  buildRuleFromAI,
  extractDomain
} from './rule-store.js';
import { extractWithAI } from './ai-extractor.js';
import { extractVerificationCode } from './code-extractor.js';

export async function handleApiRequest(request, env, ctx) {
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Session-Token',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // API 1: 创建新临时邮箱
    if (url.pathname === '/api/mailbox/create' && request.method === 'POST') {
      const prefix = generateRandomString(8);
      const domain = env.DOMAIN || 'example.com';
      const email = `${prefix}@${domain}`.toLowerCase();
      const sessionToken = generateRandomString(32);
      const tokenHash = await hashToken(sessionToken);

      const ttl = parseInt(env.MAIL_TTL_SECONDS || '1800', 10);
      const sessionData = {
        email,
        token_hash: tokenHash,
        created_at: Date.now(),
        expires_at: Date.now() + ttl * 1000
      };

      await env.MAIL_KV.put(`session:${email}`, JSON.stringify(sessionData), { expirationTtl: ttl });
      await env.MAIL_KV.put(`list:${email}`, JSON.stringify([]), { expirationTtl: ttl });

      return new Response(JSON.stringify({
        code: 0,
        message: 'success',
        data: {
          email,
          session_token: sessionToken,
          expires_at: sessionData.expires_at,
          ttl_seconds: ttl
        }
      }), { headers: corsHeaders });
    }

    // API 2: 拉取邮件列表
    if (url.pathname === '/api/mailbox/messages' && request.method === 'GET') {
      const email = url.searchParams.get('email')?.toLowerCase();
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized or Mailbox Expired' }), {
          status: 401,
          headers: corsHeaders
        });
      }

      const listRaw = await env.MAIL_KV.get(`list:${email}`);
      const idList = listRaw ? JSON.parse(listRaw) : [];

      const messages = [];
      for (const id of idList) {
        const mailRaw = await env.MAIL_KV.get(`mail:${email}:${id}`);
        if (mailRaw) {
          const m = JSON.parse(mailRaw);
          messages.push({
            id: m.id,
            from: m.from,
            sender_name: m.sender_name,
            subject: m.subject,
            verification_code: m.verification_code,
            summary: m.summary,
            received_at: m.received_at
          });
        }
      }

      return new Response(JSON.stringify({ code: 0, data: messages }), { headers: corsHeaders });
    }

    // API 3: 查询单封邮件详情
    if (url.pathname.startsWith('/api/mailbox/message/') && request.method === 'GET') {
      const messageId = url.pathname.replace('/api/mailbox/message/', '').trim();
      const email = url.searchParams.get('email')?.toLowerCase();
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized' }), {
          status: 401,
          headers: corsHeaders
        });
      }

      const mailRaw = await env.MAIL_KV.get(`mail:${email}:${messageId}`);
      if (!mailRaw) {
        return new Response(JSON.stringify({ code: 404, error: 'Message Not Found or Expired' }), {
          status: 404,
          headers: corsHeaders
        });
      }

      return new Response(JSON.stringify({ code: 0, data: JSON.parse(mailRaw) }), { headers: corsHeaders });
    }

    // API 4: 手动销毁当前邮箱
    if (url.pathname === '/api/mailbox/destroy' && request.method === 'POST') {
      const email = url.searchParams.get('email')?.toLowerCase();
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      await env.MAIL_KV.delete(`session:${email}`);
      await env.MAIL_KV.delete(`list:${email}`);

      return new Response(JSON.stringify({ code: 0, message: 'Mailbox successfully destroyed' }), { headers: corsHeaders });
    }

    // ── 规则管理 API（第 2 层 KV 已学习规则）──────────────────────
    // 需要鉴权：X-Session-Token，且仅允许查询与会话邮箱同域的规则

    // API 5: 查看已学习规则
    // GET /api/rules?email={email}
    if (url.pathname === '/api/rules' && request.method === 'GET') {
      const email = url.searchParams.get('email')?.toLowerCase();
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized or Mailbox Expired' }), {
          status: 401,
          headers: corsHeaders
        });
      }

      const domain = extractDomain(email);
      const listRes = await env.MAIL_KV.list({ prefix: `rule:${domain}:` });
      const rules = [];
      for (const obj of listRes.keys || []) {
        const raw = await env.MAIL_KV.get(obj.name);
        if (!raw) continue;
        try {
          const rule = JSON.parse(raw);
          rules.push({
            key: obj.name,
            senderHash: obj.name.split(':').pop(),
            sender: rule.sender,
            domain: rule.domain,
            patterns: rule.patterns || [],
            updatedAt: rule.updatedAt,
            totalHits: rule.totalHits,
            version: rule.version
          });
        } catch {
          // 跳过损坏的规则条目
        }
      }
      rules.sort((a, b) => (b.totalHits || 0) - (a.totalHits || 0));
      return new Response(JSON.stringify({ code: 0, data: rules, domain }), { headers: corsHeaders });
    }

    // API 6: 手动删除规则
    // DELETE /api/rules/{domain}/{senderHash}
    if (url.pathname.startsWith('/api/rules/') && request.method === 'DELETE') {
      const email = url.searchParams.get('email')?.toLowerCase();
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }

      const domain = extractDomain(email);
      const senderHash = url.pathname.replace('/api/rules/', '').trim();
      const key = ruleKey(domain, senderHash);

      await env.MAIL_KV.delete(key);
      return new Response(JSON.stringify({ code: 0, message: 'Rule deleted', key }), { headers: corsHeaders });
    }

    // API 7: 强制触发 AI 重新学习
    // POST /api/rules/learn?email={email}&messageId={messageId}
    if (url.pathname === '/api/rules/learn' && request.method === 'POST') {
      const email = url.searchParams.get('email')?.toLowerCase();
      const messageId = url.searchParams.get('messageId');
      const clientToken = request.headers.get('X-Session-Token');

      const isAuthorized = await verifySession(env.MAIL_KV, email, clientToken);
      if (!isAuthorized) {
        return new Response(JSON.stringify({ code: 401, error: 'Unauthorized or Mailbox Expired' }), {
          status: 401,
          headers: corsHeaders
        });
      }

      if (!messageId) {
        return new Response(JSON.stringify({ code: 400, error: 'messageId is required' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      const mailRaw = await env.MAIL_KV.get(`mail:${email}:${messageId}`);
      if (!mailRaw) {
        return new Response(JSON.stringify({ code: 404, error: 'Message Not Found or Expired' }), {
          status: 404,
          headers: corsHeaders
        });
      }

      const mail = JSON.parse(mailRaw);
      const fromDomain = extractDomain(mail.from);
      const senderHash = await hashSender(mail.from);
      const key = ruleKey(fromDomain, senderHash);

      // 先尝试第 1 层正则
      let code = extractVerificationCode(mail.subject || '', mail.content_text || '', mail.content_html || '');

      // 若正则未命中，调用 AI 兜底
      if (!code) {
        const aiResult = await extractWithAI(env, {
          subject: mail.subject || '',
          textBody: mail.content_text || '',
          htmlBody: mail.content_html || ''
        });
        code = aiResult.code;
      }

      if (!code) {
        return new Response(JSON.stringify({ code: 422, error: '无法从该邮件中提取验证码，未生成规则' }), {
          status: 422,
          headers: corsHeaders
        });
      }

      // 写入/更新 KV 规则（自学习）
      const existingRule = await getRule(env, key);
      if (existingRule) {
        // 已有规则，记录一次命中（若能匹配），否则追加新 pattern 并刷新
        const matched = matchRule(existingRule, {
          subject: mail.subject || '',
          textBody: mail.content_text || '',
          htmlBody: mail.content_html || ''
        });
        if (matched && matched.code === code) {
          await recordHit(env, key, existingRule, matched.patternIndex);
          return new Response(JSON.stringify({ code: 0, message: 'Rule updated (hit recorded)', key, extractedCode: code }), { headers: corsHeaders });
        }
      }

      const newRule = buildRuleFromAI({
        sender: mail.from,
        domain: fromDomain,
        subject: mail.subject || '',
        textBody: mail.content_text || '',
        htmlBody: mail.content_html || '',
        code
      });
      await putRule(env, key, newRule);

      return new Response(JSON.stringify({ code: 0, message: 'Rule learned', key, extractedCode: code }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ code: 404, error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ code: 500, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
