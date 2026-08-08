const pool = require('./db');

// Columns added after the initial release. `scripts/init-db.sql` already creates them for a fresh
// install; `ensureSchema()` brings an already-deployed database up to date on startup, so
// upgrading stays "git pull && restart" with no manual SQL step.
//
// Existence is checked against information_schema rather than using `ADD COLUMN IF NOT EXISTS`,
// which is MariaDB-only syntax.
const ADDED_COLUMNS = [
  { table: 'users', column: 'settings', definition: 'TEXT NULL' },
];

async function ensureSchema() {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (rows.length > 0) continue;

    // Identifiers can't be bound as placeholders; every value here is hard-coded above, never input.
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`DB migration: added ${table}.${column}`);
  }
}

module.exports = { ensureSchema };
