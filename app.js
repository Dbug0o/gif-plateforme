import { GIFEncoder, quantize, applyPalette } from './gifenc.js?v=28';
import { t, lang, LANGS, setLang, applyI18n } from './i18n.js?v=28';
import { FX, fxTransform, fxApply } from './effects.js?v=28';
import { decodeGif } from './gifdec.js?v=28';
import { X_LIMITS, validateX, planOutput, frameCount, parseTags, matches, trendScore, xIntentUrl } from './core.js?v=28';

const $ = id => document.getElementById(id);
const MOBILE = !!(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const BUDGET = 5_000_000; // partout
const S = { fx: [], src: null, crop: 'orig', ignoreWarn: false, out: null, busy: false };
window.NEOGIF = S; // pour les tests
let lastBadge = null, lastQ = null;
const langSel = $('langSel');
langSel.innerHTML = Object.entries(LANGS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('');
langSel.value = lang; applyI18n();
langSel.onchange = () => { setLang(langSel.value); if (S.src) update(); if (lastBadge) setBadge(...lastBadge); if (lastQ) setQuality(lastQ);
  if ($('biblio').classList.contains('active')) renderLib(); };

// ---------- Onglets ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab,.panel').forEach(e => e.classList.remove('active'));
  b.classList.add('active'); $(b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'biblio') renderLib(); else clearLib();
});

// ---------- Sources ----------
$('inVideo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(f);
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error(t('videoErr'))); })
    .catch(err => { alert(err.message); throw err; });
  S.src = { type: 'video', el: v, w: v.videoWidth, h: v.videoHeight, dur: v.duration, name: f.name };
  $('tStart').max = $('tEnd').max = v.duration.toFixed(1);
  $('tStart').value = 0; $('tEnd').value = Math.min(v.duration, S.presetDur || 6).toFixed(1);
  $('srcInfo').textContent = `🎬 ${f.name} — ${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} s, ${(f.size/1e6).toFixed(1)} ${t('mb')}`; $('srcInfo').removeAttribute('data-i18n');
  openEditor();
};
async function loadGifSource(f) { // GIF animé → images éditables
  const g = decodeGif(await f.arrayBuffer());
  const imgs = await Promise.all(g.frames.map(fr => createImageBitmap(new ImageData(fr.rgba, g.width, g.height))));
  const avg = g.frames.reduce((a, fr) => a + fr.delay, 0) / g.frames.length;
  $('imgDelay').value = Math.max(50, Math.min(3000, Math.round(avg / 50) * 50));
  S.src = { type: 'images', imgs, w: g.width, h: g.height, name: f.name };
  $('srcInfo').textContent = `🎞️ ${f.name} — ${imgs.length} ${t('images')} — ${g.width}×${g.height}`; $('srcInfo').removeAttribute('data-i18n');
  openEditor();
}
$('inImages').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  if (files.length === 1 && (files[0].type === 'image/gif' || /\.gif$/i.test(files[0].name))) return loadGifSource(files[0]).catch(err => alert(t('error') + err.message));
  const imgs = await Promise.all(files.map(f => createImageBitmap(f)));
  S.src = { type: 'images', imgs, w: imgs[0].width, h: imgs[0].height, name: files[0].name };
  $('srcInfo').textContent = `🖼️ ${imgs.length} ${t('images')} — ${imgs[0].width}×${imgs[0].height}`; $('srcInfo').removeAttribute('data-i18n');
  openEditor();
};
function openEditor() {
  const isV = S.src.type === 'video';
  $('editor').hidden = false; $('toolbox').hidden = true; $('videoOpts').hidden = !isV; $('imageOpts').hidden = isV; $('fpsWrap').hidden = !isV; $('fxCard').hidden = false; $('fxLoop').hidden = isV; $('fxHint').textContent = t(isV ? 'fxHintVideo' : 'fxHint');
  if (!$('gifTitle').value) $('gifTitle').value = (S.src.name || t('myGif')).replace(/\.\w+$/, '');
  $('libMsg').textContent = '';
  S.ignoreWarn = false; resetOut(); update();
}

// ---------- Paramètres ----------
const P = () => ({
  start: +$('tStart').value, end: +$('tEnd').value, fps: +$('fps').value, speed: +$('speed').value,
  delay: +$('imgDelay').value, zoom: +$('zoom').value, offX: +$('offX').value, offY: +$('offY').value,
  ratio: +$('ratio').value, maxW: +$('maxW').value,
  fx: S.src ? S.fx.slice() : [], fxI: +$('fxInt').value, fxDur: +$('fxDur').value, fxFps: +$('fxFps').value,
  top: $('txtTop').value, bot: $('txtBot').value, font: $('font').value, color: $('txtColor').value, size: +$('txtSize').value,
});
document.querySelectorAll('#cropChips .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#cropChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active'); S.crop = c.dataset.crop; $('freeCrop').hidden = S.crop !== 'free'; update();
});
// ---------- Effets ----------
$('fxChips').innerHTML = FX.map(k => `<button class="chip fx" data-fx="${k}" data-i18n="fx_${k}">${t('fx_' + k)}</button>`).join('');
document.querySelectorAll('#fxChips .chip').forEach(c => c.onclick = () => { const k = c.dataset.fx, i = S.fx.indexOf(k);
  if (i >= 0) S.fx.splice(i, 1); else { S.fx.push(k); if (S.fx.length > 2) S.fx.shift(); }
  document.querySelectorAll('#fxChips .chip').forEach(x => x.classList.toggle('active', S.fx.includes(x.dataset.fx)));
  $('fxOpts').hidden = !S.fx.length; resetOut(); update(); });
$('fxNone').onclick = () => { S.fx = []; document.querySelectorAll('#fxChips .chip').forEach(x => x.classList.remove('active')); $('fxOpts').hidden = true; resetOut(); update(); };
['tStart','tEnd','fxInt','fxDur','fxFps','fps','speed','imgDelay','zoom','offX','offY','ratio','maxW','txtTop','txtBot','font','txtColor','txtSize']
  .forEach(id => $(id).addEventListener('input', () => { if (id === 'tStart' && +$('tStart').value > +$('tEnd').value - .2) $('tEnd').value = Math.min(+$('tEnd').max, +$('tStart').value + .2); resetOut(); update(); }));

function cropRect(sw, sh, p) {
  const asp = { orig: sw / sh, '1:1': 1, '9:16': 9 / 16, '4:5': 4 / 5, '16:9': 16 / 9, free: p.ratio }[S.crop];
  let w = sw, h = sw / asp; if (h > sh) { h = sh; w = sh * asp; }
  w /= p.zoom; h /= p.zoom;
  return { x: (sw - w) * p.offX, y: (sh - h) * p.offY, w, h };
}
function nFrames(p) {
  if (p.fx.length && S.src.type === 'images') return Math.max(2, Math.round(p.fxDur * p.fxFps));
  return S.src.type === 'video' ? frameCount(Math.max(.1, p.end - p.start), p.fps, p.speed) : S.src.imgs.length;
}
function currentPlan(p = P(), scaleOverride = 1) {
  const c = cropRect(S.src.w, S.src.h, p);
  const pl = planOutput({ cropW: c.w, cropH: c.h, frames: nFrames(p), maxWidth: p.maxW, maxBytes: BUDGET });
  if (scaleOverride < 1) { pl.width = Math.floor(pl.width * scaleOverride) & ~1; pl.height = Math.floor(pl.height * scaleOverride) & ~1; }
  return { ...pl, crop: c };
}

// ---------- Dessin ----------
function drawFrame(ctx, source, sw, sh, W, H, p, ph = 0, f = 0) {
  const c = cropRect(sw, sh, p);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const fx = p.fx || [];
  ctx.save(); if (fx.length) fxTransform(ctx, W, H, fx, p.fxI, ph, f);
  ctx.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, W, H); ctx.restore();
  if (fx.length) fxApply(ctx, W, H, fx, p.fxI, ph, f);
  const fs = Math.max(10, Math.round(H * p.size / 100));
  ctx.font = `${fs}px ${p.font}, Impact, sans-serif`; ctx.textAlign = 'center';
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, fs / 7); ctx.strokeStyle = '#000'; ctx.fillStyle = p.color;
  const put = (t, y, base) => { if (!t) return; ctx.textBaseline = base; t = t.toUpperCase();
    ctx.strokeText(t, W / 2, y, W * .95); ctx.fillText(t, W / 2, y, W * .95); };
  put(p.top, fs * .2, 'top'); put(p.bot, H - fs * .2, 'bottom');
}
const seek = (v, t) => new Promise(r => { if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return r();
  v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = t; });

let tmr;
function update() {
  if (!S.src) return; const p = P(), pl = currentPlan(p);
  $('vStart').textContent = p.start.toFixed(1); $('vEnd').textContent = p.end.toFixed(1); $('vFps').textContent = p.fps;
  $('vSpeed').textContent = p.speed; $('vDelay').textContent = p.delay; $('vZoom').textContent = p.zoom.toFixed(1);
  $('vRatio').textContent = p.ratio.toFixed(2); $('vMaxW').textContent = p.maxW;
  $('vFxInt').textContent = Math.round(p.fxI * 100); $('vFxDur').textContent = p.fxDur.toFixed(1); $('vFxFps').textContent = p.fxFps;
  // Indicateur X (estimé)
  setBadge(validateX({ bytes: pl.estBytes, width: pl.width, height: pl.height, frames: pl.frames }), true);
  $('warn').hidden = !(pl.heavy && !S.ignoreWarn);
  $('warn').querySelector('b').textContent = t(S.src.type === 'video' ? 'warnVideo' : 'warnGif');
  setQuality(pl.quality);
  $('estInfo').textContent = t('est', { w: pl.width, h: pl.height, n: pl.frames, cap: pl.framesCapped ? t('capped') : '', mb: (pl.estBytes/1e6).toFixed(1), u: t('mb') }) +
    (pl.reduction < 1 ? t('reduced', { p: Math.round(pl.reduction * 100), w: pl.wantedW, h: pl.wantedH }) : '.') + (' ' + t('mobileMode'));
  clearTimeout(tmr); tmr = setTimeout(() => drawPreviews(p, pl), 60);
}
// Aperçus animés : « Avant » = source recadrée en boucle, « Après » = simulation à la résolution/fluidité de sortie.
const PV = { p: null, pl: null, vid: null, raf: 0, lastA: 0, img: 0, lastI: 0 };
function previewVideo() {
  if (S.src?.type !== 'video') return null;
  if (!PV.vid || PV.vid.dataset.src !== S.src.el.src) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.loop = false; v.preload = 'auto';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.src = S.src.el.src; v.dataset.src = S.src.el.src; PV.vid = v;
  }
  return PV.vid;
}
async function drawPreviews(p, pl) {
  await document.fonts.load(`20px ${p.font.split(',')[0]}`).catch(() => {});
  PV.p = p; PV.pl = pl;
  const asp = pl.crop.w / pl.crop.h;
  const b = $('cvBefore'), bw = Math.min(640, Math.max(2, Math.round(pl.crop.w))), bh = Math.max(2, Math.round(bw / asp));
  if (b.width !== bw || b.height !== bh) { b.width = bw; b.height = bh; }
  const a = $('cvAfter'); if (a.width !== pl.width || a.height !== pl.height) { a.width = pl.width; a.height = pl.height; }
  document.querySelectorAll('.compare .pv').forEach(x => x.style.aspectRatio = `${pl.width} / ${pl.height}`);
  if (!S.out) { a.hidden = false; $('gifOut').hidden = true; }
  const v = previewVideo();
  if (v) { v.playbackRate = p.speed; if (v.currentTime < p.start || v.currentTime > p.end) v.currentTime = p.start; v.play().catch(() => {}); }
  if (!PV.raf) PV.raf = requestAnimationFrame(tick);
}
function tick(now) {
  PV.raf = requestAnimationFrame(tick);
  const p = PV.p, pl = PV.pl, src = S.src; if (!p || !src || document.hidden) return;
  let el;
  if (src.type === 'video') { el = PV.vid; if (!el || el.readyState < 2) return;
    if (el.currentTime >= p.end - .02 || el.currentTime < p.start - .05 || el.ended) { el.currentTime = p.start; el.play().catch(() => {}); }
  } else if (p.fx.length) {
    const n = Math.max(2, Math.round(p.fxDur * p.fxFps)), f = Math.floor((now / 1000 % p.fxDur) * p.fxFps) % n;
    el = src.imgs[Math.floor(f * (1000 / p.fxFps) / p.delay) % src.imgs.length];
    const b = $('cvBefore'); drawFrame(b.getContext('2d'), el, src.w, src.h, b.width, b.height, { ...p, fx: [] });
    if (!S.out && f !== PV.lastF) { PV.lastF = f; PV.frames = (PV.frames || 0) + 1; const a = $('cvAfter'); drawFrame(a.getContext('2d'), el, src.w, src.h, a.width, a.height, p, f / n, f); }
    return;
  } else {
    if (now - PV.lastI >= p.delay / p.speed) { PV.img = (PV.img + 1) % src.imgs.length; PV.lastI = now; }
    el = src.imgs[PV.img % src.imgs.length];
  }
  const b = $('cvBefore'); drawFrame(b.getContext('2d'), el, src.w, src.h, b.width, b.height, { ...p, fx: [] });
  const step = src.type === 'video' ? 1000 / p.fps : 0;
  if (!S.out && now - PV.lastA >= step) { PV.lastA = now; const a = $('cvAfter');
    // Effets sur vidéo : phase = position dans l'extrait découpé → boucle calée sur la durée du clip
    let ph = 0, f = 0;
    if (src.type === 'video' && p.fx.length) { const n = pl.frames; ph = Math.min(.999, Math.max(0, (el.currentTime - p.start) / Math.max(.1, p.end - p.start))); f = Math.floor(ph * n); PV.frames = (PV.frames || 0) + 1; }
    drawFrame(a.getContext('2d'), el, src.w, src.h, a.width, a.height, p, ph, f); }
}
function setBadge(v, estimated) {
  lastBadge = [v, estimated]; const el = $('xBadge'); el.className = 'badge ' + (v.ok ? 'ok' : 'ko');
  el.textContent = t(v.ok ? 'ready' : 'notReady') + (estimated ? t('estimated') : '');
  $('checks').innerHTML = v.checks.map(c => `<li>${c.ok ? '✅' : '❌'} ${t('chk_' + c.key)} — <b>${c.val}</b></li>`).join('');
}
function setQuality(q) {
  lastQ = q; $('qLabel').textContent = t('q_' + q); $('qBar').style.width = { Excellente: '100%', Correcte: '60%', 'Pixelisée': '25%' }[q];
  $('qLabel').style.color = { Excellente: '#7dffc4', Correcte: '#ffe600', 'Pixelisée': '#ff6b8b' }[q];
}
function resetOut() { S.out = null; $('libMsg').textContent = ''; $('resultActions').hidden = true; $('gifOut').hidden = true; $('cvAfter').hidden = false; }

// ---------- Options d'avertissement ----------
const heavy = () => currentPlan().heavy;
$('fixShorten').onclick = () => { let s = +$('tStart').value;
  if (S.src.type === 'images') { $('speed').value = Math.min(4, +$('speed').value * 2); }
  else for (let i = 0; i < 40 && heavy() && +$('tEnd').value - s > 1; i++) $('tEnd').value = (s + (+$('tEnd').value - s) * .85).toFixed(1);
  resetOut(); update(); };
$('fixFps').onclick = () => { for (let i = 0; i < 30 && heavy() && +$('fps').value > 6; i++) $('fps').value = +$('fps').value - 1; resetOut(); update(); };
$('fixCrop').onclick = () => { document.querySelector('[data-crop="1:1"]').click(); if (heavy()) $('maxW').value = 400; resetOut(); update(); };
$('fixIgnore').onclick = () => { S.ignoreWarn = true; update(); };

// ---------- Encodage ----------
async function encode(p, pl, onProg) {
  const src = S.src, W = pl.width, H = pl.height, cv = document.createElement('canvas');
  cv.width = W; cv.height = H; const ctx = cv.getContext('2d', { willReadFrequently: true });
  const gif = GIFEncoder(); const n = pl.frames;
  for (let i = 0; i < n; i++) {
    let el, delay;
    if (src.type === 'video') { el = src.el; await seek(el, Math.min(src.dur - .01, p.start + i * p.speed / p.fps)); delay = 1000 / p.fps; }
    else if (p.fx.length) { delay = 1000 / p.fxFps; el = src.imgs[Math.floor(i * delay / p.delay) % src.imgs.length]; }
    else { el = src.imgs[i]; delay = p.delay / p.speed; }
    drawFrame(ctx, el, el.videoWidth || el.width, el.videoHeight || el.height, W, H, p, i / n, i);
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256); const idx = applyPalette(data, palette);
    gif.writeFrame(idx, W, H, { palette, delay: Math.max(20, Math.round(delay)) });
    onProg((i + 1) / n);
    if (i % 2 === 0) await new Promise(r => setTimeout(r));
  }
  gif.finish(); return gif.bytes();
}
$('btnMake').onclick = async () => {
  if (!S.src || S.busy) return; S.busy = true; $('btnMake').disabled = true; $('progress').hidden = false;
  const p = P(); let scale = 1, bytes, pl;
  try {
    await document.fonts.load(`20px ${p.font.split(',')[0]}`).catch(() => {});
    for (let attempt = 1; attempt <= 4; attempt++) {
      pl = currentPlan(p, scale);
      bytes = await encode(p, pl, f => { $('pBar').style.width = (f * 100) + '%'; $('pTxt').textContent = t('attempt', { a: attempt, p: Math.round(f * 100) }); });
      if (bytes.length <= BUDGET) break;
      scale *= Math.sqrt(BUDGET * 0.93 / bytes.length); // trop lourd : on réduit et on recommence
    }
    const blob = new Blob([bytes], { type: 'image/gif' });
    S.out = { blob, width: pl.width, height: pl.height, frames: pl.frames, bytes: bytes.length };
    if (S.outUrl) URL.revokeObjectURL(S.outUrl); // l'ancien lien n'est libéré qu'à la génération suivante
    const url = S.outUrl = URL.createObjectURL(blob);
    $('gifOut').src = url; $('gifOut').hidden = false; $('cvAfter').hidden = true;
    $('dlOut').href = url; $('dlOut').download = (outTitle().replace(/[^\w\- ]+/g, '') || 'neogif') + '.gif'; $('resultActions').hidden = false; $('toLib').disabled = false; $('libMsg').textContent = '';
    const v = validateX({ bytes: bytes.length, width: pl.width, height: pl.height, frames: pl.frames });
    setBadge(v, false);
    const red = Math.min(1, pl.width / pl.wantedW);
    setQuality(red >= .75 && Math.min(pl.width, pl.height) >= 360 ? 'Excellente' : (red >= .45 && Math.min(pl.width, pl.height) >= 220 ? 'Correcte' : 'Pixelisée'));
    $('pTxt').textContent = t('done', { mb: (bytes.length / 1e6).toFixed(2), u: t('mb'), w: pl.width, h: pl.height, n: pl.frames });
  } catch (e) { $('pTxt').textContent = t('error') + e.message; console.error(e); }
  S.busy = false; $('btnMake').disabled = false;
};
const renderTags = () => { $('tagPrev').innerHTML = parseTags($('gifTags').value).map(x => `<span class="tagPill">${esc(x)}</span>`).join(''); };
$('gifTags').addEventListener('input', renderTags);
$('gifTitle').addEventListener('input', () => { if (S.out) S.out.saved = false; });
// ---------- Téléchargement robuste (Android / PWA installée) ----------
function toast(msg, ms = 3500) {
  let el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; }
  (document.querySelector('dialog[open]') || document.body).appendChild(el);
  el.textContent = msg; el.classList.add('show'); clearTimeout(toast.h);
  if (ms) toast.h = setTimeout(() => el.classList.remove('show'), ms);
}
function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove(); toast(t('dlDone'), 4500);
  setTimeout(() => URL.revokeObjectURL(u), 120e3);
}
async function shareOrOpen(blob, url, name) {
  try { const f = blob && new File([blob], name, { type: 'image/gif' });
    if (f && navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: name }); return; } }
  catch (e) { if (e.name === 'AbortError') return; }
  if (url) window.open(url, '_blank', 'noopener');
}
$('dlOut').addEventListener('click', e => {
  if (!S.out?.blob) return; e.preventDefault();
  try { saveBlob(S.out.blob, $('dlOut').download || 'neogif.gif'); } catch { shareOrOpen(S.out.blob, S.outUrl, 'neogif.gif'); }
});
const outTitle = () => $('gifTitle').value.trim() || (S.src?.name || t('myGif')).replace(/\.\w+$/, '');
$('toLib').onclick = async () => {
  if (!S.out || S.out.saved) return; const { saved, ...o } = S.out;
  $('toLib').disabled = true;
  try { await addGif({ title: outTitle(), tags: parseTags($('gifTags').value), ...o }); }
  catch (e) { $('libMsg').textContent = t('error') + e.message; $('toLib').disabled = false; return; }
  S.out.saved = true; $('libMsg').textContent = t('libSaved', { t: outTitle() }); LIB.at = 0;
};
$('shareOut').onclick = async () => {
  if (!S.out) return; const f = new File([S.out.blob], (outTitle().replace(/[^\w\- ]+/g, '') || 'neogif') + '.gif', { type: 'image/gif' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], text: outTitle() }); } catch {} }
  else location.href = xIntentUrl(outTitle());
};

// ---------- Bibliothèque publique (Supabase) ----------
const SB_URL = 'https://gzfnfhijgqmoiaftujjv.supabase.co', SB_KEY = 'sb_publishable_K9EEbzeE5-NnRvmZ54jf-A_XJzi7-yx';
const SBH = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const COLS = 'id,title,tags,path,width,height,frames,size,views,downloads,shares,created_at';
const MAX_BYTES = 15 * 1024 * 1024;
const OWNER = (() => { let k; try { k = localStorage.getItem('neogif-owner'); } catch {}
  if (!k || k.length < 32) { const a = crypto.getRandomValues(new Uint8Array(32)); k = [...a].map(x => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('neogif-owner', k); } catch {} } return k; })();
const pubUrl = path => `${SB_URL}/storage/v1/object/public/gifs/${path}`;
async function sb(path, opt = {}) {
  const r = await fetch(SB_URL + path, { ...opt, headers: { ...SBH, ...(opt.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) }, body: opt.json !== undefined ? JSON.stringify(opt.json) : opt.body });
  const txt = await r.text(); if (!r.ok) { const e = new Error(txt.includes('rate_limit') ? t('rateLimit') : (r.status + ' ' + txt.slice(0, 160))); throw e; }
  return txt ? JSON.parse(txt) : null;
}
const rpc = (fn, args) => sb('/rest/v1/rpc/' + fn, { method: 'POST', json: args });
const norm = r => ({ ...r, tags: r.tags || [], bytes: r.size, created: Date.parse(r.created_at), url: pubUrl(r.path) });
async function allGifs() { return (await sb(`/rest/v1/gifs?select=${COLS}&order=created_at.desc&limit=500`)).map(norm); }
const bump = (g, c) => { g[c] = (g[c] || 0) + 1; rpc('increment_counter', { gif_id: g.id, counter: c }).catch(() => {}); };
async function addGif(g) {
  const blob = g.blob;
  if (!blob || (blob.type && blob.type !== 'image/gif')) throw new Error(t('notGif'));
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  if (String.fromCharCode(...head).slice(0, 4) !== 'GIF8') throw new Error(t('notGif'));
  if (blob.size > MAX_BYTES) throw new Error(t('tooBig'));
  const id = crypto.randomUUID(), path = id + '.gif';
  await sb('/storage/v1/object/gifs/' + path, { method: 'POST', headers: { 'Content-Type': 'image/gif', 'x-upsert': 'false' }, body: blob });
  try {
    await sb('/rest/v1/gifs', { method: 'POST', headers: { Prefer: 'return=minimal' }, json: {
      id, path, owner_token: OWNER, title: String(g.title || '').slice(0, 120), tags: (g.tags || []).slice(0, 20),
      width: g.width | 0, height: g.height | 0, frames: g.frames | 0, size: blob.size } });
  } catch (e) { sb('/storage/v1/object/gifs/' + path, { method: 'DELETE' }).catch(() => {}); throw e; }
  mine.add(id);
  return id;
}
async function deleteGif(g) { const path = await rpc('delete_gif', { gif_id: g.id, token: OWNER });
  await sb('/storage/v1/object/gifs/' + path, { method: 'DELETE' }).catch(() => {}); }
const blobCache = new Map();
async function gifBlob(g) { if (!blobCache.has(g.id)) blobCache.set(g.id, fetch(g.url, { mode: 'cors' }).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(b => new Blob([b], { type: 'image/gif' })));
  return blobCache.get(g.id).catch(e => { blobCache.delete(g.id); throw e; }); }
window.NEOGIF.lib = { allGifs, addGif };

async function gifSize(blob) { const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode().catch(() => {}); return [img.naturalWidth, img.naturalHeight]; }
function countFrames(buf) { // compte les descripteurs d'image (approx. rapide)
  const b = new Uint8Array(buf); let n = 0; for (let i = 0; i < b.length - 9; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 4) n++; return Math.max(1, n); }
// Téléversement : aperçu + vérification 𝕏 (5 Mo) avant publication
const UP = { file: null, blob: null, w: 0, h: 0, frames: 0, url: null };
function upCheck() {
  const v = validateX({ bytes: UP.blob.size, width: UP.w, height: UP.h, frames: UP.frames });
  const c0 = v.checks[0]; c0.key = 'taille5'; c0.ok = UP.blob.size <= BUDGET; v.ok = v.checks.every(c => c.ok);
  $('upBadge').className = 'badge ' + (v.ok ? 'ok' : 'ko'); $('upBadge').textContent = t(v.ok ? 'ready' : 'notReady');
  $('upChecks').innerHTML = v.checks.map(c => `<li>${c.ok ? '✅' : '❌'} ${t('chk_' + c.key)} — <b>${c.val}</b></li>`).join('');
  const big = UP.blob.size > BUDGET; $('upWarn').hidden = !big; $('upWarn').textContent = t('upWarn5'); $('upLight').hidden = !big;
}
function upShow(blob) { if (UP.url) URL.revokeObjectURL(UP.url); UP.url = URL.createObjectURL(blob); $('upImg').src = UP.url; }
function upReset() { if (UP.url) URL.revokeObjectURL(UP.url); Object.assign(UP, { file: null, blob: null, url: null });
  $('upImg').removeAttribute('src'); $('upPrev').hidden = true; $('upGif').value = ''; $('upSizes').textContent = ''; }
$('upGif').onchange = async () => {
  const f = $('upGif').files[0]; $('upMsg').textContent = ''; if (!f) return upReset();
  if (f.type !== 'image/gif' && !/\.gif$/i.test(f.name)) { upReset(); return $('upMsg').textContent = t('notGif'); }
  const [w, h] = await gifSize(f);
  Object.assign(UP, { file: f, blob: f, w, h, frames: countFrames(await f.arrayBuffer()) });
  upShow(f); $('upSizes').textContent = ''; $('upPrev').hidden = false; upCheck();
};
$('upCancel').onclick = () => { upReset(); $('upMsg').textContent = ''; };
$('upEdit').onclick = async () => { const f = UP.file; if (!f) return;
  document.querySelector('.tab[data-tab="creer"]').click();
  try { await loadGifSource(f); } catch (e) { alert(t('error') + e.message); } };
$('upLight').onclick = async () => {
  if (!UP.file || S.busy) return; S.busy = true; $('upLight').disabled = true;
  try {
    const g = decodeGif(await UP.file.arrayBuffer());
    let frames = g.frames.slice(0, X_LIMITS.maxFrames), step = 1, bytes = null, W = g.width, H = g.height;
    const minW = Math.min(g.width, 480), floorW = Math.min(g.width, 360);
    let pl = planOutput({ cropW: g.width, cropH: g.height, frames: frames.length, maxBytes: BUDGET, bpp: UP.file.size / (g.width * g.height * g.frames.length) });
    let sc = Math.max(pl.width, minW) / g.width;
    const src = document.createElement('canvas'); src.width = g.width; src.height = g.height; const sctx = src.getContext('2d');
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    for (let attempt = 1; attempt <= 6; attempt++) {
      W = Math.max(16, Math.round(g.width * sc)); H = Math.max(16, Math.round(g.height * sc)); cv.width = W; cv.height = H;
      const sel = frames.filter((_, i) => i % step === 0), gif = GIFEncoder();
      for (let i = 0; i < sel.length; i++) {
        sctx.putImageData(new ImageData(sel[i].rgba, g.width, g.height), 0, 0);
        ctx.clearRect(0, 0, W, H); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, W, H);
        const { data } = ctx.getImageData(0, 0, W, H);
        let alpha = false; for (let k = 3; k < data.length; k += 4) if (data[k] < 128) { alpha = true; break; }
        const palette = alpha ? quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true }) : quantize(data, 256);
        const idx = applyPalette(data, palette, alpha ? 'rgba4444' : 'rgb565'), ti = alpha ? palette.findIndex(c => c[3] === 0) : -1;
        let d = 0; for (let k = i * step; k < Math.min(frames.length, (i + 1) * step); k++) d += frames[k].delay;
        gif.writeFrame(idx, W, H, { palette, delay: Math.max(20, d), ...(ti >= 0 ? { transparent: true, transparentIndex: ti } : {}) });
        $('upSizes').textContent = t('upLighting', { p: Math.round((i + 1) / sel.length * 100) });
        if (i % 2 === 0) await new Promise(r => setTimeout(r));
      }
      gif.finish(); bytes = gif.bytes(); UP.frames = sel.length;
      if (bytes.length <= BUDGET) break;
      const r = Math.sqrt(BUDGET * 0.9 / bytes.length);
      if (W * r >= minW || W > floorW) sc = Math.max(sc * r, floorW / g.width); else step++; // sous 360 px : on retire des images plutôt que de pixeliser
    }
    UP.blob = new Blob([bytes], { type: 'image/gif' }); UP.w = W; UP.h = H; upShow(UP.blob); upCheck();
    $('upSizes').textContent = t('upSizes', { a: (UP.file.size / 1e6).toFixed(2), b: (bytes.length / 1e6).toFixed(2), w: W, h: H, n: UP.frames });
  } catch (e) { $('upSizes').textContent = t('error') + e.message; console.error(e); }
  S.busy = false; $('upLight').disabled = false;
};
$('upBtn').onclick = async () => {
  if (!UP.blob) return $('upMsg').textContent = t('chooseGif');
  if (UP.blob.size > MAX_BYTES) return $('upMsg').textContent = t('tooBig');
  $('upBtn').disabled = true;
  try { await addGif({ title: $('upTitle').value || UP.file.name.replace(/\.gif$/i, ''), tags: parseTags($('upTags').value), blob: UP.blob, width: UP.w, height: UP.h, frames: UP.frames, bytes: UP.blob.size }); }
  catch (e) { $('upMsg').textContent = t('error') + e.message; return; } finally { $('upBtn').disabled = false; }
  $('upMsg').textContent = t('added') + (UP.blob.size <= BUDGET ? t('ready') : t('notReady'));
  $('upTitle').value = $('upTags').value = ''; upReset(); renderLib({ force: true });
};
$('search').oninput = () => { LIB.shown = PAGE; renderLib({ cached: true }); };
let mine = new Set();
// Bibliothèque : chargée seulement quand l'onglet est visible, mise en cache 60 s, affichée par pages de 40
const PAGE = 40, LIB = { items: null, at: 0, shown: PAGE, p: null };
const libVisible = () => $('biblio').classList.contains('active');
function clearLib() { $('trending').innerHTML = ''; $('allGifs').innerHTML = ''; } // libère les GIF animés décodés
async function loadLib(force) {
  if (!force && LIB.items && Date.now() - LIB.at < 60e3) return LIB.items;
  if (!LIB.p) LIB.p = allGifs().then(async items => {
    const args = { gif_ids: items.map(i => i.id), token: OWNER };
    try { mine = new Set((await rpc('is_mine', args).catch(() => rpc('is_mine', args))) || []); } catch {}
    LIB.items = items; LIB.at = Date.now();
    return items; }).finally(() => { LIB.p = null; });
  return LIB.p;
}
async function renderLib({ cached = false, force = false } = {}) {
  if (!libVisible()) return;
  let items;
  try { items = cached && LIB.items ? LIB.items : await loadLib(force); } catch (e) { $('allGifs').innerHTML = `<p class="muted">${esc(t('netErr'))}</p>`; console.error(e); return; }
  if (!libVisible()) return;
  const q = $('search').value, list = items.filter(i => matches(i, q));
  const tile = g => `<div class="tile" data-id="${g.id}"><img loading="lazy" decoding="async" src="${g.url}" alt=""><span>${esc(g.title)}</span></div>`;
  $('trending').innerHTML = [...list].sort((a, b) => trendScore(b) - trendScore(a)).slice(0, 6).map(tile).join('') || `<p class="muted">${t('emptyTrend')}</p>`;
  const sorted = [...list].sort((a, b) => b.created - a.created);
  $('allGifs').innerHTML = (sorted.slice(0, LIB.shown).map(tile).join('') || `<p class="muted">${t('noResult')}</p>`)
    + (sorted.length > LIB.shown ? `<button id="loadMore" class="btn alt" style="grid-column:1/-1">${esc(t('loadMore'))}</button>` : '');
  if ($('loadMore')) $('loadMore').onclick = () => { LIB.shown += PAGE; renderLib({ cached: true }); };
  document.querySelectorAll('.tile').forEach(el => el.onclick = () => openGif(items.find(i => i.id === el.dataset.id)));
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function openGif(g) {
  bump(g, 'views'); const v = validateX(g);
  $('mImg').src = g.url; $('mTitle').textContent = g.title; $('mTags').textContent = g.tags.join(' · ');
  $('mMeta').textContent = `${g.width}×${g.height} · ${g.frames} ${t('frames')} · ${(g.bytes / 1e6).toFixed(2)} ${t('mb')} · ${g.views} ${t('views')} · ${t(v.ok ? 'ready' : 'notReady')}`;
  const fname = (g.title.replace(/[^\w\- ]+/g, '') || 'neogif') + '.gif';
  $('mDl').href = g.url; $('mDl').download = fname;
  gifBlob(g).catch(() => {}); // préchargement
  $('mDl').onclick = async e => {
    e.preventDefault(); bump(g, 'downloads'); toast(t('dlWait'), 0);
    let b = null;
    try { b = await gifBlob(g); if (!b.size) throw new Error('empty'); saveBlob(b, fname); }
    catch { blobCache.delete(g.id); await shareOrOpen(b, g.url, fname); }
  };
  $('mX').href = xIntentUrl(g.title);
  $('mX').onclick = async (e) => {
    bump(g, 'shares');
    if (!(navigator.canShare)) return;
    e.preventDefault();
    try {
      const f = new File([await gifBlob(g)], fname, { type: 'image/gif' });
      if (navigator.canShare({ files: [f] })) await navigator.share({ files: [f], text: g.title });
      else location.href = $('mX').href;
    } catch (err) { if (err.name !== 'AbortError') location.href = $('mX').href; }
  };
  $('mDel').style.display = mine.has(g.id) ? '' : 'none';
  if (!mine.has(g.id)) rpc('is_mine', { gif_ids: [g.id], token: OWNER })
    .then(ids => { if ((ids || []).includes(g.id)) { mine.add(g.id); if ($('modal').open) $('mDel').style.display = ''; } }).catch(() => {});
  $('mDel').onclick = async () => { if (!confirm(t('confirmDel'))) return;
    const b = $('mDel'); if (b.disabled) return; b.disabled = true;
    try { await deleteGif(g); } catch (e) { b.disabled = false; alert(/not_owner/.test(e.message) ? t('notOwner') : t('error') + e.message); return; }
    mine.delete(g.id);
    b.disabled = false; LIB.at = 0; $('modal').onclose = () => renderLib({ force: true }); $('modal').close(); toast(t('delDone')); };
  $('modal').showModal(); $('modal').onclose = () => renderLib({ cached: !!LIB.at });
}

// ---------- Repères & préréglages ----------
const guide = $('guide');
try { guide.open = localStorage.getItem('neogif-guide') !== '0'; } catch { guide.open = true; }
guide.addEventListener('toggle', () => { try { localStorage.setItem('neogif-guide', guide.open ? '1' : '0'); } catch {} });
const PRESETS = { meme: { crop: '1:1', maxW: 480, fps: 15, dur: 6, k: 'pMeme' }, clip: { crop: '16:9', maxW: 640, fps: 12, dur: 8, k: 'pClip' }, vert: { crop: '4:5', maxW: 480, fps: 12, dur: 6, k: 'pVert' } };
export function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  document.querySelectorAll('#cropChips .chip').forEach(x => x.classList.toggle('active', x.dataset.crop === p.crop));
  S.crop = p.crop; $('freeCrop').hidden = true;
  $('maxW').value = p.maxW; $('fps').value = p.fps; $('vMaxW').textContent = p.maxW; $('vFps').textContent = p.fps; S.presetDur = p.dur;
  if (S.src?.type === 'video') $('tEnd').value = Math.min(+$('tEnd').max, +$('tStart').value + p.dur).toFixed(1);
  $('presetMsg').textContent = t('presetOk', { name: t(p.k), w: p.maxW, fps: p.fps, d: p.dur });
  if (S.src) { resetOut(); update(); }
}
document.querySelectorAll('#presets [data-preset]').forEach(b => b.onclick = () => applyPreset(b.dataset.preset));
renderLib();

{ const fab=$('fabCreate'); const sync=()=>{ fab.hidden=!$('biblio').classList.contains('active'); };
  fab.onclick=()=>{ document.querySelector('.tab[data-tab="creer"]').click(); window.scrollTo({top:0,behavior:'smooth'}); sync(); };
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',sync)); sync(); }

// ---------- PWA : service worker, bouton Installer, astuce iOS ----------
// Pas de service worker : on désinstalle celui des versions 15-17 et on vide son cache
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
if (window.caches) caches.keys().then(ks => ks.filter(k => k.startsWith('neogif-')).forEach(k => caches.delete(k))).catch(() => {});
{ const btn = $('btnInstall'); let deferred = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); if (standalone()) return; deferred = e; btn.hidden = false; });
  btn.onclick = async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch {} deferred = null; btn.hidden = true; };
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let seen = false; try { seen = localStorage.getItem('neogif-iostip') === '1'; } catch {}
  if (ios && !standalone() && !seen) { $('iosTip').hidden = false;
    try { localStorage.setItem('neogif-iostip', '1'); } catch {}
    $('iosTipX').onclick = () => { $('iosTip').hidden = true; }; }
}

// ---------- Nouveau GIF : repartir à zéro ----------
const freshCreate = () => { location.href = location.pathname + '?tab=creer&t=' + Date.now(); };
$('newGif').onclick = freshCreate;
document.querySelector('.tab[data-tab="creer"]').addEventListener('click', e => { if (S.out) { e.stopImmediatePropagation(); freshCreate(); } }, true);
$('fabCreate').addEventListener('click', e => { if (S.out) { e.stopImmediatePropagation(); freshCreate(); } }, true);
if (new URLSearchParams(location.search).get('tab') === 'creer') { history.replaceState(null, '', location.pathname); document.querySelector('.tab[data-tab="creer"]').click(); }

$('heroCreate').onclick = () => $('fabCreate').click();
