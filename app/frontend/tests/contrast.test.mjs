// Garde-fou d'accessibilité : vérifie les paires de couleurs clés du système de design Stitch
// (tokens Tailwind d'index.html + page privacy) contre le ratio de contraste WCAG. Empêche la
// régression « texte clair sur surface claire » observée sur la page de confidentialité.
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

// Paires (texte, fond, ratio minimum) : texte courant 4.5:1.
// Tokens du design Stitch (config Tailwind d'index.html) : encre #1b1c1a, variante #58413c,
// terracotta #972a0a / #b84221, surfaces chaudes #fbf9f5 → #e4e2de, inverse #30312e.
const PAIRS = [
  ['#1b1c1a', '#fbf9f5', 4.5], // encre sur surface
  ['#1b1c1a', '#ffffff', 4.5], // encre sur surface-container-lowest (cartes)
  ['#58413c', '#fbf9f5', 4.5], // texte secondaire sur surface
  ['#58413c', '#f5f3ef', 4.5], // texte secondaire sur surface-container-low
  ['#58413c', '#efeeea', 4.5], // texte secondaire sur surface-container
  ['#58413c', '#eae8e4', 4.5], // texte secondaire sur surface-container-high
  ['#58413c', '#e4e2de', 4.5], // texte secondaire sur surface-container-highest
  ['#972a0a', '#fbf9f5', 4.5], // kicker terracotta sur surface
  ['#972a0a', '#efeeea', 4.5], // kicker terracotta sur surface-container
  ['#b84221', '#ffffff', 4.5], // accent sombre sur carte blanche (lecteur)
  ['#ffffff', '#972a0a', 4.5], // on-primary (boutons, pacte)
  ['#ffffff', '#b84221', 4.5], // on-primary sur primary-container
  ['#ffe4de', '#972a0a', 4.5], // corps du pacte (on-primary-container / primary)
  ['#fbf9f5', '#1a1c20', 4.5], // boutons noirs (on-secondary-fixed)
  ['#f2f0ed', '#30312e', 4.5], // inverse-on-surface
  ['#ba1a1a', '#e4e2de', 4.5], // kicker d'erreur sur bannière direct
  ['#5d5e63', '#fbf9f5', 4.5], // secondary sur surface
  ['#5d5e63', '#f5f3ef', 4.5], // secondary sur surface-container-low
  ['#882000', '#ffdbd1', 4.5], // on-primary-fixed-variant (icônes du pacte)
  ['#93000a', '#ffdad6', 4.5], // on-error-container
  // Page privacy (document chaud, thème propre).
  ['#334155', '#f7f3ea', 4.5], // corps de la page privacy
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
