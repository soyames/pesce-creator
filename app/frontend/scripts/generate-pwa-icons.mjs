// Génération des icônes PWA du Studio créatrice à partir de l'identité visuelle EXISTANTE
// (assets/profilePesce.png) — aucune nouvelle marque, aucune icône générique.
// Local uniquement (jamais déployé) : les PNG produits sont versionnés dans assets/.
// Aucune dépendance : décodage/ré-encodage PNG avec node:zlib (source 8 bits RVB, non entrelacée).
// Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/generate-pwa-icons.mjs
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../assets/profilePesce.png', import.meta.url));
const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url));

// Fond de la marque (surface éditoriale du Studio) : utilisé pour la zone de sécurité maskable.
const BRAND_SURFACE = [0xfb, 0xf9, 0xf5];
// Zone de sécurité « maskable » : le contenu utile tient dans les 80 % centraux, le système
// pouvant rogner jusqu'à 10 % de chaque côté selon la forme d'icône de la plateforme.
const MASKABLE_CONTENT_RATIO = 0.8;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

// — Décodage PNG (couleur type 2 / 6, 8 bits, non entrelacé) → { width, height, pixels RVB }.
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Fichier source : signature PNG absente.');
  let offset = 8;
  let header = null;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4),
        depth: body[8], colorType: body[9], interlace: body[12],
      };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('Fichier source : en-tête IHDR absent.');
  if (header.depth !== 8 || header.interlace !== 0 || (header.colorType !== 2 && header.colorType !== 6)) {
    throw new Error(`Fichier source non pris en charge (profondeur ${header.depth}, type ${header.colorType}, entrelacement ${header.interlace}).`);
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(header.width * header.height * 3);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      } else if (filter !== 0) throw new Error(`Filtre PNG inconnu (${filter}).`);
      line[x] = value & 0xff;
    }
    for (let x = 0; x < header.width; x += 1) {
      pixels[(y * header.width + x) * 3] = line[x * channels];
      pixels[(y * header.width + x) * 3 + 1] = line[x * channels + 1];
      pixels[(y * header.width + x) * 3 + 2] = line[x * channels + 2];
    }
    previous = line;
  }
  return { width: header.width, height: header.height, pixels };
}

// — Ré-échantillonnage par moyenne de surface (box filter) : net et sans halo en réduction.
function resize(image, size) {
  const out = Buffer.alloc(size * size * 3);
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((x + 1) * scaleX)));
      let r = 0; let g = 0; let b = 0; let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * image.width + sx) * 3;
          r += image.pixels[index]; g += image.pixels[index + 1]; b += image.pixels[index + 2];
          count += 1;
        }
      }
      const index = (y * size + x) * 3;
      out[index] = Math.round(r / count);
      out[index + 1] = Math.round(g / count);
      out[index + 2] = Math.round(b / count);
    }
  }
  return { width: size, height: size, pixels: out };
}

// Variante « maskable » : le portrait est réduit dans la zone de sécurité, sur le fond de la marque.
function maskable(image, size) {
  const content = Math.round(size * MASKABLE_CONTENT_RATIO);
  const inner = resize(image, content);
  const offset = Math.round((size - content) / 2);
  const pixels = Buffer.alloc(size * size * 3);
  for (let index = 0; index < size * size; index += 1) {
    pixels[index * 3] = BRAND_SURFACE[0];
    pixels[index * 3 + 1] = BRAND_SURFACE[1];
    pixels[index * 3 + 2] = BRAND_SURFACE[2];
  }
  for (let y = 0; y < content; y += 1) {
    for (let x = 0; x < content; x += 1) {
      const from = (y * content + x) * 3;
      const to = ((y + offset) * size + (x + offset)) * 3;
      pixels[to] = inner.pixels[from];
      pixels[to + 1] = inner.pixels[from + 1];
      pixels[to + 2] = inner.pixels[from + 2];
    }
  }
  return { width: size, height: size, pixels };
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

// Filtrage adaptatif ligne par ligne (heuristique standard de la somme des valeurs absolues) :
// indispensable sur une photographie, sans quoi le PNG produit pèse plus lourd que la source.
function filterScanline(line, previous, stride) {
  const candidates = [];
  for (let type = 0; type <= 4; type += 1) {
    const filtered = Buffer.alloc(stride);
    let score = 0;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 3 ? line[x - 3] : 0;
      const b = previous[x];
      const c = x >= 3 ? previous[x - 3] : 0;
      let value;
      if (type === 0) value = line[x];
      else if (type === 1) value = line[x] - a;
      else if (type === 2) value = line[x] - b;
      else if (type === 3) value = line[x] - ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        value = line[x] - (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
      }
      filtered[x] = value & 0xff;
      score += filtered[x] < 128 ? filtered[x] : 256 - filtered[x];
    }
    candidates.push({ type, filtered, score });
  }
  return candidates.reduce((best, item) => (item.score < best.score ? item : best));
}

function encodePng(image) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;  // 8 bits par canal
  header[9] = 2;  // RVB
  const stride = image.width * 3;
  const raw = Buffer.alloc((stride + 1) * image.height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < image.height; y += 1) {
    const line = image.pixels.subarray(y * stride, (y + 1) * stride);
    const best = filterScanline(line, previous, stride);
    raw[y * (stride + 1)] = best.type;
    best.filtered.copy(raw, y * (stride + 1) + 1);
    previous = line;
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const source = decodePng(readFileSync(SOURCE));
const outputs = [
  ['studio-icon-192.png', resize(source, 192)],
  ['studio-icon-512.png', resize(source, 512)],
  ['studio-icon-maskable-512.png', maskable(source, 512)],
];
for (const [name, image] of outputs) {
  const encoded = encodePng(image);
  writeFileSync(new URL(name, `file://${ASSETS.replace(/\\/g, '/')}`), encoded);
  console.log(`assets/${name} — ${image.width}×${image.height}, ${encoded.length} octets`);
}
console.log('Icônes PWA du Studio générées depuis assets/profilePesce.png (marque inchangée).');
