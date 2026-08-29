// Удалённый доступ: кто сейчас на сайте, запрос разрешения и передача данных подключения.
//
// Два режима, и разница между ними принципиальная:
//
//   screen   — просмотр экрана через WebRTC. Работает без установки чего-либо, но управлять
//              чужой машиной нельзя: браузер такого не умеет и не будет. Демонстрирующий сам
//              выбирает экран или окно в системном диалоге getDisplayMedia().
//   cortendesk — настоящее управление. Сервер здесь только сводит стороны: после согласия
//              принимающий отдаёт свой CortenDesk ID и одноразовый пароль, дальше работает
//              CortenDesk, а не мы.
//
// Согласие обязательно в обоих режимах и для всех, включая администратора. Это единственное
// место в проекте, где права админа НЕ дают обхода: у него и так есть веб-терминал, то есть
// shell на сервере, — но чужой рабочий стол это не сервер, и брать его молча нельзя.
const { WebSocketServer } = require('ws');
const pool = require('./db');
const { registerWs, authenticateFromCookies } = require('./ws-router');
const { cortendeskServer } = require('./cortendesk-server');
const { iceServers } = require('./ice-servers');

const REMOTE_PATH = '/api/remote';

// Сессия живёт, пока идёт разговор; неотвеченный запрос гаснет сам, иначе «висящее» окно
// согласия у принимающего копилось бы после каждой неудачной попытки.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// Та же причина, что у терминала: кука проверена на рукопожатии и больше никем не смотрится,
// а выход из аккаунта обязан доходить до открытого соединения.
const REAUTH_INTERVAL_MS = 60 * 1000;
// Защита от навязчивости: без неё одним кликом можно засыпать соседа окнами согласия.
const MAX_PENDING_PER_VIEWER = 3;
const REQUEST_COOLDOWN_MS = 5 * 1000;
// Один человек — один браузер и пара вкладок; больше похоже на ошибку или на злоупотребление.
const MAX_SOCKETS_PER_USER = 8;

// id пользователя -> { user, sockets: Set<ws> }
const online = new Map();
// id сессии -> { id, viewerId, targetId, mode, state, timer }
const sessions = new Map();
let nextSessionId = 1;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendToUser(userId, msg) {
  const entry = online.get(userId);
  if (!entry) return false;
  entry.sockets.forEach((ws) => send(ws, msg));
  return entry.sockets.size > 0;
}

// Список для выбора собеседника. Отдаём только то, что нужно интерфейсу: адрес и признак
// готовности к управлению. Настройки и права наружу не идут.
function presenceList(exceptUserId) {
  const out = [];
  online.forEach((entry, id) => {
    if (id === exceptUserId) return;
    out.push({
      id,
      email: entry.user.email,
      isAdmin: entry.user.isAdmin,
      cortendeskReady: !!(entry.user.settings && entry.user.settings.cortendeskId),
    });
  });
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

function broadcastPresence() {
  online.forEach((entry, id) => {
    entry.sockets.forEach((ws) => send(ws, { type: 'presence', users: presenceList(id) }));
  });
}

async function audit(viewerId, targetId, mode, event) {
  try {
    await pool.query(
      'INSERT INTO remote_access_log (viewer_id, target_id, mode, event) VALUES (?, ?, ?, ?)',
      [viewerId, targetId, mode, event]
    );
  } catch (err) {
    // Запись в журнал не должна ронять сеанс, но и молчать о ней нельзя: это единственный след
    // того, кто к кому подключался.
    console.error('[remote] не удалось записать в журнал доступа', err);
  }
}

function endSession(id, reason, exceptUserId) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.timer);
  sessions.delete(id);
  [s.viewerId, s.targetId].forEach((uid) => {
    if (uid !== exceptUserId) sendToUser(uid, { type: 'ended', id, reason });
  });
  audit(s.viewerId, s.targetId, s.mode, reason === 'declined' ? 'declined' : 'ended');
}

function sessionsOf(userId) {
  return [...sessions.values()].filter((s) => s.viewerId === userId || s.targetId === userId);
}

function handleRequest(ws, user, msg) {
  const targetId = Number(msg.to);
  const mode = msg.mode === 'cortendesk' ? 'cortendesk' : 'screen';

  if (!Number.isInteger(targetId) || targetId === user.id) {
    return send(ws, { type: 'error', error: 'remote_bad_target' });
  }
  if (!online.has(targetId)) {
    return send(ws, { type: 'error', error: 'remote_target_offline' });
  }
  const pending = [...sessions.values()].filter((s) => s.viewerId === user.id && s.state === 'pending');
  if (pending.length >= MAX_PENDING_PER_VIEWER) {
    return send(ws, { type: 'error', error: 'remote_too_many_requests' });
  }
  const now = Date.now();
  if (ws._lastRequestAt && now - ws._lastRequestAt < REQUEST_COOLDOWN_MS) {
    return send(ws, { type: 'error', error: 'remote_slow_down' });
  }
  ws._lastRequestAt = now;

  const id = String(nextSessionId++);
  const session = { id, viewerId: user.id, targetId, mode, state: 'pending', timer: null };
  session.timer = setTimeout(() => endSession(id, 'timeout'), REQUEST_TIMEOUT_MS);
  sessions.set(id, session);

  sendToUser(targetId, {
    type: 'request',
    id,
    mode,
    from: { id: user.id, email: user.email, isAdmin: user.isAdmin },
    expiresIn: Math.round(REQUEST_TIMEOUT_MS / 1000),
  });
  send(ws, { type: 'requested', id, mode, to: targetId });
  audit(user.id, targetId, mode, 'requested');
  console.log(`[remote] ${user.email} запросил ${mode}-доступ к пользователю ${targetId}`);
}

function handleDecision(ws, user, msg, accepted) {
  const s = sessions.get(String(msg.id));
  // Решение принимает только тот, у кого спрашивали. Проверка именно на targetId, а не на
  // «участник сессии»: иначе запросивший мог бы «согласиться» за другого.
  if (!s || s.targetId !== user.id || s.state !== 'pending') {
    return send(ws, { type: 'error', error: 'remote_no_session' });
  }
  if (!accepted) return endSession(s.id, 'declined');

  clearTimeout(s.timer);
  s.timer = null;
  s.state = 'active';
  // Реквизиты TURN обновляются здесь ещё раз: вкладка живёт неделями, а выданный пароль —
  // сутки, и момент согласия — единственная точка, где обе стороны заведомо слушают.
  const ice = iceServers();
  sendToUser(s.viewerId, { type: 'accepted', id: s.id, mode: s.mode, iceServers: ice });
  send(ws, { type: 'accepted', id: s.id, mode: s.mode, iceServers: ice });
  audit(s.viewerId, s.targetId, s.mode, 'accepted');
  console.log(`[remote] ${user.email} разрешил ${s.mode}-доступ`);
}

// Ретрансляция SDP и ICE. Сервер в содержимое не смотрит и не хранит его: он знает только,
// кому переложить пакет. Медиапоток идёт напрямую между браузерами и через сервер не проходит.
function handleSignal(ws, user, msg) {
  const s = sessions.get(String(msg.id));
  if (!s || s.state !== 'active' || (s.viewerId !== user.id && s.targetId !== user.id)) {
    return send(ws, { type: 'error', error: 'remote_no_session' });
  }
  const other = s.viewerId === user.id ? s.targetId : s.viewerId;
  sendToUser(other, { type: 'signal', id: s.id, data: msg.data });
}

// Реквизиты CortenDesk отдаёт только принимающая сторона и только после согласия. Пароль
// одноразовый — его выдаёт сам CortenDesk, мы его не храним и в журнал не пишем.
function handleCortendesk(ws, user, msg) {
  const s = sessions.get(String(msg.id));
  if (!s || s.state !== 'active' || s.targetId !== user.id || s.mode !== 'cortendesk') {
    return send(ws, { type: 'error', error: 'remote_no_session' });
  }
  const cortendeskId = String(msg.cortendeskId || '').trim();
  const password = String(msg.password || '').trim();
  if (!/^\d{6,16}$/.test(cortendeskId) || password.length < 4 || password.length > 64) {
    return send(ws, { type: 'error', error: 'remote_bad_cortendesk' });
  }
  sendToUser(s.viewerId, { type: 'cortendesk', id: s.id, cortendeskId, password });
}

function attachRemote(server) {
  const wss = new WebSocketServer({ noServer: true });

  // Пускаем любого, кто вошёл: удалённый доступ — не админская функция, а способ позвать
  // коллегу к своей машине. Права админа тут не дают ничего сверх обычного пользователя.
  registerWs(REMOTE_PATH, null, (req, socket, head, user) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  });

  wss.on('connection', (ws, req, user) => {
    let entry = online.get(user.id);
    if (!entry) {
      entry = { user, sockets: new Set(), since: new Date() };
      online.set(user.id, entry);
    } else {
      // Настройки могли поменяться между вкладками — берём свежие с последнего рукопожатия.
      entry.user = user;
    }
    if (entry.sockets.size >= MAX_SOCKETS_PER_USER) {
      return ws.close(4029, 'too_many_sockets');
    }
    entry.sockets.add(ws);

    // Реквизиты своего сервера идут в первом же сообщении: они одинаковы для всех и
    // нужны раньше, чем человек нажмёт «Управлять», — вписывать их в CortenDesk он будет
    // заранее и один раз.
    send(ws, {
      type: 'hello',
      self: { id: user.id, email: user.email },
      cortendeskServer: cortendeskServer(),
      // Свой STUN/TURN отдаётся здесь же: вкладка должна знать про него до того, как
      // человек нажмёт «Смотреть экран», иначе первый сеанс соберётся без него.
      iceServers: iceServers(),
    });
    broadcastPresence();

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return; }
      switch (msg.type) {
        case 'request':  return handleRequest(ws, user, msg);
        case 'accept':   return handleDecision(ws, user, msg, true);
        case 'decline':  return handleDecision(ws, user, msg, false);
        case 'signal':   return handleSignal(ws, user, msg);
        case 'cortendesk': return handleCortendesk(ws, user, msg);
        case 'end': {
          const s = sessions.get(String(msg.id));
          if (s && (s.viewerId === user.id || s.targetId === user.id)) endSession(s.id, 'closed', user.id);
          return;
        }
        default: return;
      }
    });

    const reauth = setInterval(async () => {
      try {
        if (await authenticateFromCookies(req.headers.cookie)) return;
        ws.close(4001, 'session_expired');
      } catch (err) {
        // Сбой базы — не доказательство того, что сессия кончилась: ждём следующего тика.
        console.error('[remote] проверка сессии не удалась', err);
      }
    }, REAUTH_INTERVAL_MS);

    ws.on('close', () => {
      clearInterval(reauth);
      const live = online.get(user.id);
      if (live) {
        live.sockets.delete(ws);
        if (live.sockets.size === 0) {
          online.delete(user.id);
          // Последняя вкладка закрылась — участвовать в сеансах больше некому.
          sessionsOf(user.id).forEach((s) => endSession(s.id, 'peer_gone', user.id));
        }
      }
      broadcastPresence();
    });
  });
}

// Снимок присутствия для панели управления: id -> сколько вкладок открыто и с какого момента.
// Данные живут в памяти процесса, поэтому перезапуск сервиса обнуляет их — это нормально:
// вместе с ним рвутся и сами соединения.
function presenceSnapshot() {
  const out = {};
  online.forEach((entry, id) => {
    out[id] = { tabs: entry.sockets.size, since: entry.since };
  });
  return out;
}

// Настройки правятся обычным HTTP-запросом, а присутствие держит копию, снятую на рукопожатии.
// Без этого вызова человек вписывает свой CortenDesk ID — и у всех остальных кнопка «Управлять»
// рядом с ним остаётся серой до перезагрузки страницы.
function onUserSettingsChanged(userId, settings) {
  const entry = online.get(userId);
  if (!entry) return;
  entry.user = { ...entry.user, settings };
  broadcastPresence();
}

module.exports = { attachRemote, onUserSettingsChanged, presenceSnapshot };
