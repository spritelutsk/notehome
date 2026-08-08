// Admin-only web terminal: WebSocket <-> real PTY (bash), spawned as the app's own OS user.
// Auth is re-checked on every WebSocket upgrade using the same session cookie as the rest of the app.
const os = require('os');
const pty = require('node-pty');
const { WebSocketServer } = require('ws');
const pool = require('./db');
const { COOKIE_NAME } = require('./auth');

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

async function authenticateFromCookies(header) {
  const cookies = parseCookies(header);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.is_admin, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (rows.length === 0) return null;
  const session = rows[0];
  if (new Date(session.expires_at) < new Date()) return null;
  if (!session.is_admin) return null;
  return { id: session.id, email: session.email };
}

// Browsers always send Origin on a WebSocket handshake, and SameSite=Lax should already stop a
// cross-site page from getting the session cookie attached to this request in the first place —
// but this endpoint is a full remote shell, so it gets an explicit belt-and-braces check too.
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (_) {
    return false;
  }
}

function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url.startsWith('/api/admin/terminal')) return; // let other upgrade handlers (if any) deal with it
    if (!isAllowedOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const user = await authenticateFromCookies(req.headers.cookie);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, user);
      });
    } catch (err) {
      console.error('terminal auth error', err);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req, user) => {
    const shell = process.env.SHELL || '/bin/bash';
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env,
    });

    console.log(`[terminal] session opened by ${user.email} (pid ${term.pid})`);

    term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'data', data }));
    });
    term.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      ws.close();
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg.type === 'input') term.write(msg.data);
      else if (msg.type === 'resize' && msg.cols && msg.rows) {
        try { term.resize(msg.cols, msg.rows); } catch (_) { /* ignore */ }
      }
    });

    ws.on('close', () => {
      console.log(`[terminal] session closed by ${user.email} (pid ${term.pid})`);
      try { term.kill(); } catch (_) { /* already dead */ }
    });
  });
}

module.exports = { attachTerminal };
