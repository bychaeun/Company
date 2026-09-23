import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { authorizationUrl, exchangeIdentity } from './google.mjs';

const assets = new Map(Object.entries({ '/': ['index.html','text/html'], '/index.html': ['index.html','text/html'],
  '/app.js': ['app.js','text/javascript'], '/auth.js': ['auth.js','text/javascript'], '/styles.css': ['styles.css','text/css'],
  '/config.js': ['config.js','text/javascript'], '/manifest.webmanifest': ['manifest.webmanifest','application/manifest+json'],
  '/service-worker.js': ['service-worker.js','text/javascript'], '/favicon.svg': ['favicon.svg','image/svg+xml'],
  '/assets/pudding-mascot.png': ['assets/pudding-mascot.png','image/png'] }));
const statusNames = { '승인': 'approved', '대기': 'pending', '거절': 'rejected', '차단': 'rejected' };
const cookieValue = (req, name) => (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);

export function createApp({ config, store, source, root = new URL('../', import.meta.url), identityExchange = exchangeIdentity }) {
  const secure = config.origin.startsWith('https:');
  const cookieName = secure ? '__Host-chae_session' : 'chae_session';
  const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const json = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const redirect = (res, location) => { res.writeHead(302, { location }); res.end(); };
  async function userFor(req) {
    const user = store.session(cookieValue(req, cookieName));
    if (!user) return null;
    if (user.role !== 'admin') {
      // Approval is authoritative in Sheets. Recheck every protected request; fail closed on outages.
      const rows = await source.accessRows();
      user.status = statusNames[rows.find(r => r.sub === user.sub)?.status] || 'pending';
    }
    return user;
  }
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('Body too large'); }
    return JSON.parse(text);
  }
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, config.origin);
      const path = url.pathname;
      if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/auth/google') {
        if (!config.clientId || !config.clientSecret || !config.adminEmails.length || !source.configured) return redirect(res, '/?auth=setup');
        const flow = store.startOAuth();
        res.setHeader('Set-Cookie', cookie('chae_oauth', flow.token, 600));
        return redirect(res, authorizationUrl(config, flow));
      }
      if (req.method === 'GET' && path === '/auth/callback') {
        const flow = store.consumeOAuth(cookieValue(req, 'chae_oauth'), url.searchParams.get('state'));
        res.setHeader('Set-Cookie', cookie('chae_oauth', '', 0));
        if (!flow || !url.searchParams.get('code')) return redirect(res, '/?auth=failed');
        try {
          const identity = await identityExchange(config, url.searchParams.get('code'), flow);
          await source.recordLogin(identity);
          const token = store.login(identity);
          res.setHeader('Set-Cookie', [cookie('chae_oauth', '', 0), cookie(cookieName, token, 7 * 86400)]);
          return redirect(res, '/');
        } catch { return redirect(res, '/?auth=failed'); }
      }
      if (path.startsWith('/api/')) {
        const user = await userFor(req);
        if (req.method === 'GET' && path === '/api/me') return json(res, 200, { user: user && { sub: user.sub, email: user.email, name: user.name, role: user.role, status: user.status }, csrf: user?.csrf,
          configured: Boolean(config.clientId && config.clientSecret && config.adminEmails.length && source.configured) });
        if (!user) return json(res, 401, { error: '로그인이 필요합니다.' });
        if (req.method !== 'GET' && (req.headers.origin !== config.origin || req.headers['x-csrf-token'] !== user.csrf)) return json(res, 403, { error: '요청을 확인할 수 없습니다.' });
        if (req.method === 'POST' && path === '/api/logout') {
          store.logout(cookieValue(req, cookieName)); res.setHeader('Set-Cookie', cookie(cookieName, '', 0));
          return json(res, 200, { ok: true });
        }
        if (user.status !== 'approved') return json(res, 403, { error: '관리자의 승인이 필요합니다.' });
        if (req.method === 'GET' && path === '/api/notes') {
          const notes = await source.notes();
          if ((await userFor(req))?.status !== 'approved') return json(res, 403, { error: '접근이 제한되었습니다.' });
          return json(res, 200, notes);
        }
        if (req.method === 'GET' && /^\/api\/images\/[-\w]{10,200}$/.test(path)) {
          const image = await source.image(path.split('/').pop());
          if (!image) return json(res, 404, { error: '이미지를 읽을 수 없습니다.' });
          // Revocation during a slow upstream image download still prevents delivery.
          if ((await userFor(req))?.status !== 'approved') return json(res, 403, { error: '접근이 제한되었습니다.' });
          res.writeHead(200, { 'content-type': image.type }); return res.end(image.body);
        }
        if (path.startsWith('/api/admin/')) {
          if (user.role !== 'admin') return json(res, 403, { error: '관리자만 사용할 수 있습니다.' });
          if (req.method === 'GET' && path === '/api/admin/users') {
            const users = await source.accessRows();
            return json(res, 200, { users: users.map(u => ({ ...u, admin: store.users().some(local => local.sub === u.sub && local.role === 'admin') })) });
          }
          if (req.method === 'POST' && path === '/api/admin/users') {
            const { sub, status } = await body(req);
            if (typeof sub !== 'string' || !['승인','거절','차단','대기'].includes(status) || store.users().some(u => u.sub === sub && u.role === 'admin')) return json(res, 400, { error: '변경할 수 없는 계정 또는 상태입니다.' });
            await source.setAccess(sub, status);
            return json(res, 200, { ok: true });
          }
          if (req.method === 'POST' && path === '/api/admin/sync') { await source.refresh(); return json(res, 200, { ok: true }); }
        }
        return json(res, 404, { error: '경로를 찾을 수 없습니다.' });
      }
      if (req.method !== 'GET' || !assets.has(path)) return json(res, 404, { error: '경로를 찾을 수 없습니다.' });
      const [file, type] = assets.get(path);
      const data = await readFile(new URL(file, root));
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); res.end(data);
    } catch {
      // Never log tokens, user profiles or private note bodies.
      json(res, 503, { error: '연결을 확인할 수 없어 접근을 제한했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  });
}

