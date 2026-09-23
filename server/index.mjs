import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStore } from './store.mjs';
import { createGoogleSource } from './google.mjs';
import { createApp } from './http.mjs';

const port = Number(process.env.PORT || 4174);
const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const url = new URL(origin);
if (url.origin !== origin || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('APP_ORIGIN must be an HTTPS origin (localhost allowed for development)');
if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production requires HTTPS');
const directory = resolve(process.env.PRIVATE_DATA_DIR || '.private');
await mkdir(directory, { recursive: true });
const config = { origin, clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean) };
const store = createStore(resolve(directory, 'access.sqlite'), config.adminEmails);
const source = createGoogleSource(process.env);
const server = createApp({ config, store, source });
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`CHAE EUN.ZIP: ${origin}`));
const sync = () => source.refresh().catch(() => console.warn('Private sheet sync unavailable; no data was published.'));
if (source.configured) sync();
const timer = setInterval(() => { if (source.configured) sync(); }, 30 * 60000);
timer.unref();
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(() => { store.close(); process.exit(0); }); });

