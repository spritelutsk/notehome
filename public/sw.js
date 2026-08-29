/* Service worker: оффлайн-чтение дерева.
 *
 * Всё дерево и так целиком лежит на клиенте — один `GET /api/nodes` отдаёт плоский список,
 * из которого браузер собирает иерархию. Значит, чтобы читать заметки без связи, достаточно
 * сохранить последний ответ этой ручки и оболочку приложения.
 *
 * ГЛАВНОЕ РЕШЕНИЕ — «сначала сеть». Обычный для PWA приём «сначала кэш» здесь опасен:
 * приложение обновляется через `git pull && systemctl restart`, а проверяется перезагрузкой
 * страницы. С кэшем-первым перезагрузка отдавала бы старый app.js, и правка «не приезжала» бы
 * без видимой причины. Поэтому в сеть идём всегда, а кэш — только запасной путь, когда сети нет.
 * Плата за это — оффлайн включается не мгновенно, а после того как запрос отвалится.
 *
 * ЧТО НЕ КЭШИРУЕТСЯ НИКОГДА: всё под /api/admin (файловый менеджер, терминал, пользователи)
 * и /api/auth. Первое — потому что это доступ к серверу, которому в кэше телефона не место;
 * второе — потому что кэшированный ответ «вы вошли» пережил бы выход из аккаунта.
 *
 * Кэш с деревом стирается при выходе: страница присылает сообщение `clear-cache`. Дерево —
 * это личные заметки, и оставлять их в CacheStorage после выхода нельзя, тем более на телефоне.
 */

// Версия поднимается при изменениях в оболочке, где разметка и скрипт обязаны совпадать.
// activate удаляет кэши с чужой версией, поэтому старый index.html не может достаться новому
// app.js. Разъехавшись, они роняют скрипт целиком: обращение к несуществующему элементу — это
// TypeError на верхнем уровне, после которого не выполняется ничего.
const VERSION = 'v6';
const SHELL_CACHE = `spritenote-shell-${VERSION}`;
const DATA_CACHE = `spritenote-data-${VERSION}`;

// Оболочка: то, без чего страница не откроется. Каталог vendor/xterm сюда намеренно не входит —
// терминал админский, тяжёлый и без сети всё равно бесполезен.
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Каждый файл кладём отдельно: один недоступный адрес не должен рушить всю установку.
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-cache') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

// Сначала сеть, кэш — запасной путь. Успешный ответ попутно обновляет кэш.
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Админские ручки и авторизация — мимо кэша, всегда в сеть.
  if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/auth')) return;

  // Дерево: то самое, ради чего всё и затевалось.
  if (url.pathname === '/api/nodes') {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Остальной API без сети смысла не имеет — пусть падает честно.
  if (url.pathname.startsWith('/api/')) return;

  // Переходы: без сети отдаём сохранённую оболочку, чтобы приложение вообще открылось.
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
