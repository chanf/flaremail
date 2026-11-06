/**
 * 安全鉴权与工具函数
 */

export function generateRandomString(len = 8) {
  // 排除容易混淆的字符：0, o, 1, l, i
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let res = '';
  const randomValues = new Uint8Array(len);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < len; i++) {
    res += chars[randomValues[i] % chars.length];
  }
  return res;
}

export async function hashToken(token) {
  const msgUint8 = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySession(kv, email, clientToken) {
  if (!email || !clientToken) return false;
  const sessionRaw = await kv.get(`session:${email}`);
  if (!sessionRaw) return false;

  try {
    const session = JSON.parse(sessionRaw);
    const clientHash = await hashToken(clientToken);
    return session.token_hash === clientHash;
  } catch {
    return false;
  }
}
