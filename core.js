// Logique pure (testable sans navigateur) : limites X, estimation, qualité.
export const X_LIMITS = { maxBytes: 15_000_000, maxW: 1280, maxH: 1080, maxFrames: 350, maxPixelFrames: 300_000_000 };
// Octets par pixel·image observés pour un GIF quantifié (approx. prudente, vidéo réelle)
export const BPP_EST = 0.45;

export function validateX({ bytes, width, height, frames }) {
  const L = X_LIMITS, pf = width * height * frames;
  const checks = [
    { key: 'taille', ok: bytes == null || bytes <= L.maxBytes, label: `Poids ≤ 15 Mo`, val: bytes == null ? '—' : (bytes / 1e6).toFixed(2) + ' Mo' },
    { key: 'largeur', ok: width <= L.maxW, label: 'Largeur ≤ 1280 px', val: width + ' px' },
    { key: 'hauteur', ok: height <= L.maxH, label: 'Hauteur ≤ 1080 px', val: height + ' px' },
    { key: 'images', ok: frames <= L.maxFrames, label: 'Images ≤ 350', val: String(frames) },
    { key: 'pixels', ok: pf <= L.maxPixelFrames, label: 'L×H×images ≤ 300 M', val: (pf / 1e6).toFixed(1) + ' M' },
  ];
  return { ok: checks.every(c => c.ok), checks };
}

// Plan : à partir des dimensions recadrées + nb d'images, quelle échelle faut-il pour respecter X ?
export function planOutput({ cropW, cropH, frames, maxWidth = 1280, bpp = BPP_EST, maxBytes = X_LIMITS.maxBytes }) {
  const L = X_LIMITS;
  let s = Math.min(1, maxWidth / cropW, L.maxW / cropW, L.maxH / cropH);
  const wantedW = Math.round(cropW * s), wantedH = Math.round(cropH * s);
  const f = Math.min(frames, L.maxFrames);
  const pix = wantedW * wantedH * f;
  const sPix = Math.sqrt(L.maxPixelFrames / pix);
  const sBytes = Math.sqrt((maxBytes * 0.92) / (pix * bpp));
  const extra = Math.min(1, sPix, sBytes);
  const w = Math.max(16, Math.floor(wantedW * extra) & ~1), h = Math.max(16, Math.floor(wantedH * extra) & ~1);
  const quality = qualityOf(w, h, extra);
  return { width: w, height: h, frames: f, framesCapped: frames > L.maxFrames, reduction: extra,
    wantedW, wantedH, estBytes: Math.round(w * h * f * bpp), quality,
    heavy: extra < 0.6 || frames > L.maxFrames };
}

export function qualityOf(w, h, reduction = 1) {
  const short = Math.min(w, h);
  if (short >= 360 && reduction >= 0.75) return 'Excellente';
  if (short >= 220 && reduction >= 0.45) return 'Correcte';
  return 'Pixelisée';
}

export function frameCount(durationSec, fps, speed) {
  return Math.max(1, Math.round((durationSec / speed) * fps));
}

export function parseTags(s) {
  return [...new Set(String(s || '').toLowerCase().split(/[,#\s]+/).map(t => t.trim()).filter(Boolean))];
}
export function matches(item, q) {
  const terms = parseTags(q); if (!terms.length) return true;
  const hay = (item.title + ' ' + item.tags.join(' ')).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return terms.every(t => hay.includes(t.normalize('NFD').replace(/\p{M}/gu, '')));
}
export function trendScore(item, now = Date.now()) {
  const ageDays = (now - item.created) / 864e5;
  return (item.views + 3 * item.downloads + 5 * (item.shares || 0) + 1) / Math.pow(ageDays + 2, 1.2);
}
export function xIntentUrl(text) {
  return 'https://x.com/intent/post?text=' + encodeURIComponent(text);
}
