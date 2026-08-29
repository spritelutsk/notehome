// CortenDesk server configuration provider
// This module provides the configuration for the CortenDesk-compatible server
// Used by remote.js to send server details to clients

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Read the public key from file.
// The path keeps the upstream `rustdesk-server` name on purpose: that directory belongs
// to the OSS package and is the WorkingDirectory of the hbbs/hbbr systemd units.
// Renaming it on disk would break the server, so only the app-level naming moved.
function getPublicKey() {
  try {
    const keyPath = process.env.CORTENDESK_KEY_FILE || '/var/lib/rustdesk-server/id_ed25519.pub';
    return fs.readFileSync(keyPath, 'utf8').trim();
  } catch (err) {
    console.warn(`Failed to read public key from ${process.env.CORTENDESK_KEY_FILE || '/var/lib/rustdesk-server/id_ed25519.pub'}:`, err.message);
    return '';
  }
}

function cortendeskServer() {
  return {
    // Public key of the CortenDesk ID server (hbbs)
    key: getPublicKey(),

    // These would come from environment variables
    lan: process.env.CORTENDESK_HOST_LAN || '',
    vpn: process.env.CORTENDESK_HOST_VPN || '',
    wss: process.env.CORTENDESK_HOST_WSS || '',
    web: process.env.CORTENDESK_WEB_URL || '', // For web client configuration

    // Configuration strings for import (base64 encoded, reversed)
    configLan: process.env.CORTENDESK_CONFIG_LAN || '',
    configVpn: process.env.CORTENDESK_CONFIG_VPN || '',
    configWss: process.env.CORTENDESK_CONFIG_WSS || ''
  };
}

// ---------------- Кто зарегистрировался с этого адреса ----------------

// База, в которую hbbs пишет каждого клиента, дошедшего до регистрации. Лежит в его рабочем
// каталоге, то есть рядом с ключевой парой, — отсюда и путь по умолчанию.
const PEER_DB_FILE = process.env.CORTENDESK_DB_FILE || '/var/lib/rustdesk-server/db_v2.sqlite3';

// Читаем чужую базу штатной утилитой, а не библиотекой: пакет `sqlite3` из зависимостей —
// нативный, и на этой машине он не собран. Тот же приём, что у log-scan.js с journalctl:
// внешняя команда, только чтение, и любая осечка означает «источника нет», а не ошибку.
function readPeers() {
  return new Promise((resolve) => {
    execFile(
      'sqlite3',
      ['-readonly', '-json', PEER_DB_FILE, 'select id, info from peer'],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        try {
          const rows = JSON.parse(stdout);
          resolve(Array.isArray(rows) ? rows : []);
        } catch (_) {
          resolve([]);
        }
      }
    );
  });
}

// Адреса приходят из трёх разных мест — от express, из info пира и от человека, — и выглядят
// по-разному: hbbs видит клиента IPv4 как ::ffff:192.168.1.104, express отдаёт 192.168.1.104,
// а в квадратных скобках и с портом адрес приходит из заголовков.
function normalizeAddress(raw) {
  let ip = String(raw || '').trim().toLowerCase();
  if (!ip) return '';
  const bracket = ip.indexOf(']');
  if (ip.startsWith('[') && bracket > 0) ip = ip.slice(1, bracket);
  const withPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(ip);
  if (withPort) ip = withPort[1];
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function isLoopback(ip) {
  return ip === '::1' || ip.startsWith('127.');
}

// Подставлять ID можно только тому, кто пришёл из своей сети. За общим выходом в интернет
// один адрес у целого дома или офиса, и совпадение по нему означало бы «кто-то за тем же
// NAT», а не «эта машина»; чужой номер, сохранённый как свой, — это приглашение управлять
// не той машиной. В своей сети адрес принадлежит одному хозяину.
function isLocalAddress(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const v4 = /^(\d+)\.(\d+)\./.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 100.64.0.0/10 — адреса Tailscale.
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  // fc00::/7 — уникальные локальные адреса (в том числе тайлнет), fe80::/10 — канальные.
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

// Адрес машины, которая открыла страницу.
//
// Обычно это `req.ip`, но не когда запрос пришёл через Tailscale: тот проксирует с петли,
// настоящий адрес кладёт в X-Forwarded-For, а nginx поверх дописывает свой 127.0.0.1
// ($proxy_add_x_forwarded_for). Express с одним доверенным переходом берёт последний элемент —
// то есть петлю, и машина в тайлнете подсказки не получала вовсе.
//
// Шагнуть влево можно ровно потому, что предыдущий переход — тоже петля. Снаружи в приложение
// не попасть (оно слушает 127.0.0.1), клиент из локальной сети приходит со своим адресом
// и в эту ветку не заходит, а Tailscale собственный X-Forwarded-For клиента не дописывает,
// а выбрасывает — проверено запросом с подставленным заголовком, он до приложения не дошёл.
// Значит, крайний непетлевой элемент справа написан локальным прокси, а не гостем.
//
// Поднимать `trust proxy` до двух переходов ради этого нельзя: цепочка бывает и короче
// (из локальной сети переход один), и тогда express взял бы как раз то, что подставил клиент.
function clientAddress(req) {
  const ip = normalizeAddress(req.ip);
  if (!isLoopback(ip)) return ip;

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => normalizeAddress(part))
    .filter(Boolean);
  while (chain.length && isLoopback(chain[chain.length - 1])) chain.pop();
  return chain.length ? chain[chain.length - 1] : ip;
}

// Идентификатор машины, с которой пришёл запрос, — по данным своего же hbbs.
//
// Номер здесь не придумывается и не выдаётся: придуманный ID не принадлежит ни одному клиенту,
// ID-сервер такого пира в сети не видит, и подключение к нему кончается
// «punch hole failed: OFFLINE». Возвращается ровно то, чем клиент представился сам.
async function peerIdForAddress(address) {
  const ip = normalizeAddress(address);
  if (!isLocalAddress(ip)) return '';
  // Петля адресом машины не бывает. Так выглядит клиент, зарегистрировавшийся не напрямую,
  // а по WebSocket через наш же nginx: hbbs видит не его, а прокси, и пишет в peer 127.0.0.1.
  // Такая запись одинакова у всех подключившихся снаружи, и совпадение по ней значило бы
  // «кто-то, кто пришёл через прокси», а не «эта машина».
  if (isLoopback(ip)) return '';

  const matches = [];
  for (const row of await readPeers()) {
    let info;
    try { info = JSON.parse(row.info || '{}'); } catch (_) { continue; }
    const peerIp = normalizeAddress(info.ip);
    if (isLoopback(peerIp)) continue;
    if (peerIp === ip) matches.push(String(row.id || ''));
  }

  // Два клиента с одного адреса — значит, между ними и нами всё-таки NAT; гадать, за которым
  // из них сидит человек, нельзя, и лучше оставить поле пустым.
  const unique = [...new Set(matches)];
  if (unique.length !== 1) return '';
  // Тот же образец, что у настройки cortendeskId: чем бы ни оказалась строка в чужой базе,
  // наружу уходит только то, что примет PUT /settings.
  return /^\d{6,16}$/.test(unique[0]) ? unique[0] : '';
}

module.exports = { cortendeskServer, peerIdForAddress, clientAddress };