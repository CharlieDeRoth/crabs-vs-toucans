// Pixelify Sans' capital "C" and "G" are boxes with tiny notches, so they read as "O" and "6" at small sizes.
// This builds a tiny TrueType font per weight containing only redrawn, clearly open "C" and "G" glyphs and digits
// (same pixel grid, strokes and metrics as Pixelify Sans, measured in the browser), saves it to fonts/, and embeds
// it in index.html as an extra @font-face for "Pixelify Sans" limited to those characters.
// Usage:  node tools/fix-glyphs.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Geometry measured from Pixelify Sans at 1000 units/em (C and G share the same box): box L..R x B..T,
// vertical/horizontal stroke, corner notch n, and advance width.
const WEIGHTS = {
  400: { adv: 586, L: 60, R: 525, B: -12, T: 631, sV: 101, sH: 101, n: 91, range: '100 500' },
  600: { adv: 597, L: 60, R: 536, B: -12, T: 636, sV: 118, sH: 125, n: 90, range: '501 650' },
  700: { adv: 603, L: 61, R: 542, B: -11, T: 638, sV: 127, sH: 137, n: 88, range: '651 900' },
};
const ARM = 92, UPM = 1000, ASC = 920, DESC = 280;   // ARM = one Pixelify "pixel"

// open pixel-art C: top + bottom bars, left stroke, short right arms, wide 3-pixel mouth
function cRects(g) {
  const { L, R, B, T, sV, sH, n } = g;
  return [
    [L + n, T - sH, R - n, T],          // top bar
    [L + n, B, R - n, B + sH],          // bottom bar
    [L, B + n, L + sV, T - n],          // left stroke
    [R - sV, T - n - ARM, R, T - n],    // top-right arm
    [R - sV, B + n, R, B + n + ARM],    // bottom-right arm
  ];
}
// pixel-art G: the open C, plus a right stroke up the lower half and a crossbar pointing inward
function gRects(g) {
  const { L, R, B, T, sV, sH, n } = g, u = (T - B) / 7, bar = Math.round(T - 3 * u);
  return [
    [L + n, T - sH, R - n, T],                                              // top bar
    [L + n, B, R - n, B + sH],                                              // bottom bar
    [L, B + n, L + sV, T - n],                                              // left stroke
    [R - sV, T - n - ARM, R, T - n],                                        // top-right arm
    [R - sV, B + n, R, bar],                                                // right stroke (lower half)
    [Math.round((L + R) / 2), bar - Math.round(Math.min(sH, u * 1.1)), R, bar],   // crossbar
  ];
}
// Pixelify's digits are just as ambiguous (2 reads as 8, 5 as S, 3 as 9), which makes prices misleading, so they
// are redrawn on the font's own 5x7 pixel grid. All share one advance width, so numbers don't jiggle as they change.
const DIGITS = [
  ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
  ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  ['#####', '....#', '...#.', '..#..', '..#..', '..#..', '..#..'],
  ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
];
// one rect per horizontal run, grown slightly past the grid to match the weight's stroke (overlaps are fine)
function digitRects(rows) {
  return g => {
    const { L, R, B, T, sV, sH } = g, cw = (R - L) / 5, ch = (T - B) / 7, gx = Math.max(0, (sV - cw) / 2), gy = Math.max(0, (sH - ch) / 2), out = [];
    rows.forEach((row, y) => {
      for (const m of row.matchAll(/#+/g)) {
        const x0 = L + m.index * cw, x1 = x0 + m[0].length * cw, y1 = T - y * ch, y0 = y1 - ch;
        out.push([Math.round(Math.max(L, x0 - gx)), Math.round(Math.max(B, y0 - gy)), Math.round(Math.min(R, x1 + gx)), Math.round(Math.min(T, y1 + gy))]);
      }
    });
    return out;
  };
}
const GLYPHS = [...DIGITS.map((rows, i) => ({ code: 0x30 + i, rects: digitRects(rows) })), { code: 0x43, rects: cRects }, { code: 0x47, rects: gRects }];

// ---------- minimal TrueType writer ----------
const be = {
  u16: v => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xFFFF); return b; },
  i16: v => { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; },
  u32: v => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; },
};
const cat = parts => Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)));
const pad4 = b => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - b.length % 4)]) : b;
function checksum(buf) { const b = pad4(buf); let s = 0; for (let i = 0; i < b.length; i += 4) s = (s + b.readUInt32BE(i)) >>> 0; return s; }

// one clockwise contour per rectangle (y up), all points on-curve
function encodeGlyph(rects) {
  const pts = [], ends = [];
  for (const [x0, y0, x1, y1] of rects) { pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]); ends.push(pts.length - 1); }
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  let px = 0, py = 0;
  const dx = [], dy = [];
  for (const [x, y] of pts) { dx.push(be.i16(x - px)); dy.push(be.i16(y - py)); px = x; py = y; }
  let buf = cat([be.i16(rects.length), ...bb.map(be.i16), ...ends.map(be.u16), be.u16(0), Buffer.alloc(pts.length, 1), ...dx, ...dy]);
  if (buf.length % 2) buf = cat([buf, Buffer.alloc(1)]);
  return { buf, bb, points: pts.length, contours: rects.length };
}

function buildFont(weight, g) {
  const glyphs = GLYPHS.map(G => encodeGlyph(G.rects(g)));   // glyph 0 (.notdef) is empty
  const glyf = cat(glyphs.map(x => x.buf));
  let off = 0;
  const loca = cat([be.u16(0), be.u16(0), ...glyphs.map(x => { off += x.buf.length; return be.u16(off / 2); })]);
  const bb = [0, 1, 2, 3].map(i => (i < 2 ? Math.min : Math.max)(...glyphs.map(x => x.bb[i])));
  const nGlyphs = glyphs.length + 1, bold = weight >= 700;
  const first = GLYPHS[0].code, last = GLYPHS[GLYPHS.length - 1].code;

  const head = cat([be.u32(0x00010000), be.u32(0x00010000), be.u32(0), be.u32(0x5F0F3CF5), be.u16(0x000B), be.u16(UPM),
    Buffer.alloc(16), ...bb.map(be.i16), be.u16(bold ? 1 : 0), be.u16(8), be.i16(2), be.i16(0), be.i16(0)]);
  const hhea = cat([be.u32(0x00010000), be.i16(ASC), be.i16(-DESC), be.i16(0), be.u16(g.adv), be.i16(0), be.i16(0), be.i16(bb[2]),
    be.i16(1), be.i16(0), be.i16(0), Buffer.alloc(8), be.i16(0), be.u16(nGlyphs)]);
  const maxp = cat([be.u32(0x00010000), be.u16(nGlyphs), be.u16(Math.max(...glyphs.map(x => x.points))), be.u16(Math.max(...glyphs.map(x => x.contours))),
    be.u16(0), be.u16(0), be.u16(2), Buffer.alloc(18)]);
  const os2 = cat([be.u16(4), be.i16(g.adv), be.u16(weight), be.u16(5), be.u16(0),
    be.i16(650), be.i16(600), be.i16(0), be.i16(75), be.i16(650), be.i16(600), be.i16(0), be.i16(350), be.i16(50), be.i16(250),
    be.i16(0), Buffer.alloc(10), be.u32(1), be.u32(0), be.u32(0), be.u32(0), 'NONE', be.u16(bold ? 0x20 : 0x40), be.u16(first), be.u16(last),
    be.i16(ASC), be.i16(-DESC), be.i16(0), be.u16(ASC), be.u16(DESC), be.u32(1), be.u32(0), be.i16(480), be.i16(g.T), be.u16(0), be.u16(32), be.u16(0)]);
  const hmtx = cat([be.u16(500), be.i16(0), ...glyphs.flatMap(x => [be.u16(g.adv), be.i16(x.bb[0])])]);
  // cmap format 4: one segment per character, plus the 0xFFFF terminator
  const codes = [...GLYPHS.map(G => G.code), 0xFFFF], seg = codes.length;
  const es = Math.floor(Math.log2(seg)), sr = 2 * 2 ** es;
  const cmap4 = cat([be.u16(4), be.u16(16 + 8 * seg), be.u16(0), be.u16(seg * 2), be.u16(sr), be.u16(es), be.u16(seg * 2 - sr),
    ...codes.map(be.u16), be.u16(0), ...codes.map(be.u16),
    ...codes.map((c, i) => be.u16(c === 0xFFFF ? 1 : (i + 1 - c) & 0xFFFF)), ...codes.map(() => be.u16(0))]);
  const cmap = cat([be.u16(0), be.u16(1), be.u16(3), be.u16(1), be.u32(12), cmap4]);
  const family = 'Pixelify Letter Fix', sub = bold ? 'Bold' : weight === 600 ? 'SemiBold' : 'Regular';
  const names = [[1, family], [2, sub], [4, family + ' ' + sub], [6, 'PixelifyLetterFix-' + sub]];
  const strs = names.map(([, s]) => Buffer.from(s, 'utf16le').swap16());
  let so = 0;
  const recs = names.map(([id], i) => { const r = cat([be.u16(3), be.u16(1), be.u16(0x409), be.u16(id), be.u16(strs[i].length), be.u16(so)]); so += strs[i].length; return r; });
  const name = cat([be.u16(0), be.u16(names.length), be.u16(6 + 12 * names.length), ...recs, ...strs]);
  const post = cat([be.u32(0x00030000), be.u32(0), be.i16(-100), be.i16(50), be.u32(0), Buffer.alloc(16)]);

  const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post };
  const tags = Object.keys(tables).sort();
  const n = tags.length, tes = Math.floor(Math.log2(n)), tsr = 16 * 2 ** tes;
  let offset = 12 + 16 * n;
  const dir = [], body = [];
  for (const t of tags) {
    const data = tables[t];
    dir.push(cat([Buffer.from(t.padEnd(4)), be.u32(checksum(data)), be.u32(offset), be.u32(data.length)]));
    body.push(pad4(data)); offset += pad4(data).length;
  }
  const font = cat([be.u32(0x00010000), be.u16(n), be.u16(tsr), be.u16(tes), be.u16(n * 16 - tsr), ...dir, ...body]);
  const headOff = font.readUInt32BE(12 + 16 * tags.indexOf('head') + 8);
  font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headOff + 8);   // checkSumAdjustment
  return font;
}

// ---------- write fonts + embed ----------
// A unicode-range face only merges with the main face when every other descriptor matches, so Pixelify Sans
// is declared once per weight range, each followed by the matching letter-fix face (later faces win).
const pixelify = fs.readFileSync(path.join(ROOT, 'fonts', 'PixelifySans.woff2')).toString('base64');
const range = GLYPHS.map(G => 'U+' + G.code.toString(16).toUpperCase().padStart(4, '0')).join(',');
const css = [];
for (const [w, g] of Object.entries(WEIGHTS)) {
  const font = buildFont(+w, g);
  fs.writeFileSync(path.join(ROOT, 'fonts', `PixelifyLetterFix-${w}.ttf`), font);
  css.push(`@font-face{font-family:"Pixelify Sans";src:url(data:font/woff2;base64,${pixelify}) format("woff2");font-weight:${g.range};font-display:swap}`);
  css.push(`@font-face{font-family:"Pixelify Sans";src:url(data:font/ttf;base64,${font.toString('base64')}) format("truetype");font-weight:${g.range};font-display:swap;unicode-range:${range}}`);
}
const file = path.join(ROOT, 'index.html');
let html = fs.readFileSync(file, 'utf8');
// remove any earlier version of the block (including the old C-only one)
for (const [s, e] of [['/* clearer capital C (tools/fix-c-glyph.js) */', '/* end clearer C */'], ['/* clearer capital C and G (tools/fix-glyphs.js) */', '/* end clearer letters */'], ['/* clearer digits and capital C, G (tools/fix-glyphs.js) */', '/* end clearer glyphs */']]) {
  const i = html.indexOf(s);
  if (i >= 0) html = html.slice(0, i) + html.slice(html.indexOf(e) + e.length + 1);
}
html = html.replace(/@font-face\{font-family:"Pixelify Sans";src:url\(data:font\/woff2;base64,[^)]*\) format\("woff2"\);font-weight:400 700;font-display:swap\}\n/, '');
const block = `/* clearer digits and capital C, G (tools/fix-glyphs.js) */\n${css.join('\n')}\n/* end clearer glyphs */\n`;
const anchor = html.indexOf('@font-face{font-family:"Press Start 2P"');
html = html.slice(0, anchor) + block + html.slice(anchor);
fs.writeFileSync(file, html);
console.log('built', Object.keys(WEIGHTS).map(w => `PixelifyLetterFix-${w}.ttf`).join(', '), `(${range}) and embedded in index.html`);
