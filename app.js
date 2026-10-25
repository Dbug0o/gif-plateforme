import { GIFEncoder, quantize, applyPalette } from './gifenc.js';
import { X_LIMITS, validateX, planOutput, frameCount, parseTags, matches, trendScore, xIntentUrl } from './core.js';

const $ = id => document.getElementById(id);
const S = { src: null, crop: 'orig', ignoreWarn: false, out: null, busy: false };
window.NEOGIF = S; // pour les tests

// ---------- Onglets ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab,.panel').forEach(e => e.classList.remove('active'));
  b.classList.add('active'); $(b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'biblio') renderLib();
});

// ---------- Sources ----------
$('inVideo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(f);
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('Format vidéo non supporté par ce navigateur')); })
    .catch(err => { alert(err.message); throw err; });
  S.src = { type: 'video', el: v, w: v.videoWidth, h: v.videoHeight, dur: v.duration, name: f.name };
  $('tStart').max = $('tEnd').max = v.duration.toFixed(1);
  $('tStart').value = 0; $('tEnd').value = Math.min(v.duration, 6).toFixed(1);
  $('srcInfo').textContent = `🎬 ${f.name} — ${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(1)} s, ${(f.size/1e6).toFixed(1)} Mo`;
  openEditor();
};
$('inImages').onchange = async e => {
  const files = [...e.target.files]; if (!files.length) return;
  const imgs = await Promise.all(files.map(f => createImageBitmap(f)));
  S.src = { type: 'images', imgs, w: imgs[0].width, h: imgs[0].height, name: files[0].name };
  $('srcInfo').textContent = `🖼️ ${imgs.length} image(s) — ${imgs[0].width}×${imgs[0].height}`;
  openEditor();
};
function openEditor() {
  const isV = S.src.type === 'video';
  $('editor').hidden = false; $('videoOpts').hidden = !isV; $('imageOpts').hidden = isV; $('fpsWrap').hidden = !isV;
  S.ignoreWarn = false; resetOut(); update();
}

// ---------- Paramètres ----------
const P = () => ({
  start: +$('tStart').value, end: +$('tEnd').value, fps: +$('fps').value, speed: +$('speed').value,
  delay: +$('imgDelay').value, zoom: +$('zoom').value, offX: +$('offX').value, offY: +$('offY').value,
  ratio: +$('ratio').value, maxW: +$('maxW').value,
  top: $('txtTop').value, bot: $('txtBot').value, font: $('font').value, color: $('txtColor').value, size: +$('txtSize').value,
});
document.querySelectorAll('#cropChips .chip').forEach(c => c.onclick = () => {
  document.querySelectorAll('#cropChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active'); S.crop = c.dataset.crop; $('freeCrop').hidden = S.crop !== 'free'; update();
});
['tStart','tEnd','fps','speed','imgDelay','zoom','offX','offY','ratio','maxW','txtTop','txtBot','font','txtColor','txtSize']
  .forEach(id => $(id).addEventListener('input', () => { if (id === 'tStart' && +$('tStart').value > +$('tEnd').value - .2) $('tEnd').value = Math.min(+$('tEnd').max, +$('tStart').value + .2); resetOut(); update(); }));

function cropRect(sw, sh, p) {
  const asp = { orig: sw / sh, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9, free: p.ratio }[S.crop];
  let w = sw, h = sw / asp; if (h > sh) { h = sh; w = sh * asp; }
  w /= p.zoom; h /= p.zoom;
  return { x: (sw - w) * p.offX, y: (sh - h) * p.offY, w, h };
}
function nFrames(p) {
  return S.src.type === 'video' ? frameCount(Math.max(.1, p.end - p.start), p.fps, p.speed) : S.src.imgs.length;
}
function currentPlan(p = P(), scaleOverride = 1) {
  const c = cropRect(S.src.w, S.src.h, p);
  const pl = planOutput({ cropW: c.w, cropH: c.h, frames: nFrames(p), maxWidth: p.maxW });
  if (scaleOverride < 1) { pl.width = Math.floor(pl.width * scaleOverride) & ~1; pl.height = Math.floor(pl.height * scaleOverride) & ~1; }
  return { ...pl, crop: c };
}

// ---------- Dessin ----------
function drawFrame(ctx, source, sw, sh, W, H, p) {
  const c = cropRect(sw, sh, p);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, W, H);
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
  // Indicateur X (estimé)
  setBadge(validateX({ bytes: pl.estBytes, width: pl.width, height: pl.height, frames: pl.frames }), true);
  $('warn').hidden = !(pl.heavy && !S.ignoreWarn);
  $('warn').querySelector('b').textContent = S.src.type === 'video' ? 'Ta vidéo est trop lourde pour X.' : 'Ton GIF est trop lourd pour X.';
  setQuality(pl.quality);
  $('estInfo').textContent = `Sortie prévue : ${pl.width}×${pl.height}, ${pl.frames} images${pl.framesCapped ? ' (plafonné à 350)' : ''}, ~${(pl.estBytes/1e6).toFixed(1)} Mo estimés` +
    (pl.reduction < 1 ? ` — réduction forcée à ${Math.round(pl.reduction * 100)} % de la taille voulue (${pl.wantedW}×${pl.wantedH}).` : '.');
  clearTimeout(tmr); tmr = setTimeout(() => drawPreviews(p, pl), 60);
}
async function drawPreviews(p, pl) {
  const src = S.src; let el = src.type === 'video' ? src.el : src.imgs[0];
  if (src.type === 'video') await seek(el, p.start + .01);
  await document.fonts.load(`20px ${p.font.split(',')[0]}`).catch(() => {});
  const b = $('cvBefore'), bw = Math.min(640, Math.round(pl.crop.w)), bh = Math.round(bw * pl.crop.h / pl.crop.w);
  b.width = bw; b.height = bh; drawFrame(b.getContext('2d'), el, src.w, src.h, bw, bh, p);
  if (!S.out) { const a = $('cvAfter'); a.hidden = false; $('gifOut').hidden = true;
    a.width = pl.width; a.height = pl.height; drawFrame(a.getContext('2d'), el, src.w, src.h, pl.width, pl.height, p); }
}
function setBadge(v, estimated) {
  const el = $('xBadge'); el.className = 'badge ' + (v.ok ? 'ok' : 'ko');
  el.textContent = v.ok ? `Prêt pour X ✅${estimated ? ' (estimé)' : ''}` : `Pas prêt pour X ❌${estimated ? ' (estimé)' : ''}`;
  $('checks').innerHTML = v.checks.map(c => `<li>${c.ok ? '✅' : '❌'} ${c.label} — <b>${c.val}</b></li>`).join('');
}
function setQuality(q) {
  $('qLabel').textContent = q; $('qBar').style.width = { Excellente: '100%', Correcte: '60%', 'Pixelisée': '25%' }[q];
  $('qLabel').style.color = { Excellente: '#7dffc4', Correcte: '#ffe600', 'Pixelisée': '#ff6b8b' }[q];
}
function resetOut() { S.out = null; $('resultActions').hidden = true; $('gifOut').hidden = true; $('cvAfter').hidden = false; }

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
    else { el = src.imgs[i]; delay = p.delay / p.speed; }
    drawFrame(ctx, el, el.videoWidth || el.width, el.videoHeight || el.height, W, H, p);
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
      bytes = await encode(p, pl, f => { $('pBar').style.width = (f * 100) + '%'; $('pTxt').textContent = `Essai ${attempt} : ${Math.round(f * 100)} %`; });
      if (bytes.length <= X_LIMITS.maxBytes) break;
      scale *= Math.sqrt(X_LIMITS.maxBytes * 0.93 / bytes.length); // trop lourd : on réduit et on recommence
    }
    const blob = new Blob([bytes], { type: 'image/gif' });
    S.out = { blob, width: pl.width, height: pl.height, frames: pl.frames, bytes: bytes.length };
    const url = URL.createObjectURL(blob);
    $('gifOut').src = url; $('gifOut').hidden = false; $('cvAfter').hidden = true;
    $('dlOut').href = url; $('resultActions').hidden = false;
    const v = validateX({ bytes: bytes.length, width: pl.width, height: pl.height, frames: pl.frames });
    setBadge(v, false);
    const red = Math.min(1, pl.width / pl.wantedW);
    setQuality(red >= .75 && Math.min(pl.width, pl.height) >= 360 ? 'Excellente' : (red >= .45 && Math.min(pl.width, pl.height) >= 220 ? 'Correcte' : 'Pixelisée'));
    $('pTxt').textContent = `Terminé : ${(bytes.length / 1e6).toFixed(2)} Mo, ${pl.width}×${pl.height}, ${pl.frames} images`;
  } catch (e) { $('pTxt').textContent = 'Erreur : ' + e.message; console.error(e); }
  S.busy = false; $('btnMake').disabled = false;
};
$('toLib').onclick = async () => {
  if (!S.out) return; const title = prompt('Titre du GIF :', (S.src.name || 'Mon GIF').replace(/\.\w+$/, '')); if (title === null) return;
  const tags = parseTags(prompt('Étiquettes (séparées par des virgules) :', 'néon, québec') || '');
  await addGif({ title, tags, ...S.out }); alert('Publié dans ta bibliothèque 🎉');
};

// ---------- Bibliothèque (IndexedDB) ----------
const dbP = new Promise((res, rej) => { const r = indexedDB.open('neogif', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('gifs', { keyPath: 'id', autoIncrement: true });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await dbP; return new Promise((res, rej) => {
  const t = db.transaction('gifs', mode), st = t.objectStore('gifs'), out = fn(st);
  t.oncomplete = () => res(out.result); t.onerror = () => rej(t.error); }); };
const allGifs = () => tx('readonly', s => s.getAll());
const putGif = g => tx('readwrite', s => s.put(g));
async function addGif(g) { return tx('readwrite', s => s.add({ views: 0, downloads: 0, shares: 0, created: Date.now(), ...g })); }
window.NEOGIF.lib = { allGifs, addGif };

async function gifSize(blob) { const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode().catch(() => {}); return [img.naturalWidth, img.naturalHeight]; }
function countFrames(buf) { // compte les descripteurs d'image (approx. rapide)
  const b = new Uint8Array(buf); let n = 0; for (let i = 0; i < b.length - 9; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 4) n++; return Math.max(1, n); }
$('upBtn').onclick = async () => {
  const f = $('upGif').files[0]; if (!f) return $('upMsg').textContent = 'Choisis un fichier GIF.';
  const [w, h] = await gifSize(f), frames = countFrames(await f.arrayBuffer());
  await addGif({ title: $('upTitle').value || f.name.replace(/\.gif$/i, ''), tags: parseTags($('upTags').value), blob: f, width: w, height: h, frames, bytes: f.size });
  const v = validateX({ bytes: f.size, width: w, height: h, frames });
  $('upMsg').textContent = `Ajouté ! ${v.ok ? 'Prêt pour X ✅' : 'Pas prêt pour X ❌ (' + v.checks.filter(c => !c.ok).map(c => c.label).join(', ') + ')'}`;
  $('upTitle').value = $('upTags').value = ''; $('upGif').value = ''; renderLib();
};
$('search').oninput = () => renderLib();
let urls = [];
async function renderLib() {
  urls.forEach(URL.revokeObjectURL); urls = [];
  const items = await allGifs(), q = $('search').value, list = items.filter(i => matches(i, q));
  const tile = g => { const u = URL.createObjectURL(g.blob); urls.push(u);
    return `<div class="tile" data-id="${g.id}"><img loading="lazy" src="${u}" alt=""><span>${esc(g.title)}</span></div>`; };
  $('trending').innerHTML = [...list].sort((a, b) => trendScore(b) - trendScore(a)).slice(0, 6).map(tile).join('') || '<p class="muted">Rien encore — crée ou téléverse ton premier GIF !</p>';
  $('allGifs').innerHTML = [...list].sort((a, b) => b.created - a.created).map(tile).join('') || '<p class="muted">Aucun résultat.</p>';
  document.querySelectorAll('.tile').forEach(t => t.onclick = () => openGif(items.find(i => i.id === +t.dataset.id)));
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function openGif(g) {
  g.views++; await putGif(g);
  const u = URL.createObjectURL(g.blob), v = validateX(g);
  $('mImg').src = u; $('mTitle').textContent = g.title; $('mTags').textContent = g.tags.map(t => '#' + t).join(' ');
  $('mMeta').textContent = `${g.width}×${g.height} · ${g.frames} images · ${(g.bytes / 1e6).toFixed(2)} Mo · ${g.views} vues · ${v.ok ? 'Prêt pour X ✅' : 'Pas prêt pour X ❌'}`;
  $('mDl').href = u; $('mDl').download = g.title.replace(/[^\w\- ]+/g, '') + '.gif';
  $('mDl').onclick = () => { g.downloads++; putGif(g); };
  $('mX').href = xIntentUrl(`${g.title} ${g.tags.slice(0, 3).map(t => '#' + t.replace(/[^\p{L}\p{N}_]/gu, '')).join(' ')}`);
  $('mX').onclick = () => { g.shares = (g.shares || 0) + 1; putGif(g); };
  $('mDel').onclick = async () => { if (confirm('Supprimer ce GIF ?')) { await tx('readwrite', s => s.delete(g.id)); renderLib(); } };
  $('modal').showModal(); $('modal').onclose = () => renderLib();
}
