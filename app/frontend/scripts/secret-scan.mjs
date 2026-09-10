// Scan automatisé des secrets du dépôt — ne JAMAIS afficher une valeur détectée :
// chaque résultat indique uniquement le fichier, la ligne et le TYPE de motif (jamais le contenu).
// Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/secret-scan.mjs
// Également exécuté par npm test (tests/secret-scan.test.mjs) et npm run scan.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Motifs de secrets connus (valeurs jamais affichées, nom du motif uniquement).
const PATTERNS = [
  { name: 'clé privée PEM/OpenSSH', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'mot de passe Neon', pattern: /npg_[A-Za-z0-9]{8,}/ },
  // Les gabarits de template literal (${VAR}) ne sont pas de vrais identifiants : ils sont ignorés.
  { name: 'URL PostgreSQL avec mot de passe', pattern: /postgres(?:ql)?:\/\/(?!\$\{)[^\s/@]+:(?!\$\{)[^@\s]+@/ },
  { name: 'token de bot Telegram', pattern: /\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b/ },
  { name: 'clé API Google', pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'clé AWS', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'token GitHub', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'clé OpenAI', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'token Slack', pattern: /\bxox[bprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'token GitLab', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'assignation non vide d’un secret d’environnement', pattern: /^\s*(DATABASE_URL|POSTGRES_URL|PGPASSWORD|POSTGRES_PASSWORD|TELEGRAM_PESCE_BOT_TOKEN|TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET|TELEGRAPH_ACCESS_TOKEN|PESCE_MEDIA_SIGNING_SECRET|FIREBASE_PRIVATE_KEY|FIREBASE_CLIENT_EMAIL|VERCEL_TOKEN)\s*=\s*\S+/m },
];

// Noms de fichiers interdits (hors .env.example, qui est un modèle sans valeur).
const FORBIDDEN_FILENAMES = [
  { name: 'fichier d’environnement', pattern: /(^|[\\/])\.env(\.|$)/ },
  { name: 'clé PEM', pattern: /\.pem$/i },
  { name: 'clé privée', pattern: /\.key$/i },
  { name: 'service account / credentials JSON', pattern: /(service[-_]?account|adminsdk|credentials).*\.json$/i },
];

// Fichiers volontairement ignorés (templates sans valeur, lockfile).
const IGNORED = new Set(['.env.example', 'package-lock.json']);

function repositoryRoot() {
  // app/frontend/scripts/ → racine du dépôt
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function trackedFiles(root) {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '--deduplicate'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('git ls-files indisponible : impossible de lister les fichiers du dépôt.');
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Retourne la liste des résultats (chemin relatif, ligne, nom du motif). JAMAIS la valeur.
export function scanRepository(root = repositoryRoot()) {
  const findings = [];
  for (const relative of trackedFiles(root)) {
    const name = relative.split(/[\\/]/).pop() || relative;
    if (IGNORED.has(relative) || IGNORED.has(name)) continue;
    const full = join(root, relative);
    if (!existsSync(full)) continue; // fichier supprimé du disque mais encore suivi (suppression non indexée)
    const filenameHit = FORBIDDEN_FILENAMES.find((rule) => rule.pattern.test(relative));
    if (filenameHit) {
      findings.push({ file: relative, line: null, pattern: filenameHit.name });
      continue;
    }
    const content = readFileSync(full, 'utf8');
    content.split('\n').forEach((line, index) => {
      for (const rule of PATTERNS) {
        if (rule.pattern.test(line)) findings.push({ file: relative, line: index + 1, pattern: rule.name });
      }
    });
  }
  return findings;
}

function main() {
  try {
    const findings = scanRepository();
    if (findings.length === 0) {
      console.log('SCAN OK — aucun secret détecté.');
      process.exitCode = 0;
      return;
    }
    console.error(`SCAN ÉCHEC — ${findings.length} découverte(s) :`);
    for (const finding of findings) {
      console.error(`  ${finding.file}${finding.line ? `:${finding.line}` : ''} — ${finding.pattern} (valeur non affichée)`);
    }
    process.exitCode = 1;
  } catch (error) {
    console.error(`SCAN ERREUR — ${error.message}`);
    process.exitCode = 1;
  }
}

main();
