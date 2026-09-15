// Génération LOCALE de l'empreinte du mot de passe du Studio créatrice — jamais déployé.
//
// Le mot de passe est saisi ici, sur VOTRE machine, sans écho à l'écran : il n'est ni affiché,
// ni écrit dans un fichier, ni envoyé sur le réseau, ni conservé après l'exécution. Le script
// n'imprime QUE l'empreinte scrypt à coller dans Vercel.
//
// Usage :
//   cd app/frontend
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/generate-studio-password-hash.mjs
//
// Puis, dans Vercel → Settings → Environment Variables (Production), créer la variable
// PESCE_STUDIO_PASSWORD_HASH (type Secret) avec la valeur affichée, et redéployer.
// Ne collez jamais le mot de passe lui-même dans le dépôt, un ticket, un chat ou Vercel.
import { hashPassword, SCRYPT_PARAMS, verifyPassword } from '../lib/password-auth.js';
import { readSecret } from './secret-prompt.mjs';

const MIN_LENGTH = 12;

async function main() {
  console.error('Empreinte du mot de passe du Studio (scrypt). La saisie reste invisible.');
  const password = await readSecret('Mot de passe : ');
  if (password.length < MIN_LENGTH) {
    console.error(`Refusé : ${MIN_LENGTH} caractères minimum (ce compte est la seule porte du bureau privé).`);
    process.exitCode = 1;
    return;
  }
  const confirmation = await readSecret('Confirmer     : ');
  if (password !== confirmation) {
    console.error('Refusé : les deux saisies diffèrent.');
    process.exitCode = 1;
    return;
  }

  const encoded = await hashPassword(password);
  // Contrôle de cohérence : l'empreinte produite vérifie bien le mot de passe saisi.
  if (!(await verifyPassword(password, encoded))) {
    console.error('Refusé : l’empreinte produite ne se vérifie pas — ne l’utilisez pas.');
    process.exitCode = 1;
    return;
  }

  // Les consignes passent par stderr, la valeur par stdout : `… > /dev/null` n'affiche que
  // les consignes, et un pipe ne transporte QUE l'empreinte (jamais le mot de passe).
  console.error(`\nEmpreinte scrypt (N=${SCRYPT_PARAMS.N}, r=${SCRYPT_PARAMS.r}, p=${SCRYPT_PARAMS.p}) — à coller dans Vercel :`);
  console.error('  Variable : PESCE_STUDIO_PASSWORD_HASH  (Production, type Secret), puis redéployer.\n');
  console.log(encoded);
  console.error('\nLe mot de passe lui-même n’a été ni affiché, ni enregistré, ni transmis.');
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
