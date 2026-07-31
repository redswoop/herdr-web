// Generate the PWA icons (public/icon-192.png, icon-512.png) with zero deps:
// SDF-rasterized sheep on the app's dark background, hand-encoded PNG.
// Run: node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------- tiny PNG encoder ----------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- sheep ----------

function drawIcon(S) {
  const img = Buffer.alloc(S * S * 4);
  const px = (x, y, [r, g, b], a) => {
    if (a <= 0) return;
    const i = (y * S + x) * 4;
    const na = Math.min(1, a);
    img[i] = Math.round(img[i] * (1 - na) + r * na);
    img[i + 1] = Math.round(img[i + 1] * (1 - na) + g * na);
    img[i + 2] = Math.round(img[i + 2] * (1 - na) + b * na);
    img[i + 3] = 255;
  };
  const circle = (cx, cy, rad, color) => {
    for (let y = Math.max(0, cy - rad - 2 | 0); y < Math.min(S, cy + rad + 2); y += 1) {
      for (let x = Math.max(0, cx - rad - 2 | 0); x < Math.min(S, cx + rad + 2); x += 1) {
        const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
        px(x, y, color, rad - d + 0.5); // 1px antialiased edge
      }
    }
  };
  const u = S / 512; // design in 512-space
  const BG = [16, 16, 20], WOOL = [236, 236, 240], DARK = [34, 34, 42];
  for (let i = 0; i < S * S; i += 1) {
    img[i * 4] = BG[0]; img[i * 4 + 1] = BG[1]; img[i * 4 + 2] = BG[2]; img[i * 4 + 3] = 255;
  }
  // legs
  for (const lx of [200, 300]) {
    for (let y = 340 * u; y < 420 * u; y += 1) {
      for (let x = (lx - 14) * u; x < (lx + 14) * u; x += 1) px(x | 0, y | 0, DARK, 1);
    }
  }
  // wool cloud
  const cloud = [[256, 280, 95], [180, 265, 62], [332, 265, 62], [205, 220, 58], [307, 220, 58], [256, 205, 62]];
  for (const [cx, cy, r] of cloud) circle(cx * u, cy * u, r * u, WOOL);
  // head + eye
  circle(352 * u, 200 * u, 52 * u, DARK);
  circle(368 * u, 190 * u, 8 * u, WOOL);
  // ear
  circle(318 * u, 172 * u, 18 * u, DARK);
  return encodePng(img, S, S);
}

for (const size of [192, 512]) {
  const file = path.join(PUBLIC, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
