// Saisie masquée d'un secret dans le terminal — utilitaire LOCAL partagé par les scripts de
// configuration unique (mot de passe du Studio, identifiants MTProto). Jamais déployé.
//
// Règle : un secret saisi ici ne doit laisser aucune trace. Il n'est pas affiché, pas écrit sur
// disque, et n'apparaît pas dans l'historique du shell (contrairement à un secret passé en
// argument ou en variable d'environnement sur la ligne de commande). Sans terminal interactif,
// la lecture est REFUSÉE plutôt que faite en clair.
export function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Terminal interactif requis : refus de lire un secret sans saisie masquée.'));
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') { // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
