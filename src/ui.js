/**
 * FlareMail 前端单页面 UI 生成器
 * 包含用户主页 getHtmlPage 与管理员 AI 日志页面 getAdminPage
 */

// 品牌 Logo：使用内联 SVG，避免外部图片加载失败或 base64 数据损坏
const LOGO_DATA_URI = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='12' fill='%23f97316'/%3E%3Cpath d='M14 14 h4 v4 h-4 z M30 14 h4 v4 h-4 z M14 30 h4 v4 h-4 z M30 30 h4 v4 h-4 z M14 22 h20 v2 h-20 z' fill='white'/%3E%3C/svg%3E";

const SHARED_STYLE = `
<style>
  :root {
    --primary: #f97316;
    --primary-hover: #ea580c;
    --bg: #f8fafc;
    --card-bg: #ffffff;
    --border: #e2e8f0;
    --text-main: #0f172a;
    --text-muted: #64748b;
    --success: #16a34a;
    --success-bg: #f0fdf4;
    --warning: #f59e0b;
    --warning-bg: #fbfef8;
    --error: #dc2626;
    --error-bg: #fef2f2;
    --info: #2563eb;
    --info-bg: #eff6ff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
  ::-webkit-scrollbar { display: none; }
  body { background: var(--bg); color: var(--text-main); font-family: inherit; }
  .container { width: 100%; max-width: 900px; margin: 0 auto; padding: 36px 16px 56px; }

  /* 品牌头部 */
  header { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
  .brand-badge { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px; text-decoration: none; }
  .brand-logo { width: 48px; height: 48px; border-radius: 12px; box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25); }
  .brand-title { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; color: #0f172a; display: flex; align-items: center; gap: 6px; }
  .brand-title span.flare { color: #f97316; }
  header p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }

  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03), 0 2px 4px -2px rgba(0,0,0,0.02); margin-bottom: 18px; }

  .status-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .status-badge { display: flex; align-items: center; font-size: 13px; font-weight: 600; color: #15803d; background: #dcfce7; padding: 5px 12px; border-radius: 20px; }
  .pulse-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 8px; box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2); animation: pulse 1.6s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.85); } }

  .email-box { display: flex; gap: 10px; margin: 8px 0; }
  .email-input { flex: 1; padding: 12px 16px; background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 16px; font-weight: 700; color: #1e293b; outline: none; letter-spacing: 0.5px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

  button { background: var(--primary); color: #fff; border: none; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all .15s ease; white-space: nowrap; }
  button:hover { background: var(--primary-hover); transform: translateY(-1px); }
  .btn-secondary { background: #f1f5f9; color: #334155; border: 1px solid var(--border); }
  .btn-secondary:hover { background: #e2e8f0; color: #0f172a; transform: none; }
  .btn-sm { padding: 6px 14px; font-size: 13px; }

  .meta-row { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-muted); margin-top: 8px; }

  /* 验证码醒目卡片 */
  .code-box { background: var(--success-bg); border: 2px dashed #86efac; border-radius: 14px; padding: 20px; text-align: center; margin-bottom: 18px; }
  .code-title { font-size: 13px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .code-value { font-size: 42px; font-weight: 900; color: #15803d; letter-spacing: 8px; margin: 8px 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .btn-copy-code { background: #16a34a; padding: 9px 24px; font-size: 14px; border-radius: 8px; }
  .btn-copy-code:hover { background: #15803d; }

  /* 邮件列表 */
  .list-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .mail-item { padding: 16px 12px; border-bottom: 1px solid var(--border); border-radius: 10px; cursor: pointer; transition: background .15s; }
  .mail-item:hover { background: #f8fafc; }
  .mail-item:last-child { border-bottom: none; }
  .mail-top { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
  .mail-from { font-weight: 700; color: #1e293b; font-size: 14px; }
  .mail-time { color: var(--text-muted); font-size: 12px; }
  .mail-subject { font-size: 15px; font-weight: 600; color: var(--text-main); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
  .code-tag { background: #dcfce7; color: #15803d; font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-family: monospace; }
  .mail-snippet { font-size: 13px; color: var(--text-muted); line-height: 1.5; }

  .empty-state { text-align: center; padding: 48px 16px; color: var(--text-muted); font-size: 14px; }
  .loading-spinner { display: inline-block; width: 20px; height: 20px; border: 2px solid #cbd5e1; border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 8px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* 模态框 */
  .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; padding: 20px; z-index: 99; backdrop-filter: blur(2px); }
  .modal-content { background: #fff; width: 100%; max-width: 700px; max-height: 85vh; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
  .modal-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
  .close-btn { font-size: 20px; border: none; background: transparent; color: #64748b; cursor: pointer; padding: 4px 8px; }
  iframe.email-frame { width: 100%; height: 420px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }

  /* ── 管理页面额外样式 ── */
  .nav-tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
  .tab-btn { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 8px 16px; border-radius: 8px 8px 0 0; font-size: 13px; cursor: pointer; border-bottom: none; margin-bottom: -1px; }
  .tab-btn:hover { background: #f1f5f9; color: var(--text-main); }
  .tab-btn.active { background: var(--card-bg); color: var(--primary); border-color: var(--border); border-bottom-color: var(--card-bg); }

  .admin-badge { font-size: 12px; font-weight: 700; color: var(--warning); background: var(--warning-bg); padding: 2px 8px; border-radius: 12px; margin-left: 8px; }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px; text-align: center; }
  .stat-value { font-size: 24px; font-weight: 800; color: var(--text-main); }
  .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .stat-value.ai-ok { color: var(--success); }
  .stat-value.ai-warn { color: var(--warning); }
  .stat-value.ai-err { color: var(--error); }

  .log-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .log-table th { text-align: left; padding: 10px 8px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; }
  .log-table td { padding: 10px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .log-table tr:hover { background: #f8fafc; }

  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; }
  .badge-extract { background: #dbeafe; color: #1e40af; }
  .badge-learn { background: #dcfce7; color: #166534; }

  .code-small { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700; color: #15803d; background: #f0fdf4; padding: 1px 6px; border-radius: 4px; }
  .code-null { color: #94a3b8; }

  .reason-box { font-size: 12px; color: var(--text-muted); white-space: pre-wrap; max-width: 400px; }
  .ts { font-size: 11px; color: var(--text-muted); font-family: ui-monospace, monospace; }

  .btn-refresh { background: #f1f5f9; color: #334155; border: 1px solid var(--border); padding: 6px 14px; font-size: 13px; border-radius: 8px; cursor: pointer; }
  .btn-refresh:hover { background: #e2e8f0; }

  footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px; }

  .hint { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
</style>
`;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTs(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function getHtmlPage(domain) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlareMail · 极速临时邮箱与验证码接收</title>
  <link rel="icon" href="${LOGO_DATA_URI}">
  ${SHARED_STYLE}
</head>
<body>
  <div class="container">
    <header>
      <div class="brand-badge">
        <img src="${LOGO_DATA_URI}" class="brand-logo" alt="FlareMail Logo">
        <h1 class="brand-title"><span class="flare">Flare</span>Mail</h1>
      </div>
      <p>极速边缘临时邮箱 · 验证码自动提取 · 阅后即焚</p>
    </header>

    <!-- 邮箱控制面板 -->
    <div class="card">
      <div class="status-row">
        <span class="status-badge"><span class="pulse-dot"></span>实时监听中</span>
        <button onclick="createNewMailbox()" class="btn-secondary btn-sm" style="padding:6px 14px; font-size:13px;">换一个邮箱</button>
      </div>
      <div class="email-box">
        <input type="text" id="emailInput" class="email-input" readonly value="正在分配临时邮箱...">
        <button onclick="copyEmail()">复制邮箱</button>
      </div>
      <div class="meta-row">
        <span>已绑定域名：@${escapeHtml(domain)}</span>
        <span id="countdown">有效倒计时：-- 分 -- 秒</span>
      </div>
    </div>

    <!-- 验证码高亮展示卡片 -->
    <div id="codeCard" class="card code-box" style="display:none;">
      <div class="code-title">🎯 成功提取验证码</div>
      <div id="codeValue" class="code-value">------</div>
      <button onclick="copyCode()" class="btn-copy-code">一键复制验证码</button>
    </div>

    <!-- 邮件列表 -->
    <div class="card">
      <div class="list-title">
        <span>收件箱</span>
        <button onclick="refreshMessages()" class="btn-secondary btn-sm">刷新</button>
        <span style="font-size:13px; font-weight:normal; color:var(--text-muted);" id="mailCountText">共 0 封</span>
      </div>
      <div id="mailList">
        <div class="empty-state">
          <div class="loading-spinner"></div>
          <div>正在等待发件方投递验证码邮件...</div>
        </div>
      </div>
    </div>

    <footer>
      Powered by FlareMail · Cloudflare Edge Network
    </footer>
  </div>

  <!-- 邮件详情弹窗 -->
  <div id="mailModal" class="modal-overlay" style="display:none;" onclick="closeModal(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="modalSubject" style="font-size:16px;">邮件详情</h3>
        <button class="close-btn" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:12px;" id="modalMeta"></div>
        <div id="modalFrameContainer"></div>
      </div>
    </div>
  </div>

  <script>
    let currentEmail = '';
    let currentToken = '';
    let expireTimestamp = 0;
    let pollTimer = null;
    let timerInterval = null;

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function createNewMailbox() {
      try {
        const res = await fetch('/api/mailbox/create', { method: 'POST' });
        const json = await res.json();
        if (json.code === 0) {
          currentEmail = json.data.email;
          currentToken = json.data.session_token;
          expireTimestamp = json.data.expires_at;

          document.getElementById('emailInput').value = currentEmail;
          document.getElementById('codeCard').style.display = 'none';
          document.getElementById('mailList').innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><div>正在等待发件方投递验证码邮件...</div></div>';
          document.getElementById('mailCountText').innerText = '共 0 封';

          sessionStorage.setItem('flaremail_email', currentEmail);
          sessionStorage.setItem('flaremail_token', currentToken);
          sessionStorage.setItem('flaremail_expires_at', String(expireTimestamp));

          startTimer();
          startPolling();
        }
      } catch (e) {
        alert('生成邮箱失败: ' + e.message);
      }
    }

    async function pollMessages() {
      if (!currentEmail || !currentToken) return;
      try {
        const res = await fetch('/api/mailbox/messages?email=' + encodeURIComponent(currentEmail), {
          headers: { 'X-Session-Token': currentToken }
        });
        const json = await res.json();
        if (json.code === 0 && Array.isArray(json.data)) {
          renderList(json.data);
        }
      } catch (e) {
        console.error('拉取邮件失败:', e);
      }
    }

    function renderList(list) {
      document.getElementById('mailCountText').innerText = '共 ' + list.length + ' 封';
      if (list.length === 0) {
        document.getElementById('codeCard').style.display = 'none';
        return;
      }

      const container = document.getElementById('mailList');
      container.innerHTML = '';

      let foundCode = null;
      list.forEach(mail => {
        if (!foundCode && mail.verification_code) {
          foundCode = mail.verification_code;
        }

        const item = document.createElement('div');
        item.className = 'mail-item';
        item.onclick = function() { openMailDetail(mail.id); };

        var fromDisplay = escapeHtml(mail.sender_name || mail.from);
        var timeDisplay = new Date(mail.received_at).toLocaleTimeString();
        var subjectDisplay = escapeHtml(mail.subject);
        var codeTag = '';
        if (mail.verification_code) {
          codeTag = '<span class="code-tag">CODE: ' + mail.verification_code + '</span>';
        }
        var snippetDisplay = escapeHtml(mail.summary);

        item.innerHTML =
          '<div class="mail-top">' +
            '<span class="mail-from">' + fromDisplay + '</span>' +
            '<span class="mail-time">' + timeDisplay + '</span>' +
          '</div>' +
          '<div class="mail-subject">' +
            '<span>' + subjectDisplay + '</span>' +
            codeTag +
          '</div>' +
          '<div class="mail-snippet">' + snippetDisplay + '</div>';

        container.appendChild(item);
      });

      if (foundCode) {
        document.getElementById('codeCard').style.display = 'block';
        document.getElementById('codeValue').innerText = foundCode;
      } else {
        document.getElementById('codeCard').style.display = 'none';
      }
    }

    async function openMailDetail(mailId) {
      try {
        var url = '/api/mailbox/message/' + mailId + '?email=' + encodeURIComponent(currentEmail);
        const res = await fetch(url, {
          headers: { 'X-Session-Token': currentToken }
        });
        const json = await res.json();
        if (json.code === 0) {
          const mail = json.data;
          document.getElementById('modalSubject').innerText = mail.subject;
          document.getElementById('modalMeta').innerText = '发件人: ' + mail.from + ' | 时间: ' + new Date(mail.received_at).toLocaleString();

          const frameContainer = document.getElementById('modalFrameContainer');
          frameContainer.innerHTML = '';

          if (mail.content_html) {
            const iframe = document.createElement('iframe');
            iframe.className = 'email-frame';
            iframe.sandbox = 'allow-popups';
            iframe.srcdoc = mail.content_html;
            frameContainer.appendChild(iframe);
          } else {
            const pre = document.createElement('pre');
            pre.style = 'white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 13px; color: #334155;';
            pre.innerText = mail.content_text || '(无正文)';
            frameContainer.appendChild(pre);
          }

          document.getElementById('mailModal').style.display = 'flex';
        }
      } catch (e) {
        alert('读取邮件详情失败: ' + e.message);
      }
    }

    function closeModal() {
      document.getElementById('mailModal').style.display = 'none';
    }

    function copyEmail() {
      const email = document.getElementById('emailInput').value;
      if (email.includes('@')) {
        navigator.clipboard.writeText(email);
        alert('邮箱已复制到剪贴板！');
      }
    }

    function copyCode() {
      const code = document.getElementById('codeValue').innerText;
      navigator.clipboard.writeText(code);
      alert('验证码 ' + code + ' 已复制！');
    }

    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      const timerEl = document.getElementById('countdown');
      const update = function() {
        const remain = Math.max(0, Math.floor((expireTimestamp - Date.now()) / 1000));
        const m = Math.floor(remain / 60);
        const s = remain % 60;
        var sStr = s < 10 ? '0' + s : s;
        timerEl.innerText = '有效倒计时：' + m + ' 分 ' + sStr + ' 秒';
        if (remain <= 0) {
          clearInterval(timerInterval);
          clearInterval(pollTimer);
          timerEl.innerText = '⚠️ 邮箱已过期销毁';
        }
      };
      update();
      timerInterval = setInterval(update, 1000);
    }

    async function refreshMessages() {
      if (!currentEmail || !currentToken) return;
      const btn = event.currentTarget;
      const originalText = btn.innerText;
      btn.innerText = '刷新中...';
      btn.disabled = true;
      try {
        await pollMessages();
      } catch (e) {
        console.error('刷新失败:', e);
        alert('刷新失败: ' + e.message);
      } finally {
        btn.innerText = originalText;
        btn.disabled = false;
      }
    }

    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollMessages();
      pollTimer = setInterval(pollMessages, 3000);
    }

    // 刷新页面时优先恢复已有会话，只有没有可用会话才创建新邮箱
    function restoreMailbox() {
      const email = sessionStorage.getItem('flaremail_email');
      const token = sessionStorage.getItem('flaremail_token');
      const expiresAt = sessionStorage.getItem('flaremail_expires_at');
      if (!email || !token || !expiresAt) return false;

      expireTimestamp = parseInt(expiresAt, 10);
      if (Date.now() >= expireTimestamp) {
        sessionStorage.removeItem('flaremail_email');
        sessionStorage.removeItem('flaremail_token');
        sessionStorage.removeItem('flaremail_expires_at');
        return false;
      }

      currentEmail = email;
      currentToken = token;
      document.getElementById('emailInput').value = currentEmail;
      document.getElementById('codeCard').style.display = 'none';
      document.getElementById('mailList').innerHTML = '<div class="empty-state"><div class="loading-spinner"></div><div>正在等待发件方投递验证码邮件...</div></div>';
      document.getElementById('mailCountText').innerText = '共 0 封';

      startTimer();
      startPolling();
      return true;
    }

    window.onload = function() {
      if (!restoreMailbox()) {
        createNewMailbox();
      }
    };
  </script>
</body>
</html>`;
}

/**
 * 管理页面：AI 工作日志 / 规则升级历史
 * 只读，供开发者/管理员查看 AI 提取行为
 */
export function getAdminPage(domain) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FlareMail · AI 工作日志管理</title>
  <link rel="icon" href="${LOGO_DATA_URI}">
  ${SHARED_STYLE}
</head>
<body>
  <div class="container">
    <header style="text-align:left; align-items:flex-start;">
      <div class="brand-badge" style="margin-bottom:4px;">
        <img src="${LOGO_DATA_URI}" class="brand-logo" alt="FlareMail Logo">
        <h1 class="brand-title" style="font-size:22px;"><span class="flare">Flare</span>Mail <span class="admin-badge">管理后台</span></h1>
      </div>
      <p style="color:var(--text-muted); font-size:13px;">AI 验证码提取工作日志 · 最近 7 天</p>
    </header>

    <div class="nav-tabs">
      <button class="tab-btn active" onclick="switchTab('extract')">提取日志</button>
      <button class="tab-btn" onclick="switchTab('learn')">自学习 / 规则升级</button>
    </div>

    <div class="stat-grid" id="statGrid">
      <div class="stat-card">
        <div class="stat-value ai-ok" id="statTotal">-</div>
        <div class="stat-label">AI 调用总次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ai-ok" id="statSuccess">-</div>
        <div class="stat-label">成功提取</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ai-warn" id="statFailed">-</div>
        <div class="stat-label">提取失败</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ai-err" id="statLimit">-</div>
        <div class="stat-label">每日达上限</div>
      </div>
    </div>

    <div class="card">
      <div class="status-row" style="margin-bottom:12px;">
        <span id="tabTitle">最近 AI 提取记录</span>
        <div style="display:flex; gap:8px;">
          <button class="btn-refresh btn-sm" onclick="refreshLogs()">刷新</button>
          <button class="btn-refresh btn-sm" onclick="pingAI()" style="background:#e2e8f0;color:#334155;">AI Ping 测试</button>
        </div>
      </div>
      <div id="pingResult" style="display:none; font-size:13px; color:var(--text-muted); background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:12px; white-space:pre-wrap; line-height:1.7;"></div>
      <div id="logContainer">
        <div class="empty-state">正在加载日志...</div>
      </div>
    </div>

    <div class="hint">说明：<br>• 提取日志：每封进入第 3 层（AI 兜底）的邮件都会记录，包含提取结果、置信度、失败原因。<br>• 自学习日志：手动触发 /api/rules/learn 时记录，显示 AI 是否参与及推断出的规则类型。<br>• 日志保留 7 天，随后自动过期。</div>

    <footer>
      Powered by FlareMail · Cloudflare Edge Network
    </footer>
  </div>

  <script>
    let currentTab = 'extract';
    let allLogs = [];

    async function refreshLogs() {
      try {
        const res = await fetch('/api/admin/logs?tab=' + currentTab);
        const json = await res.json();
        if (json.code === 0) {
          allLogs = json.data || [];
          renderStats(allLogs);
          renderLogs(allLogs);
        } else {
          document.getElementById('logContainer').innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(json.error || '未知错误') + '</div>';
        }
      } catch (e) {
        document.getElementById('logContainer').innerHTML = '<div class="empty-state">请求异常：' + escapeHtml(e.message) + '</div>';
      }
    }

    async function pingAI() {
      const btn = event.currentTarget;
      const resultEl = document.getElementById('pingResult');
      const originalText = btn.innerText;
      btn.innerText = 'Ping 中...';
      resultEl.style.display = 'block';
      resultEl.style.color = 'var(--text-muted)';
      resultEl.innerText = '正在调用 AI 模型，请稍候...';
      const start = Date.now();
      try {
        const res = await fetch('/api/admin/ping-ai?force=1');
        const json = await res.json();
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        if (json.code === 0 && json.data.ok) {
          const prov = json.data.provider === 'workers-ai'
            ? 'Cloudflare Workers AI · 兜底通道'
            : '外部供应商';
          resultEl.style.color = 'var(--success)';
          resultEl.innerText = '✅ AI 连接正常（耗时 ' + elapsed + 's · ' + prov + '）· 模型即兴创作：\\n\\n' + (json.data.response || '(空响应)');
        } else {
          resultEl.style.color = 'var(--error)';
          resultEl.innerText = '❌ 两条 AI 通道均异常（耗时 ' + elapsed + 's）\\n外部供应商：' + (json.data?.detail?.external?.error || '未测试') + '\\nWorkers AI：' + (json.data?.detail?.workersAI?.error || '未测试');
        }
      } catch (e) {
        resultEl.style.color = 'var(--error)';
        resultEl.innerText = '❌ 请求异常：' + e.message;
      } finally {
        btn.innerText = originalText;
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('tabTitle').innerText = tab === 'extract' ? '最近 AI 提取记录' : '自学习 / 规则升级记录';
      renderLogs(allLogs.filter(l => l.type === (tab === 'extract' ? 'extract' : 'learn')));
      renderStats(allLogs);
    }

    function renderStats(logs) {
      const total = logs.length;
      const success = logs.filter(l => l.extractedCode).length;
      const failed = logs.filter(l => l.type === 'extract' && !l.extractedCode && !l.dailyLimitReached).length;
      const limit = logs.filter(l => l.dailyLimitReached).length;

      document.getElementById('statTotal').innerText = total;
      document.getElementById('statSuccess').innerText = success;
      document.getElementById('statFailed').innerText = failed;
      document.getElementById('statLimit').innerText = limit;
    }

    function renderLogs(logs) {
      const container = document.getElementById('logContainer');
      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无记录</div>';
        return;
      }

      // 按时间倒序
      const sorted = [...logs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      let html = '<table class="log-table"><thead><tr>';
      if (currentTab === 'extract') {
        html += '<th style="width:16%;">时间</th><th style="width:22%;">发件人</th><th style="width:14%;">域名</th><th style="width:12%;">主题</th><th style="width:10%;">结果</th><th style="width:10%;">置信度</th><th style="width:14%;">原因 / 失败信息</th><th style="width:12%;">提取码</th>';
      } else {
        html += '<th style="width:16%;">时间</th><th style="width:22%;">发件人</th><th style="width:14%;">域名</th><th style="width:12%;">主题</th><th style="width:10%;">AI 参与</th><th style="width:10%;">置信度</th><th style="width:14%;">原因</th><th style="width:12%;">提取码</th>';
      }
      html += '</tr></thead><tbody>';

      sorted.forEach(log => {
        const isExtract = log.type === 'extract';
        const ok = !!log.extractedCode;
        const resultCls = ok ? 'badge-extract' : (log.dailyLimitReached ? 'badge-learn' : '');
        const resultText = isExtract ? (ok ? '成功' : (log.dailyLimitReached ? '达上限' : '失败')) : (ok ? '已学习' : '学习失败');
        const conf = log.confidence ? (log.confidence * 100).toFixed(0) + '%' : '-';
        const codeHtml = ok ? '<span class="code-small">' + escapeHtml(log.extractedCode) + '</span>' : '<span class="code-null">-</span>';
        const reasonHtml = '<div class="reason-box">' + escapeHtml(log.reason || '-') + '</div>';
        const fromHtml = escapeHtml(log.from || '-');
        const domainHtml = escapeHtml(log.domain || '-');
        const subjectHtml = escapeHtml(log.subject || '-');
        const tsHtml = '<div class="ts">' + formatTs(log.timestamp) + '</div>';

        html += '<tr>';
        html += '<td>' + tsHtml + '</td>';
        html += '<td>' + fromHtml + '</td>';
        html += '<td>' + domainHtml + '</td>';
        html += '<td><div class="reason-box" style="max-width:180px;">' + subjectHtml + '</div></td>';
        html += '<td><span class="badge ' + resultCls + '">' + resultText + '</span></td>';
        html += '<td>' + conf + '</td>';
        html += '<td>' + reasonHtml + '</td>';
        html += '<td>' + codeHtml + '</td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
      container.innerHTML = html;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function formatTs(ts) {
      if (!ts) return '--';
      return new Date(ts).toLocaleString('zh-CN', { hour12: false });
    }

    refreshLogs();
  </script>
</body>
</html>`;
}