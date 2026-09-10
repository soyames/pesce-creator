// Applique les migrations de lib/schema.js (DDL idempotent, source unique) via le même mécanisme
// que le démarrage à froid des fonctions serveur (lib/db.js ensureMigrations).
// Usage local : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/migrate.mjs
// La connexion est résolue par lib/db.js depuis DATABASE_URL / POSTGRES_URL / PG* (aucun identifiant journalisé).
import { connectionString, db, ensureMigrations } from '../lib/db.js';

async function main() {
  if (!connectionString()) {
    console.error('Base de données non configurée : DATABASE_URL (ou PG*) est requis.');
    process.exitCode = 1;
    return;
  }
  const applied = await ensureMigrations();
  console.log(applied.length === 0 ? 'aucune nouvelle migration.' : `${applied.length} migration(s) appliquée(s).`);
  try { await db().end(); } catch { /* fermeture du pool avant la sortie */ }
  // Sortie naturelle (pas de process.exit) : évite l'assertion libuv Windows pendant la fermeture des handles du driver.
  process.exitCode = 0;
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
