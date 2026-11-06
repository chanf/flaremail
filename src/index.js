/**
 * Cloudflare Worker 主入口
 * 聚合处理 Email 邮件事件 与 Fetch HTTP 流量
 */
import { handleIncomingEmail } from './email-handler.js';
import { handleApiRequest } from './api-handler.js';
import { getHtmlPage } from './ui.js';

export default {
  // 1. 邮件接收事件处理器
  async email(message, env, ctx) {
    await handleIncomingEmail(message, env, ctx);
  },

  // 2. HTTP 流量处理器 (Web 页面 + API 接口)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 静态前端主页渲染
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = getHtmlPage(env.DOMAIN || 'example.com');
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // 后端 RESTful API 路由处理
    if (url.pathname.startsWith('/api/')) {
      return await handleApiRequest(request, env, ctx);
    }

    return new Response('404 Not Found', { status: 404 });
  }
};
