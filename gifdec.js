// Décodeur GIF minimal : renvoie les images composées (RGBA plein cadre) + délais.
export function decodeGif(buf) {
  const b = new Uint8Array(buf); let p = 0;
  const u16 = () => b[p++] | (b[p++] << 8);
  if (String.fromCharCode(b[0], b[1], b[2]) !== 'GIF') throw new Error('GIF?');
  p = 6; const W = u16(), H = u16(), fl = b[p++]; p += 2;
  let gct = null; if (fl & 0x80) { const n = 3 << ((fl & 7) + 1); gct = b.subarray(p, p + n); p += n; }
  const frames = []; let canvas = new Uint8ClampedArray(W * H * 4), gce = { delay: 100, disp: 0, ti: -1 };
  while (p < b.length) {
    const c = b[p++];
    if (c === 0x3B) break;
    if (c === 0x21) { const lab = b[p++];
      if (lab === 0xF9) { p++; const f = b[p++]; const d = u16(); const ti = b[p++]; p++; gce = { delay: (d || 10) * 10, disp: (f >> 2) & 7, ti: f & 1 ? ti : -1 }; }
      else { let s; while ((s = b[p++])) p += s; }
      continue; }
    if (c !== 0x2C) break;
    const x = u16(), y = u16(), w = u16(), h = u16(), lf = b[p++];
    let ct = gct; if (lf & 0x80) { const n = 3 << ((lf & 7) + 1); ct = b.subarray(p, p + n); p += n; }
    const minCode = b[p++]; const chunks = []; let s, len = 0;
    while ((s = b[p++])) { chunks.push(b.subarray(p, p + s)); len += s; p += s; }
    const data = new Uint8Array(len); let o = 0; for (const ch of chunks) { data.set(ch, o); o += ch.length; }
    const idx = lzw(data, minCode, w * h);
    const prev = gce.disp === 3 ? canvas.slice() : null;
    const inter = lf & 0x40, rows = [];
    if (inter) { for (const [st, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = st; r < h; r += step) rows.push(r); }
    for (let i = 0; i < h; i++) { const ry = y + (inter ? rows[i] : i); if (ry >= H) continue;
      for (let j = 0; j < w; j++) { const k = idx[i * w + j]; if (k === gce.ti || x + j >= W || !ct) continue;
        const q = (ry * W + x + j) * 4; canvas[q] = ct[k * 3]; canvas[q + 1] = ct[k * 3 + 1]; canvas[q + 2] = ct[k * 3 + 2]; canvas[q + 3] = 255; } }
    frames.push({ rgba: canvas.slice(), delay: gce.delay });
    if (gce.disp === 2) for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { if (y + i < H && x + j < W) canvas.fill(0, ((y + i) * W + x + j) * 4, ((y + i) * W + x + j) * 4 + 4); }
    else if (prev) canvas = prev;
    gce = { delay: 100, disp: 0, ti: -1 };
  }
  return { width: W, height: H, frames };
}
function lzw(data, minCode, npix) {
  const out = new Uint8Array(npix), clear = 1 << minCode, eoi = clear + 1;
  const pre = new Int16Array(4096), suf = new Uint8Array(4096), stack = new Uint8Array(4097);
  let size = minCode + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0, bits = 0, acc = 0, o = 0, dp = 0;
  for (let i = 0; i < clear; i++) suf[i] = i;
  while (o < npix) {
    while (bits < size) { if (dp >= data.length) return out; acc |= data[dp++] << bits; bits += 8; }
    let code = acc & mask; acc >>= size; bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[o++] = suf[code]; old = first = code; continue; }
    const inCode = code; let sp = 0;
    if (code >= avail) { stack[sp++] = first; code = old; }
    while (code >= clear) { stack[sp++] = suf[code]; code = pre[code]; }
    first = suf[code]; stack[sp++] = first;
    if (avail < 4096) { pre[avail] = old; suf[avail] = first; avail++; if (avail === (1 << size) && size < 12) { size++; mask = (1 << size) - 1; } }
    old = inCode;
    while (sp && o < npix) out[o++] = stack[--sp];
  }
  return out;
}
