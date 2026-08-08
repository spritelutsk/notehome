// One-off import: folders/items exported from notes.sdb (SQLite) -> MySQL `nodes` table
// for a specific user. Run with: node scripts/import-notes-sdb.js <user_id> <folders.json> <items.json>
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const pool = require('../server/db');

async function main() {
  const [, , userIdArg, foldersPath, itemsPath] = process.argv;
  if (!userIdArg || !foldersPath || !itemsPath) {
    console.error('Usage: node import-notes-sdb.js <user_id> <folders.json> <items.json>');
    process.exit(1);
  }
  const userId = Number(userIdArg);
  const folders = JSON.parse(fs.readFileSync(foldersPath, 'utf8'));
  const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));

  const idMap = new Map(); // sqlite folder id -> new MySQL node id

  // Insert root folders first, then children (source only has 1 level of nesting,
  // but this handles arbitrary depth via repeated passes).
  let remaining = [...folders];
  let progress = true;
  while (remaining.length && progress) {
    progress = false;
    const next = [];
    for (const f of remaining) {
      if (f.parent_id === null || idMap.has(f.parent_id)) {
        const parentId = f.parent_id === null ? null : idMap.get(f.parent_id);
        const [result] = await pool.query(
          `INSERT INTO nodes (user_id, parent_id, type, name, created_at, updated_at)
           VALUES (?, ?, 'folder', ?, ?, ?)`,
          [userId, parentId, f.name, f.created_at, f.created_at]
        );
        idMap.set(f.id, result.insertId);
        progress = true;
      } else {
        next.push(f);
      }
    }
    remaining = next;
  }
  if (remaining.length) {
    console.error('Could not resolve parents for folders:', remaining.map((f) => f.id));
  }
  console.log(`Imported ${idMap.size} folders`);

  let linkCount = 0, pageCount = 0, skipped = 0;
  for (const it of items) {
    const parentId = idMap.get(it.folder_id);
    if (parentId === undefined) {
      skipped++;
      continue;
    }
    if (it.kind === 'link') {
      await pool.query(
        `INSERT INTO nodes (user_id, parent_id, type, name, description, url, created_at, updated_at)
         VALUES (?, ?, 'link', ?, ?, ?, ?, ?)`,
        [userId, parentId, it.title || it.url || '(без названия)', it.body || null, it.url || '', it.created_at, it.updated_at]
      );
      linkCount++;
    } else if (it.kind === 'page') {
      await pool.query(
        `INSERT INTO nodes (user_id, parent_id, type, name, content, created_at, updated_at)
         VALUES (?, ?, 'text', ?, ?, ?, ?)`,
        [userId, parentId, it.title || '(без названия)', it.body || '', it.created_at, it.updated_at]
      );
      pageCount++;
    } else {
      skipped++;
    }
  }
  console.log(`Imported ${linkCount} links, ${pageCount} pages, skipped ${skipped}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
