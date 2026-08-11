// Проверка ссылок на живость. Хранилище ссылок неизбежно накапливает мёртвые адреса, и
// единственный способ узнать об этом — сходить по ним.
//
// Своего похода по URL здесь нет: `safeFetch` берётся из `server/link-summary.js` целиком,
// вместе с проверкой IP, пиннингом соединения на уже проверенный адрес и ручным разбором
// редиректов. Это единственные два места, где сервер ходит по адресу, который ввёл
// пользователь, и защита у них общая.
const pool = require('./db');
const { safeFetch, PreviewError } = require('./link-summary');

// Обход идёт раз в сутки, ночью: днём Pi незачем ходить по интернету, а страницы не умирают
// так внезапно, чтобы это заметить между тремя часами ночи и тремя следующей.
const CHECK_HOUR = 3;
// Узел, проверенный меньше этого времени назад, ночной обход пропускает. Чуть меньше суток —
// иначе проверка, начатая в 3:00:05, на следующую ночь сочла бы вчерашние ссылки свежими.
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000;
// Сколько ссылок берётся за один заход в базу. Обход идёт по одной, с паузой: десяток тысяч
// ссылок в параллель уронил бы и Pi, и терпение чужих серверов.
const BATCH_SIZE = 20;
const PAUSE_BETWEEN_MS = 1500;
// Предохранитель на всю ночь: если ссылок вдруг окажется очень много, обход прекратится,
// не заняв утро, и продолжит следующей ночью.
const MAX_PER_NIGHT = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Адрес, сохранённый без схемы («example.com»), — обычное дело: так его копируют из адресной
// строки. Браузер в таком случае подставляет https://, и проверка обязана делать то же самое,
// иначе живой сайт объявляется «неразбираемым адресом».
function normalizeUrl(raw) {
  const url = String(raw || '').trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

// Ответы, которые означают «сервер отказался с нами разговаривать», а не «страницы больше нет».
// За ними обычно стоит защита от ботов: сайт работает в браузере, но проверку с сервера
// не пускает. Объявлять такую ссылку битой — врать пользователю.
const UNVERIFIABLE = new Set(['http_401', 'http_403', 'http_429', 'network_unreachable']);
const isBroken = (status) => status !== 'ok' && !UNVERIFIABLE.has(status);

// Возвращает код состояния строкой: 'ok', код «не смогли проверить» либо причина
// недоступности. Коды переводятся на клиенте (`TRANSLATIONS` в app.js) — как и остальные
// ошибки в этом проекте, наружу уходит код, а не готовый русский текст.
async function checkLink(url) {
  let response;
  try {
    response = await safeFetch(normalizeUrl(url));
  } catch (err) {
    if (err instanceof PreviewError) {
      // 'invalid_url' — адрес не разбирается, 'url_not_allowed' — резолвится во внутренний IP,
      // 'dns_failed' — домена нет, 'network_unreachable' — это у нас нет маршрута,
      // 'fetch_failed' — не достучались, 'too_many_redirects' — зациклился.
      return err.code === 'fetch_failed' ? 'unreachable' : err.code;
    }
    return 'unreachable';
  }

  const code = response.statusCode;
  // Тело нам не нужно ни при каком исходе — освобождаем сокет, не скачивая страницу целиком.
  response.resume();
  response.destroy();

  if (code >= 200 && code < 400) return 'ok';
  // Кодов HTTP много, а словарь не резиновый: те, что означают разные действия пользователя,
  // объясняются отдельно, остальное сводится к «сервер ответил ошибкой».
  if (code === 404) return 'http_404';
  if (code === 403) return 'http_403';
  if (code === 401) return 'http_401';
  if (code === 429) return 'http_429';
  if (code >= 500) return 'http_5xx';
  return 'http_error';
}

// Проверка с одной повторной попыткой. Сетевой сбой бывает мгновенным и случайным — чужой
// сервер моргнул, Wi-Fi присел, — и одного такого хватало, чтобы живая ссылка получила красный
// значок. Повторяем только сетевые отказы: у 404 второй заход ничего не изменит.
async function checkLinkTwice(url) {
  const first = await checkLink(url);
  if (first !== 'unreachable' && first !== 'http_5xx') return first;
  await sleep(3000);
  return checkLink(url);
}

async function saveResult(nodeId, status) {
  // `updated_at = updated_at` гасит ON UPDATE CURRENT_TIMESTAMP: проверка ссылки — не правка
  // элемента, и дата изменения от неё меняться не должна.
  await pool.query(
    'UPDATE nodes SET link_status = ?, link_checked_at = NOW(), updated_at = updated_at WHERE id = ?',
    [status, nodeId]
  );
}

// Проверить одну ссылку по требованию пользователя (кнопка «Проверить снова»).
// Владелец узла проверяется вызывающей стороной — сюда узел приходит уже своим.
async function checkNode(node) {
  const status = await checkLinkTwice(node.url);
  await saveResult(node.id, status);
  return status;
}

// Один проход обхода: берёт те ссылки, которые дольше всех не проверялись, и идёт по ним
// по очереди. Узлы в корзине пропускаются — проверять то, что пользователь удалил, незачем.
async function sweepOnce() {
  const [rows] = await pool.query(
    `SELECT id, url FROM nodes
     WHERE type = 'link' AND deleted_at IS NULL AND url IS NOT NULL AND url <> ''
       AND (link_checked_at IS NULL OR link_checked_at < DATE_SUB(NOW(), INTERVAL ? SECOND))
     ORDER BY link_checked_at IS NOT NULL, link_checked_at
     LIMIT ?`,
    [Math.round(RECHECK_AFTER_MS / 1000), BATCH_SIZE]
  );
  if (rows.length === 0) return 0;

  let broken = 0;
  for (const row of rows) {
    let status;
    try {
      status = await checkLinkTwice(row.url);
    } catch (err) {
      // Непредвиденная ошибка в проверке одной ссылки не должна обрывать весь проход.
      console.error('[link-check] unexpected failure for node', row.id, err.message);
      status = 'unreachable';
    }
    if (isBroken(status)) broken++;
    await saveResult(row.id, status);
    await sleep(PAUSE_BETWEEN_MS);
  }

  console.log(`[link-check] checked ${rows.length} link(s), ${broken} broken`);
  return rows.length;
}

// Ночной обход: идёт заходами по BATCH_SIZE, пока не кончатся ссылки, которым пора.
// За один раз проверяется всё дерево, а не первые двадцать, — иначе при сотне ссылок и одном
// проходе в сутки очередь разбиралась бы неделю.
async function sweepAll() {
  let total = 0;
  while (total < MAX_PER_NIGHT) {
    const done = await sweepOnce();
    if (!done) break;
    total += done;
  }
  if (total) console.log(`[link-check] nightly run finished, ${total} link(s) checked`);
  return total;
}

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(CHECK_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

// Каждый раз планируем следующий запуск заново, а не ставим `setInterval` на сутки: так время
// не уползает от 3:00 и переход на зимнее время не сдвигает обход навсегда.
function scheduleNextRun() {
  const delay = msUntilNextRun();
  const timer = setTimeout(async () => {
    try {
      await sweepAll();
    } catch (err) {
      // Ошибка обхода не должна ронять приложение и не должна отменять следующую ночь.
      console.error('[link-check] nightly run failed:', err.message);
    }
    scheduleNextRun();
  }, delay);
  timer.unref(); // таймер не держит процесс при остановке сервиса

  const hours = Math.round(delay / 3600000 * 10) / 10;
  console.log(`[link-check] next run at ${String(CHECK_HOUR).padStart(2, '0')}:00 (через ${hours} ч)`);
  return timer;
}

// При старте ничего не проверяется: перезапуск сервиса — не повод идти в интернет,
// а при частых рестартах это означало бы обход по несколько раз на дню.
function startLinkCheck() {
  return scheduleNextRun();
}

module.exports = { checkLink, checkLinkTwice, checkNode, sweepOnce, sweepAll, startLinkCheck, isBroken };
