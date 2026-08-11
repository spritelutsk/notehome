# AGENTS.md — архитектура и правила проекта SpriteNote

Документ для того, кто (человек или модель) впервые открывает этот репозиторий.
Здесь только то, что **не** выводится из чтения кода: почему сделано так, а не иначе, и чего
делать нельзя. Пользовательское описание возможностей — в [README.md](README.md).

## Что это

Личный «проводник» для заметок: дерево папок, внутри — ссылки, текстовые страницы и документы.
Один пользователь видит только свои данные. Крутится на Raspberry Pi автора, за nginx.

## Стек и почему такой

- **Node.js + Express + MariaDB (`mysql2/promise`).** Обычный SQL, без ORM.
- **Фронтенд — один файл `public/js/app.js`, без сборки, без фреймворка.** Это осознанно:
  проект живёт на Pi, и «залил файл — обновилось» ценнее, чем удобства npm-сборки.
  **Не вводите здесь сборщик, TypeScript или фреймворк без явной просьбы.**
- **Зависимостей минимум.** Каждая новая — это ещё и `npm install` на слабой машине.

## Карта кода

```
server/
├── index.js          express-приложение, rate limiting, порядок middleware, запуск
├── db.js             пул mysql2 — и больше ничего
├── schema.js         ensureSchema(): доколонки для уже развёрнутых БД
├── auth.js           куки-сессии, requireAuth / requireAdmin
├── user-settings.js  спецификация пользовательских настроек (SETTINGS_SPEC)
├── terminal.js       веб-терминал: WebSocket + node-pty, только админ
├── link-summary.js   «Кратко о ссылке»: безопасный fetch + вызов claude CLI
└── routes/
    ├── auth.js       регистрация, вход, пароль, настройки, удаление аккаунта
    ├── nodes.js      CRUD дерева, move, export/import, link-summary
    └── admin.js      пользователи, файловый менеджер, .zip проекта, блокнот
public/
├── index.html        вся разметка приложения, включая модалки
├── css/style.css     единственный стиль-файл
├── js/app.js         SPA целиком: state, рендер, обработчики
└── vendor/xterm/     xterm.js, положен локально, не из CDN
scripts/
├── init-db.sql       схема БД для свежей установки
├── spritenote.service           пример systemd-юнита приложения
├── nginx-spritenote.conf        пример конфига nginx: TLS + security headers + WS
├── nginx-spritenote-funnel.conf vhost для доступа снаружи через Tailscale Funnel (TLS у Tailscale)
├── nginx-websocket-map.conf     map $http_upgrade → $connection_upgrade, общий для обоих vhost
├── duckdns-update.sh/.service/.timer      обновление A-записи DuckDNS по таймеру
├── duckdns-acme-auth.sh/-cleanup.sh       хуки DNS-01 для Let's Encrypt (пути прописаны в /etc/letsencrypt)
└── import-notes-sdb.js          разовый импорт из старой базы notes.sdb, не часть приложения
docs/                 подробности по крупным модулям (см. ниже)
```

Подробнее по модулям:

- [docs/data-model.md](docs/data-model.md) — таблицы, дерево, настройки пользователя
- [docs/frontend.md](docs/frontend.md) — устройство SPA, иконки, состояние
- [docs/import-export.md](docs/import-export.md) — формат JSON и правило «без дублей»
- [docs/link-summary.md](docs/link-summary.md) — защита от SSRF и вызов `claude`
- [docs/admin-and-terminal.md](docs/admin-and-terminal.md) — админка и веб-терминал
- `docs/sessions/` — журнал рабочих сессий; лежит только на рабочей машине, в git не уходит
  (см. `.gitignore`): там инфраструктура конкретного сервера, а не проект

## Принципы, которых держится код

1. **Всё фильтруется по `user_id`.** Любой запрос к `nodes` содержит `WHERE user_id = ?`.
   Проверка «объект мой» — это `getOwnNode()`, а не доверие к id из запроса.
   Рядом идёт второй фильтр: `AND deleted_at IS NULL` — иначе в дерево просочится корзина
   (см. [docs/data-model.md](docs/data-model.md)).
2. **`requireAuth` на весь роутер, а не на отдельные ручки.** В `routes/nodes.js` стоит
   `router.use(requireAuth)`, в `routes/admin.js` — `router.use(requireAuth, requireAdmin)`.
   Новая ручка защищена по умолчанию; забыть защиту нельзя.
3. **Ошибки — это коды, а не тексты.** Сервер отдаёт `{ error: 'some_code' }`, человеческий
   русский текст живёт в `ERROR_MESSAGES` в `public/js/app.js`. Добавили код на сервере —
   добавьте перевод, иначе пользователь увидит «Произошла ошибка».
4. **Комментарий объясняет «почему», а не «что».** В коде много неочевидных мест (пиннинг IP,
   порядок body-парсеров, `RequiresMountsFor` в юните) — они прокомментированы именно так.
5. **Импорт данных не разрушает.** Импорт только добавляет; он не удаляет и не перезаписывает
   существующее. См. [docs/import-export.md](docs/import-export.md).
6. **По пользовательскому URL ходит только `safeFetch`** из `server/link-summary.js` — и «Кратко
   о ссылке», и проверка живости. Проверка IP, пиннинг соединения на уже проверенный адрес и
   ручной разбор редиректов там не для красоты; второй реализации похода наружу быть не должно.
7. **Пользовательский текст в `innerHTML` — только через `renderMarkdown()`**, и только в том
   порядке, в каком он написан: сначала экранирование всего, потом расстановка тегов.
6. **Никаких emoji в интерфейсе.** Иконки — inline-SVG из `ICONS` в `app.js`.
   Причина: на Linux эмодзи-шрифт обычно не установлен (на этой самой Pi его нет), и
   emoji превращаются в пустые квадратики. См. [docs/frontend.md](docs/frontend.md).
7. **Настройки пользователя — на аккаунте, а не в localStorage.** См. `server/user-settings.js`.

## Что ломается молча

- **Порядок парсеров тела в `server/index.js`.** `app.use('/api/nodes/import', express.json({limit:'1gb'}))`
  обязан стоять **до** общего `express.json({limit:'5mb'})`, иначе импорт с вложенными файлами
  падает на лимите. Не переставляйте.
- **Каталог проекта нельзя переименовывать или переносить.** Пути к `scripts/duckdns-acme-*.sh`
  прописаны в `/etc/letsencrypt/renewal/…`, а `WorkingDirectory` — в systemd-юните. Переезд
  тихо ломает продление сертификата, и это выяснится только когда он протухнет.
- **Веб-терминал — это полноценный shell от имени пользователя приложения.** Он не в песочнице.
  Файловый менеджер админки тоже видит всю файловую систему, а не только проект.
- **Схема БД в двух местах.** Свежая установка берёт `scripts/init-db.sql`, уже развёрнутая —
  `server/schema.js`. Добавляя колонку, правьте **оба**, иначе прод и новая установка разъедутся.

## Как запускать и проверять

```bash
npm start                     # слушает HOST:PORT из .env, по умолчанию 127.0.0.1:3000
sudo systemctl restart spritenote     # на этой Pi приложение крутится юнитом
journalctl -u spritenote -f           # логи
```

Автотестов в проекте нет. Проверка серверных изменений — поднять экземпляр на отдельной БД
и отдельном порту, чтобы не трогать боевые данные:

```bash
sudo mariadb -u root -e "CREATE DATABASE spritenote_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
                         GRANT ALL ON spritenote_test.* TO 'spritenote'@'localhost';"
sed -n '/^CREATE TABLE/,$p' scripts/init-db.sql | sudo mariadb -u root spritenote_test
DB_NAME=spritenote_test PORT=3099 node server/index.js
# ... curl-ы по http://127.0.0.1:3099 ...
sudo mariadb -u root -e "DROP DATABASE spritenote_test;"
```

Учтите: загруженные файлы в этом режиме всё равно ложатся в общий `data/uploads/<user_id>/`,
поэтому после теста с документами подчистите за собой.

## Конвенции

- Язык интерфейса и документации — русский. Идентификаторы, комментарии в коде — английский.
- Каждая рабочая сессия записывается в `docs/sessions/YYYY-MM-DD.md`: что сделано, что проверено,
  что осталось. Системное состояние (юниты, nginx, сертификаты) в git не попадает — журнал
  единственное место, где оно фиксируется. Сам каталог тоже не коммитится: он описывает
  конкретный сервер (имена узлов, адреса, устройство доступа снаружи), и в публичном
  репозитории ему не место.
- Заметные изменения — строкой в [CHANGELOG.md](CHANGELOG.md), незакрытые хвосты — в [TODO.md](TODO.md).
