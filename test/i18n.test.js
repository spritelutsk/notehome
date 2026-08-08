// Проверка переключения языка в настоящем DOM: грузим index.html и app.js в jsdom,
// подставляем ответы сервера, дёргаем селектор языка и смотрим, что изменилось на странице.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'public');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// xterm грузится только для терминала и в тесте не нужен; app.js подключим руками.
html = html.replace(/<script src="\/vendor\/[^"]*"><\/script>/g, '').replace('<script src="/js/app.js"></script>', '');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

const SETTINGS = { contentViewMode: 'grid', language: 'ru' };
const USER = { id: 1, email: 'test@example.com', isAdmin: true, settings: SETTINGS };
const puts = [];

window.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET';
  const body = { ok: true };
  if (url === '/api/auth/me') Object.assign(body, { user: USER });
  else if (url === '/api/nodes') Object.assign(body, { nodes: [] });
  else if (url === '/api/auth/settings' && method === 'PUT') {
    const patch = JSON.parse(opts.body);
    puts.push(patch);
    Object.assign(SETTINGS, patch);
    Object.assign(body, { settings: { ...SETTINGS } });
  } else if (url.startsWith('/api/admin/')) Object.assign(body, { users: [], entries: [], path: '/', parent: null, content: '' });
  return { ok: true, status: 200, json: async () => body };
};
window.ResizeObserver = class { observe() {} disconnect() {} };
window.WebSocket = class { addEventListener() {} };

window.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));

const doc = window.document;
const $ = (s) => doc.querySelector(s);
const txt = (s) => ($(s) ? $(s).textContent.trim() : '<нет элемента>');

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${JSON.stringify(actual)}${ok ? '' : ' != ' + JSON.stringify(expected)}`);
};

async function run() {
  await new Promise((r) => setTimeout(r, 60)); // init() -> /api/auth/me -> enterApp()

  console.log('--- язык из настроек аккаунта (ru) ---');
  check('вкладка «Инструкция»', txt('#tab-help'), 'Инструкция');
  check('кнопка «Аккаунт»', txt('#btn-account'), 'Аккаунт');
  check('title страницы', doc.title, 'SpriteNote — ваш личный проводник заметок');
  check('lang документа', doc.documentElement.lang, 'ru');
  check('placeholder поиска', $('#tree-search').placeholder, 'Поиск по дереву…');
  check('подсказка кнопки экспорта', $('#btn-export-tree').title, 'Экспортировать всё в JSON');
  check('значение селектора языка', $('#account-language').value, 'ru');
  check('строка таблицы в инструкции', txt('[data-t="help_topbar_logout_desc"]'), 'Завершает сеанс. Данные остаются, вход — тем же email и паролем.');
  check('иконка в кнопке аккаунта на месте', !!$('#btn-account svg'), true);

  console.log('--- переключаем на английский ---');
  $('#account-language').value = 'en';
  $('#account-language').dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 60));

  check('вкладка «Инструкция»', txt('#tab-help'), 'Help');
  check('кнопка «Аккаунт»', txt('#btn-account'), 'Account');
  check('title страницы', doc.title, 'SpriteNote — your personal notes navigator');
  check('lang документа', doc.documentElement.lang, 'en');
  check('placeholder поиска', $('#tree-search').placeholder, 'Search tree…');
  check('подсказка кнопки экспорта', $('#btn-export-tree').title, 'Export all to JSON');
  check('строка таблицы в инструкции', txt('[data-t="help_topbar_logout_desc"]'), 'Ends session. Data remains, log in with the same email and password.');
  check('иконка в кнопке аккаунта не стёрта', !!$('#btn-account svg'), true);
  check('иконка в ячейке инструкции не стёрта', !!$('[data-t="help_sidebar_plus"] svg'), true);
  check('пустое состояние проводника переведено', txt('.empty-state div:last-child'), 'Pick a folder on the left or create a new one to start');
  check('настройка ушла на сервер', JSON.stringify(puts), JSON.stringify([{ language: 'en' }]));
  check('тостов об ошибке нет', $('#toast-container').children.length, 0);

  console.log('--- переключаем на украинский ---');
  $('#account-language').value = 'uk';
  $('#account-language').dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 60));

  check('вкладка «Инструкция»', txt('#tab-help'), 'Інструкція');
  check('кнопка «Выход»', txt('#btn-logout'), 'Вихід');
  check('lang документа', doc.documentElement.lang, 'uk');
  check('тостов об ошибке нет', $('#toast-container').children.length, 0);

  // Ни один видимый текст не должен остаться на русском после переключения.
  const cyr = [];
  doc.querySelectorAll('#app *').forEach((node) => {
    [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3 && /[ЁёЪъЫыЭэ]/.test(c.textContent)) cyr.push(c.textContent.trim().slice(0, 60));
    });
  });
  console.log('--- русские тексты, оставшиеся после переключения на uk ---');
  console.log(cyr.length ? cyr.slice(0, 10).join('\n') : '  нет (по буквам ё ъ ы э)');

  console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВсе проверки прошли');
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('ОШИБКА ТЕСТА:', e); process.exit(1); });
