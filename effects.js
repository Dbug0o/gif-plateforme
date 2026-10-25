// Neo GIF — effets animés pour images fixes. Tout est périodique en `ph` ∈ [0,1) → boucle parfaite.
export const FX = ['zoom', 'glitch', 'neon', 'vhs', 'shake', 'sparkle', 'hue', 'rain'];
const TAU = Math.PI * 2;
const rnd = s => { s = Math.sin(s * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// Transformation géométrique (avant drawImage) : zoom lent + tremblement
export function fxTransform(ctx, W, H, fx, I, ph, f) {
  let s = 1, dx = 0, dy = 0;
  if (fx.includes('zoom')) { const k = .5 - .5 * Math.cos(TAU * ph); s *= 1 + .22 * I * k; dx += W * .04 * I * Math.sin(TAU * ph); dy += H * .03 * I * Math.sin(TAU * ph + 1); }
  if (fx.includes('shake')) { s *= 1 + .07 * I; const a = W * .035 * I;
    dx += a * (Math.sin(TAU * ph * 7) * .6 + (rnd(f * 3.1) - .5) * .8); dy += a * (Math.cos(TAU * ph * 9) * .6 + (rnd(f * 5.7) - .5) * .8); }
  if (s === 1 && !dx && !dy) return;
  ctx.translate(W / 2 + dx, H / 2 + dy); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
}
let glowCv;
// Effets sur l'image (après drawImage, avant le texte)
export function fxApply(ctx, W, H, fx, I, ph, f) {
  const pix = fx.some(x => x === 'hue' || x === 'glitch' || x === 'vhs');
  if (pix) {
    const im = ctx.getImageData(0, 0, W, H), d = im.data;
    if (fx.includes('hue')) hueRotate(d, TAU * ph, I);
    if (fx.includes('glitch')) glitch(d, W, H, I, ph, f);
    if (fx.includes('vhs')) vhs(d, W, H, I, ph, f);
    ctx.putImageData(im, 0, 0);
  }
  if (fx.includes('vhs')) { ctx.fillStyle = `rgba(0,0,0,${.18 + .25 * I})`; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1); }
  if (fx.includes('neon')) neon(ctx, W, H, I, ph);
  if (fx.includes('rain')) rain(ctx, W, H, I, ph);
  if (fx.includes('sparkle')) sparkle(ctx, W, H, I, ph);
}
function hueRotate(d, a, I) {
  const c = Math.cos(a), s = Math.sin(a), m = [
    .213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928,
    .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283,
    .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072];
  const sat = 1 + .5 * I;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2]; const l = .3 * r + .59 * g + .11 * b;
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    d[i] = m[0] * r + m[1] * g + m[2] * b; d[i + 1] = m[3] * r + m[4] * g + m[5] * b; d[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
}
function glitch(d, W, H, I, ph, f) {
  const burst = rnd(f * 1.7) < .35 + .4 * I ? 1 : .25;
  const sh = Math.round(W * .02 * I * burst * (1 + Math.sin(TAU * ph * 3))) + 1;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
    d[i] = src[(y * W + Math.min(W - 1, x + sh)) * 4]; d[i + 2] = src[(y * W + Math.max(0, x - sh)) * 4 + 2]; }
  const n = Math.round((2 + 6 * I) * burst);
  for (let k = 0; k < n; k++) {
    const y0 = Math.floor(rnd(f * 13 + k) * H), h = Math.max(2, Math.floor(rnd(f * 7 + k * 3) * H * .08 * I)), off = Math.round((rnd(f * 3 + k * 11) - .5) * W * .25 * I);
    for (let y = y0; y < Math.min(H, y0 + h); y++) { const row = d.slice(y * W * 4, (y + 1) * W * 4);
      for (let x = 0; x < W; x++) { const sx = ((x - off) % W + W) % W; d.set(row.subarray(sx * 4, sx * 4 + 4), (y * W + x) * 4); } }
  }
}
function vhs(d, W, H, I, ph, f) {
  const by = Math.floor(ph * H * 1.3 - H * .15), bh = Math.max(4, H * .07);
  for (let y = 0; y < H; y++) {
    const inBar = y >= by && y < by + bh, off = inBar ? Math.round(W * .03 * I * Math.sin(y * .7)) : 0;
    const row = off ? d.slice(y * W * 4, (y + 1) * W * 4) : null;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
      if (row) { const sx = Math.min(W - 1, Math.max(0, x - off)); d[i] = row[sx * 4]; d[i + 1] = row[sx * 4 + 1]; d[i + 2] = row[sx * 4 + 2]; }
      const n = (rnd(f * 977 + i * .013) - .5) * 70 * I + (inBar ? 40 * I : 0);
      d[i] += n + 6; d[i + 1] += n; d[i + 2] += n + 10; }
  }
}
function neon(ctx, W, H, I, ph) {
  const pulse = Math.pow(.5 + .5 * Math.sin(TAU * ph * 2), 2) * (rnd(Math.floor(ph * 24)) < .12 ? .3 : 1);
  glowCv ||= document.createElement('canvas'); const gw = Math.max(8, W >> 3), gh = Math.max(8, H >> 3);
  glowCv.width = gw; glowCv.height = gh; const g = glowCv.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(ctx.canvas, 0, 0, gw, gh);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = (.25 + .6 * pulse) * I; ctx.drawImage(glowCv, 0, 0, W, H);
  ctx.globalAlpha = .18 * pulse * I; ctx.fillStyle = '#ff2bd6'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .5 * (1 - pulse) * I; ctx.fillStyle = '#0b0420'; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
function rain(ctx, W, H, I, ph) {
  const n = Math.round(30 + 120 * I), L = H * .08; ctx.save(); ctx.strokeStyle = 'rgba(180,220,255,.55)'; ctx.lineWidth = Math.max(1, W / 400);
  ctx.fillStyle = `rgba(10,20,50,${.15 * I})`; ctx.fillRect(0, 0, W, H); ctx.beginPath();
  for (let i = 0; i < n; i++) { const k = 1 + Math.floor(rnd(i) * 3), y = (((rnd(i + 50) + ph * k) % 1) * (H + L * 2)) - L, x = rnd(i + 99) * W * 1.2 - y * .15;
    ctx.moveTo(x, y); ctx.lineTo(x - L * .15, y + L * (.6 + .4 * rnd(i + 7))); }
  ctx.stroke(); ctx.restore();
}
function sparkle(ctx, W, H, I, ph) {
  const n = Math.round(8 + 30 * I), R = Math.min(W, H); ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) { const k = 1 + Math.floor(rnd(i * 3) * 3), a = Math.max(0, Math.sin(TAU * (ph * k + rnd(i * 5))));
    if (a < .05) continue; const x = rnd(i * 7 + 1) * W, y = rnd(i * 11 + 2) * H, s = R * (.015 + .04 * rnd(i)) * a * (.6 + I * .6);
    const col = ['255,255,255', '255,43,214', '0,240,255', '255,230,0'][i % 4];
    const gr = ctx.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = gr; ctx.fillRect(x - s, y - s, s * 2, s * 2);
    ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.beginPath(); ctx.moveTo(x - s * 1.6, y); ctx.lineTo(x, y - s * .12); ctx.lineTo(x + s * 1.6, y); ctx.lineTo(x, y + s * .12);
    ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s * .12, y); ctx.lineTo(x, y + s * 1.6); ctx.lineTo(x - s * .12, y); ctx.fill(); }
  ctx.restore();
}
