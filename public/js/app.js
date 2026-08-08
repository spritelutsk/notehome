(() => {
  'use strict';

  // Client-side mirror of SETTINGS_SPEC in server/user-settings.js — used before the account's
  // own settings have arrived, and as the fallback if the server ever omits a key.
  const DEFAULT_SETTINGS = { contentViewMode: 'grid', language: 'ru' }; // 'grid' | 'list', 'uk' | 'ru' | 'en'

  // ---------------- State ----------------
  const state = {
    user: null,
    nodes: [],
    selectedFolderId: null, // null = nothing selected yet
    expanded: new Set(),
    view: 'explorer',
    authMode: 'login', // 'login' | 'register'
    itemModal: null, // { mode, type, parentId, nodeId }
    moveModal: null, // { nodeId, chosenParentId }
    filesPath: null, // null = let the server pick its default (project root) on first load
    terminal: null, // { term, fitAddon, ws }
    settings: { ...DEFAULT_SETTINGS }, // per-account UI preferences, replaced on login
    searchQuery: '',
  };

  // ---------------- Translations ----------------
  //
  // Один ключ — одна строка на трёх языках: [uk, ru, en]. Языки лежат рядом, а не в трёх
  // отдельных словарях: добавляя строку, невозможно молча забыть про один из языков, и это
  // видно глазами в одной строке диффа.
  //
  // Статическая разметка не дублирует эти строки, а помечена в index.html атрибутами
  // data-t / data-t-title / data-t-placeholder; renderStaticTexts() расставляет текст по ним.

  const LANGS = ['uk', 'ru', 'en'];

  // Даты форматирует сам браузер; ему нужна не наша метка языка, а BCP 47.
  const DATE_LOCALE = { uk: 'uk-UA', ru: 'ru-RU', en: 'en-GB' };

  const TRANSLATIONS = {
    // Ответы сервера: код ошибки приходит с бэкенда, errMsg() достаёт по нему строку.
    invalid_email: ["Введіть коректний email", "Введите корректный email", "Enter a valid email address"],
    weak_password: [
      "Пароль має бути не менше 8 символів",
      "Пароль должен быть не короче 8 символов",
      "Password must be at least 8 characters",
    ],
    email_taken: [
      "Цей email вже зареєстрований",
      "Этот email уже зарегистрирован",
      "This email is already registered",
    ],
    invalid_credentials: ["Невірний email або пароль", "Неверный email или пароль", "Invalid email or password"],
    missing_credentials: ["Введіть email і пароль", "Введите email и пароль", "Enter email and password"],
    not_authenticated: ["Потрібен вхід", "Требуется вход", "Authentication required"],
    session_expired: [
      "Сесія закінчилася, увійдіть знову",
      "Сессия истекла, войдите снова",
      "Session expired, please log in again",
    ],
    admin_required: ["Потрібні права адміністратора", "Требуются права администратора", "Admin privileges required"],
    name_required: ["Введіть назву", "Введите название", "Enter a name"],
    url_required: ["Введіть посилання (URL)", "Введите ссылку (URL)", "Enter a URL"],
    invalid_type: ["Некоректний тип елемента", "Некорректный тип элемента", "Invalid element type"],
    parent_not_found: [
      "Папка призначення не знайдена",
      "Папка назначения не найдена",
      "Destination folder not found",
    ],
    parent_not_folder: [
      "Можна переміщувати тільки всередину папки",
      "Можно перемещать только внутрь папки",
      "Can only move into a folder",
    ],
    cannot_move_into_self: [
      "Не можна перемістити елемент у самого себе",
      "Нельзя переместить элемент в самого себя",
      "Cannot move an element into itself",
    ],
    cannot_move_into_descendant: [
      "Не можна перемістити папку в свою ж підпапку",
      "Нельзя переместить папку в свою же подпапку",
      "Cannot move a folder into its own descendant",
    ],
    cannot_remove_last_admin: [
      "Не можна зняти права у останнього адміністратора",
      "Нельзя снять права у последнего администратора",
      "Cannot remove privileges from the last admin",
    ],
    not_found: ["Елемент не знайдено", "Элемент не найден", "Element not found"],
    file_required: ["Оберіть файл", "Выберите файл", "Select a file"],
    upload_error: ["Помилка завантаження файлу", "Ошибка загрузки файла", "File upload error"],
    server_error: ["Внутрішня помилка сервера", "Внутренняя ошибка сервера", "Internal server error"],
    cannot_read_dir: [
      "Не вдалося прочитати папку (немає доступу?)",
      "Не удалось прочитать папку (нет доступа?)",
      "Failed to read folder (no access?)",
    ],
    target_dir_not_found: [
      "Папка призначення не знайдена",
      "Папка назначения не найдена",
      "Destination folder not found",
    ],
    cannot_delete_directory: [
      "Не можна видалити папку цілком — тільки окремі файли",
      "Нельзя удалить папку целиком — только отдельные файлы",
      "Cannot delete entire directory — only individual files",
    ],
    invalid_import_file: [
      "Файл не схожий на експорт SpriteNote",
      "Файл не похож на экспорт SpriteNote",
      "File does not look like a SpriteNote export",
    ],
    fetch_failed: [
      "Не вдалося відкрити сторінку за цим посиланням",
      "Не удалось открыть страницу по этой ссылке",
      "Failed to open page at this URL",
    ],
    url_not_allowed: [
      "Це посилання недоступне для перегляду",
      "Эта ссылка недоступна для просмотра",
      "This URL is not accessible",
    ],
    not_html: [
      "Сторінка за посиланням — не HTML, не можу її прочитати",
      "Страница по ссылке — не HTML, не могу её прочитать",
      "Page at URL is not HTML, cannot read it",
    ],
    empty_page: ["На сторінці не знайшлося тексту", "На странице не нашлось текста", "No text found on page"],
    summary_failed: [
      "Не вийшло скласти стислий опис, спробуйте ще раз",
      "Не получилось составить краткое описание, попробуйте ещё раз",
      "Failed to generate summary, try again",
    ],
    too_many_redirects: [
      "Занадто багато перенаправлень за посиланням",
      "Слишком много перенаправлений по ссылке",
      "Too many redirects",
    ],
    cannot_delete_last_admin_with_other_users: [
      "Ви останній адміністратор, а на сайті є інші користувачі — спочатку призначте іншого адміна",
      "Вы последний администратор, а на сайте есть другие пользователи — сначала назначьте другого админа",
      "You are the last admin and there are other users — assign another admin first",
    ],
    too_many_requests: [
      "Занадто багато спроб, зачекайте трохи і повторіть",
      "Слишком много попыток, подождите немного и повторите",
      "Too many attempts, please wait and try again",
    ],
    invalid_request: ["Некоректний запит", "Некорректный запрос", "Invalid request"],
    error_generic: ["Сталася помилка", "Произошла ошибка", "Something went wrong"],

    // Страница до входа и окно входа/регистрации.
    app_title: [
      "SpriteNote — ваш особистий провідник нотаток",
      "SpriteNote — ваш личный проводник заметок",
      "SpriteNote — your personal notes navigator",
    ],
    btn_login_register: ["Увійти / Реєстрація", "Войти / Регистрация", "Log In / Register"],
    landing_h1: [
      "Усі ваші папки, посилання та нотатки — в одному дереві",
      "Все ваши папки, ссылки и заметки — в одном дереве",
      "All your folders, links, and notes — in one tree",
    ],
    landing_p: [
      "SpriteNote — особистий провідник для зберігання інформації: створюйте папки та підпапки, додавайте посилання з описом, текстові нотатки та документи. Все як у звичному файловому менеджері, але в браузері і тільки для вас.",
      "SpriteNote — личный проводник для хранения информации: создавайте папки и подпапки, добавляйте ссылки с описанием, текстовые заметки и документы. Всё как в привычном файловом менеджере, но в браузере и только для вас.",
      "SpriteNote is a personal navigator for storing information: create folders and subfolders, add links with descriptions, text notes, and documents. Just like a familiar file manager, but in your browser and only for you.",
    ],
    feature_folders: [
      "Дерево папок і підпапок, як у провіднику Windows",
      "Дерево папок и подпапок, как в проводнике Windows",
      "Tree of folders and subfolders, like in Windows Explorer",
    ],
    feature_links: [
      "Посилання, текстові сторінки та документи всередині папок",
      "Ссылки, текстовые страницы и документы внутри папок",
      "Links, text pages, and documents inside folders",
    ],
    feature_edit: [
      "Редагування, видалення та переміщення будь-яких елементів",
      "Редактирование, удаление и перемещение любых элементов",
      "Edit, delete, and move any elements",
    ],
    feature_private: [
      "Дані кожного користувача видні тільки йому",
      "Данные каждого пользователя видны только ему",
      "Each user's data is visible only to them",
    ],
    art_new_item: ["+ новий елемент", "+ новый элемент", "+ new item"],
    btn_start: ["Почати користуватися", "Начать пользоваться", "Get Started"],
    auth_title_login: ["Вхід", "Вход", "Log In"],
    auth_title_register: ["Реєстрація", "Регистрация", "Register"],
    auth_sub_login: [
      "Увійдіть, щоб відкрити свій провідник нотаток",
      "Войдите, чтобы открыть свой проводник заметок",
      "Log in to open your notes navigator",
    ],
    auth_sub_register: [
      "Створіть акаунт — перший зареєстрований стає адміністратором",
      "Создайте аккаунт — первый зарегистрированный становится администратором",
      "Create an account — the first registrant becomes admin",
    ],
    label_email: ["Email", "Email", "Email"],
    label_password: ["Пароль", "Пароль", "Password"],
    btn_sign_in: ["Увійти", "Войти", "Log In"],
    btn_sign_up: ["Зареєструватися", "Зарегистрироваться", "Register"],
    no_account: ["Немає акаунту?", "Нет аккаунта?", "No account?"],
    have_account: ["Вже є акаунт?", "Уже есть аккаунт?", "Already have an account?"],
    link_register: ["Зареєструватися", "Зарегистрироваться", "Register"],
    link_login: ["Увійти", "Войти", "Log In"],

    // Каркас приложения: вкладки, боковая панель, панель над содержимым.
    tab_explorer: ["Провідник", "Проводник", "Explorer"],
    tab_help: ["Інструкція", "Инструкция", "Help"],
    tab_admin: ["Панель керування", "Панель управления", "Admin Panel"],
    tab_notepad: ["Блокнот", "Блокнот", "Notepad"],
    tab_terminal: ["Термінал", "Терминал", "Terminal"],
    btn_account: ["Акаунт", "Аккаунт", "Account"],
    btn_logout: ["Вихід", "Выход", "Logout"],
    sidebar_root_folders: ["Кореневі папки", "Корневые папки", "Root Folders"],
    btn_export: ["Експортувати все в JSON", "Экспортировать всё в JSON", "Export all to JSON"],
    btn_import: ["Імпортувати з JSON", "Импортировать из JSON", "Import from JSON"],
    btn_new_folder: ["Нова коренева папка", "Новая корневая папка", "New Root Folder"],
    search_placeholder: ["Пошук по дереву…", "Поиск по дереву…", "Search tree…"],
    btn_new_subfolder: ["Нова підпапка", "Новая подпапка", "New Subfolder"],
    btn_new_link: ["Нове посилання", "Новая ссылка", "New Link"],
    btn_new_text: ["Нова текстова сторінка", "Новая текстовая страница", "New Text Page"],
    btn_new_doc: ["Новий документ", "Новый документ", "New Document"],
    view_tile: ["Плитка", "Плитка", "Grid"],
    view_list_label: ["Список", "Список", "List"],
    view_list_title: ["Список (одним рядком)", "Список (одной строкой)", "List (one line each)"],
    tree_empty: [
      "Поки немає жодної папки. Натисніть «+», щоб створити першу.",
      "Пока нет ни одной папки. Нажмите «+», чтобы создать первую.",
      "No folders yet. Click “+” to create the first one.",
    ],
    tree_menu_title: ["Дії з папкою", "Действия с папкой", "Folder actions"],
    path_root: ["Корінь", "Корень", "Root"],
    search_results: ["Пошук: «{q}»", "Поиск: «{q}»", "Search: “{q}”"],
    empty_pick_folder: [
      "Оберіть папку зліва або створіть нову, щоб почати",
      "Выберите папку слева или создайте новую, чтобы начать",
      "Pick a folder on the left or create a new one to start",
    ],
    empty_folder: [
      "Ця папка порожня. Додайте елемент через панель зверху.",
      "Эта папка пуста. Добавьте элемент через панель сверху.",
      "This folder is empty. Add an item from the toolbar above.",
    ],
    empty_search: [
      "Нічого не знайдено за запитом «{q}»",
      "Ничего не найдено по запросу «{q}»",
      "Nothing found for “{q}”",
    ],
    no_file: ["Файл не прикріплено", "Файл не прикреплён", "No file attached"],
    items_count: ["елементів: {n}", "элементов: {n}", "{n} item(s)"],

    // Меню элемента, подтверждения и тосты.
    confirm_delete_account: [
      "Видалити акаунт і всі ваші дані без можливості відновлення?",
      "Удалить аккаунт и все ваши данные без возможности восстановления?",
      "Delete your account and all your data without possibility of recovery?",
    ],
    menu_open: ["Відкрити", "Открыть", "Open"],
    menu_open_link: ["Відкрити посилання", "Открыть ссылку", "Open link"],
    menu_download: ["Завантажити", "Скачать", "Download"],
    menu_edit: ["Редагувати", "Редактировать", "Edit"],
    menu_move: ["Перемістити", "Переместить", "Move"],
    menu_delete: ["Видалити", "Удалить", "Delete"],
    confirm_delete_folder: [
      "Видалити папку «{name}» і весь її вміст? Цю дію не скасувати.",
      "Удалить папку «{name}» и всё её содержимое? Это действие необратимо.",
      "Delete the folder “{name}” and everything in it? This cannot be undone.",
    ],
    confirm_delete_item: [
      "Видалити «{name}»? Цю дію не скасувати.",
      "Удалить «{name}»? Это действие необратимо.",
      "Delete “{name}”? This cannot be undone.",
    ],
    confirm_delete_file: ["Видалити файл «{name}»?", "Удалить файл «{name}»?", "Delete the file “{name}”?"],
    confirm_import: [
      "Імпортувати дані з «{name}»? Додасться лише те, чого ще немає — наявні елементи залишаться як є, дублі не створюються.",
      "Импортировать данные из «{name}»? Добавится только то, чего ещё нет — существующие элементы останутся как есть, дубли не создаются.",
      "Import data from “{name}”? Only what is missing gets added — existing items stay as they are and no duplicates are created.",
    ],
    toast_created: ["Створено", "Создано", "Created"],
    toast_saved: ["Збережено", "Сохранено", "Saved"],
    toast_deleted: ["Видалено", "Удалено", "Deleted"],
    toast_moved: ["Переміщено", "Перемещено", "Moved"],
    toast_done: ["Готово", "Готово", "Done"],
    toast_uploaded: ["Файл завантажено", "Файл загружен", "File uploaded"],
    import_added: ["Додано елементів: {n}", "Добавлено элементов: {n}", "Items added: {n}"],
    import_added_skipped: [
      "Додано: {n}, вже було: {skipped}",
      "Добавлено: {n}, уже было: {skipped}",
      "Added: {n}, already there: {skipped}",
    ],
    import_parse_failed: [
      "Не вдалося розібрати файл імпорту",
      "Не удалось разобрать файл импорта",
      "Could not read the import file",
    ],

    // Окна: создание/редактирование, перемещение, аккаунт.
    account_title: ["Акаунт", "Аккаунт", "Account"],
    account_current_password: ["Поточний пароль", "Текущий пароль", "Current Password"],
    account_new_password: ["Новий пароль", "Новый пароль", "New Password"],
    account_new_password_repeat: ["Повторіть новий пароль", "Повторите новый пароль", "Repeat New Password"],
    btn_change_password: ["Змінити пароль", "Изменить пароль", "Change Password"],
    delete_account_title: ["Видалення акаунту", "Удаление аккаунта", "Delete Account"],
    delete_account_desc: [
      "Видалить ваш акаунт і всі ваші папки, посилання, сторінки та документи без можливості відновлення.",
      "Удалит ваш аккаунт и все ваши папки, ссылки, страницы и документы без возможности восстановления.",
      "Will delete your account and all your folders, links, pages, and documents without possibility of recovery.",
    ],
    delete_account_confirm: ["Пароль для підтвердження", "Пароль для подтверждения", "Password for confirmation"],
    password_changed: ["Пароль змінено", "Пароль изменён", "Password changed"],
    passwords_mismatch: ["Нові паролі не співпадають", "Новые пароли не совпадают", "New passwords do not match"],
    account_deleted: ["Акаунт видалено", "Аккаунт удалён", "Account deleted"],
    save_setting_failed: [
      "Не вдалося зберегти налаштування відображення",
      "Не удалось сохранить настройку отображения",
      "Failed to save display setting",
    ],
    lang_uk: ["Українська", "Українська", "Українська"],
    lang_ru: ["Русский", "Русский", "Русский"],
    lang_en: ["English", "English", "English"],
    label_language: ["Мова інтерфейсу", "Язык интерфейса", "Interface Language"],
    modal_new: ["Нова: {type}", "Новая: {type}", "New: {type}"],
    modal_edit: ["Змінити: {type}", "Изменить: {type}", "Edit: {type}"],
    modal_sub_create: [
      "Заповніть поля і натисніть «Створити»",
      "Заполните поля и нажмите «Создать»",
      "Fill in the fields and click “Create”",
    ],
    modal_sub_edit: [
      "Змініть поля і натисніть «Зберегти»",
      "Измените поля и нажмите «Сохранить»",
      "Change the fields and click “Save”",
    ],
    current_file: [
      "Поточний файл: {name} ({size})",
      "Текущий файл: {name} ({size})",
      "Current file: {name} ({size})",
    ],
    reading_page: ["Читаю сторінку…", "Читаю страницу…", "Reading the page…"],
    label_name: ["Назва", "Название", "Name"],
    label_url: ["Посилання (URL)", "Ссылка (URL)", "Link (URL)"],
    label_description: ["Опис", "Описание", "Description"],
    label_content: ["Текст сторінки", "Текст страницы", "Page text"],
    label_file: ["Файл документа", "Файл документа", "Document file"],
    btn_link_summary: ["Коротко про посилання Claude", "Кратко о ссылке Claude", "Summarize link with Claude"],
    btn_cancel: ["Скасувати", "Отмена", "Cancel"],
    btn_create: ["Створити", "Создать", "Create"],
    btn_save: ["Зберегти", "Сохранить", "Save"],
    move_title: ["Перемістити", "Переместить", "Move"],
    move_sub: ["Оберіть папку призначення", "Выберите папку назначения", "Choose the destination folder"],
    move_root: ["Корінь (без папки)", "Корень (без папки)", "Root (no folder)"],
    btn_move_here: ["Перемістити сюди", "Переместить сюда", "Move here"],

    // Панель управления, блокнот, терминал.
    btn_delete_account: ["Видалити акаунт і всі дані", "Удалить аккаунт и все данные", "Delete Account and All Data"],
    admin_view_title: ["Панель керування", "Панель управления", "Control panel"],
    admin_view_sub: [
      "Користувачі, права та файли сервера",
      "Пользователи, права и файлы сервера",
      "Users, permissions and server files",
    ],
    th_email: ["Email", "Email", "Email"],
    th_role: ["Роль", "Роль", "Role"],
    th_data: ["Дані", "Данные", "Data"],
    th_registered: ["Реєстрація", "Регистрация", "Registered"],
    th_name: ["Ім'я", "Имя", "Name"],
    th_size: ["Розмір", "Размер", "Size"],
    th_modified: ["Змінено", "Изменён", "Modified"],
    you: ["(ви)", "(вы)", "(you)"],
    role_admin: ["Адмін", "Админ", "Admin"],
    role_user: ["Користувач", "Пользователь", "User"],
    btn_promote: ["Зробити адміном", "Сделать админом", "Make admin"],
    btn_demote: ["Зняти права адміна", "Снять права админа", "Revoke admin"],
    server_files_title: ["Файли сервера", "Файлы сервера", "Server files"],
    btn_download_project: ["Завантажити проєкт (.zip)", "Скачать проект (.zip)", "Download project (.zip)"],
    btn_up: ["Вгору", "Наверх", "Up"],
    btn_up_title: ["На рівень вище", "На уровень выше", "One level up"],
    btn_refresh: ["Оновити", "Обновить", "Refresh"],
    file_drop: [
      "Натисніть, щоб завантажити файл у поточну папку",
      "Нажмите, чтобы загрузить файл в текущую папку",
      "Click to upload a file into the current folder",
    ],
    btn_download: ["Завантажити", "Скачать", "Download"],
    btn_delete: ["Видалити", "Удалить", "Delete"],
    dir_empty: ["Папка порожня", "Папка пуста", "The folder is empty"],
    notepad_view_title: ["Блокнот", "Блокнот", "Notepad"],
    notepad_placeholder: ["Нотатки адміністратора…", "Заметки администратора…", "Administrator notes…"],
    notepad_saving: ["Збереження…", "Сохранение…", "Saving…"],
    notepad_saved: ["Збережено: {date}", "Сохранено: {date}", "Saved: {date}"],
    notepad_save_error: ["Помилка збереження", "Ошибка сохранения", "Could not save"],
    terminal_view_title: ["Термінал", "Терминал", "Terminal"],
    term_not_connected: ["не підключено", "не подключено", "not connected"],
    term_connecting: ["підключення…", "подключение…", "connecting…"],
    term_connected: ["підключено", "подключено", "connected"],
    term_exited: ["процес завершено (код {code})", "процесс завершён (код {code})", "process exited (code {code})"],
    term_disconnected: [
      "відключено — оновіть сторінку або перемкніть вкладку, щоб перепідключитися",
      "отключено — обновите страницу или переключите вкладку, чтобы переподключиться",
      "disconnected — reload the page or switch tabs to reconnect",
    ],
    term_socket_error: ["помилка з'єднання", "ошибка соединения", "connection error"],

    // Единицы размера файла.
    unit_b: ["Б", "Б", "B"],
    unit_kb: ["КБ", "КБ", "KB"],
    unit_mb: ["МБ", "МБ", "MB"],
    unit_gb: ["ГБ", "ГБ", "GB"],

    // Вкладка «Инструкция». Порядок — как на странице.
    help_title: ["Інструкція", "Инструкция", "Help"],
    help_subtitle: [
      "Як користуватися SpriteNote і що робить кожна кнопка",
      "Как пользоваться SpriteNote и что делает каждая кнопка",
      "How to use SpriteNote and what each button does",
    ],
    help_lead: [
      "SpriteNote влаштований як файловий менеджер: зліва — дерево папок, справа — вміст обраної папки. Всередині папок лежать посилання, текстові сторінки та документи. Усі дані видні тільки вам.",
      "SpriteNote устроен как файловый менеджер: слева — дерево папок, справа — содержимое выбранной папки. Внутри папок лежат ссылки, текстовые страницы и документы. Все данные видны только вам.",
      "SpriteNote works like a file manager: on the left is a folder tree, on the right is the content of the selected folder. Inside folders are links, text pages, and documents. All data is visible only to you.",
    ],
    help_start_title: ["З чого почати", "С чего начать", "Getting Started"],
    help_start_1: [
      "Створіть кореневу папку — кнопка «+» у заголовку бічної панелі зліва.",
      "Создайте корневую папку — кнопка «+» в заголовке боковой панели слева.",
      "Create a root folder — the \"+\" button in the sidebar header on the left.",
    ],
    help_start_2: [
      "Оберіть папку в дереві — її вміст відкриється справа.",
      "Выберите папку в дереве — её содержимое откроется справа.",
      "Select a folder in the tree — its content will open on the right.",
    ],
    help_start_3: [
      "Додайте елемент кнопками над вмістом: підпапку, посилання, текстову сторінку або документ.",
      "Добавьте элемент кнопками над содержимым: подпапку, ссылку, текстовую страницу или документ.",
      "Add an element using the buttons above the content: subfolder, link, text page, or document.",
    ],
    help_start_4: [
      "Заповніть поля у вікні, що відкрилося, і натисніть «Створити».",
      "Заполните поля в открывшемся окне и нажмите «Создать».",
      "Fill in the fields in the dialog that opens and click \"Create\".",
    ],
    help_start_5: [
      "Далі: клік по елементу — відкрити, кнопка «…» на елементі — змінити, перемістити або видалити.",
      "Дальше: клик по элементу — открыть, кнопка «…» на элементе — изменить, переместить или удалить.",
      "Then: click an element to open it, click \"…\" on an element to edit, move, or delete it.",
    ],
    help_types_title: ["Що можна зберігати", "Что можно хранить", "What You Can Store"],
    help_type_folder: ["Папка", "Папка", "Folder"],
    help_type_folder_desc: [
      "Вкладеність не обмежена: папки всередині папок, як у провіднику.",
      "Вложенность не ограничена: папки внутри папок, как в проводнике.",
      "Unlimited nesting: folders inside folders, like in a file manager.",
    ],
    help_type_link: ["Посилання", "Ссылка", "Link"],
    help_type_link_desc: [
      "Адреса та опис. Клік відкриває сайт у новій вкладці браузера.",
      "Адрес и описание. Клик открывает сайт в новой вкладке браузера.",
      "URL and description. Click opens the website in a new browser tab.",
    ],
    help_type_text: ["Текстова сторінка", "Текстовая страница", "Text Page"],
    help_type_text_desc: [
      "Нотатка прямо в SpriteNote. Клік відкриває її для читання і правки.",
      "Заметка прямо в SpriteNote. Клик открывает её для чтения и правки.",
      "A note directly in SpriteNote. Click opens it for reading and editing.",
    ],
    help_type_doc: ["Документ", "Документ", "Document"],
    help_type_doc_desc: [
      "Завантажений файл. Клік завантажує його назад на пристрій.",
      "Загруженный файл. Клик скачивает его обратно на устройство.",
      "Uploaded file. Click downloads it back to your device.",
    ],
    help_topbar_title: ["Верхня панель", "Верхняя панель", "Top Bar"],
    help_topbar_explorer: ["Провідник", "Проводник", "Explorer"],
    help_topbar_explorer_desc: [
      "Дерево папок і їх вміст — основна сторінка.",
      "Дерево папок и их содержимое — основная страница.",
      "Folder tree and their content — the main page.",
    ],
    help_topbar_help: ["Інструкція", "Инструкция", "Help"],
    help_topbar_help_desc: ["Ця сторінка.", "Эта страница.", "This page."],
    help_topbar_account: ["Акаунт", "Аккаунт", "Account"],
    help_topbar_account_desc: [
      "Зміна пароля і видалення акаунту разом з усіма даними.",
      "Смена пароля и удаление аккаунта вместе со всеми данными.",
      "Change password and delete account along with all data.",
    ],
    help_topbar_logout: ["Вихід", "Выход", "Logout"],
    help_topbar_logout_desc: [
      "Завершує сеанс. Дані залишаються, вхід — тим самим email і паролем.",
      "Завершает сеанс. Данные остаются, вход — тем же email и паролем.",
      "Ends session. Data remains, log in with the same email and password.",
    ],
    help_sidebar_title: ["Бічна панель: дерево папок", "Боковая панель: дерево папок", "Sidebar: Folder Tree"],
    help_sidebar_plus: ["Плюс", "Плюс", "Plus"],
    help_sidebar_plus_desc: [
      "Створює нову кореневу папку — папку верхнього рівня.",
      "Создаёт новую корневую папку — папку верхнего уровня.",
      "Creates a new root folder — a top-level folder.",
    ],
    help_sidebar_download: ["Стрілка вниз", "Стрелка вниз", "Down Arrow"],
    help_sidebar_download_desc: [
      "Вивантажує все дерево у файл JSON — резервна копія або перенесення на інший сервер.",
      "Выгружает всё дерево в файл JSON — резервная копия или перенос на другой сервер.",
      "Exports the entire tree to a JSON file — backup or transfer to another server.",
    ],
    help_sidebar_upload: ["Стрілка вгору", "Стрелка вверх", "Up Arrow"],
    help_sidebar_upload_desc: [
      "Завантажує дерево з файлу JSON. Додається тільки те, чого ще немає: повторний імпорт того ж файлу дублікатів не створює.",
      "Загружает дерево из файла JSON. Добавляется только то, чего ещё нет: повторный импорт того же файла дублей не создаёт.",
      "Imports tree from a JSON file. Only adds what doesn't exist yet: re-importing the same file won't create duplicates.",
    ],
    help_sidebar_search: ["Пошук по дереву", "Поиск по дереву", "Tree Search"],
    help_sidebar_search_desc: [
      "Шукає за назвою, описом, текстом сторінок і адресами посилань у всьому дереві одразу. Результати показуються справа з указанням папки; клік по результату відкриває елемент. Очистити — клавішею Esc або стерши текст.",
      "Ищет по названию, описанию, тексту страниц и адресам ссылок во всём дереве сразу. Результаты показываются справа с указанием папки; клик по результату открывает элемент. Очистить — клавишей Esc или стерев текст.",
      "Searches by name, description, page text, and link URLs across the entire tree. Results appear on the right with folder indication; click result to open element. Clear with Esc key or by deleting text.",
    ],
    help_sidebar_chevron: ["Трикутник біля папки", "Треугольник у папки", "Triangle by Folder"],
    help_sidebar_chevron_desc: [
      "Розгортає і згортає список підпапок. У папок без підпапок його немає.",
      "Разворачивает и сворачивает список подпапок. У папок без подпапок его нет.",
      "Expands and collapses the list of subfolders. Folders without subfolders don't have it.",
    ],
    help_sidebar_dots: ["Три точки біля папки", "Три точки у папки", "Three Dots by Folder"],
    help_sidebar_dots_desc: [
      "Меню дій з папкою: відкрити, редагувати, перемістити, видалити. Те ж меню відкривається правою кнопкою миші по рядку.",
      "Меню действий с папкой: открыть, редактировать, переместить, удалить. То же меню открывается правой кнопкой мыши по строке.",
      "Folder actions menu: open, edit, move, delete. Same menu opens with right-click on the row.",
    ],
    help_toolbar_title: ["Панель над вмістом", "Панель над содержимым", "Toolbar Above Content"],
    help_toolbar_home: ["Провідник (у рядку шляху)", "Проводник (в строке пути)", "Explorer (in path bar)"],
    help_toolbar_home_desc: [
      "Повертає в корінь — до списку кореневих папок. Назви папок правіше — перехід на будь-який рівень шляху.",
      "Возвращает в корень — к списку корневых папок. Названия папок правее — переход на любой уровень пути.",
      "Returns to root — to the list of root folders. Folder names to the right — jump to any path level.",
    ],
    help_toolbar_subfolder: ["Нова підпапка", "Новая подпапка", "New Subfolder"],
    help_toolbar_subfolder_desc: [
      "Створює папку всередині відкритої папки.",
      "Создаёт папку внутри открытой папки.",
      "Creates a folder inside the open folder.",
    ],
    help_toolbar_link: ["Нове посилання", "Новая ссылка", "New Link"],
    help_toolbar_link_desc: [
      "Додає посилання з назвою та описом.",
      "Добавляет ссылку с названием и описанием.",
      "Adds a link with name and description.",
    ],
    help_toolbar_text: ["Нова текстова сторінка", "Новая текстовая страница", "New Text Page"],
    help_toolbar_text_desc: [
      "Створює нотатку, текст якої зберігається в SpriteNote.",
      "Создаёт заметку, текст которой хранится в SpriteNote.",
      "Creates a note whose text is stored in SpriteNote.",
    ],
    help_toolbar_doc: ["Новий документ", "Новый документ", "New Document"],
    help_toolbar_doc_desc: [
      "Завантажує файл на сервер і кладе його у відкриту папку.",
      "Загружает файл на сервер и кладёт его в открытую папку.",
      "Uploads a file to the server and places it in the open folder.",
    ],
    help_toolbar_tile: ["Плитка", "Плитка", "Grid"],
    help_toolbar_tile_desc: [
      "Показує вміст картками. Вибір запам'ятовується в акаунті і діє на будь-якому пристрої.",
      "Показывает содержимое карточками. Выбор запоминается в аккаунте и действует на любом устройстве.",
      "Shows content as cards. Selection is saved in account and works on any device.",
    ],
    help_toolbar_list: ["Список", "Список", "List"],
    help_toolbar_list_desc: [
      "Показує вміст компактними рядками — зручно, коли елементів багато.",
      "Показывает содержимое компактными строками — удобно, когда элементов много.",
      "Shows content as compact rows — convenient when there are many elements.",
    ],
    help_toolbar_note: [
      "Чотири кнопки створення з'являються, тільки коли обрана папка: класти елементи в корінь не можна, там живуть лише папки.",
      "Четыре кнопки создания появляются, только когда выбрана папка: класть элементы в корень нельзя, там живут лишь папки.",
      "Four creation buttons appear only when a folder is selected: you can't place elements in root, only folders live there.",
    ],
    help_element_title: ["Елемент і меню дій", "Элемент и меню действий", "Element and Actions Menu"],
    help_element_click: ["Клік по елементу", "Клик по элементу", "Click on Element"],
    help_element_click_desc: [
      "Папка — відкривається, посилання — відкривається в новій вкладці, текстова сторінка — відкривається для правки, документ — завантажується.",
      "Папка — открывается, ссылка — открывается в новой вкладке, текстовая страница — открывается для правки, документ — скачивается.",
      "Folder — opens, Link — opens in new tab, Text Page — opens for editing, Document — downloads.",
    ],
    help_element_dots: [
      "Три точки / права кнопка миші",
      "Три точки / правая кнопка мыши",
      "Three Dots / Right Click",
    ],
    help_element_dots_desc: [
      "Відкриває меню з чотирьох пунктів нижче.",
      "Открывает меню из четырёх пунктов ниже.",
      "Opens menu with four items below.",
    ],
    help_element_open: [
      "Відкрити · Відкрити посилання · Завантажити",
      "Открыть · Открыть ссылку · Скачать",
      "Open · Open Link · Download",
    ],
    help_element_open_desc: [
      "Те ж, що клік по елементу; назва пункту залежить від типу.",
      "То же, что клик по элементу; название пункта зависит от типа.",
      "Same as clicking element; item name depends on type.",
    ],
    help_element_edit: ["Редагувати", "Редактировать", "Edit"],
    help_element_edit_desc: [
      "Відкриває вікно з полями елемента: назва, адреса, опис, текст або файл.",
      "Открывает окно с полями элемента: название, адрес, описание, текст или файл.",
      "Opens dialog with element fields: name, URL, description, text, or file.",
    ],
    help_element_move: ["Перемістити", "Переместить", "Move"],
    help_element_move_desc: [
      "Відкриває вибір нової папки для елемента.",
      "Открывает выбор новой папки для элемента.",
      "Opens selection of new folder for element.",
    ],
    help_element_delete: ["Видалити", "Удалить", "Delete"],
    help_element_delete_desc: [
      "Видаляє елемент після підтвердження. Папка видаляється разом з усім вмістом. Скасувати видалення не можна.",
      "Удаляет элемент после подтверждения. Папка удаляется вместе со всем содержимым. Отменить удаление нельзя.",
      "Deletes element after confirmation. Folder deletes with all content. Cannot undo deletion.",
    ],
    help_modal_title: ["Вікно створення і редагування", "Окно создания и редактирования", "Create and Edit Dialog"],
    help_modal_name: ["Назва", "Название", "Name"],
    help_modal_name_desc: [
      "Обов'язкове поле — під цим ім'ям елемент видно в дереві і в списку.",
      "Обязательное поле — под этим именем элемент виден в дереве и в списке.",
      "Required field — element appears under this name in tree and list.",
    ],
    help_modal_url: ["Посилання (URL)", "Ссылка (URL)", "URL"],
    help_modal_url_desc: [
      "Адреса сторінки для елемента-посилання, наприклад https://example.com.",
      "Адрес страницы для элемента-ссылки, например https://example.com.",
      "Page address for link element, e.g., https://example.com.",
    ],
    help_modal_claude: ["Стисло про посилання Claude", "Кратко о ссылке Claude", "Summarize Link with Claude"],
    help_modal_claude_desc: [
      "Сервер сам відкриває вказану адресу, читає сторінку і заповнює назву та опис за вас. Працює тільки при заповненому полі «Посилання»; займає кілька секунд.",
      "Сервер сам открывает указанный адрес, читает страницу и заполняет название и описание за вас. Работает только при заполненном поле «Ссылка»; занимает несколько секунд.",
      "Server opens the specified URL, reads the page, and fills name and description for you. Only works when \"URL\" field is filled; takes a few seconds.",
    ],
    help_modal_desc: [
      "Опис · Текст сторінки · Файл документа",
      "Описание · Текст страницы · Файл документа",
      "Description · Page Text · Document File",
    ],
    help_modal_desc_desc: [
      "Показується те поле, яке стосується типу елемента. При заміні файлу у документа старий файл видаляється.",
      "Показывается то поле, которое относится к типу элемента. При замене файла у документа старый файл удаляется.",
      "Shows the field relevant to element type. When replacing a document's file, old file is deleted.",
    ],
    help_modal_create: ["Створити / Зберегти", "Создать / Сохранить", "Create / Save"],
    help_modal_create_desc: [
      "Записує елемент. Напис залежить від того, створюєте ви елемент чи правите наявний.",
      "Записывает элемент. Надпись зависит от того, создаёте вы элемент или правите существующий.",
      "Saves element. Label depends on whether you're creating or editing.",
    ],
    help_th_button: ["Кнопка", "Кнопка", "Button"],
    help_th_action: ["Дія", "Действие", "Action"],
    help_th_field: ["Кнопка або поле", "Кнопка или поле", "Button or field"],
    help_th_does: ["Що робить", "Что делает", "What it does"],
    help_badge_admin: ["Адмін", "Админ", "Admin"],
    help_modal_corner: ["Куток вікна", "Уголок окна", "Window corner"],
    help_modal_corner_desc: [
      "Вікно розтягується мишею за правий нижній кут; розмір запам'ятовується в цьому браузері й застосовується до наступних вікон того ж виду.",
      "Окно растягивается мышью за правый нижний угол; размер запоминается в этом браузере и применяется к следующим окнам того же вида.",
      "Drag the bottom-right corner to resize. The size is remembered in this browser and reused for the next window of the same kind.",
    ],
    help_modal_cancel_row: ["Скасувати і «×»", "Отмена и «×»", "Cancel and “×”"],
    help_modal_cancel_row_desc: [
      "Закривають вікно без збереження. Те саме робить клік по затемненому фону.",
      "Закрывают окно без сохранения. То же делает клик по затемнённому фону.",
      "Close the window without saving. Clicking the dimmed background does the same.",
    ],
    help_move_title: ["Вікно «Перемістити»", "Окно «Переместить»", "The “Move” window"],
    help_move_root: ["Корінь (без папки)", "Корень (без папки)", "Root (no folder)"],
    help_move_root_desc: [
      "Робить папку кореневою. Доступно лише для папок — посилання, сторінки й документи мусять лежати в папці.",
      "Делает папку корневой. Доступно только для папок — ссылки, страницы и документы обязаны лежать в папке.",
      "Makes the folder a root folder. Folders only — links, pages and documents must live inside a folder.",
    ],
    help_move_folder: ["Папка у списку", "Папка в списке", "A folder in the list"],
    help_move_folder_desc: [
      "Обирає її як місце призначення. Папка, яку ви переносите, і її вміст у списку не показуються: всередину себе перемістити не можна.",
      "Выбирает её как место назначения. Папка, которую вы переносите, и её содержимое в списке не показываются: внутрь себя переместить нельзя.",
      "Picks it as the destination. The folder you are moving and its contents are not listed: it cannot be moved into itself.",
    ],
    help_move_confirm: ["Перемістити сюди", "Переместить сюда", "Move here"],
    help_move_confirm_desc: [
      "Виконує перенесення до обраної папки.",
      "Выполняет перенос в выбранную папку.",
      "Performs the move into the chosen folder.",
    ],
    help_move_cancel: ["Скасувати і «×»", "Отмена и «×»", "Cancel and “×”"],
    help_move_cancel_desc: [
      "Закривають вікно, нічого не змінюючи.",
      "Закрывают окно, ничего не меняя.",
      "Close the window without changing anything.",
    ],
    help_account_title: ["Вікно «Акаунт»", "Окно «Аккаунт»", "The “Account” window"],
    help_account_lang: ["Мова інтерфейсу", "Язык интерфейса", "Interface language"],
    help_account_lang_desc: [
      "Перемикає мову на українську, російську або англійську. Вибір зберігається в акаунті й переїжджає разом з ним на інший пристрій.",
      "Переключает язык на украинский, русский или английский. Выбор хранится в аккаунте и переезжает вместе с ним на другое устройство.",
      "Switches the interface to Ukrainian, Russian or English. The choice is stored on the account and follows it to any device.",
    ],
    help_account_password: ["Змінити пароль", "Изменить пароль", "Change password"],
    help_account_password_desc: [
      "Змінює пароль: потрібен поточний пароль і новий, не коротший за 8 символів, введений двічі.",
      "Меняет пароль: нужен текущий пароль и новый, не короче 8 символов, введённый дважды.",
      "Changes the password: the current one plus a new one, at least 8 characters, entered twice.",
    ],
    help_account_delete: [
      "Видалити акаунт і всі дані",
      "Удалить аккаунт и все данные",
      "Delete account and all data",
    ],
    help_account_delete_desc: [
      "Видаляє акаунт разом з усіма папками, посиланнями, сторінками та завантаженими файлами. Потребує пароль і підтвердження, відновити дані потім неможливо.",
      "Удаляет аккаунт вместе со всеми папками, ссылками, страницами и загруженными файлами. Требует пароль и подтверждение, восстановить данные потом невозможно.",
      "Deletes the account together with every folder, link, page and uploaded file. Requires the password and a confirmation; the data cannot be recovered.",
    ],
    help_admin_section_title: ["Для адміністраторів", "Для администраторов", "For administrators"],
    help_admin_note: [
      "Ці вкладки та кнопки бачать лише адміністратори. Перший зареєстрований користувач стає адміністратором, іншим права видає він.",
      "Эти вкладки и кнопки видны только администраторам. Первый зарегистрированный пользователь становится администратором, остальным права выдаёт он.",
      "These tabs and buttons are visible to administrators only. The first registered user becomes an administrator and grants the role to everyone else.",
    ],
    help_admin_tab: ["Вкладка «Панель керування»", "Вкладка «Панель управления»", "The “Control panel” tab"],
    help_admin_tab_desc: [
      "Список користувачів з роллю, обсягом даних і датою реєстрації, а також файловий менеджер сервера.",
      "Список пользователей с ролью, объёмом данных и датой регистрации, а также файловый менеджер сервера.",
      "The list of users with their role, data size and registration date, plus the server file manager.",
    ],
    help_admin_role: [
      "Зробити адміном / Зняти права адміна",
      "Сделать админом / Снять права админа",
      "Make admin / Revoke admin",
    ],
    help_admin_role_desc: [
      "Змінює роль користувача. Знявши права з себе, ви одразу втрачаєте доступ до адмінських вкладок.",
      "Меняет роль пользователя. Сняв права с себя, вы сразу теряете доступ к админским вкладкам.",
      "Changes a user's role. Revoke your own and you lose access to the admin tabs immediately.",
    ],
    help_admin_zip: ["Завантажити проєкт (.zip)", "Скачать проект (.zip)", "Download project (.zip)"],
    help_admin_zip_desc: [
      "Віддає архів з вихідним кодом застосунку.",
      "Отдаёт архив с исходным кодом приложения.",
      "Returns an archive with the application source code.",
    ],
    help_admin_up: ["Вгору", "Наверх", "Up"],
    help_admin_up_desc: [
      "Переходить на рівень вище у файловому менеджері сервера. Неактивна в корені файлової системи.",
      "Переходит на уровень выше в файловом менеджере сервера. Неактивна в корне файловой системы.",
      "Goes one level up in the server file manager. Disabled at the filesystem root.",
    ],
    help_admin_refresh: ["Оновити", "Обновить", "Refresh"],
    help_admin_refresh_desc: [
      "Перечитує вміст поточної папки сервера.",
      "Перечитывает содержимое текущей папки сервера.",
      "Re-reads the contents of the current server folder.",
    ],
    help_admin_upload: ["Натисніть, щоб завантажити файл", "Нажмите, чтобы загрузить файл", "Click to upload a file"],
    help_admin_upload_desc: [
      "Завантажує файл з вашого пристрою у відкриту папку сервера.",
      "Загружает файл с вашего устройства в открытую папку сервера.",
      "Uploads a file from your device into the open server folder.",
    ],
    help_admin_download: ["Завантажити (у файла)", "Скачать (у файла)", "Download (on a file)"],
    help_admin_download_desc: [
      "Завантажує файл сервера собі.",
      "Скачивает файл сервера себе.",
      "Downloads the server file to your device.",
    ],
    help_admin_delete: ["Видалити (у файла)", "Удалить (у файла)", "Delete (on a file)"],
    help_admin_delete_desc: [
      "Видаляє файл з диска сервера після підтвердження. Це справжній файл, а не елемент дерева — відновлення немає.",
      "Удаляет файл с диска сервера после подтверждения. Это настоящий файл, а не элемент дерева — восстановления нет.",
      "Deletes the file from the server disk after a confirmation. This is a real file, not a tree item — there is no recovery.",
    ],
    help_admin_notepad: ["Вкладка «Блокнот»", "Вкладка «Блокнот»", "The “Notepad” tab"],
    help_admin_notepad_desc: [
      "Спільний текстовий блокнот адміністраторів. Кнопки збереження немає: текст зберігається сам за секунду після того, як ви перестали друкувати, статус — під полем.",
      "Общий текстовый блокнот администраторов. Кнопки сохранения нет: текст сохраняется сам через секунду после того, как вы перестали печатать, статус — под полем.",
      "A shared text notepad for administrators. There is no save button: the text saves itself a second after you stop typing, and the status is shown below the field.",
    ],
    help_admin_terminal: ["Вкладка «Термінал»", "Вкладка «Терминал»", "The “Terminal” tab"],
    help_admin_terminal_desc: [
      "Повноцінний командний рядок сервера від імені користувача, під яким запущено застосунок. Статус з'єднання — праворуч від заголовка; якщо написано «відключено», оновіть сторінку або перемкніться на іншу вкладку й назад.",
      "Полноценная командная строка сервера от имени пользователя, под которым запущено приложение. Статус соединения — справа от заголовка; если написано «отключено», обновите страницу или переключитесь на другую вкладку и обратно.",
      "A full server command line, running as the user the application runs as. The connection status sits next to the heading; if it says “disconnected”, reload the page or switch tabs and back.",
    ],
    help_facts_title: ["Корисно знати", "Полезно знать", "Worth knowing"],
    help_fact_rmb: [
      "Права кнопка миші працює і в дереві, і на картках — це те саме меню, що й «…».",
      "Правая кнопка мыши работает и в дереве, и на карточках — это то же меню, что и «…».",
      "Right-click works both in the tree and on cards — it is the same menu as “…”.",
    ],
    help_fact_hover: [
      "Наведіть курсор на картку: у спливаючій підказці видно повний опис, навіть якщо в картці він обрізаний.",
      "Наведите курсор на карточку: во всплывающей подсказке видно полное описание, даже если в карточке оно обрезано.",
      "Hover a card: the tooltip shows the full description even when the card clips it.",
    ],
    help_fact_delete: [
      "Видалення будь-якого елемента незворотне, «кошика» в SpriteNote немає.",
      "Удаление любого элемента необратимо, «корзины» в SpriteNote нет.",
      "Deleting anything is permanent — SpriteNote has no trash bin.",
    ],
    help_fact_toasts: [
      "Усі дії підтверджуються спливаючим повідомленням у кутку екрана; повідомлення про помилку означає, що зміна не збереглася.",
      "Все действия подтверждаются всплывающим сообщением в углу экрана; сообщение об ошибке означает, что изменение не сохранилось.",
      "Every action is confirmed by a toast in the corner of the screen; an error toast means the change was not saved.",
    ],
    help_fact_private: [
      "Ваші дані бачите тільки ви: інші користувачі, включно з адміністраторами, не бачать вміст вашого дерева.",
      "Ваши данные видны только вам: другие пользователи, включая администраторов, не видят содержимое вашего дерева.",
      "Your data is yours alone: other users, administrators included, cannot see the contents of your tree.",
    ],
  };

  // Подстановка вида {name} — для строк, куда попадают имена файлов, счётчики и т. п.
  function t(key, vars) {
    const idx = Math.max(0, LANGS.indexOf(state.settings?.language || DEFAULT_SETTINGS.language));
    const row = TRANSLATIONS[key];
    if (!row) return key;
    const s = row[idx] || row[LANGS.indexOf(DEFAULT_SETTINGS.language)] || key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : s;
  }

  // Коды ошибок приходят с сервера и совпадают с ключами словаря; незнакомый код не должен
  // превращаться в собственное имя на экране, поэтому падаем на общую формулировку.
  function errMsg(code) {
    return TRANSLATIONS[code] ? t(code) : t('error_generic');
  }

  // ---------------- DOM refs ----------------
  const $ = (sel) => document.querySelector(sel);
  const el = {
    landing: $('#landing'),
    app: $('#app'),
    btnOpenAuth: $('#btn-open-auth'),
    btnOpenAuth2: $('#btn-open-auth-2'),

    authOverlay: $('#auth-modal-overlay'),
    authForm: $('#auth-form'),
    authTitle: $('#auth-title'),
    authSub: $('#auth-sub'),
    authEmail: $('#auth-email'),
    authPassword: $('#auth-password'),
    authError: $('#auth-error'),
    authSubmit: $('#auth-submit'),
    authSwitchText: $('#auth-switch-text'),
    authSwitchLink: $('#auth-switch-link'),
    authModalClose: $('#auth-modal-close'),

    topbarEmail: $('#topbar-email'),
    btnLogout: $('#btn-logout'),
    btnAccount: $('#btn-account'),

    accountOverlay: $('#account-modal-overlay'),
    accountModalClose: $('#account-modal-close'),
    accountModalEmail: $('#account-modal-email'),
    accountLanguage: $('#account-language'),
    passwordForm: $('#password-form'),
    currentPassword: $('#current-password'),
    newPassword: $('#new-password'),
    newPasswordRepeat: $('#new-password-repeat'),
    passwordError: $('#password-error'),
    passwordSubmit: $('#password-submit'),
    deleteAccountForm: $('#delete-account-form'),
    deleteAccountPassword: $('#delete-account-password'),
    deleteAccountError: $('#delete-account-error'),
    deleteAccountSubmit: $('#delete-account-submit'),
    viewTabs: $('#view-tabs'),
    tabAdmin: $('#tab-admin'),
    tabNotepad: $('#tab-notepad'),
    tabTerminal: $('#tab-terminal'),

    viewExplorer: $('#view-explorer'),
    viewHelp: $('#view-help'),
    helpAdmin: $('#help-admin'),
    helpAdminRows: document.querySelectorAll('.help-admin-row'),
    viewAdmin: $('#view-admin'),
    viewNotepad: $('#view-notepad'),
    viewTerminal: $('#view-terminal'),

    treeRoot: $('#tree-root'),
    btnNewRootFolder: $('#btn-new-root-folder'),
    treeSearch: $('#tree-search'),
    btnExportTree: $('#btn-export-tree'),
    btnImportTree: $('#btn-import-tree'),
    importTreeInput: $('#import-tree-input'),
    breadcrumb: $('#breadcrumb'),
    toolbarActions: $('#toolbar-actions'),
    contentGrid: $('#content-grid'),
    viewModeToggle: $('#view-mode-toggle'),

    usersTableBody: $('#users-table-body'),
    adminFileDrop: $('#admin-file-drop'),
    adminFileInput: $('#admin-file-input'),
    filesTableBody: $('#files-table-body'),
    filesPath: $('#files-path'),
    filesUpBtn: $('#files-up-btn'),
    filesRefreshBtn: $('#files-refresh-btn'),

    notepadTextarea: $('#notepad-textarea'),
    notepadStatus: $('#notepad-status'),

    terminalContainer: $('#terminal-container'),
    terminalStatus: $('#terminal-status'),

    itemOverlay: $('#item-modal-overlay'),
    itemModalBox: $('#item-modal'),
    itemForm: $('#item-form'),
    itemModalTitle: $('#item-modal-title'),
    itemModalSub: $('#item-modal-sub'),
    itemName: $('#item-name'),
    fieldUrl: $('#field-url'),
    itemUrl: $('#item-url'),
    itemFetchPreview: $('#item-fetch-preview'),
    fieldDescription: $('#field-description'),
    itemDescription: $('#item-description'),
    fieldContent: $('#field-content'),
    itemContent: $('#item-content'),
    fieldFile: $('#field-file'),
    itemFile: $('#item-file'),
    itemFileCurrent: $('#item-file-current'),
    itemError: $('#item-error'),
    itemSubmit: $('#item-submit'),
    itemCancel: $('#item-cancel'),
    itemModalClose: $('#item-modal-close'),

    moveOverlay: $('#move-modal-overlay'),
    moveTree: $('#move-tree'),
    moveConfirm: $('#move-confirm'),
    moveCancel: $('#move-cancel'),
    moveModalClose: $('#move-modal-close'),

    toastContainer: $('#toast-container'),
  };

  // ---------------- API helper ----------------
  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      const code = data && data.error;
      const error = new Error(errMsg(code));
      error.code = code;
      error.status = res.status;
      throw error;
    }
    return data;
  }

  // Локальная переменная нарочно не названа `t`: это имя занято функцией перевода, и её
  // затенение внутри функции — ровно тот сорт ошибки, который проявляется только в рантайме.
  function toast(message, type = 'default') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    el.toastContainer.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }

  function formatBytes(bytes) {
    if (!bytes) return `0 ${t('unit_b')}`;
    const units = [t('unit_b'), t('unit_kb'), t('unit_mb'), t('unit_gb')];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatDate(str) {
    if (!str) return '';
    const d = new Date(str.replace(' ', 'T'));
    if (isNaN(d.getTime())) return str;
    return d.toLocaleString(DATE_LOCALE[state.settings?.language] || 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------- Icons ----------------
  //
  // The UI used emoji (📁 🔗 📝 📄 …) as its icon set, which degrades to empty boxes on any client
  // without an emoji font — the default state of most Linux desktops, this server's own Pi
  // included. These inline SVGs render identically everywhere and inherit the surrounding colour.
  //
  // Paths are 24×24, stroked (not filled), so one definition works at every size and in both the
  // light and dark parts of the palette.

  const ICONS = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.6.8l1 1.2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    folderOpen:
      '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8H18a2 2 0 0 1 2 2v1.5"/>' +
      '<path d="m4 20 2.7-7.6A2 2 0 0 1 8.6 11h12.2a1 1 0 0 1 .95 1.3l-1.9 6a2 2 0 0 1-1.9 1.4H4Z"/>',
    link:
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>' +
      '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    text:
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/>' +
      '<path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.2V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/>',
    inbox:
      '<path d="M21 12h-5l-1.5 3h-5L8 12H3"/>' +
      '<path d="M6.2 5.2 3 12v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5l-3.2-6.8A2 2 0 0 0 16 4H8a2 2 0 0 0-1.8 1.2Z"/>',
    grid:
      '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
      '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    list:
      '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/>' +
      '<path d="M4.5 6h.01"/><path d="M4.5 12h.01"/><path d="M4.5 18h.01"/>',
    download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 21V9"/><path d="m7.5 13.5 4.5-4.5 4.5 4.5"/><path d="M4 4h16"/>',
    arrowUp: '<path d="M12 20V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5v-.8A5.7 5.7 0 0 1 10.2 14h3.6a5.7 5.7 0 0 1 5.7 5.7v.8"/>',
    refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4v5h-5"/>',
    sparkles:
      '<path d="m12 3 1.7 4.6 4.6 1.7-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3Z"/>' +
      '<path d="m18.5 15 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    dots:
      '<circle cx="12" cy="5.2" r="1.45" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="18.8" r="1.45" fill="currentColor" stroke="none"/>',
  };

  const ICON_ATTRS =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

  // Markup form, for the call sites that build their DOM from template strings. `name` is always
  // one of the literals above, so no escaping question arises.
  function iconHtml(name, extraClass = '') {
    const body = ICONS[name];
    if (!body) return '';
    return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" ${ICON_ATTRS}>${body}</svg>`;
  }

  // Element form, for the call sites that build their DOM with createElement.
  function iconEl(name, extraClass = '') {
    const holder = document.createElement('span');
    holder.innerHTML = iconHtml(name, extraClass);
    return holder.firstElementChild;
  }

  // The static buttons in index.html declare their icon as `data-icon="…"` instead of hard-coding
  // a second copy of the path data; fill them all in once, at load.
  document.querySelectorAll('[data-icon]').forEach((node) => {
    const svg = iconEl(node.dataset.icon);
    if (svg) node.prepend(svg);
  });

  // ---------------- Static texts ----------------
  //
  // Разметка в index.html написана по-русски и помечена ключами словаря. Русский текст в файле —
  // не дубль, а то, что видно до загрузки скрипта и что останется, если ключ однажды исчезнет.
  //
  // Три атрибута: `data-t` — видимый текст элемента, `data-t-title` — всплывающая подсказка,
  // `data-t-placeholder` — подсказка внутри поля ввода.

  // Меняем только текстовые узлы: у кнопок первым потомком лежит вставленная иконка (SVG),
  // и присваивание textContent стёрло бы её. Текст встаёт после иконки — там, где и был.
  function setElementText(node, text) {
    node.childNodes.forEach((child) => { if (child.nodeType === Node.TEXT_NODE) child.remove(); });
    node.appendChild(document.createTextNode(text));
  }

  function renderStaticTexts() {
    document.querySelectorAll('[data-t]').forEach((node) => setElementText(node, t(node.dataset.t)));
    document.querySelectorAll('[data-t-title]').forEach((node) => { node.title = t(node.dataset.tTitle); });
    document.querySelectorAll('[data-t-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.tPlaceholder); });

    document.title = t('app_title');
    document.documentElement.lang = state.settings?.language || DEFAULT_SETTINGS.language;
    if (el.accountLanguage) el.accountLanguage.value = state.settings?.language || DEFAULT_SETTINGS.language;

    // Тексты, которые собираются не из разметки: окно входа и заголовки, зависящие от режима.
    if (!el.authOverlay.classList.contains('hidden')) renderAuthMode();
  }

  // Перерисовать всё, что построено из данных: дерево, содержимое папки и открытую панель.
  // Вызывается после смены языка — статическая разметка обновляется отдельно.
  function renderDynamicTexts() {
    if (!state.user) return;
    renderTree();
    renderContent();
    if (state.view === 'admin') { loadAdminUsers(); loadAdminFiles(state.filesPath); }
    if (state.view === 'notepad') loadNotepad();
  }

  // ---------------- Auth flow ----------------

  function openAuthModal(mode) {
    state.authMode = mode;
    renderAuthMode();
    el.authOverlay.classList.remove('hidden');
    el.authEmail.focus();
  }
  function closeAuthModal() {
    el.authOverlay.classList.add('hidden');
    el.authForm.reset();
    el.authError.textContent = '';
  }
  function renderAuthMode() {
    const isLogin = state.authMode === 'login';
    el.authTitle.textContent = t(isLogin ? 'auth_title_login' : 'auth_title_register');
    el.authSub.textContent = t(isLogin ? 'auth_sub_login' : 'auth_sub_register');
    el.authSubmit.textContent = t(isLogin ? 'btn_sign_in' : 'btn_sign_up');
    el.authSwitchText.textContent = t(isLogin ? 'no_account' : 'have_account');
    el.authSwitchLink.textContent = t(isLogin ? 'link_register' : 'link_login');
    el.authPassword.autocomplete = isLogin ? 'current-password' : 'new-password';
    el.authError.textContent = '';
  }

  el.btnOpenAuth.addEventListener('click', () => openAuthModal('login'));
  el.btnOpenAuth2.addEventListener('click', () => openAuthModal('register'));
  el.authModalClose.addEventListener('click', closeAuthModal);
  el.authOverlay.addEventListener('click', (e) => { if (e.target === el.authOverlay) closeAuthModal(); });
  el.authSwitchLink.addEventListener('click', () => {
    state.authMode = state.authMode === 'login' ? 'register' : 'login';
    renderAuthMode();
  });

  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.authError.textContent = '';
    el.authSubmit.disabled = true;
    try {
      const email = el.authEmail.value.trim();
      const password = el.authPassword.value;
      const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const data = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      state.user = data.user;
      closeAuthModal();
      await enterApp();
    } catch (err) {
      el.authError.textContent = err.message;
    } finally {
      el.authSubmit.disabled = false;
    }
  });

  // ---------------- User settings ----------------
  //
  // Preferences belong to the account, not to the browser: two people sharing this machine each
  // get their own, and a preference set here shows up on the user's phone too. The server is the
  // source of truth (server/user-settings.js); this side only caches and patches it.

  function applyUserSettings() {
    state.settings = { ...DEFAULT_SETTINGS, ...(state.user && state.user.settings) };
  }

  // Fire-and-forget: the UI has already re-rendered by the time this runs. A failed write costs
  // the user nothing but the preference at next login, so it's reported rather than rolled back.
  async function saveSetting(key, value) {
    try {
      const data = await api('/api/auth/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    } catch (_) {
      toast(t('save_setting_failed'), 'error');
    }
  }

  function returnToLanding() {
    state.user = null;
    state.nodes = [];
    state.selectedFolderId = null;
    state.settings = { ...DEFAULT_SETTINGS };
    renderStaticTexts();
    el.app.classList.add('hidden');
    el.landing.classList.remove('hidden');
  }

  el.btnLogout.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    returnToLanding();
  });

  // ---------------- Account: change password / delete account ----------------

  function openAccountModal() {
    el.accountModalEmail.textContent = state.user.email;
    el.accountLanguage.value = state.settings.language || 'ru';
    el.passwordForm.reset();
    el.deleteAccountForm.reset();
    el.passwordError.textContent = '';
    el.deleteAccountError.textContent = '';
    el.accountOverlay.classList.remove('hidden');
  }
  function closeAccountModal() {
    el.accountOverlay.classList.add('hidden');
  }
  el.btnAccount.addEventListener('click', openAccountModal);
  el.accountModalClose.addEventListener('click', closeAccountModal);
  el.accountOverlay.addEventListener('click', (e) => { if (e.target === el.accountOverlay) closeAccountModal(); });

  // Смена языка: сначала перерисовываем, потом сохраняем. Интерфейс обязан переключиться даже
  // если запись настройки не дойдёт до сервера — в этом смысле язык ничем не отличается от
  // режима «плитка/список», который тоже применяется оптимистично (см. saveSetting).
  //
  // Ошибку показывает только сам запрос: если завернуть сюда ещё и отрисовку, любая ошибка
  // в ней превратится в сообщение «не удалось сохранить настройку» — неправдивое и уводящее
  // от причины.
  el.accountLanguage.addEventListener('change', () => {
    const newLang = el.accountLanguage.value;
    if (!LANGS.includes(newLang)) return;
    state.settings.language = newLang;
    renderStaticTexts();
    renderDynamicTexts();
    saveSetting('language', newLang);
  });

  el.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.passwordError.textContent = '';
    if (el.newPassword.value !== el.newPasswordRepeat.value) {
      el.passwordError.textContent = t('passwords_mismatch');
      return;
    }
    el.passwordSubmit.disabled = true;
    try {
      await api('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: el.currentPassword.value,
          newPassword: el.newPassword.value,
        }),
      });
      toast(t('password_changed'), 'success');
      el.passwordForm.reset();
    } catch (err) {
      el.passwordError.textContent = err.message;
    } finally {
      el.passwordSubmit.disabled = false;
    }
  });

  el.deleteAccountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.deleteAccountError.textContent = '';
    if (!confirm(t('confirm_delete_account'))) return;
    el.deleteAccountSubmit.disabled = true;
    try {
      await api('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: el.deleteAccountPassword.value }),
      });
      closeAccountModal();
      returnToLanding();
      toast(t('account_deleted'), 'success');
    } catch (err) {
      el.deleteAccountError.textContent = err.message;
    } finally {
      el.deleteAccountSubmit.disabled = false;
    }
  });

  async function enterApp() {
    el.landing.classList.add('hidden');
    el.app.classList.remove('hidden');
    el.topbarEmail.textContent = state.user.email;
    applyUserSettings();
    renderStaticTexts();
    applyAdminVisibility();
    switchView('explorer');
    await loadNodes();
  }

  // Everything that only administrators may see, in one place: the tabs, the export/import
  // buttons, and the admin-only parts of the instructions page.
  function applyAdminVisibility() {
    const hide = !state.user.isAdmin;
    el.tabAdmin.classList.toggle('hidden', hide);
    el.tabNotepad.classList.toggle('hidden', hide);
    el.tabTerminal.classList.toggle('hidden', hide);
    el.btnExportTree.classList.toggle('hidden', hide);
    el.btnImportTree.classList.toggle('hidden', hide);
    el.helpAdmin.classList.toggle('hidden', hide);
    el.helpAdminRows.forEach((row) => row.classList.toggle('hidden', hide));
  }

  // ---------------- View switching ----------------

  function switchView(view) {
    state.view = view;
    el.viewExplorer.classList.toggle('hidden', view !== 'explorer');
    el.viewHelp.classList.toggle('hidden', view !== 'help');
    el.viewAdmin.classList.toggle('hidden', view !== 'admin');
    el.viewNotepad.classList.toggle('hidden', view !== 'notepad');
    el.viewTerminal.classList.toggle('hidden', view !== 'terminal');
    el.viewTabs.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    if (view === 'admin') { loadAdminUsers(); loadAdminFiles(state.filesPath); }
    if (view === 'notepad') { loadNotepad(); }
    if (view === 'terminal') { ensureTerminal(); }
  }

  el.viewTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchView(btn.dataset.view);
  });

  // ---------------- Nodes / tree ----------------

  async function loadNodes() {
    const data = await api('/api/nodes');
    state.nodes = data.nodes;
    if (state.selectedFolderId !== null && !state.nodes.find((n) => n.id === state.selectedFolderId)) {
      state.selectedFolderId = null;
    }
    renderTree();
    renderContent();
  }

  function childrenOf(parentId) {
    return state.nodes.filter((n) => n.parentId === parentId);
  }
  function foldersOf(parentId) {
    return childrenOf(parentId).filter((n) => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  // Node type -> key in ICONS. Kept explicit so a new node type has to opt in to an icon rather
  // than silently rendering nothing.
  const TYPE_ICON = { folder: 'folder', link: 'link', text: 'text', doc: 'doc' };
  // Подписи типов живут в словаре вместе с карточками типов на странице «Инструкция».
  const typeLabel = (type) => t(`help_type_${type}`);

  function renderTree() {
    el.treeRoot.innerHTML = '';
    const roots = foldersOf(null);
    if (roots.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = t('tree_empty');
      el.treeRoot.appendChild(hint);
      return;
    }
    roots.forEach((folder) => el.treeRoot.appendChild(renderTreeNode(folder)));
  }

  function renderTreeNode(folder) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-row' + (state.selectedFolderId === folder.id ? ' selected' : '');
    row.dataset.id = folder.id;

    const subFolders = foldersOf(folder.id);
    const caret = document.createElement('span');
    caret.className = 'tree-caret' + (subFolders.length ? '' : ' empty');
    caret.innerHTML = subFolders.length
      ? iconHtml(state.expanded.has(folder.id) ? 'chevronDown' : 'chevronRight')
      : '';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!subFolders.length) return;
      if (state.expanded.has(folder.id)) state.expanded.delete(folder.id);
      else state.expanded.add(folder.id);
      renderTree();
    });

    const icon = iconEl('folder', 'tree-icon');

    const label = document.createElement('span');
    label.textContent = folder.name;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    label.style.minWidth = '0';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'tree-menu-btn';
    menuBtn.innerHTML = iconHtml('dots');
    menuBtn.title = t('tree_menu_title');
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(folder, e.clientX, e.clientY); });

    row.append(caret, icon, label, menuBtn);
    row.addEventListener('click', () => selectFolder(folder.id));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(folder, e.clientX, e.clientY); });
    wrap.appendChild(row);

    if (subFolders.length && state.expanded.has(folder.id)) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'tree-children';
      subFolders.forEach((sf) => childrenWrap.appendChild(renderTreeNode(sf)));
      wrap.appendChild(childrenWrap);
    }
    return wrap;
  }

  function expandPathTo(folderId) {
    let current = state.nodes.find((n) => n.id === folderId);
    while (current && current.parentId !== null) {
      state.expanded.add(current.parentId);
      current = state.nodes.find((n) => n.id === current.parentId);
    }
  }

  function selectFolder(folderId) {
    state.selectedFolderId = folderId;
    expandPathTo(folderId);
    renderTree();
    renderContent();
  }

  function pathTo(folderId) {
    const path = [];
    let current = folderId === null ? null : state.nodes.find((n) => n.id === folderId);
    while (current) {
      path.unshift(current);
      current = current.parentId === null ? null : state.nodes.find((n) => n.id === current.parentId);
    }
    return path;
  }

  function renderBreadcrumb() {
    el.breadcrumb.innerHTML = '';

    if (state.searchQuery.trim()) {
      const label = document.createElement('span');
      label.append(iconEl('search'), document.createTextNode(t('search_results', { q: state.searchQuery.trim() })));
      el.breadcrumb.appendChild(label);
      return;
    }

    const root = document.createElement('span');
    root.className = 'crumb';
    root.append(iconEl('home'), document.createTextNode(t('tab_explorer')));
    root.addEventListener('click', () => { state.selectedFolderId = null; renderTree(); renderContent(); });
    el.breadcrumb.appendChild(root);

    pathTo(state.selectedFolderId).forEach((node) => {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '/';
      el.breadcrumb.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'crumb';
      crumb.textContent = node.name;
      crumb.addEventListener('click', () => selectFolder(node.id));
      el.breadcrumb.appendChild(crumb);
    });
  }

  function renderToolbar() {
    el.toolbarActions.innerHTML = '';
    if (state.searchQuery.trim()) return;
    if (state.selectedFolderId === null) return;
    const actions = [
      ['folder', t('btn_new_subfolder')],
      ['link', t('btn_new_link')],
      ['text', t('btn_new_text')],
      ['doc', t('btn_new_doc')],
    ];
    actions.forEach(([type, label]) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-small';
      btn.append(iconEl(TYPE_ICON[type]), document.createTextNode(label));
      btn.addEventListener('click', () => openItemModal({ mode: 'create', type, parentId: state.selectedFolderId }));
      el.toolbarActions.appendChild(btn);
    });
  }

  function renderViewModeToggle() {
    el.viewModeToggle.querySelectorAll('.view-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === state.settings.contentViewMode);
    });
  }

  function setContentViewMode(mode) {
    if (state.settings.contentViewMode === mode) return;
    state.settings.contentViewMode = mode;
    renderContent();
    saveSetting('contentViewMode', mode);
  }

  el.viewModeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-mode-btn');
    if (btn) setContentViewMode(btn.dataset.mode);
  });

  function renderContent() {
    renderBreadcrumb();
    renderToolbar();
    renderViewModeToggle();

    const listMode = state.settings.contentViewMode === 'list';
    el.contentGrid.className = 'content-grid' + (listMode ? ' list-mode' : '');
    el.contentGrid.innerHTML = '';

    const query = state.searchQuery.trim();
    if (query) {
      renderSearchResults(query);
      return;
    }

    if (state.selectedFolderId === null) {
      el.contentGrid.classList.add('is-empty');
      el.contentGrid.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">${iconHtml('folderOpen')}</div>
          <div>${escapeHtml(t('empty_pick_folder'))}</div>
        </div>`;
      return;
    }

    const items = childrenOf(state.selectedFolderId).sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      return a.name.localeCompare(b.name, 'ru');
    });

    if (items.length === 0) {
      el.contentGrid.classList.add('is-empty');
      el.contentGrid.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">${iconHtml('inbox')}</div>
          <div>${escapeHtml(t('empty_folder'))}</div>
        </div>`;
      return;
    }

    items.forEach((node) => el.contentGrid.appendChild(renderCard(node)));
  }

  // ---------------- Search (across the whole tree, client-side) ----------------

  function renderSearchResults(query) {
    const q = query.toLowerCase();
    const matches = state.nodes
      .filter((n) =>
        n.name.toLowerCase().includes(q) ||
        (n.description || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q) ||
        (n.url || '').toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    if (matches.length === 0) {
      el.contentGrid.classList.add('is-empty');
      el.contentGrid.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">${iconHtml('search')}</div>
          <div>${escapeHtml(t('empty_search', { q: query }))}</div>
        </div>`;
      return;
    }

    matches.forEach((node) => el.contentGrid.appendChild(renderCard(node, { showPath: true, onOpen: () => openSearchResult(node) })));
  }

  function nodePathLabel(node) {
    const ancestors = pathTo(node.parentId);
    return ancestors.length ? ancestors.map((a) => a.name).join(' / ') : t('path_root');
  }

  function openSearchResult(node) {
    clearSearch();
    if (node.type === 'folder') {
      selectFolder(node.id);
    } else {
      selectFolder(node.parentId);
      openNode(node);
    }
  }

  function clearSearch() {
    state.searchQuery = '';
    el.treeSearch.value = '';
    renderContent();
  }

  function renderCard(node, opts = {}) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const icon = document.createElement('div');
    icon.className = 'item-icon';
    icon.appendChild(iconEl(TYPE_ICON[node.type]));

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = node.name;

    const desc = document.createElement('div');
    desc.className = 'item-desc';
    let fullDesc = '';
    if (opts.showPath) desc.textContent = fullDesc = nodePathLabel(node);
    else if (node.type === 'link') { fullDesc = node.description || node.url; desc.textContent = fullDesc; }
    else if (node.type === 'text') { fullDesc = node.content || ''; desc.textContent = fullDesc.slice(0, 140); }
    else if (node.type === 'doc') desc.textContent = fullDesc = node.fileName ? `${node.fileName} · ${formatBytes(node.fileSize)}` : t('no_file');
    else desc.textContent = fullDesc = t('items_count', { n: childrenOf(node.id).length });

    // Full, untruncated description on hover — the visible line is clipped for layout.
    if (fullDesc.trim()) card.title = `${node.name}\n\n${fullDesc}`;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'item-menu-btn';
    menuBtn.innerHTML = iconHtml('dots');
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); openContextMenu(node, e.clientX, e.clientY); });

    card.append(icon, name, desc, menuBtn);
    card.addEventListener('click', () => (opts.onOpen ? opts.onOpen() : openNode(node)));
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(node, e.clientX, e.clientY); });
    return card;
  }

  function openNode(node) {
    if (node.type === 'folder') selectFolder(node.id);
    else if (node.type === 'link') window.open(node.url, '_blank', 'noopener');
    else if (node.type === 'text') openItemModal({ mode: 'edit', type: 'text', nodeId: node.id });
    else if (node.type === 'doc') window.open(`/api/nodes/${node.id}/download`, '_blank');
  }

  // ---------------- Context menu ----------------

  function closeContextMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
  }
  document.addEventListener('click', closeContextMenu);

  function openContextMenu(node, x, y) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const openLabel = node.type === 'link' ? t('menu_open_link') : node.type === 'doc' ? t('menu_download') : t('menu_open');
    menu.appendChild(menuItem(openLabel, () => openNode(node)));
    menu.appendChild(menuItem(t('menu_edit'), () => openItemModal({ mode: 'edit', type: node.type, nodeId: node.id })));
    menu.appendChild(menuItem(t('menu_move'), () => openMoveModal(node.id)));
    const hr = document.createElement('hr');
    menu.appendChild(hr);
    menu.appendChild(menuItem(t('menu_delete'), () => deleteNode(node), true));

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 12);
    const top = Math.min(y, window.innerHeight - rect.height - 12);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function menuItem(label, onClick, danger = false) {
    const btn = document.createElement('button');
    if (danger) btn.classList.add('danger');
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeContextMenu(); onClick(); });
    return btn;
  }

  async function deleteNode(node) {
    const key = node.type === 'folder' ? 'confirm_delete_folder' : 'confirm_delete_item';
    if (!confirm(t(key, { name: node.name }))) return;
    try {
      await api(`/api/nodes/${node.id}`, { method: 'DELETE' });
      if (state.selectedFolderId === node.id) state.selectedFolderId = node.parentId;
      toast(t('toast_deleted'), 'success');
      await loadNodes();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------------- Create / edit modal ----------------

  // Link/text modals get a big (near-maximized) default, since their description/content
  // textarea benefits from the extra room — folder/doc modals stay compact. Each group
  // remembers its own size independently, so resizing one doesn't affect the other.
  const ITEM_MODAL_SIZE_PREFIX = 'spritenote_item_modal_size_';

  function sizeGroupFor(type) {
    return type === 'link' || type === 'text' ? 'large' : 'compact';
  }

  function defaultItemModalSize(group) {
    if (group === 'large') {
      return { width: Math.round(window.innerWidth * 0.9), height: Math.round(window.innerHeight * 0.85) };
    }
    return { width: 520, height: 320 };
  }

  function applyItemModalSize(group) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ITEM_MODAL_SIZE_PREFIX + group) || 'null'); } catch (_) { /* corrupt value */ }
    const size = saved && saved.width && saved.height ? saved : defaultItemModalSize(group);
    el.itemModalBox.style.width = `${size.width}px`;
    el.itemModalBox.style.height = `${size.height}px`;
  }

  // Persist the user's chosen modal size (via the CSS `resize` handle) so it's remembered
  // next time a modal of the same group is opened, including in future visits.
  let itemModalResizeObserver = null;
  let currentItemModalSizeGroup = null;
  function watchItemModalSize(group) {
    currentItemModalSizeGroup = group;
    if (itemModalResizeObserver) return;
    itemModalResizeObserver = new ResizeObserver(() => {
      if (el.itemOverlay.classList.contains('hidden')) return;
      const { width, height } = el.itemModalBox.getBoundingClientRect();
      localStorage.setItem(
        ITEM_MODAL_SIZE_PREFIX + currentItemModalSizeGroup,
        JSON.stringify({ width: Math.round(width), height: Math.round(height) })
      );
    });
    itemModalResizeObserver.observe(el.itemModalBox);
  }

  function openItemModal({ mode, type, parentId, nodeId }) {
    let node = null;
    if (mode === 'edit') {
      node = state.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      type = node.type;
    }
    state.itemModal = { mode, type, parentId, nodeId };

    el.itemForm.reset();
    el.itemError.textContent = '';
    el.itemFileCurrent.textContent = '';

    el.itemModalTitle.textContent = mode === 'create'
      ? t('modal_new', { type: typeLabel(type).toLowerCase() })
      : t('modal_edit', { type: typeLabel(type).toLowerCase() });
    el.itemModalSub.textContent = t(mode === 'create' ? 'modal_sub_create' : 'modal_sub_edit');
    el.itemSubmit.textContent = t(mode === 'create' ? 'btn_create' : 'btn_save');

    el.fieldUrl.classList.toggle('hidden', type !== 'link');
    el.fieldDescription.classList.toggle('hidden', type !== 'link');
    el.fieldContent.classList.toggle('hidden', type !== 'text');
    el.fieldFile.classList.toggle('hidden', type !== 'doc');

    if (node) {
      el.itemName.value = node.name || '';
      el.itemUrl.value = node.url || '';
      el.itemDescription.value = node.description || '';
      el.itemContent.value = node.content || '';
      if (type === 'doc') {
        el.itemFileCurrent.textContent = node.fileName ? t('current_file', { name: node.fileName, size: formatBytes(node.fileSize) }) : t('no_file');
      }
    }

    el.itemOverlay.classList.remove('hidden');
    const sizeGroup = sizeGroupFor(type);
    applyItemModalSize(sizeGroup);
    watchItemModalSize(sizeGroup);
    el.itemName.focus();
  }

  function closeItemModal() {
    el.itemOverlay.classList.add('hidden');
    state.itemModal = null;
  }
  el.itemModalClose.addEventListener('click', closeItemModal);
  el.itemCancel.addEventListener('click', closeItemModal);
  el.itemOverlay.addEventListener('click', (e) => { if (e.target === el.itemOverlay) closeItemModal(); });

  el.itemFetchPreview.addEventListener('click', async () => {
    const url = el.itemUrl.value.trim();
    if (!url) {
      el.itemError.textContent = errMsg('url_required');
      el.itemUrl.focus();
      return;
    }
    el.itemError.textContent = '';
    // Snapshot the whole button, icon included — assigning textContent would drop the SVG.
    const originalLabel = el.itemFetchPreview.innerHTML;
    el.itemFetchPreview.disabled = true;
    el.itemFetchPreview.innerHTML = `${iconHtml('refresh', 'icon-spin')}${escapeHtml(t('reading_page'))}`;
    try {
      const data = await api(`/api/nodes/link-summary?url=${encodeURIComponent(url)}`);
      if (data.title) el.itemName.value = data.title;
      if (data.description) el.itemDescription.value = data.description;
      toast(t('toast_done'), 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      el.itemFetchPreview.disabled = false;
      el.itemFetchPreview.innerHTML = originalLabel;
    }
  });

  el.itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { mode, type, parentId, nodeId } = state.itemModal;
    el.itemError.textContent = '';
    el.itemSubmit.disabled = true;
    try {
      const fd = new FormData();
      fd.append('name', el.itemName.value.trim());
      if (type === 'link') {
        fd.append('url', el.itemUrl.value.trim());
        fd.append('description', el.itemDescription.value);
      }
      if (type === 'text') fd.append('content', el.itemContent.value);
      if (type === 'doc' && el.itemFile.files[0]) fd.append('file', el.itemFile.files[0]);

      if (mode === 'create') {
        fd.append('type', type);
        fd.append('parentId', parentId === null ? '' : String(parentId));
        await api('/api/nodes', { method: 'POST', body: fd });
        toast(t('toast_created'), 'success');
      } else {
        await api(`/api/nodes/${nodeId}`, { method: 'PUT', body: fd });
        toast(t('toast_saved'), 'success');
      }
      closeItemModal();
      await loadNodes();
    } catch (err) {
      el.itemError.textContent = err.message;
    } finally {
      el.itemSubmit.disabled = false;
    }
  });

  el.btnNewRootFolder.addEventListener('click', () => openItemModal({ mode: 'create', type: 'folder', parentId: null }));

  let searchDebounceTimer = null;
  el.treeSearch.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      state.searchQuery = el.treeSearch.value;
      renderContent();
    }, 150);
  });
  el.treeSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSearch();
  });

  // ---------------- Export / import the whole tree ----------------

  el.btnExportTree.addEventListener('click', () => {
    window.location.href = '/api/nodes/export';
  });

  el.btnImportTree.addEventListener('click', () => el.importTreeInput.click());

  el.importTreeInput.addEventListener('change', async () => {
    const file = el.importTreeInput.files[0];
    if (!file) return;
    el.importTreeInput.value = '';
    if (!confirm(t('confirm_import', { name: file.name }))) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = await api('/api/nodes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const summary = data.skipped
        ? t('import_added_skipped', { n: data.imported, skipped: data.skipped })
        : t('import_added', { n: data.imported });
      toast(summary, 'success');
      await loadNodes();
    } catch (err) {
      toast(err.message || t('import_parse_failed'), 'error');
    }
  });

  // ---------------- Move modal ----------------

  function isDescendantOrSelf(candidateId, ancestorId) {
    let current = state.nodes.find((n) => n.id === candidateId);
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId === null ? null : state.nodes.find((n) => n.id === current.parentId);
    }
    return false;
  }

  function openMoveModal(nodeId) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    state.moveModal = { nodeId, chosenParentId: node.parentId, initial: true };
    renderMoveTree();
    el.moveOverlay.classList.remove('hidden');
  }
  function closeMoveModal() {
    el.moveOverlay.classList.add('hidden');
    state.moveModal = null;
  }
  el.moveModalClose.addEventListener('click', closeMoveModal);
  el.moveCancel.addEventListener('click', closeMoveModal);
  el.moveOverlay.addEventListener('click', (e) => { if (e.target === el.moveOverlay) closeMoveModal(); });

  function renderMoveTree() {
    el.moveTree.innerHTML = '';
    const { nodeId } = state.moveModal;

    const rootRow = document.createElement('div');
    rootRow.className = 'tree-row' + (state.moveModal.chosenParentId === null ? ' selected' : '');
    rootRow.innerHTML = `<span class="tree-caret empty"></span>${iconHtml('home', 'tree-icon')}<span>${escapeHtml(t('move_root'))}</span>`;
    rootRow.addEventListener('click', () => { state.moveModal.chosenParentId = null; renderMoveTree(); });
    el.moveTree.appendChild(rootRow);

    function renderLevel(parentId, container) {
      foldersOf(parentId).forEach((folder) => {
        if (folder.id === nodeId || isDescendantOrSelf(folder.id, nodeId)) return; // can't move into itself/descendant
        const wrap = document.createElement('div');
        wrap.className = 'tree-node';
        const row = document.createElement('div');
        row.className = 'tree-row' + (state.moveModal.chosenParentId === folder.id ? ' selected' : '');
        row.innerHTML = `<span class="tree-caret empty"></span>${iconHtml('folder', 'tree-icon')}<span>${escapeHtml(folder.name)}</span>`;
        row.addEventListener('click', () => { state.moveModal.chosenParentId = folder.id; renderMoveTree(); });
        wrap.appendChild(row);
        const childWrap = document.createElement('div');
        childWrap.className = 'tree-children';
        renderLevel(folder.id, childWrap);
        if (childWrap.children.length) wrap.appendChild(childWrap);
        container.appendChild(wrap);
      });
    }
    renderLevel(null, el.moveTree);
  }

  el.moveConfirm.addEventListener('click', async () => {
    const { nodeId, chosenParentId } = state.moveModal;
    try {
      await api(`/api/nodes/${nodeId}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: chosenParentId }),
      });
      toast(t('toast_moved'), 'success');
      closeMoveModal();
      await loadNodes();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Admin: users ----------------

  async function loadAdminUsers() {
    try {
      const data = await api('/api/admin/users');
      el.usersTableBody.innerHTML = '';
      data.users.forEach((u) => {
        const tr = document.createElement('tr');
        const isSelf = u.id === state.user.id;
        tr.innerHTML = `
          <td>${escapeHtml(u.email)}${isSelf ? ` <span style="color:var(--text-dim)">${escapeHtml(t('you'))}</span>` : ''}</td>
          <td><span class="badge ${u.isAdmin ? 'badge-admin' : 'badge-user'}">${escapeHtml(u.isAdmin ? t('role_admin') : t('role_user'))}</span></td>
          <td>${formatBytes(u.bytesUsed)}</td>
          <td>${formatDate(u.createdAt)}</td>
          <td></td>`;
        const actionTd = tr.lastElementChild;
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-small';
        btn.textContent = u.isAdmin ? t('btn_demote') : t('btn_promote');
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/admin/users/${u.id}/admin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isAdmin: !u.isAdmin }),
            });
            toast(t('toast_done'), 'success');
            await loadAdminUsers();
            if (isSelf) {
              const me = await api('/api/auth/me');
              state.user = me.user;
              applyAdminVisibility();
              if (!state.user.isAdmin) switchView('explorer');
            }
          } catch (err) {
            toast(err.message, 'error');
          }
        });
        actionTd.appendChild(btn);
        el.usersTableBody.appendChild(tr);
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------------- Admin: server files (defaults to project root, full filesystem otherwise) ----------------

  async function loadAdminFiles(dirPath) {
    const targetPath = dirPath || state.filesPath; // falsy on first call -> let the server default (project root)
    try {
      const url = targetPath ? `/api/admin/files?path=${encodeURIComponent(targetPath)}` : '/api/admin/files';
      const data = await api(url);
      state.filesPath = data.path;
      el.filesPath.textContent = data.path;
      el.filesUpBtn.disabled = data.parent === null;

      el.filesTableBody.innerHTML = '';
      data.entries.forEach((f) => {
        const tr = document.createElement('tr');
        if (f.isDir) tr.classList.add('files-table-row-dir');
        tr.innerHTML = `
          <td class="files-name-cell">${iconHtml(f.isDir ? 'folder' : 'doc')}${escapeHtml(f.name)}</td>
          <td>${f.isDir ? '—' : formatBytes(f.size)}</td>
          <td>${formatDate(f.modifiedAt)}</td>
          <td></td>`;
        const actionTd = tr.lastElementChild;

        if (f.isDir) {
          tr.addEventListener('click', () => loadAdminFiles(joinPath(data.path, f.name)));
        } else {
          const dl = document.createElement('a');
          dl.href = `/api/admin/files/download?path=${encodeURIComponent(joinPath(data.path, f.name))}`;
          dl.className = 'btn btn-ghost btn-small';
          dl.textContent = t('btn_download');
          dl.style.marginRight = '8px';
          dl.style.textDecoration = 'none';
          dl.style.display = 'inline-block';
          dl.addEventListener('click', (e) => e.stopPropagation());
          const del = document.createElement('button');
          del.className = 'btn btn-ghost btn-small';
          del.textContent = t('btn_delete');
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(t('confirm_delete_file', { name: f.name }))) return;
            try {
              await api(`/api/admin/files?path=${encodeURIComponent(joinPath(data.path, f.name))}`, {
                method: 'DELETE',
              });
              toast(t('toast_deleted'), 'success');
              await loadAdminFiles(data.path);
            } catch (err) {
              toast(err.message, 'error');
            }
          });
          actionTd.append(dl, del);
        }
        el.filesTableBody.appendChild(tr);
      });

      if (data.entries.length === 0) {
        el.filesTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-dim)">${escapeHtml(t('dir_empty'))}</td></tr>`;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function joinPath(dir, name) {
    return dir === '/' ? `/${name}` : `${dir}/${name}`;
  }

  el.filesUpBtn.addEventListener('click', () => {
    if (state.filesPath === '/') return;
    const parent = state.filesPath.split('/').slice(0, -1).join('/') || '/';
    loadAdminFiles(parent);
  });
  el.filesRefreshBtn.addEventListener('click', () => loadAdminFiles(state.filesPath));

  el.adminFileInput.addEventListener('change', async () => {
    const file = el.adminFileInput.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/api/admin/files?path=${encodeURIComponent(state.filesPath)}`, { method: 'POST', body: fd });
      toast(t('toast_uploaded'), 'success');
      el.adminFileInput.value = '';
      await loadAdminFiles(state.filesPath);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ---------------- Notepad ----------------

  let notepadSaveTimer = null;
  async function loadNotepad() {
    try {
      const data = await api('/api/admin/notepad');
      el.notepadTextarea.value = data.content || '';
      el.notepadStatus.textContent = data.updatedAt ? t('notepad_saved', { date: formatDate(data.updatedAt) }) : ' ';
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  el.notepadTextarea.addEventListener('input', () => {
    el.notepadStatus.textContent = t('notepad_saving');
    clearTimeout(notepadSaveTimer);
    notepadSaveTimer = setTimeout(async () => {
      try {
        await api('/api/admin/notepad', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: el.notepadTextarea.value }),
        });
        el.notepadStatus.textContent = t('notepad_saved', { date: formatDate(new Date().toISOString()) });
      } catch (err) {
        el.notepadStatus.textContent = t('notepad_save_error');
      }
    }, 700);
  });

  // ---------------- Terminal ----------------

  function setTerminalStatus(text, cls) {
    el.terminalStatus.textContent = text;
    el.terminalStatus.className = 'terminal-status' + (cls ? ` ${cls}` : '');
  }

  function ensureTerminal() {
    if (state.terminal) {
      // Already initialized — just make sure sizing is correct for the now-visible container.
      requestAnimationFrame(() => state.terminal.fitAddon.fit());
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SF Mono', Consolas, monospace",
      theme: { background: '#14120a' },
    });
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(el.terminalContainer);

    state.terminal = { term, fitAddon, ws: null };

    connectTerminalSocket();

    window.addEventListener('resize', () => {
      if (!el.viewTerminal.classList.contains('hidden')) fitAddon.fit();
    });

    requestAnimationFrame(() => fitAddon.fit());
  }

  function connectTerminalSocket() {
    const { term, fitAddon } = state.terminal;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/admin/terminal`);
    state.terminal.ws = ws;

    setTerminalStatus(t('term_connecting'));

    ws.addEventListener('open', () => {
      setTerminalStatus(t('term_connected'), 'connected');
      fitAddon.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'data') term.write(msg.data);
      else if (msg.type === 'exit') setTerminalStatus(t('term_exited', { code: msg.code }), 'error');
    });

    ws.addEventListener('close', () => {
      setTerminalStatus(t('term_disconnected'), 'error');
    });

    ws.addEventListener('error', () => {
      setTerminalStatus(t('term_socket_error'), 'error');
    });

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
  }

  // ---------------- Init ----------------

  async function init() {
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      await enterApp();
    } catch (_) {
      // Не вошли — язык взять неоткуда, страница остаётся на языке по умолчанию.
      renderStaticTexts();
      el.landing.classList.remove('hidden');
      el.app.classList.add('hidden');
    }
  }

  init();
})();
