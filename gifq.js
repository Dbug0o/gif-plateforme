// gifq.js — encodeur GIF « joli » : palette partagée entre images (moins de scintillement),
// tramage ordonné léger uniquement dans les zones lisses (dégradés sans bandes, détails nets),
// et réutilisation des pixels inchangés en transparent (fichier plus léger => résolution plus haute).
import { GIFEncoder, quantize } from './gifenc.js?v=29';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);
const TI = 255; // index transparent réservé

export function createQEncoder(W, H, o = {}) {
  const { dither = 4, smooth = 18, keep = 5, refresh = 1.25 } = o;
  const gif = GIFEncoder(), N = W * H;
  const shown = new Uint8Array(N * 3); let hasPrev = false;
  const idx = new Uint8Array(N);
  let pal = null, cache = null, baseErr = 0;
  const nearest = (r, g, b) => { let bi = 0, bd = 1e9;
    for (let k = 0; k < pal.length; k++) { const c = pal[k], dr = c[0] - r, dg = c[1] - g, db = c[2] - b, d = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (d < bd) { bd = d; bi = k; } }
    return bi; };
  const look = (r, g, b) => { const key = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2); let v = cache[key]; if (v < 0) v = cache[key] = nearest(r, g, b); return v; };
  const sampleErr = d => { let e = 0, n = 0;
    for (let i = 0; i < N; i += 37) { const p = i * 4, c = pal[look(d[p], d[p + 1], d[p + 2])], a = c[0] - d[p], b = c[1] - d[p + 1], q = c[2] - d[p + 2]; e += a * a + b * b + q * q; n++; }
    return e / n; };
  const build = d => { pal = quantize(d, 255, { format: 'rgb565' }); while (pal.length < 256) pal.push([0, 0, 0]);
    pal = pal.slice(0, 255); cache = new Int16Array(1 << 18).fill(-1); baseErr = sampleErr(d) + 4; };
  return {
    // reset : image non consécutive (mode estimation) -> on repart d'une image complète
    add(data, delay, reset = false) {
      if (reset) hasPrev = false;
      if (!pal || sampleErr(data) > baseErr * refresh) build(data);
      const amp = dither, sm = smooth, kp = keep * 3, BW = (W + 7) >> 3;
      // bloc 8x8 réutilisé (transparent) seulement si tous ses pixels sont quasi identiques : longues plages => LZW efficace
      const still = new Uint8Array(BW * ((H + 7) >> 3));
      if (hasPrev) { still.fill(1);
        for (let i = 0, s = 0, p = 0; i < N; i++, s += 3, p += 4) { const bi = ((i / W | 0) >> 3) * BW + ((i % W) >> 3);
          if (still[bi] && Math.abs(data[p] - shown[s]) + Math.abs(data[p + 1] - shown[s + 1]) + Math.abs(data[p + 2] - shown[s + 2]) > kp) still[bi] = 0; } }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2], s = i * 3;
        if (hasPrev && (still[(y >> 3) * BW + (x >> 3)] || (x && idx[i - 1] === TI && Math.abs(r - shown[s]) + Math.abs(g - shown[s + 1]) + Math.abs(b - shown[s + 2]) <= kp))) { idx[i] = TI; continue; }
        let R = r, G = g, B = b;
        if (amp) { // tramage seulement là où l'image est lisse (dégradés)
          const q = x + 1 < W ? p + 4 : p - 4, u = y + 1 < H ? p + W * 4 : p - W * 4;
          const gr = Math.abs(r - data[q]) + Math.abs(g - data[q + 1]) + Math.abs(b - data[q + 2]) + Math.abs(r - data[u]) + Math.abs(g - data[u + 1]) + Math.abs(b - data[u + 2]);
          if (gr < sm) { const t = BAYER[(y & 3) * 4 + (x & 3)] * amp; R = r + t; G = g + t; B = b + t;
            R = R < 0 ? 0 : R > 255 ? 255 : R | 0; G = G < 0 ? 0 : G > 255 ? 255 : G | 0; B = B < 0 ? 0 : B > 255 ? 255 : B | 0; }
        }
        const k = look(R, G, B), c = pal[k]; idx[i] = k; shown[s] = c[0]; shown[s + 1] = c[1]; shown[s + 2] = c[2];
      }
      const full = pal.concat([[0, 0, 0]]);
      gif.writeFrame(idx, W, H, { palette: full, delay, dispose: 1, ...(hasPrev ? { transparent: true, transparentIndex: TI } : {}) });
      hasPrev = true;
    },
    finish() { gif.finish(); return gif.bytes(); }
  };
}
