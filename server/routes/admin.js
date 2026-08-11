const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const multer = require('multer');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const PROJECT_ROOT = path.join(__dirname, '..', '..');

// Full server filesystem browser, defaults to the project folder, but not sandboxed to it —
// admins can navigate anywhere on disk the app's OS user can read. Admin-only (gated below).
function resolvePath(input) {
  return path.resolve('/', input || PROJECT_ROOT);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = resolvePath(req.query.path);
      fs.stat(dir, (err, stat) => {
        if (err || !stat.isDirectory()) return cb(new Error('target_dir_not_found'));
        cb(null, dir);
      });
    },
    filename: (req, file, cb) => cb(null, path.basename(file.originalname).replace(/[/\\]/g, '_')),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

router.use(requireAuth, requireAdmin);

// Cheapest possible admin route, used by the client to find out whether this router is reachable
// at all from the address the page was opened on. The Tailscale Funnel vhost answers 404 to the
// whole /api/admin prefix (a public address must not expose a shell), so a reverse proxy — not the
// app — decides the answer here. Hence a probe rather than a flag in /api/auth/me: the app cannot
// know what nginx in front of it blocks.
router.get('/ping', (req, res) => res.json({ ok: true }));

// --- Users management ---

router.get('/users', async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.email, u.is_admin, u.created_at,
             COALESCE(SUM(
               COALESCE(LENGTH(n.content), 0) +
               COALESCE(LENGTH(n.description), 0) +
               COALESCE(LENGTH(n.url), 0) +
               COALESCE(n.file_size, 0)
             ), 0) AS bytes_used
      FROM users u
      -- Без фильтра по deleted_at намеренно: удалённое лежит в корзине до месяца и всё это
      -- время занимает место на диске. Здесь считается занятое место, а не размер дерева.
      LEFT JOIN nodes n ON n.user_id = u.id
      GROUP BY u.id, u.email, u.is_admin, u.created_at
      ORDER BY u.created_at
    `);
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        isAdmin: !!r.is_admin,
        createdAt: r.created_at,
        bytesUsed: Number(r.bytes_used),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/admin', async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (typeof req.body.isAdmin !== 'boolean') {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const { isAdmin } = req.body;

    if (!isAdmin && targetId === req.user.id) {
      const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');
      if (c <= 1) {
        return res.status(400).json({ error: 'cannot_remove_last_admin' });
      }
    }

    const [result] = await pool.query('UPDATE users SET is_admin = ? WHERE id = ?', [
      isAdmin ? 1 : 0,
      targetId,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Server file manager (full filesystem, rooted at "/") ---

router.get('/files', async (req, res, next) => {
  try {
    const dirPath = resolvePath(req.query.path);
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (e) {
      return res.status(400).json({ error: 'cannot_read_dir', message: e.code || e.message });
    }

    const items = [];
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch (_) {
        continue; // broken symlink / permission race — skip rather than fail the whole listing
      }
      items.push({
        name: e.name,
        isDir: stat.isDirectory(),
        size: stat.isDirectory() ? null : stat.size,
        modifiedAt: stat.mtime,
      });
    }
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'ru');
    });

    res.json({
      path: dirPath,
      parent: dirPath === '/' ? null : path.dirname(dirPath),
      entries: items,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/files', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    res.status(201).json({ ok: true, name: req.file.filename });
  } catch (err) {
    if (err.message === 'target_dir_not_found') {
      return res.status(400).json({ error: 'target_dir_not_found' });
    }
    next(err);
  }
});

router.get('/files/download', async (req, res, next) => {
  try {
    const full = resolvePath(req.query.path);
    const stat = fs.existsSync(full) && fs.statSync(full);
    if (!stat || stat.isDirectory()) return res.status(404).json({ error: 'not_found' });
    res.download(full);
  } catch (err) {
    next(err);
  }
});

router.delete('/files', async (req, res, next) => {
  try {
    const full = resolvePath(req.query.path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'not_found' });
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      // Deleting whole directories from the UI is deliberately not supported — too easy to
      // fat-finger on a full filesystem browser. Delete files one at a time instead.
      return res.status(400).json({ error: 'cannot_delete_directory' });
    }
    fs.unlinkSync(full);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Left out of the project archive. Paths are relative to the project folder and become
// `zip -x` patterns below.
//
// The archive is a convenience download, not a disaster-recovery backup — whoever restores from
// it re-creates `.env` and runs `npm install` anyway, so dropping these costs nothing.
//
// Note that `scripts/init-db.sql` is deliberately *included* despite currently holding the real
// DB password (deployment overwrote the CHANGE_ME placeholder with it). Restoring the
// placeholder in that file is the actual fix — see TODO.md — not excluding it here.
const ZIP_EXCLUDES = [
  '.env',           // DB password + DuckDNS token
  'node_modules/*', // ~75 MB and the bulk of the file count; restored by `npm install`
];

// Streams the whole project folder as a single .zip, built on the fly (no temp file on disk).
router.get('/project-zip', async (req, res, next) => {
  try {
    const parentDir = path.dirname(PROJECT_ROOT);
    const baseName = path.basename(PROJECT_ROOT);
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}-${stamp}.zip"`);

    // zip matches -x patterns against the stored entry names, which are rooted at baseName.
    const excludeArgs = ZIP_EXCLUDES.flatMap((rel) => ['-x', `${baseName}/${rel}`]);
    const zipProc = spawn('zip', ['-r', '-q', '-', baseName, ...excludeArgs], { cwd: parentDir });
    zipProc.stdout.pipe(res);
    zipProc.stderr.on('data', (d) => console.error('[project-zip]', d.toString().trim()));
    zipProc.on('error', (err) => {
      console.error('[project-zip] spawn failed', err);
      if (!res.headersSent) res.status(500).json({ error: 'zip_failed' });
    });
    req.on('close', () => {
      if (zipProc.exitCode === null) zipProc.kill();
    });
  } catch (err) {
    next(err);
  }
});

// --- Shared admin notepad ---

router.get('/notepad', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT content, updated_at FROM admin_notepad WHERE id = 1');
    res.json({ content: rows[0]?.content || '', updatedAt: rows[0]?.updated_at || null });
  } catch (err) {
    next(err);
  }
});

router.put('/notepad', async (req, res, next) => {
  try {
    const { content } = req.body;
    await pool.query('UPDATE admin_notepad SET content = ?, updated_at = NOW() WHERE id = 1', [
      content || '',
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
