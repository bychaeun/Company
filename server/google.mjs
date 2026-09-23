import { createPrivateKey, createHash } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function authorizationUrl(config, flow) {
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/auth/callback`,
    response_type: 'code', scope: 'openid email profile', state: flow.state, nonce: flow.nonce,
    code_challenge: createHash('sha256').update(flow.verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}
export async function exchangeIdentity(config, code, flow) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: `${config.origin}/auth/callback`, grant_type: 'authorization_code', code_verifier: flow.verifier }) });
  if (!response.ok) throw new Error('Google token exchange failed');
  const tokens = await response.json();
  const { payload } = await jwtVerify(tokens.id_token, keys, { audience: config.clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'], algorithms: ['RS256'], maxTokenAge: '10m' });
  if (payload.nonce !== flow.nonce || payload.email_verified !== true || typeof payload.email !== 'string' || !payload.sub) throw new Error('Unverified identity');
  return payload;
}

export function createGoogleSource(env) {
  let token, tokenExpires = 0, snapshot = null, refreshing = null;
  const configured = Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON && env.GOOGLE_SHEET_ID);
  async function accessToken() {
    if (token && Date.now() < tokenExpires) return token;
    const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(account.client_email).setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt().setExpirationTime('1h').sign(createPrivateKey(account.private_key));
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!response.ok) throw new Error('Sheet authentication failed');
    const value = await response.json();
    token = value.access_token; tokenExpires = Date.now() + 50 * 60000;
    return token;
  }
  async function refresh() {
    if (!configured) throw new Error('Sheet not configured');
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const range = encodeURIComponent("'메모'!A:G");
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}/values/${range}`, {
        headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Sheet read failed');
      const { values = [] } = await response.json();
      const headers = values[0] || [];
      if (!['대분류','소분류','제목','부제목','내용','이미지','수정일'].every(h => headers.includes(h))) throw new Error('Invalid sheet headers');
      let blockedImages = 0;
      const records = values.slice(1).map(row => {
        const get = name => String(row[headers.indexOf(name)] || '');
        return { category: get('대분류') || '기타', subcategory: get('소분류'), title: get('제목'), subtitle: get('부제목'), content: get('내용'), updatedAt: get('수정일'),
          images: get('이미지').split(/[|\n;]/).map(value => {
            const id = driveFileId(value.trim());
            if (!id && value.trim()) blockedImages++;
            return id ? `/api/images/${id}` : '';
          }).filter(Boolean) };
      }).filter(row => row.title || row.content);
      snapshot = { records, syncedAt: new Date().toISOString(), syncMode: 'scheduled', blockedImages };
      return snapshot;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  const accessHeaders = ['Google ID', '이메일', '이름', '승인상태', '최초 로그인', '최근 로그인'];
  let accessReady = false, writes = Promise.resolve();
  async function sheetApi(path, body, method = 'POST') {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}${path}`, {
      method: body ? method : 'GET', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Access sheet unavailable');
    return response.json();
  }
  async function accessRows() {
    if (!configured) throw new Error('Sheet not configured');
    if (!accessReady) {
      const metadata = await sheetApi('?fields=sheets.properties.title');
      if (!metadata.sheets.some(s => s.properties.title === '접근관리')) {
        await sheetApi(':batchUpdate', { requests: [{ addSheet: { properties: { title: '접근관리', gridProperties: { frozenRowCount: 1 } } } }] });
        await sheetApi(`/values/${encodeURIComponent("'접근관리'!A1:F1")}?valueInputOption=RAW`, { values: [accessHeaders] }, 'PUT');
      }
      accessReady = true;
    }
    const { values = [] } = await sheetApi(`/values/${encodeURIComponent("'접근관리'!A:F")}`);
    if (!accessHeaders.every((h, i) => values[0]?.[i] === h)) throw new Error('Access sheet header mismatch');
    const rows = values.slice(1).map((row, i) => ({ sub: row[0], email: row[1], name: row[2], status: row[3], created: row[4], lastLogin: row[5], row: i + 2 })).filter(r => r.sub);
    if (new Set(rows.map(r => r.sub)).size !== rows.length) throw new Error('Duplicate access identity');
    return rows;
  }
  function queueWrite(action) {
    const result = writes.then(action);
    writes = result.catch(() => {});
    return result;
  }
  return {
    accessRows,
    recordLogin(identity) {
      return queueWrite(async () => {
        const rows = await accessRows();
        const existing = rows.find(r => r.sub === identity.sub);
        const now = new Date().toISOString();
        if (existing) {
          await sheetApi('/values:batchUpdate', { valueInputOption: 'RAW', data: [
            { range: `'접근관리'!B${existing.row}:C${existing.row}`, values: [[identity.email, identity.name || identity.email]] },
            { range: `'접근관리'!F${existing.row}`, values: [[now]] }
          ] });
        } else {
          await sheetApi(`/values/${encodeURIComponent("'접근관리'!A:F")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { values: [[identity.sub, identity.email, identity.name || identity.email, '대기', now, now]] });
        }
      });
    },
    setAccess(sub, status) {
      return queueWrite(async () => {
        if (!['승인', '대기', '거절', '차단'].includes(status)) throw new Error('Invalid access status');
        const rows = await accessRows();
        const row = rows.find(r => r.sub === sub);
        if (!row) throw new Error('Unknown account');
        await sheetApi(`/values/${encodeURIComponent(`'접근관리'!D${row.row}`)}?valueInputOption=RAW`, { values: [[status]] }, 'PUT');
      });
    },
    configured, refresh,
    async notes() {
      if (!snapshot || Date.now() - Date.parse(snapshot.syncedAt) > 30 * 60000) return refresh();
      return { ...snapshot, stale: Date.now() - Date.parse(snapshot.syncedAt) > 35 * 60000 };
    },
    async image(id) {
      // Only files actually linked from the current memo snapshot may be requested. Never proxy arbitrary URLs.
      if (!snapshot?.records.some(row => row.images.includes(`/api/images/${id}`))) return null;
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
        headers: { authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(response.headers.get('content-type') || '')) return null;
      const limit = 10 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); return null; }
      const parts = []; let length = 0;
      for await (const part of response.body) {
        length += part.length;
        if (length > limit) return null;
        parts.push(part);
      }
      return { type: response.headers.get('content-type'), body: Buffer.concat(parts) };
    }
  };
}

export function driveFileId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;
    const id = url.pathname.match(/^\/file\/d\/([-\w]+)(?:\/|$)/)?.[1] || url.searchParams.get('id');
    return id && /^[-\w]{10,200}$/.test(id) ? id : null;
  } catch { return null; }
}

