// Applique les migrations SQL (migrations/*.sql) dans l'ordre, une seule fois chacune
// (suivi dans la table schema_migrations). Usage local : node scripts/migrate.mjs
// La connexion est résolue par lib/db.js depuis DATABASE_URL / POSTGRES_URL / PG* (aucun identifiant journalisé).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionString, db } from '../lib/db.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  const url = connectionString();
  if (!url) {
    console.error('Base de données non configurée : DATABASE_URL (ou PG*) est requis.');
    process.exit(1);
  }
  const client = db();
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} échouée : ${error.message}`);
    }
    appliedCount += 1;
    console.log(`migration appliquée : ${file}`);
  }
  console.log(appliedCount === 0 ? 'aucune nouvelle migration.' : `${appliedCount} migration(s) appliquée(s).`);
}

main().then(async () => {
  try { await db().end(); } catch { /* fermeture du pool avant la sortie */ }
  // Sortie naturelle (pas de process.exit) : évite l'assertion libuv Windows pendant la fermeture des handles du driver.
  process.exitCode = 0;
}).catch((error) => { console.error(error.message || error); process.exitCode = 1; });
