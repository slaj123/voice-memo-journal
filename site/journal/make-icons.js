// Draws the Journal home-screen icon (a ruled page with a ribbon on rust)
// as PNGs with no dependencies, 4x4 supersampled, written with Node's zlib.
// Output goes to static/, which generate.js copies into dist/.
// Run: node make-icons.js   (only needed when the icon changes)
const fs = require("fs");
const path = require("path");
const { deflateSync } = require("zlib");

const BG = [0x9e, 0x43, 0x2a];
const PAGE = [0xf6, 0xf2, 0xea];
const LINE = [0xc9, 0xbd, 0xa8];
const RIBBON = [0x5e, 0x22, 0x13];

const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

function colorAt(x, y, maskable) {
  // Android crops maskable icons to a circle; keep the art in the middle.
  const k = maskable ? 0.74 : 1;
  x = 0.5 + (x - 0.5) / k;
  y = 0.5 + (y - 0.5) / k;
  // Ribbon hangs off the top-right of the page, notched at the bottom.
  if (inRect(x, y, 0.58, 0.2, 0.66, 0.42) && !(y > 0.38 && Math.abs(x - 0.62) < (y - 0.38))) return RIBBON;
  if (!inRect(x, y, 0.27, 0.2, 0.73, 0.8)) return BG;
  for (const ly of [0.48, 0.57, 0.66]) if (inRect(x, y, 0.34, ly, 0.66, ly + 0.022)) return LINE;
  return PAGE;
}

function png(size, maskable) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, maskable);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / (SS * SS); raw[o + 1] = g / (SS * SS); raw[o + 2] = b / (SS * SS);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const out = path.join(__dirname, "static");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), png(180, false));
fs.writeFileSync(path.join(out, "icon-192.png"), png(192, false));
fs.writeFileSync(path.join(out, "icon-512.png"), png(512, false));
fs.writeFileSync(path.join(out, "icon-maskable-512.png"), png(512, true));
console.log("icons written to static/");
