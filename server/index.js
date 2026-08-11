require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const nodesRoutes = require('./routes/nodes');
const adminRoutes = require('./routes/admin');
const { attachTerminal } = require('./terminal');
const { ensureSchema } = require('./schema');
const { startTrashPurge } = require('./trash');
const { startLinkCheck } = require('./link-check');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind nginx, so req.secure reflects X-Forwarded-Proto and rate-limit sees the real client IP
app.use(cookieParser());
// Tree import can embed base64 doc attachments, so it gets a much higher body limit than
// everything else — scoped to this one path so the rest of the API keeps a small, DoS-conscious cap.
app.use('/api/nodes/import', express.json({ limit: '1gb' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Brute-force protection on auth: no lockout mechanism otherwise, and the site is now public.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// "Кратко о ссылке" spends real Claude subscription usage and makes outbound fetches on the
// caller's behalf — cap it so one account can't burn quota or use it to hammer arbitrary hosts.
const linkSummaryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/nodes/link-summary', linkSummaryLimiter);

// Ручная проверка ссылки тоже ходит по пользовательскому адресу — тот же класс поверхности,
// что и «Кратко о ссылке», только без расхода подписки. Лимит выше, но он есть: иначе кнопкой
// «Проверить снова» можно долбить чужой сервер вручную.
const linkCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use(/^\/api\/nodes\/\d+\/check-link$/, linkCheckLimiter);

// Admin endpoints (file manager, user management) — generous but bounded, mainly a DoS backstop.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api/admin', adminLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/nodes', nodesRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Сам service worker кэшировать нельзя: браузер берёт его из HTTP-кэша и может неделю не
// замечать новую версию — а это тот самый файл, который решает, что делать со всем остальным.
// `Service-Worker-Allowed` разрешает ему управлять всем сайтом, а не только своим каталогом.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err.name === 'MulterError' || /file/i.test(err.message || '')) {
    return res.status(400).json({ error: 'upload_error', message: err.message });
  }
  res.status(500).json({ error: 'server_error' });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Migrate before accepting traffic: a request that hits a missing column would 500, and under
// systemd a failure here should stop the unit loudly rather than serve a half-broken app.
ensureSchema()
  .then(() => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`SpriteNote server listening on ${HOST}:${PORT}`);
    });
    attachTerminal(server);
    startTrashPurge();
    startLinkCheck();
  })
  .catch((err) => {
    console.error('Failed to prepare the database schema:', err);
    process.exit(1);
  });
