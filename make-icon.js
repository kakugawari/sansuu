/*
 * ホーム画面用の アイコン (icon-180.png) を つくる:  node make-icon.js
 *
 * iOS は apple-touch-icon に SVG を 使えない。だから PNG が いる。
 * 外部の ライブラリを 入れずに すむよう、node の zlib だけで PNG を 書く。
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

const SIZE = 180;
const PAPER = [0xfa, 0xf3, 0xe4];    // クリーム色の 紙
const BORDER = [0xc9, 0xa8, 0x6b];   // ふちどり (紙の わく線と 同じ 色)
const INK = [0x3a, 0x2e, 0x1e];      // 万年筆の インク (÷ の 横ぼう)
const ACCENT = [0xf5, 0xa6, 0x23];   // 蛍光ペン オレンジ (÷ の 上の点)
const BLUE = [0x3b, 0x6e, 0xa8];     // 青ボールペン (÷ の 下の点)

/** (left,top) から w×h の 角の まるい 四角の 中か */
function inRoundedRect(x, y, left, top, w, h, radius) {
  const cx = Math.min(Math.max(x, left + radius), left + w - radius);
  const cy = Math.min(Math.max(y, top + radius), top + h - radius);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function pixel(x, y) {
  const px = x + 0.5, py = y + 0.5;
  if (!inRoundedRect(px, py, 0, 0, SIZE, SIZE, 39)) return null;              // 外は とうめい
  if (!inRoundedRect(px, py, 3, 3, SIZE - 6, SIZE - 6, 37)) return BORDER;    // 紙の ふちどり
  if (inCircle(x, y, 90, 53, 11)) return ACCENT;                              // ÷ の 上の点
  if (inCircle(x, y, 90, 127, 11)) return BLUE;                              // ÷ の 下の点
  if (x >= 40 && x <= 140 && y >= 84 && y <= 96) return INK;                 // ÷ の 横ぼう
  return PAPER;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let at = 0;
for (let y = 0; y < SIZE; y++) {
  raw[at++] = 0;                                   // フィルタなし
  for (let x = 0; x < SIZE; x++) {
    const c = pixel(x, y);
    raw[at++] = c ? c[0] : 0;
    raw[at++] = c ? c[1] : 0;
    raw[at++] = c ? c[2] : 0;
    raw[at++] = c ? 255 : 0;
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;    // 1 色 8 ビット
ihdr[9] = 6;    // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(__dirname + '/icon-180.png', png);
console.log('icon-180.png を つくった (' + png.length + ' バイト)');
