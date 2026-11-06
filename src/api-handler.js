/**
 * RESTful HTTP API 处理模块
 */
import { generateRandomString, hashToken, verifySession } from './auth.js';

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

    return new Response(JSON.stringify({ code: 404, error: 'Endpoint Not Found' }), { status: 404, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ code: 500, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
