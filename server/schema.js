const pool = require('./db');

// Таблицы и колонки, добавленные после первого релиза. `scripts/init-db.sql` уже создаёт их
// для свежей установки; `ensureSchema()` доливает их в уже развёрнутую БД при старте, поэтому
// обновление остаётся «git pull && restart» без ручного SQL. Определения обязаны совпадать
// с init-db.sql: свежая база берёт схему оттуда, работающая — отсюда.
const ADDED_TABLES = [
  `CREATE TABLE IF NOT EXISTS log_reports (
     id          INT AUTO_INCREMENT PRIMARY KEY,
     created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     window_from DATETIME NOT NULL,
     window_to   DATETIME NOT NULL,
     level       VARCHAR(10) NOT NULL,
     alerts      INT NOT NULL DEFAULT 0,
     warnings    INT NOT NULL DEFAULT 0,
     report      MEDIUMTEXT NOT NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Наличие колонки проверяется по information_schema, а не через `ADD COLUMN IF NOT EXISTS`:
// последнее — синтаксис только MariaDB. У таблиц такой заботы нет: `CREATE TABLE IF NOT EXISTS`
// понимают все.
const ADDED_COLUMNS = [
  { table: 'users', column: 'settings', definition: 'TEXT NULL' },
  { table: 'nodes', column: 'deleted_at', definition: 'DATETIME NULL DEFAULT NULL' },
  { table: 'nodes', column: 'is_favorite', definition: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { table: 'nodes', column: 'link_status', definition: 'VARCHAR(40) NULL DEFAULT NULL' },
  { table: 'nodes', column: 'link_checked_at', definition: 'DATETIME NULL DEFAULT NULL' },
];

async function ensureSchema() {
  for (const sql of ADDED_TABLES) {
    await pool.query(sql);
  }

  for (const { table, column, definition } of ADDED_COLUMNS) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (rows.length > 0) continue;

    // Идентификаторы нельзя подставить плейсхолдером; всё, что сюда попадает, записано выше
    // литералом и никогда не приходит извне.
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`DB migration: added ${table}.${column}`);
  }
}

module.exports = { ensureSchema };
