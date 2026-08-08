(() => {
  'use strict';

  // Client-side mirror of SETTINGS_SPEC in server/user-settings.js — used before the account's
  // own settings have arrived, and as the fallback if the server ever omits a key.
  const DEFAULT_SETTINGS = { contentViewMode: 'grid' }; // 'grid' | 'list'

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

  const ERROR_MESSAGES = {
    invalid_email: 'Введите корректный email',
    weak_password: 'Пароль должен быть не короче 8 символов',
    email_taken: 'Этот email уже зарегистрирован',
    invalid_credentials: 'Неверный email или пароль',
    missing_credentials: 'Введите email и пароль',
    not_authenticated: 'Требуется вход',
    session_expired: 'Сессия истекла, войдите снова',
    admin_required: 'Требуются права администратора',
    name_required: 'Введите название',
    url_required: 'Введите ссылку (URL)',
    invalid_type: 'Некорректный тип элемента',
    parent_not_found: 'Папка назначения не найдена',
    parent_not_folder: 'Можно перемещать только внутрь папки',
    cannot_move_into_self: 'Нельзя переместить элемент в самого себя',
    cannot_move_into_descendant: 'Нельзя переместить папку в свою же подпапку',
    cannot_remove_last_admin: 'Нельзя снять права у последнего администратора',
    not_found: 'Элемент не найден',
    file_required: 'Выберите файл',
    upload_error: 'Ошибка загрузки файла',
    server_error: 'Внутренняя ошибка сервера',
    cannot_read_dir: 'Не удалось прочитать папку (нет доступа?)',
    target_dir_not_found: 'Папка назначения не найдена',
    cannot_delete_directory: 'Нельзя удалить папку целиком — только отдельные файлы',
    invalid_import_file: 'Файл не похож на экспорт SpriteNote',
    fetch_failed: 'Не удалось открыть страницу по этой ссылке',
    url_not_allowed: 'Эта ссылка недоступна для просмотра',
    not_html: 'Страница по ссылке — не HTML, не могу её прочитать',
    empty_page: 'На странице не нашлось текста',
    summary_failed: 'Не получилось составить краткое описание, попробуйте ещё раз',
    too_many_redirects: 'Слишком много перенаправлений по ссылке',
    cannot_delete_last_admin_with_other_users: 'Вы последний администратор, а на сайте есть другие пользователи — сначала назначьте другого админа',
    too_many_requests: 'Слишком много попыток, подождите немного и повторите',
    invalid_request: 'Некорректный запрос',
  };

  function errMsg(code) {
    return ERROR_MESSAGES[code] || 'Произошла ошибка';
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

  function toast(message, type = 'default') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    el.toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatDate(str) {
    if (!str) return '';
    const d = new Date(str.replace(' ', 'T'));
    if (isNaN(d.getTime())) return str;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    el.authTitle.textContent = isLogin ? 'Вход' : 'Регистрация';
    el.authSub.textContent = isLogin
      ? 'Войдите, чтобы открыть свой проводник заметок'
      : 'Создайте аккаунт — первый зарегистрированный становится администратором';
    el.authSubmit.textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
    el.authSwitchText.textContent = isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?';
    el.authSwitchLink.textContent = isLogin ? 'Зарегистрироваться' : 'Войти';
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
      toast('Не удалось сохранить настройку отображения', 'error');
    }
  }

  function returnToLanding() {
    state.user = null;
    state.nodes = [];
    state.selectedFolderId = null;
    state.settings = { ...DEFAULT_SETTINGS };
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

  el.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.passwordError.textContent = '';
    if (el.newPassword.value !== el.newPasswordRepeat.value) {
      el.passwordError.textContent = 'Новые пароли не совпадают';
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
      toast('Пароль изменён', 'success');
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
    if (!confirm('Удалить аккаунт и все ваши данные без возможности восстановления?')) return;
    el.deleteAccountSubmit.disabled = true;
    try {
      await api('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: el.deleteAccountPassword.value }),
      });
      closeAccountModal();
      returnToLanding();
      toast('Аккаунт удалён', 'success');
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
  const TYPE_LABEL = { folder: 'Папка', link: 'Ссылка', text: 'Текстовая страница', doc: 'Документ' };

  function renderTree() {
    el.treeRoot.innerHTML = '';
    const roots = foldersOf(null);
    if (roots.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Пока нет ни одной папки. Нажмите «+», чтобы создать первую.';
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
    menuBtn.title = 'Действия с папкой';
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
      label.append(iconEl('search'), document.createTextNode(`Поиск: «${state.searchQuery.trim()}»`));
      el.breadcrumb.appendChild(label);
      return;
    }

    const root = document.createElement('span');
    root.className = 'crumb';
    root.append(iconEl('home'), document.createTextNode('Проводник'));
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
      ['folder', 'Новая подпапка'],
      ['link', 'Новая ссылка'],
      ['text', 'Новая текстовая страница'],
      ['doc', 'Новый документ'],
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
          <div>Выберите папку слева или создайте новую, чтобы начать</div>
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
          <div>Эта папка пуста. Добавьте элемент через панель сверху.</div>
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
          <div>Ничего не найдено по запросу «${escapeHtml(query)}»</div>
        </div>`;
      return;
    }

    matches.forEach((node) => el.contentGrid.appendChild(renderCard(node, { showPath: true, onOpen: () => openSearchResult(node) })));
  }

  function nodePathLabel(node) {
    const ancestors = pathTo(node.parentId);
    return ancestors.length ? ancestors.map((a) => a.name).join(' / ') : 'Корень';
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
    else if (node.type === 'doc') desc.textContent = fullDesc = node.fileName ? `${node.fileName} · ${formatBytes(node.fileSize)}` : 'Файл не прикреплён';
    else desc.textContent = fullDesc = `${childrenOf(node.id).length} элемент(ов)`;

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

    const openLabel = node.type === 'folder' ? 'Открыть' : node.type === 'link' ? 'Открыть ссылку' : node.type === 'doc' ? 'Скачать' : 'Открыть';
    menu.appendChild(menuItem(openLabel, () => openNode(node)));
    menu.appendChild(menuItem('Редактировать', () => openItemModal({ mode: 'edit', type: node.type, nodeId: node.id })));
    menu.appendChild(menuItem('Переместить', () => openMoveModal(node.id)));
    const hr = document.createElement('hr');
    menu.appendChild(hr);
    menu.appendChild(menuItem('Удалить', () => deleteNode(node), true));

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
    const label = node.type === 'folder' ? `папку «${node.name}» и всё её содержимое` : `«${node.name}»`;
    if (!confirm(`Удалить ${label}? Это действие необратимо.`)) return;
    try {
      await api(`/api/nodes/${node.id}`, { method: 'DELETE' });
      if (state.selectedFolderId === node.id) state.selectedFolderId = node.parentId;
      toast('Удалено', 'success');
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
      ? `Новая: ${TYPE_LABEL[type].toLowerCase()}`
      : `Изменить: ${TYPE_LABEL[type].toLowerCase()}`;
    el.itemModalSub.textContent = mode === 'create' ? 'Заполните поля и нажмите «Создать»' : 'Измените поля и нажмите «Сохранить»';
    el.itemSubmit.textContent = mode === 'create' ? 'Создать' : 'Сохранить';

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
        el.itemFileCurrent.textContent = node.fileName ? `Текущий файл: ${node.fileName} (${formatBytes(node.fileSize)})` : 'Файл не прикреплён';
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
    el.itemFetchPreview.innerHTML = `${iconHtml('refresh', 'icon-spin')}Читаю страницу…`;
    try {
      const data = await api(`/api/nodes/link-summary?url=${encodeURIComponent(url)}`);
      if (data.title) el.itemName.value = data.title;
      if (data.description) el.itemDescription.value = data.description;
      toast('Готово', 'success');
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
        toast('Создано', 'success');
      } else {
        await api(`/api/nodes/${nodeId}`, { method: 'PUT', body: fd });
        toast('Сохранено', 'success');
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
    if (!confirm(`Импортировать данные из «${file.name}»? Добавится только то, чего ещё нет — существующие элементы останутся как есть, дубли не создаются.`)) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const data = await api('/api/nodes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const summary = data.skipped
        ? `Добавлено: ${data.imported}, уже было: ${data.skipped}`
        : `Добавлено элементов: ${data.imported}`;
      toast(summary, 'success');
      await loadNodes();
    } catch (err) {
      toast(err.message || 'Не удалось разобрать файл импорта', 'error');
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
    rootRow.innerHTML = `<span class="tree-caret empty"></span>${iconHtml('home', 'tree-icon')}<span>Корень (без папки)</span>`;
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
      toast('Перемещено', 'success');
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
          <td>${escapeHtml(u.email)}${isSelf ? ' <span style="color:var(--text-dim)">(вы)</span>' : ''}</td>
          <td><span class="badge ${u.isAdmin ? 'badge-admin' : 'badge-user'}">${u.isAdmin ? 'Админ' : 'Пользователь'}</span></td>
          <td>${formatBytes(u.bytesUsed)}</td>
          <td>${formatDate(u.createdAt)}</td>
          <td></td>`;
        const actionTd = tr.lastElementChild;
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-small';
        btn.textContent = u.isAdmin ? 'Снять права админа' : 'Сделать админом';
        btn.addEventListener('click', async () => {
          try {
            await api(`/api/admin/users/${u.id}/admin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isAdmin: !u.isAdmin }),
            });
            toast('Готово', 'success');
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
          dl.textContent = 'Скачать';
          dl.style.marginRight = '8px';
          dl.style.textDecoration = 'none';
          dl.style.display = 'inline-block';
          dl.addEventListener('click', (e) => e.stopPropagation());
          const del = document.createElement('button');
          del.className = 'btn btn-ghost btn-small';
          del.textContent = 'Удалить';
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`Удалить файл «${f.name}»?`)) return;
            try {
              await api(`/api/admin/files?path=${encodeURIComponent(joinPath(data.path, f.name))}`, {
                method: 'DELETE',
              });
              toast('Удалено', 'success');
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
        el.filesTableBody.innerHTML = `<tr><td colspan="4" style="color:var(--text-dim)">Папка пуста</td></tr>`;
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
      toast('Файл загружен', 'success');
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
      el.notepadStatus.textContent = data.updatedAt ? `Сохранено: ${formatDate(data.updatedAt)}` : ' ';
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  el.notepadTextarea.addEventListener('input', () => {
    el.notepadStatus.textContent = 'Сохранение…';
    clearTimeout(notepadSaveTimer);
    notepadSaveTimer = setTimeout(async () => {
      try {
        await api('/api/admin/notepad', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: el.notepadTextarea.value }),
        });
        el.notepadStatus.textContent = `Сохранено: ${formatDate(new Date().toISOString())}`;
      } catch (err) {
        el.notepadStatus.textContent = 'Ошибка сохранения';
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

    setTerminalStatus('подключение…');

    ws.addEventListener('open', () => {
      setTerminalStatus('подключено', 'connected');
      fitAddon.fit();
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'data') term.write(msg.data);
      else if (msg.type === 'exit') setTerminalStatus(`процесс завершён (код ${msg.code})`, 'error');
    });

    ws.addEventListener('close', () => {
      setTerminalStatus('отключено — обновите страницу или переключите вкладку, чтобы переподключиться', 'error');
    });

    ws.addEventListener('error', () => {
      setTerminalStatus('ошибка соединения', 'error');
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
      el.landing.classList.remove('hidden');
      el.app.classList.add('hidden');
    }
  }

  init();
})();
