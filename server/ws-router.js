// Single owner of the HTTP `upgrade` event, plus the auth helpers every WebSocket endpoint needs.
//
// Subscribing to 'upgrade' switches off Node's own handling, so whoever listens becomes
// responsible for every upgrade request — including the ones meant for somebody else. While the
// terminal was the only endpoint it could simply destroy anything that wasn't its own path; with
// a second endpoint that same line would kill the other one's sockets. Hence one dispatcher:
// modules register a path prefix, and requests matching nothing are closed here, once.
const pool = require('./db');
const { COOKIE_NAME } = require('./auth');
const { parseSettings } = require('./user-settings');

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

// Resolves the session cookie to a user, or null. Admin rights are reported, never required —
// each endpoint decides for itself what it needs.
async function authenticateFromCookies(header) {
  const token = parseCookies(header)[COOKIE_NAME];
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.is_admin, u.settings, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );
  if (rows.length === 0) return null;
  const session = rows[0];
  if (new Date(session.expires_at) < new Date()) return null;
  return {
    id: session.id,
    email: session.email,
    isAdmin: !!session.is_admin,
    settings: parseSettings(session.settings),
  };
}

// Browsers always send Origin on a WebSocket handshake, and SameSite=Lax should already stop a
// cross-site page from getting the session cookie attached — but these endpoints reach a shell
// and a screen share, so they get an explicit belt-and-braces check too.
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (_) {
    return false;
  }
}

const routes = [];

// handler(req, socket, head, user) is called only for an authenticated request on a matching
// path whose Origin checks out. Returning false from `allow(user)` answers 403.
function registerWs(prefix, allow, handler) {
  routes.push({ prefix, allow, handler });
}

function attachWsRouter(server) {
  server.on('upgrade', async (req, socket, head) => {
    const route = routes.find((r) => req.url.startsWith(r.prefix));
    if (!route) {
      // No timeout applies to a socket we never answer, so an unclaimed upgrade has to be closed
      // by hand — otherwise anyone could pile them up unauthenticated.
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
      if (route.allow && !route.allow(user)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      route.handler(req, socket, head, user);
    } catch (err) {
      console.error('websocket auth error', err);
      socket.destroy();
    }
  });
}

module.exports = { attachWsRouter, registerWs, authenticateFromCookies, isAllowedOrigin, parseCookies };
