// Ежедневный разбор журналов сервера.
//
// Журналы уже пишутся (см. docs/web-access-log.md), но никто их не читает: чтобы заметить
// скан или ошибку приложения, надо руками зайти по ssh и вспомнить нужный grep. Этот модуль
// раз в сутки проходит по тем же файлам, сводит их в отчёт и кладёт его в базу; вкладка
// «Логи» в админке показывает последний отчёт и историю.
//
// Здесь только чтение и счёт. Ничего не блокируется и не удаляется: при CGNAT снаружи
// стучаться некому, а внутри сети банить самих себя незачем — та же причина, по которой
// в журналах нет fail2ban.
const fs = require('fs');
const zlib = require('zlib');
const { execFile } = require('child_process');
const pool = require('./db');

// Разбор идёт утром, чтобы к началу дня отчёт уже был готов, и покрывает предыдущие сутки:
// в восемь утра окно — это ровно вчерашние восемь утра и до сих пор.
const SCAN_HOUR = 8;
const WINDOW_HOURS = 24;

// Юнит приложения в systemd. Имя вынесено в переменную окружения ради тестового экземпляра:
// он запускается руками и своего юнита не имеет, journalctl для него вернёт пустоту.
const APP_UNIT = process.env.LOG_SCAN_UNIT || 'spritenote';

// Файлы журналов. Пути прибиты гвоздями намеренно: их задаёт не приложение, а конфигурация
// nginx и rsyslog из scripts/ — меняете там, правьте здесь.
const NGINX_DIR = process.env.LOG_SCAN_NGINX_DIR || '/var/log/nginx';
const FILE_SOURCES = {
  web_access: `${NGINX_DIR}/web-access.log`,
  web_unknown: `${NGINX_DIR}/web-unknown.log`,
  web_external: `${NGINX_DIR}/web-external.log`,
  web_error: `${NGINX_DIR}/web-error.log`,
  nftables: process.env.LOG_SCAN_NFT_FILE || '/var/log/nftables-web.log',
};

// Предохранители. Приложение живёт на Raspberry Pi с картой памяти: под заливкой скана
// журнал за сутки бывает в сотни мегабайт, и читать его целиком в память нельзя.
const MAX_READ_BYTES = 8 * 1024 * 1024; // сколько байт с конца файла читается
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_SAMPLES = 12;   // сколько строк-примеров кладётся в раздел отчёта
const MAX_TOP = 8;        // длина списков «кто чаще всех»
const MAX_LINE_CHARS = 300;
const KEEP_REPORTS = 90;  // примерно квартал истории

const LEVELS = ['ok', 'warn', 'alert'];
const worstLevel = (a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);

// ---------------- Чтение файлов ----------------

// Последние MAX_READ_BYTES байт файла. Первая строка после обрезки почти наверняка обрублена
// посередине, поэтому отбрасывается: полстроки испортили бы разбор.
function readTailLines(file) {
  const stat = fs.statSync(file);
  if (stat.size === 0) return [];

  const start = Math.max(0, stat.size - MAX_READ_BYTES);
  const length = stat.size - start;
  const buf = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  const lines = buf.toString('utf8').split('\n');
  if (start > 0) lines.shift();
  return lines.filter((l) => l.length > 0);
}

function readGzipLines(file) {
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  return text.split('\n').filter((l) => l.length > 0);
}

// Файл плюс его вчерашняя ротация. Окно в сутки почти всегда пересекает полночь, когда
// logrotate уводит текущий файл в `.1`, — без этого шага половина суток пропала бы из отчёта.
function readSource(file) {
  const candidates = [file, `${file}.1`, `${file}.1.gz`];
  const lines = [];
  let found = false;

  for (const path of candidates) {
    if (!fs.existsSync(path)) continue;
    found = true;
    lines.push(...(path.endsWith('.gz') ? readGzipLines(path) : readTailLines(path)));
  }

  if (!found) {
    const err = new Error('missing');
    err.reason = 'log_source_missing';
    throw err;
  }
  return lines;
}

// ---------------- Разбор времени ----------------

// nginx и rsyslog пишут время в начале строки в ISO с зоной: «2026-08-19T08:07:47+03:00»
// у nginx, с микросекундами у rsyslog. Date разбирает оба вида.
function isoLineTime(line) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(line);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d;
}

// error_log живёт своим форматом: «2026/08/19 08:07:47 [warn] …», без зоны — время местное.
function nginxErrorTime(line) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

// Строка без разобранного времени не выбрасывается: у nginx это продолжение многострочной
// записи, и потерять её значит потерять сам текст ошибки. Считаем такие свежими.
function withinWindow(time, from) {
  return time === null || time >= from;
}

// ---------------- Разбор строки доступа ----------------

// Формат задан переменной log_format в scripts/nginx-access-logging.conf. Разбор нестрогий:
// одно чужое поле не должно ронять весь отчёт, поэтому неразобранная строка просто считается
// «прочей» и попадает в счётчик total.
const ACCESS_RE = new RegExp(
  '^\\S+ (\\S+?) -> :(\\d+) xff=(\\S+) host="([^"]*)" sni="([^"]*)" ' +
    '"(\\S+) ([^" ]*)[^"]*" (\\d{3}) '
);

function parseAccess(line) {
  const m = ACCESS_RE.exec(line);
  if (!m) return null;
  const [, remote, port, xff, host, sni, method, path, status] = m;
  return {
    // В remote лежит «адрес:порт»; сам порт клиента в отчёте не нужен ни в одном разделе.
    remote: remote.replace(/:\d+$/, ''),
    // Через Tailscale Funnel remote всегда 127.0.0.1, а настоящий гость — в X-Forwarded-For.
    client: xff !== '-' ? xff.split(',')[0].trim() : remote.replace(/:\d+$/, ''),
    port: Number(port),
    host,
    sni,
    method,
    path,
    status: Number(status),
  };
}

// Запросы, которых у этого приложения быть не может: PHP-админки, .env, .git и прочая
// классика сканеров. Приложение на Node, поэтому любой .php — заведомо чужой интерес.
//
// Свои адреса под шаблоны не попадают намеренно: админка живёт на /api/admin, а не на /admin,
// а xterm.js отдаётся из /vendor/xterm/ — отсюда точный /vendor/phpunit/ вместо /vendor/.
const PROBE_PATTERNS = [
  /^\/wp-(login\.php|admin|content|includes)/i,
  /^\/xmlrpc\.php/i,
  /\/\.env(\.|\/|$|\?)/i,
  /^\/\.(git|svn|aws|ssh)(\/|$)/i,
  /^\/(phpmyadmin|pma|myadmin|mysqladmin|adminer)(\/|$)/i,
  /^\/admin(\/|$)/i,
  /^\/cgi-bin\//i,
  /^\/vendor\/phpunit\//i,
  /^\/(actuator|solr|jenkins|struts|telescope|_ignition)(\/|$)/i,
  /^\/manager\/html/i,
  /^\/(HNAP1|boaform|setup\.cgi|shell|hudson)(\/|$)/i,
  /\.(php|asp|aspx|jsp|cgi)(\?|$)/i,
];

const isProbe = (path) => PROBE_PATTERNS.some((re) => re.test(path));

// ---------------- Сборка разделов ----------------

function topN(counter, n = MAX_TOP) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, value]) => ({ label, value }));
}

function bump(counter, key) {
  counter.set(key, (counter.get(key) || 0) + 1);
}

const trim = (line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);

// Уровень раздела по числу событий. Пороги подобраны под домашний сервер: то, что для
// публичного сайта фоновый шум, здесь означает, что кто-то приходил специально.
function levelFor(count, warnAt, alertAt) {
  if (alertAt !== undefined && count >= alertAt) return 'alert';
  if (warnAt !== undefined && count >= warnAt) return 'warn';
  return 'ok';
}

// Раздел отчёта. `id` переводится на клиенте (TRANSLATIONS в app.js) — наружу, как и коды
// ошибок в этом проекте, уходит ключ, а не готовый русский текст.
function section(id, count, { level = 'ok', stats = [], samples = [], note = null } = {}) {
  return {
    id,
    level,
    count,
    stats,
    samples: samples.slice(0, MAX_SAMPLES).map(trim),
    note,
  };
}

// ---------------- Источник: журнал systemd ----------------

function journalLines(since) {
  return new Promise((resolve) => {
    execFile(
      'journalctl',
      ['-u', APP_UNIT, '--since', since.toISOString(), '--no-pager', '-o', 'short-iso'],
      { maxBuffer: MAX_JOURNAL_BYTES, timeout: 30000 },
      (err, stdout) => {
        // Причин отказа две — journalctl нет вовсе или у пользователя нет прав на журнал, —
        // и обе означают одно: этот источник в отчёт не попадёт, о чём надо сказать вслух.
        if (err && !stdout) return resolve({ error: 'log_source_unreadable', lines: [] });
        resolve({ error: null, lines: stdout.split('\n').filter((l) => l && !l.startsWith('-- ')) });
      }
    );
  });
}

// Что в журнале приложения считается ошибкой. Слова, а не приоритет systemd: node пишет
// и обычный вывод, и ошибки в один поток, journald метит их одинаково, и `-p err` пуст всегда.
const APP_ERROR_RE = /\b(error|failed|failure|exception|unhandled|econnrefused|eacces|enospc)\b/i;
// Строки, которые под это правило попадают, но ошибками не являются.
const APP_ERROR_EXCLUDE = /\[link-check\] checked |link_status/i;

function appSections(lines, from) {
  const errors = [];
  const terminal = [];
  let restarts = 0;

  for (const line of lines) {
    const time = isoLineTime(line);
    if (!withinWindow(time, from)) continue;

    if (line.includes('SpriteNote server listening')) restarts++;
    if (line.includes('[terminal] session opened')) terminal.push(line);
    if (APP_ERROR_RE.test(line) && !APP_ERROR_EXCLUDE.test(line)) errors.push(line);
  }

  return [
    section('app_errors', errors.length, {
      level: levelFor(errors.length, 1, 20),
      samples: errors.slice(-MAX_SAMPLES),
    }),
    // Перезапуск сам по себе не беда — «git pull && restart» выглядит так же. Настораживает
    // их количество: сервис под Restart=always падает и поднимается молча.
    section('app_restarts', restarts, { level: levelFor(restarts, 4, 10) }),
    // Открытие веб-терминала — это чей-то shell на сервере. Даже свой собственный полезно
    // видеть списком: чужой в этом списке заметен сразу.
    section('terminal_sessions', terminal.length, { samples: terminal.slice(-MAX_SAMPLES) }),
  ];
}

// ---------------- Источник: журнал запросов nginx ----------------

function accessSections(lines, from) {
  const clients = new Map();
  const probePaths = new Map();
  const notFound = new Map();
  const probeSamples = [];
  const serverErrorSamples = [];
  let total = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let authFailures = 0;
  let bareIp = 0;

  for (const line of lines) {
    if (!withinWindow(isoLineTime(line), from)) continue;
    total++;

    const req = parseAccess(line);
    if (!req) continue;

    bump(clients, req.client);
    if (req.status >= 500) {
      serverErrors++;
      serverErrorSamples.push(line);
    } else if (req.status >= 400) {
      clientErrors++;
      if (req.status === 404) bump(notFound, req.path);
    }
    // Лимит на /api/auth/login отдаёт 429, неверный пароль — 401. И то, и другое здесь
    // означает одно: кто-то не смог войти.
    if (req.path.startsWith('/api/auth/login') && (req.status === 401 || req.status === 429)) {
      authFailures++;
    }
    if (isProbe(req.path)) {
      bump(probePaths, req.path);
      probeSamples.push(line);
    }
    // Пустой SNI при заполненном host на 443 — клиент пришёл по голому IP и имени
    // не спрашивал. Браузер так не делает, сканер делает всегда.
    if (req.port === 443 && req.sni === '-' && req.host && req.host !== '-') bareIp++;
  }

  return [
    section('http_requests', total, { stats: topN(clients) }),
    section('http_probes', probeSamples.length, {
      level: levelFor(probeSamples.length, 1, 20),
      stats: topN(probePaths),
      samples: probeSamples.slice(-MAX_SAMPLES),
    }),
    section('auth_failures', authFailures, { level: levelFor(authFailures, 5, 20) }),
    section('http_server_errors', serverErrors, {
      level: levelFor(serverErrors, 1, 20),
      samples: serverErrorSamples.slice(-MAX_SAMPLES),
    }),
    section('http_client_errors', clientErrors, {
      level: levelFor(clientErrors, 50, 300),
      stats: topN(notFound),
    }),
    section('http_bare_ip', bareIp, { level: levelFor(bareIp, 1, 50) }),
  ];
}

// ---------------- Источник: чужой Host и внешние адреса ----------------

function hostSections(unknownLines, externalLines, from) {
  const unknownHosts = new Map();
  const unknownSamples = [];
  for (const line of unknownLines) {
    if (!withinWindow(isoLineTime(line), from)) continue;
    const req = parseAccess(line);
    bump(unknownHosts, req ? req.host || '-' : '-');
    unknownSamples.push(line);
  }

  const externalClients = new Map();
  const externalSamples = [];
  for (const line of externalLines) {
    if (!withinWindow(isoLineTime(line), from)) continue;
    const req = parseAccess(line);
    if (req) bump(externalClients, req.client);
    externalSamples.push(line);
  }

  return [
    // Обращение по чужому имени означает, что адрес взяли не по ссылке, а перебором.
    section('unknown_host', unknownSamples.length, {
      level: levelFor(unknownSamples.length, 1, 20),
      stats: topN(unknownHosts),
      samples: unknownSamples.slice(-MAX_SAMPLES),
    }),
    // Приход снаружи домашней сети — норма: адрес фаннела виден из интернета. Тревоги нет,
    // но список гостей за сутки полезен сам по себе.
    section('external_requests', externalSamples.length, {
      stats: topN(externalClients),
      samples: externalSamples.slice(-MAX_SAMPLES),
    }),
  ];
}

// ---------------- Источник: error_log nginx ----------------

const TLS_ERROR_RE = /SSL_|handshak|plain HTTP|no "ssl_certificate"|cert/i;
const NGINX_SERIOUS_RE = /\[(error|crit|alert|emerg)\]/;

function nginxErrorSections(lines, from) {
  const serious = [];
  const tls = [];

  for (const line of lines) {
    if (!withinWindow(nginxErrorTime(line), from)) continue;
    if (TLS_ERROR_RE.test(line)) tls.push(line);
    else if (NGINX_SERIOUS_RE.test(line)) serious.push(line);
  }

  return [
    // Оборванное рукопожатие TLS — это и кривой клиент, и попытка подключиться не тем
    // протоколом. Отдельно от прочих ошибок nginx: причина разная, и путать их незачем.
    section('tls_errors', tls.length, {
      level: levelFor(tls.length, 5, 50),
      samples: tls.slice(-MAX_SAMPLES),
    }),
    section('nginx_errors', serious.length, {
      level: levelFor(serious.length, 1, 20),
      samples: serious.slice(-MAX_SAMPLES),
    }),
  ];
}

// ---------------- Источник: пакетный журнал nftables ----------------

function nftSections(lines, from) {
  const sources = new Map();
  const oddSamples = [];
  let connections = 0;
  let odd = 0;

  for (const line of lines) {
    if (!withinWindow(isoLineTime(line), from)) continue;
    const src = /SRC=(\S+)/.exec(line);
    const dpt = /DPT=(\d+)/.exec(line);

    if (line.includes('WEB-ODD')) {
      odd++;
      oddSamples.push(src && dpt ? `${src[1]} -> :${dpt[1]}` : line);
    } else if (line.includes('WEB-CONN')) {
      connections++;
      if (src) bump(sources, src[1]);
    }
  }

  return [
    section('nft_connections', connections, { stats: topN(sources) }),
    // Пакет не на установленное соединение и не начало нового — это ACK-скан или
    // FIN/NULL/Xmas. Случайно такое не приходит.
    section('nft_odd', odd, {
      level: levelFor(odd, 1, 50),
      samples: oddSamples.slice(-MAX_SAMPLES),
    }),
  ];
}

// ---------------- Отчёт целиком ----------------

// Собрать отчёт за последние WINDOW_HOURS часов. Возвращает объект, который уходит на клиент
// как есть, — форма описана в docs/log-scan.md.
async function buildReport() {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  const sources = [];
  const sections = [];

  // Журнал приложения.
  const journal = await journalLines(from);
  sources.push({ id: 'journal', label: `journalctl -u ${APP_UNIT}`, error: journal.error });
  sections.push(...appSections(journal.lines, from));

  // Файловые источники читаются по одному: недоступный файл не должен обрывать остальные.
  const read = {};
  for (const [id, file] of Object.entries(FILE_SOURCES)) {
    try {
      read[id] = readSource(file);
      sources.push({ id, label: file, error: null });
    } catch (err) {
      read[id] = [];
      // EACCES — приложение выпало из группы adm, ENOENT — журнал ещё не заводили.
      // Разница видна админу и подсказывает, что чинить.
      const reason = err.reason || (err.code === 'EACCES' || err.code === 'EPERM'
        ? 'log_source_denied'
        : 'log_source_unreadable');
      sources.push({ id, label: file, error: reason });
    }
  }

  sections.push(...accessSections(read.web_access, from));
  sections.push(...hostSections(read.web_unknown, read.web_external, from));
  sections.push(...nginxErrorSections(read.web_error, from));
  sections.push(...nftSections(read.nftables, from));

  const unreadable = sources.filter((s) => s.error);
  // Недоступный источник — не «ничего не нашли», а «не смотрели». Молча выдать «всё чисто»
  // при нечитаемых журналах значит соврать, поэтому это отдельный раздел со своим уровнем.
  if (unreadable.length) {
    sections.push(
      section('sources_unavailable', unreadable.length, {
        level: 'warn',
        stats: unreadable.map((s) => ({ label: s.label, value: s.error })),
      })
    );
  }

  const alerts = sections.filter((s) => s.level === 'alert').length;
  const warnings = sections.filter((s) => s.level === 'warn').length;

  return {
    generatedAt: to.toISOString(),
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    windowHours: WINDOW_HOURS,
    scanHour: SCAN_HOUR,
    level: sections.reduce((acc, s) => worstLevel(acc, s.level), 'ok'),
    alerts,
    warnings,
    sources,
    sections,
  };
}

// ---------------- Хранение ----------------

// В минуту, когда сходятся ночной таймер и кнопка «Проверить сейчас», разбор не должен идти
// дважды: он читает мегабайты с карты памяти.
let running = null;

// Границы окна пишутся местным временем, а не UTC: рядом в той же строке лежит `created_at`
// от NOW(), то есть местное, и смешивать в одной таблице два часовых пояса — верный способ
// однажды сравнить их между собой и получить сдвиг на три часа.
function toMysqlDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

async function saveReport(report) {
  const [result] = await pool.query(
    `INSERT INTO log_reports (window_from, window_to, level, alerts, warnings, report)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      toMysqlDate(report.windowFrom),
      toMysqlDate(report.windowTo),
      report.level,
      report.alerts,
      report.warnings,
      JSON.stringify(report),
    ]
  );
  // История подрезается сразу после вставки: отчёт весит килобайты, но копится каждый день,
  // а нужен из них последний и «а что было на той неделе».
  await pool.query(
    `DELETE FROM log_reports WHERE id NOT IN (
       SELECT id FROM (SELECT id FROM log_reports ORDER BY id DESC LIMIT ?) keep
     )`,
    [KEEP_REPORTS]
  );
  return result.insertId;
}

async function runScan() {
  if (running) return running;
  running = (async () => {
    const report = await buildReport();
    const id = await saveReport(report);
    console.log(
      `[log-scan] отчёт #${id}: ${report.level}, тревог ${report.alerts}, предупреждений ${report.warnings}`
    );
    return { id, report };
  })().finally(() => {
    running = null;
  });
  return running;
}

async function latestReport() {
  const [rows] = await pool.query(
    'SELECT id, created_at, level, alerts, warnings, report FROM log_reports ORDER BY id DESC LIMIT 1'
  );
  return rows[0] ? { id: rows[0].id, createdAt: rows[0].created_at, report: JSON.parse(rows[0].report) } : null;
}

async function reportById(id) {
  const [rows] = await pool.query(
    'SELECT id, created_at, report FROM log_reports WHERE id = ?',
    [id]
  );
  return rows[0] ? { id: rows[0].id, createdAt: rows[0].created_at, report: JSON.parse(rows[0].report) } : null;
}

// Список для выпадающего меню истории: сам отчёт здесь не нужен и в выборку не берётся —
// это мегабайты JSON на девяносто строк.
async function reportHistory() {
  const [rows] = await pool.query(
    'SELECT id, created_at, level, alerts, warnings FROM log_reports ORDER BY id DESC LIMIT ?',
    [KEEP_REPORTS]
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    level: r.level,
    alerts: r.alerts,
    warnings: r.warnings,
  }));
}

// ---------------- Расписание ----------------

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(SCAN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

// Следующий запуск планируется заново каждый раз, а не setInterval на сутки: так время
// не уползает от восьми утра и переход на зимнее время не сдвигает разбор навсегда.
// Тот же приём, что в server/link-check.js.
function scheduleNextRun() {
  const delay = msUntilNextRun();
  const timer = setTimeout(async () => {
    try {
      await runScan();
    } catch (err) {
      // Сбой разбора не должен ронять приложение и не отменяет завтрашний заход.
      console.error('[log-scan] разбор не удался:', err.message);
    }
    scheduleNextRun();
  }, delay);
  timer.unref(); // таймер не держит процесс при остановке сервиса

  const hours = Math.round((delay / 3600000) * 10) / 10;
  console.log(`[log-scan] следующий разбор в ${String(SCAN_HOUR).padStart(2, '0')}:00 (через ${hours} ч)`);
  return timer;
}

// При старте разбор не запускается: перезапуск сервиса — не повод перечитывать журналы,
// а при частых рестартах история засорилась бы отчётами за одни и те же сутки.
function startLogScan() {
  return scheduleNextRun();
}

module.exports = {
  SCAN_HOUR,
  WINDOW_HOURS,
  buildReport,
  runScan,
  latestReport,
  reportById,
  reportHistory,
  startLogScan,
};
