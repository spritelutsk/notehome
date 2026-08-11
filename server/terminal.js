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

// The handshake authenticates once, but a shell stays open for hours. Re-checking the cookie on a
// timer is what makes logout, session expiry and a revoked admin flag actually reach a live shell.
const REAUTH_INTERVAL_MS = 60 * 1000;

// Backstop against a buggy or hostile client opening PTYs without end — every one of them is a real
// bash process on a Raspberry Pi. The interface caps itself at MAX_TERMINAL_TABS (8) in
// public/js/app.js; this number is deliberately higher, so that closing one tab and opening another
// never trips the limit while the old socket is still winding down.
const MAX_PTY_PER_USER = 12;

function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true });
  const liveSessions = new Map(); // user id -> how many PTYs that user has open right now

  server.on('upgrade', async (req, socket, head) => {
    // Subscribing to 'upgrade' switches off Node's own handling, so a request we do not serve has
    // to be closed here by hand — otherwise the socket hangs around with no timeout, and anyone
    // could pile them up unauthenticated. There is no other upgrade handler to defer to.
    if (!req.url.startsWith('/api/admin/terminal')) {
      socket.destroy();
      return;
    }
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
    // Counted and checked in the same handler on purpose: doing the check back at the upgrade
    // would let two simultaneous handshakes both pass it before either one was counted.
    const open = liveSessions.get(user.id) || 0;
    if (open >= MAX_PTY_PER_USER) {
      console.warn(`[terminal] refused: ${user.email} already holds ${open} sessions`);
      ws.close(4029, 'too_many_sessions');
      return;
    }
    liveSessions.set(user.id, open + 1);

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

    // The cookie was good at handshake time and is never looked at again by the socket itself, so
    // without this a shell would outlive logout, session expiry and the removal of admin rights.
    const reauth = setInterval(async () => {
      try {
        if (await authenticateFromCookies(req.headers.cookie)) return;
        console.log(`[terminal] session no longer valid for ${user.email} (pid ${term.pid})`);
        ws.close(4001, 'session_expired');
      } catch (err) {
        // A database hiccup is not evidence that the session is gone — keep the shell and retry
        // on the next tick rather than cutting off work in progress.
        console.error('terminal re-auth check failed', err);
      }
    }, REAUTH_INTERVAL_MS);

    ws.on('close', () => {
      console.log(`[terminal] session closed by ${user.email} (pid ${term.pid})`);
      clearInterval(reauth);
      const left = (liveSessions.get(user.id) || 1) - 1;
      if (left > 0) liveSessions.set(user.id, left);
      else liveSessions.delete(user.id);
      try { term.kill(); } catch (_) { /* already dead */ }
    });
  });
}

module.exports = { attachTerminal };
