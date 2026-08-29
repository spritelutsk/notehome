// Per-user UI preferences.
//
// These live in `users.settings` (a JSON blob in a TEXT column) rather than in the browser's
// localStorage, so a preference follows the account across devices and browsers instead of
// leaking between two people who share one machine.
//
// Adding a preference = one entry in SETTINGS_SPEC. Everything else (validation, defaults,
// the API surface, forward-compatibility with old rows) follows from it.

const SETTINGS_SPEC = {
  // Folder contents rendered as cards ("плитка") or as one-line rows ("список").
  contentViewMode: { default: 'grid', values: ['grid', 'list'] },
  // Interface language. Only the chrome is translated — folder names, page text and uploaded
  // documents are the user's own data and stay exactly as they were typed.
  language: { default: 'uk', values: ['uk', 'ru'] },
  // Идентификатор в CortenDesk — для режима управления в «Удалённом доступе». Не перечисление,
  // а строка по образцу, поэтому у неё `pattern` вместо `values`. Пустая строка допустима:
  // это состояние «управление не настроено», и оно же значение по умолчанию.
  cortendeskId: { default: '', pattern: /^\d{6,16}$/ },
};

function defaults() {
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) out[key] = spec.default;
  return out;
}

function isValid(key, value) {
  const spec = SETTINGS_SPEC[key];
  if (!spec) return false;
  if (spec.values) return spec.values.includes(value);
  // Строка по образцу. Пустая строка означает «не задано» и разрешена всегда — иначе настройку
  // нельзя было бы очистить, только переписать на другую.
  if (spec.pattern) return typeof value === 'string' && (value === '' || spec.pattern.test(value));
  return false;
}

// Turn a raw `users.settings` column into a complete settings object. Anything unparseable,
// unknown or out of range is dropped in favour of the default — a bad row must never break login.
function parseSettings(raw) {
  const result = defaults();
  if (!raw) return result;

  let stored;
  try {
    stored = JSON.parse(raw);
  } catch (_) {
    return result;
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return result;

  for (const [key, value] of Object.entries(stored)) {
    if (isValid(key, value)) result[key] = value;
  }
  return result;
}

// Keep only the recognised, in-range keys of an incoming patch. Returns null when the caller
// sent something that isn't a usable patch at all, so the route can answer 400 instead of
// silently storing nothing.
function sanitizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;

  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (isValid(key, value)) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

module.exports = { SETTINGS_SPEC, defaults, parseSettings, sanitizePatch };
