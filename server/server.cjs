const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = Number(process.env.BETAF_PORT || 3000);
const HOST = process.env.BETAF_HOST || '0.0.0.0';
const DATA_DIR = process.env.BETAF_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'betaf.sqlite');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SESSION_TTL = 8 * 60 * 60 * 1000;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    fullname TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager','viewer')),
    password TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL,
    details TEXT
  );
`);
const meta = key => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
const setMeta = (key, value) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
const hash = value => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(value, salt, 64).toString('hex')}`;
};
const verify = (value, stored) => {
  const [salt, digest] = String(stored || '').split(':');
  if (!salt || !digest) return false;
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), crypto.scryptSync(value, salt, 64));
};
if (!meta('version')) setMeta('version', '0');
if (!meta('data')) setMeta('data', JSON.stringify({ clients: [], docs: [], documentTypes: [], archive: [], settings: {} }));
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  db.prepare('INSERT INTO users(id,username,fullname,role,password,created_at) VALUES(?,?,?,?,?,?)')
    .run('admin', 'admin', 'Administrateur BETAF', 'admin', hash(process.env.BETAF_ADMIN_PASSWORD || 'BETAF-ChangeMe-2026'), new Date().toISOString());
}
const readData = () => ({ version: Number(meta('version') || 0), data: JSON.parse(meta('data') || '{}') });
const audit = (user, action, details = '') => db.prepare('INSERT INTO audit(user_id,action,created_at,details) VALUES(?,?,?,?)').run(user.id, action, new Date().toISOString(), details);
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const body = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 25 * 1024 * 1024) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); } });
  req.on('error', reject);
});
const auth = req => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) return null;
  session.expires = Date.now() + SESSION_TTL;
  return session.user;
};
const snapshot = () => fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `betaf-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`));

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { ok: true, service: 'BETAF Studio Server', database: 'SQLite' });
    if (req.method === 'POST' && req.url === '/api/login') {
      const input = await body(req);
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(input.username || ''));
      if (!row || !verify(String(input.password || ''), row.password)) return json(res, 401, { error: 'Identifiants invalides' });
      const user = { id: row.id, username: row.username, fullname: row.fullname, role: row.role };
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { user, expires: Date.now() + SESSION_TTL });
      audit(user, 'login');
      return json(res, 200, { token, user, version: readData().version });
    }
    const user = auth(req);
    if (!user) return json(res, 401, { error: 'Authentification requise' });
    if (req.method === 'GET' && req.url === '/api/state') return json(res, 200, readData());
    if (req.method === 'PUT' && req.url === '/api/state') {
      if (!['admin', 'manager'].includes(user.role)) return json(res, 403, { error: 'Droits insuffisants' });
      const input = await body(req);
      const current = readData();
      if (Number(input.version) !== current.version) return json(res, 409, { error: 'Conflit de synchronisation', state: current });
      if (!input.data || typeof input.data !== 'object') return json(res, 400, { error: 'Données invalides' });
      snapshot();
      setMeta('data', JSON.stringify(input.data));
      setMeta('version', String(current.version + 1));
      audit(user, 'state-updated', `version=${current.version + 1}`);
      return json(res, 200, { ok: true, version: current.version + 1 });
    }
    if (req.url === '/api/users' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, 403, { error: 'Droits insuffisants' });
      return json(res, 200, { users: db.prepare('SELECT id,username,fullname,role,created_at FROM users ORDER BY fullname').all() });
    }
    if (req.url === '/api/users' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, 403, { error: 'Droits insuffisants' });
      const input = await body(req);
      if (!input.username || !input.fullname || String(input.password || '').length < 8) return json(res, 400, { error: 'Nom, utilisateur et mot de passe de 8 caractères minimum requis' });
      const id = `user-${crypto.randomUUID()}`;
      try {
        db.prepare('INSERT INTO users(id,username,fullname,role,password,created_at) VALUES(?,?,?,?,?,?)').run(id, input.username.trim(), input.fullname.trim(), input.role || 'viewer', hash(input.password), new Date().toISOString());
      } catch (error) { return json(res, 409, { error: 'Ce nom utilisateur existe déjà' }); }
      audit(user, 'user-created', id);
      return json(res, 201, { id });
    }
    const userMatch = req.url.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && req.method === 'DELETE') {
      if (user.role !== 'admin' || userMatch[1] === 'admin') return json(res, 403, { error: 'Action interdite' });
      db.prepare('DELETE FROM users WHERE id = ?').run(userMatch[1]);
      audit(user, 'user-deleted', userMatch[1]);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/audit') {
      if (user.role !== 'admin') return json(res, 403, { error: 'Droits insuffisants' });
      return json(res, 200, { entries: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all() });
    }
    return json(res, 404, { error: 'Route introuvable' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Erreur interne du serveur' });
  }
}).listen(PORT, HOST, () => console.log(`BETAF Studio Server listening on ${HOST}:${PORT}`));
