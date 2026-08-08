const crypto = require('crypto');
const pool = require('./db');
const { parseSettings } = require('./user-settings');

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'spritenote_session';
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    [token, userId, expiresAt]
  );
  return { token, expiresAt };
}

async function destroySession(token) {
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
}

function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure, // true when served over HTTPS (trusts X-Forwarded-Proto behind nginx)
    expires: expiresAt,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Middleware: attaches req.user if a valid session cookie is present, else 401.
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'not_authenticated' });

    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.is_admin, u.settings, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
      [token]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'not_authenticated' });

    const session = rows[0];
    if (new Date(session.expires_at) < new Date()) {
      await destroySession(token);
      clearSessionCookie(res);
      return res.status(401).json({ error: 'session_expired' });
    }

    req.user = {
      id: session.id,
      email: session.email,
      isAdmin: !!session.is_admin,
      settings: parseSettings(session.settings),
    };
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
};
