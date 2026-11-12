import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runMigration(dbPath: string): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf-8');
  const db = new Database(dbPath);

  // Execute all statements in the schema file
  db.exec(sql);
  db.close();

  console.log(`Migration complete: ${dbPath}`);
}

// Run directly when invoked as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH ?? join(__dirname, '..', '..', '..', 'dev.db');
  runMigration(dbPath);
}
