const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { defaults: defaultSettings, parseSettings, sanitizePatch } = require('../user-settings');
const { onUserSettingsChanged } = require('../remote');
const { peerIdForAddress, clientAddress } = require('../cortendesk-server');
const {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  COOKIE_NAME,
} = require('../auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !EMAIL_RE.test(String(email))) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'weak_password' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [existing] = await conn.query(
        'SELECT id FROM users WHERE email = ? FOR UPDATE',
        [normalizedEmail]
      );
      if (existing.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'email_taken' });
      }

      const [countRows] = await conn.query('SELECT COUNT(*) AS c FROM users FOR UPDATE');
      const isFirstUser = countRows[0].c === 0;

      const passwordHash = await bcrypt.hash(String(password), 10);
      const [result] = await conn.query(
        'INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)',
        [normalizedEmail, passwordHash, isFirstUser ? 1 : 0]
      );

      await conn.commit();

      const { token, expiresAt } = await createSession(result.insertId);
      setSessionCookie(req, res, token, expiresAt);

      res.json({
        user: {
          id: result.insertId,
          email: normalizedEmail,
          isAdmin: isFirstUser,
          settings: defaultSettings(),
        },
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'missing_credentials' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const [rows] = await pool.query(
      'SELECT id, email, password_hash, is_admin, settings FROM users WHERE email = ?',
      [normalizedEmail]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(req, res, token, expiresAt);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        isAdmin: !!user.is_admin,
        settings: parseSettings(user.settings),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    await destroySession(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Patch UI preferences. Sends back the full settings object so the client always renders from
// what was actually stored rather than from what it hoped to store.
router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const patch = sanitizePatch(req.body);
    if (!patch) return res.status(400).json({ error: 'invalid_request' });

    const [rows] = await pool.query('SELECT settings FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const merged = { ...parseSettings(rows[0].settings), ...patch };
    await pool.query('UPDATE users SET settings = ? WHERE id = ?', [JSON.stringify(merged), req.user.id]);
    // Вкладка «Удалённый доступ» показывает у каждого признак «готов к управлению», и он
    // считается из этих настроек. Присутствие обязано узнать о правке сразу.
    onUserSettingsChanged(req.user.id, merged);

    res.json({ settings: merged });
  } catch (err) {
    next(err);
  }
});

// Идентификатор CortenDesk той машины, с которой открыта страница, — чтобы человек не переносил
// девять цифр глазами из чужого окна. Своего ID браузер не знает и знать не может, поэтому
// смотрим в базу своего же hbbs: кто регистрировался с этого адреса.
//
// Ошибки здесь не бывает по определению. Нет базы, нет утилиты, адрес чужой, совпало двое —
// всё это одно и то же «подсказки не будет», и поле просто остаётся пустым, как раньше.
// Отвечать 500 значило бы показать человеку ошибку там, где ничего не сломалось.
router.get('/cortendesk-id', requireAuth, async (req, res) => {
  let id = '';
  try {
    id = await peerIdForAddress(clientAddress(req));
  } catch (_) {
    id = '';
  }
  res.json({ id });
});

router.put('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'missing_credentials' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'weak_password' });
    }

    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    const ok = await bcrypt.compare(String(currentPassword), rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

    // Log out every other session for this account (keep the one making this request alive) —
    // standard practice, in case an old/leaked session was the reason for the change.
    await pool.query('DELETE FROM sessions WHERE user_id = ? AND token != ?', [req.user.id, req.sessionToken]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'missing_credentials' });

    const [rows] = await pool.query('SELECT password_hash, is_admin FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
    const ok = await bcrypt.compare(String(password), rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    if (rows[0].is_admin) {
      const [[{ adminCount }]] = await pool.query('SELECT COUNT(*) AS adminCount FROM users WHERE is_admin = 1');
      const [[{ totalCount }]] = await pool.query('SELECT COUNT(*) AS totalCount FROM users');
      if (adminCount <= 1 && totalCount > 1) {
        return res.status(400).json({ error: 'cannot_delete_last_admin_with_other_users' });
      }
    }

    // DB rows (sessions, nodes) cascade automatically via FK ON DELETE CASCADE, but files
    // this user uploaded for doc-type nodes live on disk and need explicit cleanup.
    const userUploadsDir = path.join(__dirname, '..', '..', 'data', 'uploads', String(req.user.id));
    fs.rm(userUploadsDir, { recursive: true, force: true }, () => {});

    await pool.query('DELETE FROM users WHERE id = ?', [req.user.id]);

    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
