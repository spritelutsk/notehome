const fs = require('fs');
const pool = require('./db');

// Сколько удалённое лежит в корзине. Единственное место, где записан этот срок:
// `server/routes/nodes.js` берёт его отсюда, чтобы дата очистки на экране «Недавно удалённое»
// не разошлась с тем, когда чистка происходит на самом деле.
const TRASH_TTL_DAYS = 30;

// Раз в шесть часов, а не раз в сутки: перезапуск сервиса обнуляет таймер, и при суточном
// шаге приложение, которое перезапускают каждый день, не почистило бы корзину никогда.
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Стереть всё, что пролежало в корзине дольше срока.
//
// Отбираются просроченные строки, затем к ним добавляется удалённое поддерево каждой:
// потомок удалённого узла всегда удалён сам, но метку может иметь более раннюю (его удалили
// отдельно, до родителя), и без этого шага каскад по parent_id снёс бы строку, а файл документа
// остался бы на диске сиротой.
async function purgeExpiredTrash() {
  const [rows] = await pool.query(
    'SELECT id, parent_id, file_path, deleted_at FROM nodes WHERE deleted_at IS NOT NULL'
  );
  if (rows.length === 0) return 0;

  const deadline = Date.now() - TRASH_TTL_DAYS * 24 * 60 * 60 * 1000;
  const doomed = new Set(rows.filter((r) => new Date(r.deleted_at).getTime() <= deadline).map((r) => r.id));
  if (doomed.size === 0) return 0;

  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (row.parent_id !== null && doomed.has(row.parent_id) && !doomed.has(row.id)) {
        doomed.add(row.id);
        grew = true;
      }
    }
  }

  const ids = [...doomed];
  const files = rows.filter((r) => doomed.has(r.id) && r.file_path).map((r) => r.file_path);

  await pool.query(`DELETE FROM nodes WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  files.forEach((p) => fs.existsSync(p) && fs.unlink(p, () => {}));

  console.log(`Trash: purged ${ids.length} node(s) older than ${TRASH_TTL_DAYS} days`);
  return ids.length;
}

// Ошибка чистки не должна ронять приложение: корзина подождёт до следующего круга, а
// пользователь тем временем работает с деревом как ни в чём не бывало.
function runPurge() {
  purgeExpiredTrash().catch((err) => console.error('Trash purge failed:', err));
}

function startTrashPurge() {
  runPurge();
  const timer = setInterval(runPurge, PURGE_INTERVAL_MS);
  timer.unref(); // таймер не держит процесс живым при остановке сервиса
  return timer;
}

module.exports = { TRASH_TTL_DAYS, purgeExpiredTrash, startTrashPurge };
