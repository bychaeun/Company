import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');

export function createStore(filename, ownerEmails) {
  const owners = new Set(ownerEmails.map(email => email.toLowerCase()));
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, sub TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, state TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT, target TEXT, status TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const clean = () => {
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('DELETE FROM oauth WHERE expires < ?').run(Date.now());
  };
  // Bootstrap exactly one owner from a verified Google-hosted email; pin ownership to immutable sub.
  function isOwner(sub) {
    return Array.from(owners).some(email => db.prepare('SELECT value FROM settings WHERE key=?').get(`owner:${email}`)?.value === sub);
  }
  function login(identity) {
    clean();
    const email = identity.email.toLowerCase();
    if (owners.has(email) && (email.endsWith('@gmail.com') || identity.hd === email.split('@')[1])) {
      db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run(`owner:${email}`, identity.sub);
    }
    db.prepare(`INSERT INTO users(sub,email,name,status,created) VALUES(?,?,?,'pending',?)
      ON CONFLICT(sub) DO UPDATE SET email=excluded.email,name=excluded.name`).run(identity.sub, email, identity.name || email, new Date().toISOString());
    const token = randomToken();
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), identity.sub, randomToken(), Date.now() + 7 * 86400000);
    return token;
  }
  function session(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT users.*, sessions.csrf FROM sessions JOIN users USING(sub)
      WHERE hash=? AND expires>?`).get(digest(token), Date.now());
    return row ? { ...row, role: isOwner(row.sub) ? 'admin' : 'member', status: isOwner(row.sub) ? 'approved' : row.status } : null;
  }
  return {
    login, session, close: () => db.close(),
    logout: token => { if (token) db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)); },
    users: () => db.prepare('SELECT sub,email,name,status,created FROM users ORDER BY created DESC').all().map(u => ({ ...u, role: isOwner(u.sub) ? 'admin' : 'member', status: isOwner(u.sub) ? 'approved' : u.status })),
    setStatus(actor, target, status) {
      if (!isOwner(actor) || isOwner(target) || !['approved', 'rejected', 'pending'].includes(status)) return false;
      const result = db.prepare('UPDATE users SET status=? WHERE sub=?').run(status, target);
      if (!result.changes) return false;
      db.prepare('INSERT INTO audit(actor,target,status,created) VALUES(?,?,?,?)').run(actor, target, status, new Date().toISOString());
      // Revoked users retain identity for the waiting screen but every API rechecks current status.
      return true;
    },
    startOAuth() {
      clean();
      const flow = { token: randomToken(), state: randomToken(), verifier: randomToken(), nonce: randomToken() };
      db.prepare('INSERT INTO oauth VALUES(?,?,?,?,?)').run(digest(flow.token), flow.state, flow.verifier, flow.nonce, Date.now() + 10 * 60000);
      return flow;
    },
    consumeOAuth(token, state) {
      if (!token || !state) return null;
      const flow = db.prepare('SELECT * FROM oauth WHERE hash=? AND expires>?').get(digest(token), Date.now());
      if (!flow || flow.state !== state) return null;
      db.prepare('DELETE FROM oauth WHERE hash=?').run(digest(token));
      return flow;
    }
  };
}

