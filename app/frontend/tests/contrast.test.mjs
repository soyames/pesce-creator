// Garde-fou d'accessibilité : vérifie les paires de couleurs clés du système de design
// (styles.css + page privacy) contre le ratio de contraste WCAG. Empêche la régression
// « texte clair sur surface claire » observée sur la page de confidentialité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

// Paires (texte, fond, ratio minimum) : texte courant 4.5:1, grand texte/UI 3:1.
const PAIRS = [
  ['#f8fafc', '#0b1220', 4.5], // texte principal sur fond
  ['#e2e8f0', '#111827', 4.5], // corps de lecture sur carte
  ['#94a3b8', '#111827', 4.5], // texte secondaire sur carte
  ['#94a3b8', '#111c2e', 4.5], // texte secondaire sur carte accentuée
  ['#94a3b8', '#0b1220', 4.5], // texte secondaire sur fond (nav, pied de page)
  ['#f5b942', '#0b1220', 3.0], // accent or sur fond
  ['#172033', '#f5b942', 4.5], // libellé du bouton primaire
  ['#f8fafc', '#1d293b', 4.5], // libellé du bouton secondaire
  ['#f87171', '#111c2e', 3.0], // badge « En direct »
  ['#334155', '#f7f3ea', 4.5], // corps de la page privacy (document chaud)
  ['#475569', '#f7f3ea', 4.5], // méta de la page privacy
  ['#1e293b', '#f7f3ea', 4.5], // texte de la carte privacy
  ['#f5b942', '#0b1220', 3.0], // lien retour privacy sur fond
];

test('contrastes WCAG du système de design', () => {
  const failures = [];
  for (const [foreground, background, minimum] of PAIRS) {
    const ratio = contrast(foreground, background);
    if (ratio < minimum) failures.push(`${foreground} sur ${background} : ${ratio.toFixed(2)}:1 < ${minimum}:1`);
  }
  assert.deepEqual(failures, []);
});

test('la page privacy définit son propre thème lisible (pas d’héritage clair sur clair)', () => {
  const privacy = readFileSync(fileURLToPath(new URL('../privacy/index.html', import.meta.url)), 'utf8');
  assert.ok(privacy.includes('.privacy-card { background: #f7f3ea'), 'surface de lecture chaude attendue');
  assert.ok(privacy.includes('color: #334155'), 'texte de corps sombre attendu');
  assert.ok(!/\.privacy-card\s*{[^}]*color:\s*#f8fafc/.test(privacy), 'aucun texte clair hérité sur la carte claire');
});
