// Garde-fou permanent : aucun secret dans le dépôt. Intégré à npm test.
// Le scanner ne révèle jamais les valeurs détectées (nom de motif uniquement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRepository } from '../scripts/secret-scan.mjs';

test('aucun secret (credential, token, clé, URL de base de données) dans le dépôt', () => {
  const findings = scanRepository();
  const summary = findings.map((finding) => `${finding.file}${finding.line ? `:${finding.line}` : ''} (${finding.pattern})`);
  assert.deepEqual(summary, []);
});
