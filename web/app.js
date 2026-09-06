// AC Car Paint — garaje, skins y editor de liveries (Fabric.js 2D + three.js 3D en vivo)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const enc = encodeURIComponent;

// ------------------------------------------------------------------ utilidades
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) { /* */ }
    throw new Error(msg);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}
const postJSON = (p, body, method = 'POST') => api(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false; t.className = err ? 'err' : '';
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
  if (err) console.error(msg);
}
const status = (m) => ($('#ed-status').textContent = m || '');

// ------------------------------------------------------------------ estado + rutas
const S = { cars: [], car: null, carInfo: null, skins: [], skin: null, textures: [], tex: null, texInfo: null,
  proj: null, canvas: null, W: 0, H: 0, hist: [], hpos: -1, loading: false, dirty: false, uvImg: null,
  layout: '3d', inRender: false, noOutline: false, uvInfo: null };

function route() {
  const h = location.hash.replace(/^#/, '') || 'cars';
  const [v, a, b] = h.split('/').map((x) => decodeURIComponent(x));
  showView(v === 'car' ? 'skins' : v === 'edit' ? 'editor' : 'cars');
  if (v === 'car') openCar(a);
  else if (v === 'edit') openEditor(a, b);
  else loadCars();
}
function showView(name) {
  for (const v of $$('.view')) v.hidden = v.id !== 'view-' + name;
  if (name !== 'editor' && S.canvas) closeEditor();
  const c = $('#crumbs'); c.innerHTML = '<a href="#cars">Garaje</a>';
  if (name !== 'cars' && S.car) c.innerHTML += `<a href="#car/${enc(S.car)}">${S.carInfo?.name || S.car}</a>`;
  if (name === 'editor' && S.skin) c.innerHTML += `<a>${S.skin}</a>`;
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ ajustes
async function loadSettings() {
  const s = await api('/api/settings');
  $('#version').textContent = 'v' + s.version;
  $('#settings-banner').hidden = s.ok;
  $('#set-root').value = s.ac_root || '';
  return s;
}
function openSettings() { $('#set-err').textContent = ''; $('#dlg-settings').showModal(); }
$('#btn-settings').onclick = openSettings;
$('#btn-settings2').onclick = openSettings;
$('#set-ok').onclick = async (e) => {
  e.preventDefault();
  try { await postJSON('/api/settings', { ac_root: $('#set-root').value }); $('#dlg-settings').close(); await loadSettings(); loadCars(); }
  catch (err) { $('#set-err').textContent = err.message; }
};

// ------------------------------------------------------------------ garaje
async function loadCars() {
  try { S.cars = await api('/api/cars'); } catch (e) { S.cars = []; $('#settings-banner').hidden = false; }
  renderCars();
}
function renderCars() {
  const q = $('#car-search').value.trim().toLowerCase();
  const list = S.cars.filter((c) => !q || (c.name + ' ' + c.brand + ' ' + c.id).toLowerCase().includes(q));
  $('#car-count').textContent = `${list.length} coches`;
  $('#car-grid').innerHTML = list.map((c) => `
    <div class="card" data-id="${c.id}">
      <div class="thumb">${c.badge ? `<img src="/api/cars/${enc(c.id)}/badge" alt="">` : '🚗'}</div>
      <div class="body"><span class="name">${esc(c.name)}</span><span class="hint">${esc(c.brand)} ${c.year || ''} · ${c.skins} skins</span></div>
    </div>`).join('');
  for (const el of $$('#car-grid .card')) el.onclick = () => (location.hash = 'car/' + enc(el.dataset.id));
}
$('#car-search').oninput = renderCars;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ skins
async function openCar(car) {
  S.car = car;
  if (!S.cars.length) { try { S.cars = await api('/api/cars'); } catch (e) { /* */ } }
  S.carInfo = S.cars.find((c) => c.id === car) || { name: car };
  showView('skins');
  $('#skins-title').textContent = S.carInfo.name;
  $('#skins-badge').src = `/api/cars/${enc(car)}/badge`;
  try { S.skins = await api(`/api/cars/${enc(car)}/skins`); } catch (e) { toast(e.message, true); S.skins = []; }
  renderSkins();
}
function renderSkins() {
  const car = enc(S.car);
  $('#skin-grid').innerHTML = S.skins.map((s) => `
    <div class="card" data-id="${esc(s.id)}">
      <div class="thumb" style="${s.preview ? `background-image:url('/api/cars/${car}/skins/${enc(s.id)}/preview?t=${Date.now()}')` : ''}">${s.preview ? '' : '🎨'}</div>
      <div class="body"><span class="name">${esc(s.meta.skinname || s.id)} ${s.meta.number ? `<span class="hint">#${esc(s.meta.number)}</span>` : ''}</span>
        <span class="hint">${esc(s.id)} · ${esc(s.meta.drivername || '')} ${s.meta.team ? '· ' + esc(s.meta.team) : ''}</span>
        <span class="hint">${s.textures.length} texturas${s.project ? ' · proyecto guardado' : ''}</span></div>
      <div class="actions">
        <button data-act="edit" class="primary">✏ Editar</button>
        <button data-act="meta">Datos</button>
        <button data-act="dup">Duplicar</button>
        <button data-act="zip">Zip</button>
        <button data-act="open" title="Abrir carpeta">📂</button>
        <button data-act="del" class="danger">🗑</button>
      </div>
    </div>`).join('') + `<div class="card new" id="card-new">＋ Nueva skin</div>`;
  $('#card-new').onclick = () => skinDialog();
  for (const el of $$('#skin-grid .card[data-id]')) {
    const id = el.dataset.id;
    el.querySelector('.thumb').onclick = () => (location.hash = `edit/${enc(S.car)}/${enc(id)}`);
    for (const b of el.querySelectorAll('button')) b.onclick = (e) => { e.stopPropagation(); skinAction(b.dataset.act, id); };
  }
}
async function skinAction(act, id) {
  const base = `/api/cars/${enc(S.car)}/skins/${enc(id)}`;
  const sk = S.skins.find((s) => s.id === id);
  try {
    if (act === 'edit') location.hash = `edit/${enc(S.car)}/${enc(id)}`;
    else if (act === 'meta') skinDialog(sk);
    else if (act === 'dup') skinDialog(null, id);
    else if (act === 'zip') window.open(base + '/export.zip');
    else if (act === 'open') await postJSON(base + '/open', {});
    else if (act === 'del') {
      if (!confirm(`¿Borrar la skin "${id}" del disco? No se puede deshacer.`)) return;
      await api(base, { method: 'DELETE' }); toast('Skin borrada'); openCar(S.car);
    }
  } catch (e) { toast(e.message, true); }
}
function skinDialog(existing = null, cloneFrom = null) {
  const d = $('#dlg-skin');
  $('#dlg-skin-title').textContent = existing ? 'Datos de la skin' : cloneFrom ? `Duplicar "${cloneFrom}"` : 'Nueva skin';
  $('#sk-id').value = existing ? existing.id : cloneFrom ? cloneFrom + '_copia' : '';
  $('#sk-id').disabled = !!existing;
  $('#sk-clone-row').hidden = !!existing;
  $('#sk-clone').innerHTML = '<option value="">— vacía (sin texturas) —</option>' + S.skins.map((s) => `<option ${s.id === cloneFrom || (!cloneFrom && s === S.skins[0]) ? 'selected' : ''}>${esc(s.id)}</option>`).join('');
  const m = existing ? existing.meta : {};
  $('#sk-name').value = m.skinname || ''; $('#sk-driver').value = m.drivername || ''; $('#sk-number').value = m.number || '';
  $('#sk-team').value = m.team || ''; $('#sk-country').value = m.country || ''; $('#sk-priority').value = m.priority ?? 1;
  $('#sk-err').textContent = '';
  $('#sk-ok').onclick = async (e) => {
    e.preventDefault();
    const meta = { skinname: $('#sk-name').value, drivername: $('#sk-driver').value, number: $('#sk-number').value,
      team: $('#sk-team').value, country: $('#sk-country').value, priority: +$('#sk-priority').value || 1 };
    try {
      if (existing) await postJSON(`/api/cars/${enc(S.car)}/skins/${enc(existing.id)}/meta`, { meta }, 'PUT');
      else await postJSON(`/api/cars/${enc(S.car)}/skins`, { name: $('#sk-id').value.trim(), clone_from: $('#sk-clone').value || null, meta });
      d.close(); toast('Guardado'); openCar(S.car);
    } catch (err) { $('#sk-err').textContent = err.message; }
  };
  d.showModal();
}
$('#btn-new-skin').onclick = () => skinDialog();
$('#btn-import-skin').onclick = () => $('#file-import').click();
$('#file-import').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const r = await api(`/api/cars/${enc(S.car)}/import`, { method: 'POST', body: await f.arrayBuffer() }); toast('Importadas: ' + r.skins.join(', ')); openCar(S.car); }
  catch (err) { toast(err.message, true); }
  e.target.value = '';
};

// ================================================================== EDITOR
const PROPS_EXTRA = ['name', 'locked', 'kind', 'pat', 'patScale', 'grad', 'grad2'];

async function openEditor(car, skin) {
  if (S.canvas && S.car === car && S.skin === skin) return;
  if (S.canvas) closeEditor();
  S.car = car; S.skin = skin;
  if (!S.cars.length) { try { S.cars = await api('/api/cars'); } catch (e) { /* */ } }
  S.carInfo = S.cars.find((c) => c.id === car) || { name: car };
  showView('editor');
  $('#ed-title').textContent = `${S.carInfo.name} › ${skin}`;
  status('Cargando…');
  try {
    [S.textures, S.proj] = await Promise.all([
      api(`/api/cars/${enc(car)}/textures?skin=${enc(skin)}`), api(`/api/cars/${enc(car)}/skins/${enc(skin)}/project`)]);
  } catch (e) { toast(e.message, true); return; }
  if (!S.proj || !S.proj.textures) S.proj = { version: 1, textures: {} };
  const sel = $('#ed-texture');
  sel.innerHTML = S.textures.map((t) => `<option value="${esc(t.name)}">${t.in_skin ? '★ ' : ''}${esc(t.name)} · ${t.width || '?'}×${t.height || '?'} · ${t.meshes.length} mallas</option>`).join('');
  const first = S.proj.current || (S.textures.find((t) => t.in_skin) || S.textures[0] || {}).name;
  initCanvas();
  init3D();
  loadLibrary();
  let lay = '3d'; try { lay = localStorage.getItem('acpaint.layout') || '3d'; } catch (e) { /* */ }
  setLayout(lay);
  await load3DModel();
  if (first) { sel.value = first; await switchTexture(first); }
  else status('El coche no tiene texturas txDiffuse');
}

function closeEditor() {
  if (S.canvas) { stashCurrent(); S.canvas.dispose(); S.canvas = null; }
  S.tex = null; S.texInfo = null; S.proj = null; S.dirty = false; disarm();
  if (V.renderer) { V.renderer.setAnimationLoop(null); V.renderer.dispose(); V.renderer = null; V.scene = null; }
  window.removeEventListener('resize', onResize);
}

// ------------------------------------------------------------------ lienzo 2D
function initCanvas() {
  const wrap = $('#canvas-wrap');
  const c = new fabric.Canvas('c', { preserveObjectStacking: true, selection: true, backgroundColor: undefined,
    fireRightClick: false, stopContextMenu: true, uniformScaling: true });
  c.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
  S.canvas = c;
  window.addEventListener('resize', onResize);
  // zoom con rueda, pan con botón central o Alt+arrastrar
  c.on('mouse:wheel', (o) => {
    const e = o.e; let z = c.getZoom() * Math.pow(0.999, e.deltaY);
    z = Math.min(Math.max(z, 0.02), 20); c.zoomToPoint({ x: e.offsetX, y: e.offsetY }, z); e.preventDefault(); e.stopPropagation();
  });
  let pan = null;
  c.on('mouse:down', (o) => { if (o.e.button === 1 || o.e.altKey) { pan = { x: o.e.clientX, y: o.e.clientY }; c.selection = false; c.setCursor('grab'); } });
  c.on('mouse:move', (o) => { if (pan) { const v = c.viewportTransform; v[4] += o.e.clientX - pan.x; v[5] += o.e.clientY - pan.y; pan = { x: o.e.clientX, y: o.e.clientY }; c.requestRenderAll(); } });
  c.on('mouse:up', () => { if (pan) { pan = null; c.selection = true; c.setViewportTransform(c.viewportTransform); } });
  wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  const changed = () => { if (!S.loading) { pushHistory(); renderLayers(); scheduleLive(); S.dirty = true; } };
  c.on('object:added', changed); c.on('object:removed', changed); c.on('object:modified', changed);
  const selChanged = () => { showProps(); scheduleLive(); };
  c.on('selection:created', selChanged); c.on('selection:updated', selChanged); c.on('selection:cleared', selChanged);
  // toCanvasElement (render en vivo) también dispara after:render: S.inRender evita el bucle
  c.on('after:render', () => { if (!S.loading && !S.inRender) scheduleLive(); });
  c.on('path:created', (o) => { o.path.set({ name: 'Trazo', kind: 'brush' }); renderLayers(); });
}
function onResize() {
  if (!S.canvas) return;
  const wrap = $('#canvas-wrap'); S.canvas.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
  resize3D();
}
// ------------------------------------------------------------------ disposición: coche en grande (Forza) o textura en grande
function setLayout(mode) {
  const main = $('#main'), side = $('#side-top'), wrap = $('#canvas-wrap'), viewer = $('#viewer');
  if (mode === '3d') { main.appendChild(viewer); side.appendChild(wrap); }
  else { main.appendChild(wrap); side.appendChild(viewer); }
  S.layout = mode; try { localStorage.setItem('acpaint.layout', mode); } catch (e) { /* */ }
  $('#btn-swap').classList.toggle('active', mode === '3d');
  onResize(); fitZoom();
}
$('#btn-swap').onclick = $('#btn-swap2').onclick = () => setLayout(S.layout === '3d' ? '2d' : '3d');

function fitZoom() {
  const c = S.canvas; if (!c || !S.W) return;
  const z = Math.min((c.getWidth() - 30) / S.W, (c.getHeight() - 30) / S.H);
  c.setViewportTransform([z, 0, 0, z, (c.getWidth() - S.W * z) / 2, (c.getHeight() - S.H * z) / 2]);
}
$('#btn-fit').onclick = fitZoom;

function texUrl(name, src) { return `/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/tex/${enc(name)}?src=${src}&t=${Date.now()}`; }

function stashCurrent() {
  if (!S.tex || !S.canvas) return;
  S.proj.textures[S.tex] = { json: S.canvas.toJSON(PROPS_EXTRA), base: $('#ed-base').value, w: S.W, h: S.H,
    fmt: $('#ed-fmt').value, keep_alpha: $('#ed-keepalpha').checked };
  S.proj.current = S.tex;
}

async function switchTexture(name) {
  stashCurrent();
  S.tex = name; S.loading = true; status('Cargando textura…');
  const c = S.canvas;
  try { S.texInfo = await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/texinfo/${enc(name)}`); }
  catch (e) { S.texInfo = { width: 2048, height: 2048, format: '?' }; }
  S.W = S.texInfo.width; S.H = S.texInfo.height;
  const saved = S.proj.textures[name];
  if (saved?.w && saved?.h) { S.W = saved.w; S.H = saved.h; }
  else if (Math.max(S.W, S.H) <= 64) {
    S.W = S.H = 2048;
    toast(`${name} es una textura de color plano (${S.texInfo.width}×${S.texInfo.height}): lienzo ampliado a 2048×2048 para poder pintar vinilos`);
  }
  fillSizeSelect();
  $('#ed-base').value = saved?.base || 'orig';
  $('#ed-fmt').value = saved?.fmt || '';
  $('#ed-keepalpha').checked = saved ? saved.keep_alpha !== false : true;
  c.clear();
  c.clipPath = new fabric.Rect({ left: 0, top: 0, width: S.W, height: S.H, absolutePositioned: true });
  await new Promise((res) => (saved?.json ? c.loadFromJSON(saved.json, res) : res()));
  await loadBase();
  S.hist = []; S.hpos = -1; pushHistory();
  S.loading = false; S.dirty = false;
  fitZoom(); renderLayers(); showProps(); scheduleLive(); updateUV();
  bind3DTexture();
  status(`${name} · ${S.W}×${S.H} · ${S.texInfo.format || ''} (${S.texInfo.source === 'kn5' ? 'del kn5, no está en la skin' : S.texInfo.source})`);
  updateUVInfo();
}
$('#ed-texture').onchange = (e) => switchTexture(e.target.value);

// tamaño del lienzo (= del DDS que se escribe). Las texturas de color plano se amplían para poder pintar.
function fillSizeSelect() {
  const ow = S.texInfo.width, oh = S.texInfo.height; const sel = $('#ed-size');
  const opts = [['orig', `original (${ow}×${oh})`]];
  for (const n of [1024, 2048, 4096]) if (!(n === ow && n === oh)) opts.push([String(n), `${n}×${n}`]);
  if (!(S.W === ow && S.H === oh) && !opts.some(([v]) => v === String(S.W) && S.W === S.H)) opts.push([String(S.W), `${S.W}×${S.H}`]);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  sel.value = (S.W === ow && S.H === oh) ? 'orig' : String(S.W);
}
$('#ed-size').onchange = (e) => { const v = e.target.value; if (v === 'orig') resizeCanvas(S.texInfo.width, S.texInfo.height); else resizeCanvas(+v, +v); };
function applyCanvasSize(w, h) {
  const c = S.canvas; S.W = w; S.H = h;
  c.clipPath = new fabric.Rect({ left: 0, top: 0, width: w, height: h, absolutePositioned: true });
  const bg = c.backgroundImage; if (bg && bg.width) bg.set({ scaleX: w / bg.width, scaleY: h / bg.height });
  fillSizeSelect();
}
/** Cambia el tamaño del lienzo escalando todas las capas para que el diseño se conserve. */
function resizeCanvas(w, h) {
  const c = S.canvas; if (!c || (w === S.W && h === S.H)) return;
  const fx = w / S.W, fy = h / S.H;
  for (const o of c.getObjects()) { o.set({ left: o.left * fx, top: o.top * fy, scaleX: o.scaleX * fx, scaleY: o.scaleY * fy }); o.setCoords(); }
  applyCanvasSize(w, h);
  fitZoom(); updateUV(); pushHistory(); scheduleLive(); S.dirty = true; renderLayers(); showProps();
  status(`Lienzo ${w}×${h}`);
}

// diagnóstico del desplegado UV: ¿se pueden poner vinilos en esta textura?
async function updateUVInfo() {
  const b = $('#ed-uv'); b.hidden = true; const tex = S.tex; S.uvInfo = null;
  try {
    const u = await api(`/api/cars/${enc(S.car)}/uvinfo/${enc(tex)}`);
    if (S.tex !== tex) return;
    S.uvInfo = u;
    const pct = (x) => (x * 100).toFixed(0) + ' %';
    let cls = '', txt = '';
    let tip = `${u.meshes} mallas · ${u.triangles} triángulos · cobertura ${pct(u.coverage)} · ${u.layers} capas · espejo ${pct(u.mirrored)}`;
    if (u.encrypted_suspect) { cls = 'bad'; txt = '⚠ kn5 posiblemente cifrado: 3D y UV no fiables'; tip += ` · normales no unitarias ${pct(u.bad_normals)}. Los mods protegidos (cifrados) sólo se ven bien dentro de AC con CSP; aquí no se puede colocar sobre el 3D, sólo pintar en 2D.`; }
    else if (u.triangles === 0) { cls = 'warn'; txt = 'UV: ninguna malla visible usa esta textura'; }
    else if (u.degenerate) { cls = 'bad'; txt = 'UV ✗ sin desplegado: sólo se puede cambiar el color'; tip += '. Todas las mallas apuntan al mismo punto de la textura: cualquier dibujo se vería como un color uniforme. Para vinilos habría que re-desplegar el modelo (kn5), no basta una skin.'; }
    else if (u.layers > 1.6 && u.mirrored > 0.25) { cls = 'warn'; txt = `UV ⚠ simétricas · ${pct(u.coverage)} del lienzo`; tip += '. Los dos lados del coche comparten la misma zona de textura: un vinilo aparece en ambos lados y en uno se ve invertido (usa formas simétricas o dorsales).'; }
    else if (u.layers > 1.6) { cls = 'warn'; txt = `UV ⚠ solapadas · ${pct(u.coverage)} del lienzo`; tip += '. Varias mallas comparten la misma zona de textura: un vinilo puede repetirse en varias piezas.'; }
    else txt = `UV ✓ ${pct(u.coverage)} del lienzo`;
    if (Math.max(S.texInfo.width, S.texInfo.height) <= 64 && !u.degenerate && !u.encrypted_suspect) tip += ' · La textura original es de color plano, pero las UV están desplegadas: con el lienzo ampliado se pueden pintar vinilos en todo el coche.';
    b.textContent = txt; b.title = tip; b.className = 'uvbadge ' + cls; b.hidden = false;
  } catch (e) { /* sin diagnóstico */ }
}
$('#ed-base').onchange = async () => { await loadBase(); S.canvas.requestRenderAll(); S.dirty = true; };

function loadBase() {
  const c = S.canvas; const src = $('#ed-base').value;
  return new Promise((res) => {
    if (src === 'none') { c.setBackgroundImage(null, () => { c.requestRenderAll(); res(); }); return; }
    fabric.Image.fromURL(texUrl(S.tex, src), (img) => {
      if (!img || !img.width) { c.setBackgroundImage(null, res); return; }
      img.set({ scaleX: S.W / img.width, scaleY: S.H / img.height, originX: 'left', originY: 'top', imageSmoothing: img.width >= 64 });
      c.setBackgroundImage(img, () => { c.requestRenderAll(); res(); });
    }, { crossOrigin: 'anonymous' });
  });
}

// plantilla UV
function updateUV() {
  const c = S.canvas; if (!c) return;
  if (!$('#chk-uv').checked) { c.setOverlayImage(null, () => c.requestRenderAll()); return; }
  const size = Math.min(4096, Math.max(S.W, S.H));
  fabric.Image.fromURL(`/api/cars/${enc(S.car)}/uv/${enc(S.tex)}?size=${size}`, (img) => {
    if (!img || !img.width) return;
    img.set({ scaleX: S.W / img.width, scaleY: S.H / img.height, opacity: 0.8 });
    c.setOverlayImage(img, () => c.requestRenderAll());
  });
}
$('#chk-uv').onchange = updateUV;

// ------------------------------------------------------------------ historial
function pushHistory() {
  const j = JSON.stringify({ w: S.W, h: S.H, c: S.canvas.toJSON(PROPS_EXTRA) });
  if (S.hist[S.hpos] === j) return;
  S.hist = S.hist.slice(0, S.hpos + 1); S.hist.push(j); if (S.hist.length > 60) S.hist.shift();
  S.hpos = S.hist.length - 1;
}
function restoreHistory(pos) {
  if (pos < 0 || pos >= S.hist.length) return;
  S.hpos = pos; S.loading = true;
  const bg = S.canvas.backgroundImage, ov = S.canvas.overlayImage, clip = S.canvas.clipPath;
  const h = JSON.parse(S.hist[pos]);
  S.canvas.loadFromJSON(h.c, () => {
    S.canvas.backgroundImage = bg; S.canvas.overlayImage = ov; S.canvas.clipPath = clip;
    if (h.w && (h.w !== S.W || h.h !== S.H)) { applyCanvasSize(h.w, h.h); fitZoom(); updateUV(); }
    S.loading = false; S.canvas.requestRenderAll(); renderLayers(); showProps(); scheduleLive();
  });
}
$('#btn-undo').onclick = () => restoreHistory(S.hpos - 1);
$('#btn-redo').onclick = () => restoreHistory(S.hpos + 1);

// ------------------------------------------------------------------ añadir objetos
const DEF = () => ({ fill: libC1() || '#ffffff', stroke: null, strokeWidth: 0, originX: 'center', originY: 'center', left: S.W / 2, top: S.H / 2 });
function add(obj, name, kind) {
  obj.set({ name, kind }); S.canvas.add(obj); S.canvas.setActiveObject(obj); S.canvas.requestRenderAll();
}
function starPoints(n, r1, r2) {
  const p = []; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = (Math.PI * i) / n - Math.PI / 2; p.push({ x: r * Math.cos(a), y: r * Math.sin(a) }); } return p;
}
const ADD = {
  base: () => add(new fabric.Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width: S.W, height: S.H, fill: '#c81e1e', selectable: true, lockMovementX: true, lockMovementY: true, hasControls: false }), 'Color base', 'base'),
  rect: () => add(new fabric.Rect({ ...DEF(), width: S.W / 4, height: S.H / 8 }), 'Rectángulo', 'shape'),
  circle: () => add(new fabric.Circle({ ...DEF(), radius: S.W / 12 }), 'Círculo', 'shape'),
  ring: () => add(new fabric.Circle({ ...DEF(), radius: S.W / 12, fill: '', stroke: $('#brush-color').value, strokeWidth: S.W / 100 }), 'Anillo', 'shape'),
  triangle: () => add(new fabric.Triangle({ ...DEF(), width: S.W / 6, height: S.H / 6 }), 'Triángulo', 'shape'),
  stripe: () => add(new fabric.Rect({ ...DEF(), width: S.W, height: S.H / 30 }), 'Franja', 'shape'),
  star: () => add(new fabric.Polygon(starPoints(5, S.W / 12, S.W / 30), { ...DEF() }), 'Estrella', 'shape'),
  chevron: () => { const w = S.W / 6, h = S.H / 10, t = h * 0.45; add(new fabric.Polygon([{ x: 0, y: h }, { x: w / 2, y: 0 }, { x: w, y: h }, { x: w - t, y: h }, { x: w / 2, y: t }, { x: t, y: h }], { ...DEF() }), 'Chevrón', 'shape'); },
  text: () => add(new fabric.IText('TEXTO', { ...DEF(), fontFamily: 'Impact', fontSize: S.W / 12, fill: '#ffffff' }), 'Texto', 'text'),
  number: () => { const sk = S.skins.find((s) => s.id === S.skin); add(new fabric.IText(String(sk?.meta?.number || '7'), { ...DEF(), fontFamily: 'Arial Black', fontWeight: 'bold', fontSize: S.W / 6, fill: '#ffffff', stroke: '#000000', strokeWidth: S.W / 200 }), 'Dorsal', 'text'); },
  image: () => $('#file-decal').click(),
  brush: () => toggleBrush(),
};
for (const b of $$('[data-add]')) b.onclick = () => { if (!S.canvas) return; if (S.canvas.isDrawingMode && b.dataset.add !== 'brush') toggleBrush(false); ADD[b.dataset.add](); };

function toggleBrush(force) {
  const c = S.canvas; const on = force === undefined ? !c.isDrawingMode : force;
  c.isDrawingMode = on; $('#btn-brush').classList.toggle('active', on); $('#brush-opts').hidden = !on;
  if (on) { c.freeDrawingBrush = new fabric.PencilBrush(c); c.freeDrawingBrush.width = +$('#brush-size').value; c.freeDrawingBrush.color = $('#brush-color').value; }
}
$('#brush-size').oninput = (e) => { if (S.canvas?.freeDrawingBrush) S.canvas.freeDrawingBrush.width = +e.target.value; };
$('#brush-color').oninput = (e) => { if (S.canvas?.freeDrawingBrush) S.canvas.freeDrawingBrush.color = e.target.value; };

// ------------------------------------------------------------------ biblioteca: vinilos, texturas, imágenes
const libC1 = () => $('#lib-c1').value, libC2 = () => $('#lib-c2').value;
function checkerSvg(c1, c2, n = 8) {
  let r = ''; const s = 200 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n / 2; j++) r += `<rect x="${i * s}" y="${j * s}" width="${s}" height="${s}" fill="${(i + j) % 2 ? c2 : c1}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${r}</svg>`;
}
const VINYLS = {
  flames: { label: 'Llamas', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 100"><path fill="${b}" d="M0 100 L0 60 C20 70 30 40 40 30 C45 55 60 60 70 35 C80 60 95 55 100 20 C110 50 125 55 135 25 C145 55 165 60 175 30 C185 50 200 50 205 15 C215 45 230 55 240 40 L240 100 Z"/><path fill="${a}" d="M0 100 L0 75 C20 80 30 60 42 52 C48 70 62 72 72 55 C82 72 96 68 104 45 C112 65 126 68 136 48 C146 68 164 70 176 52 C186 66 200 62 208 42 C218 62 230 66 240 58 L240 100 Z"/></svg>` },
  lightning: { label: 'Rayo', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><polygon fill="${b}" points="58,0 10,110 46,110 30,200 92,80 56,80 76,0"/><polygon fill="${a}" points="56,8 20,104 52,104 40,176 80,86 48,86 66,8"/></svg>` },
  arrow: { label: 'Flecha', svg: (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><polygon fill="${a}" points="0,30 120,30 120,0 200,50 120,100 120,70 0,70"/></svg>` },
  chevrons: { label: 'Chevrones', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><polygon fill="${a}" points="0,0 40,0 90,50 40,100 0,100 50,50"/><polygon fill="${b}" points="55,0 95,0 145,50 95,100 55,100 105,50"/><polygon fill="${a}" points="110,0 150,0 200,50 150,100 110,100 160,50"/></svg>` },
  checker: { label: 'Bandera a cuadros', svg: (a, b) => checkerSvg(a, b) },
  stripes2: { label: 'Doble franja', svg: (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect x="14" y="0" width="28" height="200" fill="${a}"/><rect x="58" y="0" width="28" height="200" fill="${a}"/></svg>` },
  stripes3: { label: 'Franja con filetes', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200"><rect x="8" y="0" width="6" height="200" fill="${b}"/><rect x="22" y="0" width="56" height="200" fill="${a}"/><rect x="86" y="0" width="6" height="200" fill="${b}"/></svg>` },
  swoosh: { label: 'Swoosh', svg: (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path fill="${a}" d="M0 80 C60 20 160 0 300 10 C180 20 100 45 40 95 Z"/></svg>` },
  wave: { label: 'Onda', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path fill="${a}" d="M0 50 C50 0 100 0 150 50 C200 100 250 100 300 50 L300 75 C250 125 200 125 150 75 C100 25 50 25 0 75 Z"/><path fill="${b}" d="M0 30 C50 -20 100 -20 150 30 C200 80 250 80 300 30 L300 45 C250 95 200 95 150 45 C100 -5 50 -5 0 45 Z"/></svg>` },
  speed: { label: 'Líneas de velocidad', svg: (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><polygon fill="${a}" points="0,10 300,4 300,14"/><polygon fill="${a}" points="40,30 300,26 300,36"/><polygon fill="${a}" points="0,52 300,48 300,58"/><polygon fill="${a}" points="80,74 300,70 300,80"/><polygon fill="${a}" points="20,94 300,90 300,100"/></svg>` },
  tribal: { label: 'Tribal', svg: (a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><path fill="${a}" d="M0 60 C40 20 80 20 120 55 C150 80 180 80 210 50 C240 20 270 20 300 40 C270 30 245 40 220 70 C185 105 145 105 110 70 C80 40 45 45 0 60 Z M150 10 C170 30 175 50 160 65 C185 55 190 30 150 10 Z M60 90 C90 110 130 110 160 95 C130 118 85 118 60 90 Z"/></svg>` },
  diamond: { label: 'Rombo', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon fill="${b}" points="50,0 100,50 50,100 0,50"/><polygon fill="${a}" points="50,14 86,50 50,86 14,50"/></svg>` },
  shield: { label: 'Escudo', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120"><path fill="${b}" d="M50 0 L100 18 L94 70 C90 95 70 110 50 120 C30 110 10 95 6 70 L0 18 Z"/><path fill="${a}" d="M50 12 L88 26 L83 68 C80 88 65 100 50 108 C35 100 20 88 17 68 L12 26 Z"/></svg>` },
  plate: { label: 'Placa de dorsal', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><rect x="2" y="2" width="116" height="96" rx="14" fill="${b}"/><rect x="8" y="8" width="104" height="84" rx="10" fill="${a}"/></svg>` },
  circle: { label: 'Círculo de dorsal', svg: (a, b) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="49" fill="${b}"/><circle cx="50" cy="50" r="44" fill="${a}"/></svg>` },
  stars: { label: 'Estrellas', svg: (a) => { const st = (cx, cy, r) => { let p = ''; for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.4 : r, an = Math.PI * i / 5 - Math.PI / 2; p += `${(cx + rr * Math.cos(an)).toFixed(1)},${(cy + rr * Math.sin(an)).toFixed(1)} `; } return `<polygon fill="${a}" points="${p}"/>`; }; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">${st(40, 50, 40)}${st(120, 50, 30)}${st(185, 50, 22)}${st(235, 50, 16)}${st(272, 50, 11)}</svg>`; } },
  hazard: { label: 'Rayas de peligro', svg: (a, b) => { let r = `<rect width="300" height="60" fill="${b}"/>`; for (let x = -60; x < 300; x += 60) r += `<polygon fill="${a}" points="${x},60 ${x + 30},60 ${x + 90},0 ${x + 60},0"/>`; return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60">${r}</svg>`; } },
  sun: { label: 'Sol / rayos', svg: (a) => { let r = ''; for (let i = 0; i < 16; i++) { const an = Math.PI * 2 * i / 16, an2 = an + Math.PI / 16; r += `<polygon fill="${a}" points="50,50 ${(50 + 50 * Math.cos(an)).toFixed(1)},${(50 + 50 * Math.sin(an)).toFixed(1)} ${(50 + 50 * Math.cos(an2)).toFixed(1)},${(50 + 50 * Math.sin(an2)).toFixed(1)}"/>`; } return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${r}<circle cx="50" cy="50" r="18" fill="${a}"/></svg>`; } },
  halftone: { label: 'Degradado de puntos', svg: (a) => { let r = ''; for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) { const rad = 11 * (1 - i / 12); if (rad > 0.5) r += `<circle cx="${12 + i * 25}" cy="${12 + j * 25}" r="${rad.toFixed(1)}" fill="${a}"/>`; } return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">${r}</svg>`; } },
};
let LIB = { tab: 'vinyls', patterns: [], images: [], skinDecals: [] };
S.armed = null;

function patUrl(name, c1, c2) { return `/api/pattern/${enc(name)}.png?c1=${enc(c1)}&c2=${enc(c2)}&size=512`; }
function libImgUrl(name) { return `/api/library/${enc(name)}`; }
function decalUrl(name) { return `/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/decal/${enc(name)}`; }

async function loadLibrary() {
  try { LIB.patterns = await api('/api/patterns'); } catch (e) { LIB.patterns = []; }
  $('#p-pattern').innerHTML = '<option value="">— color liso —</option>' + LIB.patterns.map((p) => `<option value="${p.name}">${esc(p.label)}</option>`).join('');
  await refreshImages();
  renderLibrary();
}
async function refreshImages() {
  try { LIB.images = await api('/api/library'); } catch (e) { LIB.images = []; }
  try { LIB.skinDecals = S.car && S.skin ? await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/decals`) : []; } catch (e) { LIB.skinDecals = []; }
}
function renderLibrary() {
  const c1 = libC1(), c2 = libC2(); let html = '';
  if (LIB.tab === 'vinyls') html = Object.entries(VINYLS).map(([k, v]) => `<div class="item" data-type="vinyl" data-n="${k}" title="${esc(v.label)}">${v.svg(c1, c2)}</div>`).join('');
  else if (LIB.tab === 'patterns') html = LIB.patterns.map((p) => `<div class="item" data-type="pattern" data-n="${p.name}" title="${esc(p.label)}" style="background-image:url('${patUrl(p.name, c1, c2)}');background-size:cover"></div>`).join('');
  else html = `<div class="item" data-type="upload" title="Subir imágenes (PNG con transparencia, JPG, SVG)" style="font-size:22px;display:flex;align-items:center;justify-content:center">＋</div>` +
    LIB.images.map((n) => `<div class="item" data-type="image" data-n="${esc(n)}" title="${esc(n)}" style="background-image:url('${libImgUrl(n)}')"><button class="del" title="Borrar de la biblioteca">×</button></div>`).join('') +
    LIB.skinDecals.map((n) => `<div class="item" data-type="decal" data-n="${esc(n)}" title="${esc(n)} (de esta skin)" style="background-image:url('${decalUrl(n)}')"></div>`).join('');
  $('#lib-list').innerHTML = html || '<span class="hint">vacío</span>';
  for (const el of $$('#lib-list .item')) {
    el.onclick = () => libClick(el.dataset.type, el.dataset.n, el);
    if (el.dataset.type !== 'upload') {
      el.draggable = true;
      el.ondragstart = (e) => { e.dataTransfer.setData('text/acpaint', JSON.stringify({ type: el.dataset.type, name: el.dataset.n })); e.dataTransfer.effectAllowed = 'copy'; };
    }
    const del = el.querySelector('.del');
    if (del) del.onclick = async (e) => { e.stopPropagation(); if (!confirm(`¿Borrar ${el.dataset.n} de la biblioteca?`)) return; await api(libImgUrl(el.dataset.n), { method: 'DELETE' }); await refreshImages(); renderLibrary(); };
  }
  for (const b of $$('[data-lib]')) b.classList.toggle('active', b.dataset.lib === LIB.tab);
}
for (const b of $$('[data-lib]')) b.onclick = () => { LIB.tab = b.dataset.lib; renderLibrary(); };
$('#lib-c1').oninput = renderLibrary; $('#lib-c2').oninput = renderLibrary;

function libClick(type, name, el) {
  if (!S.canvas) return;
  if (type === 'upload') return $('#file-decal').click();
  const sel = S.canvas.getActiveObject();
  if (type === 'pattern' && sel && sel.type !== 'i-text' && sel.kind !== 'image') { applyPattern(sel, name, +$('#p-patscale').value || 1); showProps(); return; }
  if ($('#chk-place3d').checked) {
    S.armed = { type, name }; for (const x of $$('#lib-list .item')) x.classList.toggle('armed', x === el);
    $('#viewer').classList.add('armed'); status('Haz clic sobre el coche en 3D para colocar ' + name); return;
  }
  addFromLibrary(type, name);
}
function disarm() { S.armed = null; $('#viewer').classList.remove('armed'); $('#v3d').classList.remove('place'); for (const x of $$('#lib-list .item')) x.classList.remove('armed'); }

/** Añade un elemento de la biblioteca al lienzo centrado en (x, y) (por defecto el centro). */
function addFromLibrary(type, name, x = S.W / 2, y = S.H / 2, cb) {
  const c1 = libC1(), c2 = libC2();
  if (type === 'vinyl') {
    fabric.loadSVGFromString(VINYLS[name].svg(c1, c2), (objs, opts) => {
      const g = fabric.util.groupSVGElements(objs, opts);
      const s = (S.W / 4) / g.width; g.set({ originX: 'center', originY: 'center', left: x, top: y, scaleX: s, scaleY: s });
      add(g, VINYLS[name].label, 'vinyl'); cb && cb(g);
    });
  } else if (type === 'pattern') {
    const r = new fabric.Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width: S.W, height: S.H, fill: c1 });
    add(r, 'Textura ' + name, 'shape'); applyPattern(r, name, 1); cb && cb(r);
  } else {
    const url = type === 'decal' ? decalUrl(name) : libImgUrl(name);
    fabric.Image.fromURL(url, (img) => {
      if (!img || !img.width) return toast('No se pudo cargar ' + name, true);
      const s = Math.min(1, (S.W / 4) / img.width); img.set({ originX: 'center', originY: 'center', left: x, top: y, scaleX: s, scaleY: s });
      add(img, name, 'image'); cb && cb(img);
    }, { crossOrigin: 'anonymous' });
  }
}
function fillTargets(o) { return o.type === 'group' ? o.getObjects().flatMap(fillTargets) : o.type === 'activeSelection' ? o.getObjects().flatMap(fillTargets) : [o]; }
function applyPattern(obj, name, scale) {
  if (!name) { for (const t of fillTargets(obj)) t.set('fill', libC1()); obj.pat = null; S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); return; }
  new fabric.Pattern({ source: patUrl(name, libC1(), libC2()), repeat: 'repeat', patternTransform: [scale, 0, 0, scale, 0, 0] }, (pat) => {
    for (const t of fillTargets(obj)) t.set('fill', pat);
    obj.pat = name; obj.patScale = scale; obj.grad = null; obj.dirty = true;
    S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); S.dirty = true;
  });
}
function applyGradient(obj, mode, c2) {
  const c1 = typeof obj.fill === 'string' && obj.fill ? obj.fill : libC1();
  let g;
  if (!mode) { for (const t of fillTargets(obj)) t.set('fill', c1); obj.grad = null; }
  else {
    const stops = [{ offset: 0, color: c1 }, { offset: 1, color: c2 }];
    if (mode === 'radial') g = new fabric.Gradient({ type: 'radial', gradientUnits: 'percentage', coords: { x1: 0.5, y1: 0.5, r1: 0, x2: 0.5, y2: 0.5, r2: 0.7 }, colorStops: stops });
    else { const a = +mode * Math.PI / 180; g = new fabric.Gradient({ type: 'linear', gradientUnits: 'percentage', coords: { x1: 0, y1: 0, x2: Math.cos(a), y2: Math.sin(a) }, colorStops: stops }); }
    for (const t of fillTargets(obj)) t.set('fill', g);
    obj.grad = mode; obj.grad2 = c2; obj.pat = null;
  }
  obj.dirty = true; S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); S.dirty = true;
}

// subida de imágenes (botón, arrastrar/soltar, pegar)
$('#file-decal').onchange = async (e) => { await uploadImages([...e.target.files]); e.target.value = ''; };
async function uploadImages(files, x, y) {
  const added = [];
  for (const f of files) {
    if (!/^image\//.test(f.type) && !/\.svg$/i.test(f.name)) continue;
    try {
      const r = await api(`/api/library?name=${enc(f.name || 'pegada.png')}`, { method: 'POST', body: await f.arrayBuffer() });
      added.push(r.name);
    } catch (err) { toast(err.message, true); }
  }
  await refreshImages(); LIB.tab = 'images'; renderLibrary();
  added.forEach((n, i) => addFromLibrary('image', n, (x ?? S.W / 2) + i * 40, (y ?? S.H / 2) + i * 40));
  return added;
}
function setupDrops() {
  const wrap = $('#canvas-wrap'), viewer = $('#viewer');
  for (const el of [wrap, viewer]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); el.classList.remove('dragover'); if (!S.canvas) return;
      const lib = e.dataTransfer.getData('text/acpaint');
      if (lib) {
        const a = JSON.parse(lib);
        if (el === wrap) { const p = S.canvas.getPointer(e); addFromLibrary(a.type, a.name, p.x, p.y); }
        else { const uv = pickUV(e); if (!uv) return status('Suelta el vinilo sobre una pieza del coche que use la textura en edición'); placeOnCar(a.type, a.name, uv, () => pushHistory()); }
        return;
      }
      const files = [...e.dataTransfer.files]; if (!files.length) return;
      let x, y;
      if (el === wrap) { const p = S.canvas.getPointer(e); x = p.x; y = p.y; }
      else { const uv = pickUV(e); if (uv) { x = uv.x; y = uv.y; } }
      uploadImages(files, x, y);
    });
  }
  document.addEventListener('paste', (e) => {
    if (!S.canvas || $('#view-editor').hidden) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); uploadImages(files.map((f, i) => new File([f], f.name || `pegada_${Date.now()}_${i}.png`, { type: f.type }))); }
  });
}
setupDrops();

// ------------------------------------------------------------------ interacción con el coche 3D (estilo Forza)
const RAY = new THREE.Raycaster();
const movable = (o) => !!o && o.kind !== 'base' && !o.locked && !o.lockMovementX;
function liveMeshes() { const m = []; V.model.traverse((o) => { if (o.isMesh && o.material.userData?.live) m.push(o); }); return m; }
/** Punto de la textura (píxeles) bajo el cursor, sólo sobre mallas que usan la textura en edición. */
function pickUV(e) {
  if (!V.model || !S.W) return null;
  const cv = $('#v3d'); const r = cv.getBoundingClientRect();
  RAY.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), V.camera);
  const hit = RAY.intersectObjects(liveMeshes(), false).find((h) => h.uv);
  if (!hit) return null;
  return { x: hit.uv.x * S.W, y: hit.uv.y * S.H, hit };
}
/** Marco local de la superficie en el triángulo tocado: cómo se ve un vector del mundo en píxeles de la
 *  textura. Devuelve {angle, flipY, pxPerM} para que un vinilo salga derecho respecto a la cámara y con su
 *  tamaño real en el coche, o null si las UV del triángulo son degeneradas. */
function surfaceFrame(hit) {
  const g = hit.object.geometry, pos = g.attributes.position, uv = g.attributes.uv, f = hit.face;
  if (!f || !uv) return null;
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld);
  const p0 = P(f.a), p1 = P(f.b), p2 = P(f.c);
  const u0 = uv.getX(f.a), v0 = uv.getY(f.a);
  const du1 = uv.getX(f.b) - u0, dv1 = uv.getY(f.b) - v0, du2 = uv.getX(f.c) - u0, dv2 = uv.getY(f.c) - v0;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-12) return null;
  const e1 = p1.clone().sub(p0), e2 = p2.clone().sub(p0);
  const T = e1.clone().multiplyScalar(dv2).sub(e2.clone().multiplyScalar(dv1)).divideScalar(det);   // dP/du
  const B = e2.clone().multiplyScalar(du1).sub(e1.clone().multiplyScalar(du2)).divideScalar(det);   // dP/dv
  const n = e1.clone().cross(e2).normalize();
  const TT = T.dot(T), TB = T.dot(B), BB = B.dot(B), G = TT * BB - TB * TB;
  if (!(G > 1e-18)) return null;
  // mínimos cuadrados: vector del mundo -> (du, dv) -> píxeles
  const toPx = (w) => { const a = T.dot(w), b = B.dot(w); return { x: ((BB * a - TB * b) / G) * S.W, y: ((TT * b - TB * a) / G) * S.H }; };
  const proj = (w) => w.sub(n.clone().multiplyScalar(w.dot(n)));
  let right = proj(new THREE.Vector3(1, 0, 0).applyQuaternion(V.camera.quaternion));
  let up = proj(new THREE.Vector3(0, 1, 0).applyQuaternion(V.camera.quaternion));
  if (right.lengthSq() < 1e-6) right = up.clone().cross(n);          // superficie vista de canto
  if (up.lengthSq() < 1e-6) up = n.clone().cross(right);
  right.normalize(); up.normalize();
  const r = toPx(right), u = toPx(up);
  const pxPerM = Math.hypot(r.x, r.y);
  if (!(pxPerM > 1e-6) || !isFinite(pxPerM)) return null;
  const angle = Math.atan2(r.y, r.x) * 180 / Math.PI;
  const flipY = (r.x * u.y - r.y * u.x) > 0;   // en la textura (y hacia abajo) "arriba" debe quedar a -90° de "derecha"; si no, la isla UV está en espejo
  return { angle, flipY, pxPerM };
}
/** Coloca un elemento de la biblioteca sobre el coche en el punto tocado: orientado como se ve desde la
 *  cámara (aunque la isla UV esté girada o en espejo) y con la anchura en cm elegida. */
function placeOnCar(type, name, uv, cb) {
  const fr = uv.hit ? surfaceFrame(uv.hit) : null;
  addFromLibrary(type, name, uv.x, uv.y, (obj) => {
    if (fr && type !== 'pattern') {
      const cm = +$('#lib-size3d').value || 50;
      const px = Math.min(S.W * 2, Math.max(4, (cm / 100) * fr.pxPerM));
      const sc = px / obj.width;
      obj.set({ scaleX: sc, scaleY: sc, angle: (fr.angle + 360) % 360, flipY: fr.flipY });
      obj.setCoords(); S.canvas.requestRenderAll(); scheduleLive();
    }
    cb && cb(obj);
  });
}
function objectAt(x, y) {
  const pt = new fabric.Point(x, y);
  const objs = S.canvas.getObjects().slice().reverse().filter((o) => o.visible && !o.locked && o.containsPoint(pt, null, true));
  return objs.find((o) => o.kind !== 'base') || objs[0];
}
function setup3DInteraction() {
  const cv = $('#v3d'); let drag = null, down = null, hoverT = 0, wheelT = null;
  const startDrag = (obj, uv, pointerId) => {
    drag = { obj, dx: obj.left - uv.x, dy: obj.top - uv.y, last: uv, moved: false, id: pointerId, evt: null, raf: 0 };
    V.controls.enabled = false; try { cv.setPointerCapture(pointerId); } catch (err) { /* */ }
    cv.classList.add('dragging');
  };
  const nudge = (o, fn) => { fn(o); o.setCoords(); S.canvas.requestRenderAll(); liveNow(); showProps(); S.dirty = true; clearTimeout(wheelT); wheelT = setTimeout(pushHistory, 400); };
  // en fase de captura: si empezamos a arrastrar una capa, OrbitControls (enabled=false) no orbita
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !S.canvas) return;
    down = { x: e.clientX, y: e.clientY };
    const uv = pickUV(e);
    if (!uv) return;                                   // fondo o pieza sin esta textura: orbitar
    if (S.armed) {
      const a = S.armed; if (!e.ctrlKey) disarm();
      V.controls.enabled = false; drag = { pending: e.pointerId };
      placeOnCar(a.type, a.name, uv, (obj) => {
        pushHistory(); status(`${obj.name || a.name} colocado en (${Math.round(uv.x)}, ${Math.round(uv.y)}) · arrástralo, Ctrl+rueda: tamaño, Mayús+rueda: girar`);
        if (drag && drag.pending !== undefined) startDrag(obj, uv, drag.pending);   // sigue pulsado: arrastra el recién colocado
      });
      return;
    }
    const act = S.canvas.getActiveObject();
    if (e.shiftKey && movable(act)) { act.set({ left: uv.x, top: uv.y }); act.setCoords(); S.canvas.requestRenderAll(); startDrag(act, uv, e.pointerId); drag.moved = true; return; }
    const o = objectAt(uv.x, uv.y);
    if (!o) { if (act) { S.canvas.discardActiveObject(); S.canvas.requestRenderAll(); } return; }
    if (act !== o) { S.canvas.setActiveObject(o); S.canvas.requestRenderAll(); status(`Capa: ${o.name || o.type}`); }
    if (movable(o)) startDrag(o, uv, e.pointerId);
  }, true);
  const processDrag = () => {
    if (!drag || !drag.obj) return;
    drag.raf = 0; const e = drag.evt; if (!e) return;
    const uv = pickUV(e); if (!uv) return;
    // salto grande en la textura = otra isla UV: el objeto pasa a quedar justo bajo el cursor
    if (Math.hypot(uv.x - drag.last.x, uv.y - drag.last.y) > 0.15 * Math.max(S.W, S.H)) { drag.dx = 0; drag.dy = 0; }
    drag.last = uv; drag.moved = true;
    drag.obj.set({ left: uv.x + drag.dx, top: uv.y + drag.dy }); drag.obj.setCoords(); S.canvas.requestRenderAll(); liveNow();
  };
  cv.addEventListener('pointermove', (e) => {
    if (drag && drag.obj) { drag.evt = e; if (!drag.raf) drag.raf = requestAnimationFrame(processDrag); return; }
    if (drag) return;
    const now = performance.now(); if (now - hoverT < 80) return; hoverT = now;
    if (S.armed) { cv.classList.add('place'); cv.classList.remove('over'); return; }
    cv.classList.remove('place');
    if (e.buttons || !S.canvas) return;
    const uv = pickUV(e); const o = uv && objectAt(uv.x, uv.y);
    cv.classList.toggle('over', movable(o));
  });
  const end = (e) => {
    if (drag) {
      if (drag.obj) {
        try { cv.releasePointerCapture(drag.id); } catch (err) { /* */ }
        if (drag.moved) { pushHistory(); S.dirty = true; showProps(); scheduleLive(); }
      }
      drag = null; down = null; V.controls.enabled = true; cv.classList.remove('dragging'); return;
    }
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4; down = null;
    if (moved || e.button !== 0 || !S.canvas) return;
    if (!pickUV(e) && S.canvas.getActiveObject()) { S.canvas.discardActiveObject(); S.canvas.requestRenderAll(); }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  // Ctrl+rueda: tamaño de la capa seleccionada · Mayús+rueda: girarla (sin modificador, OrbitControls hace zoom)
  cv.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.shiftKey) || !S.canvas) return;
    const o = S.canvas.getActiveObject(); if (!movable(o)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const up = (e.deltaY || e.deltaX) < 0;
    if (e.ctrlKey) nudge(o, (t) => { const f = up ? 1.08 : 1 / 1.08; t.set({ scaleX: t.scaleX * f, scaleY: t.scaleY * f }); });
    else nudge(o, (t) => t.rotate(((t.angle || 0) + (up ? -5 : 5) + 360) % 360));
  }, { capture: true, passive: false });
}
setup3DInteraction();

// ------------------------------------------------------------------ capas
const ICON = { base: '🎨', shape: '◆', text: 'T', image: '🖼', brush: '✏' };
function renderLayers() {
  const c = S.canvas; if (!c) return;
  const act = c.getActiveObjects();
  const objs = c.getObjects().slice().reverse();
  $('#layers').innerHTML = objs.map((o, i) => `
    <div class="layer ${act.includes(o) ? 'sel' : ''}" data-i="${objs.length - 1 - i}">
      <span class="ic">${ICON[o.kind] || '◆'}</span><span class="nm">${esc(o.name || o.type)}</span>
      <button class="eye ${o.visible ? '' : 'off'}" title="Visible">👁</button>
      <button class="lk" title="Bloquear">${o.locked ? '🔒' : ''}</button>
    </div>`).join('') || '<span class="hint">Sin capas: añade formas, texto o imágenes.</span>';
  for (const el of $$('#layers .layer')) {
    const o = c.getObjects()[+el.dataset.i];
    el.onclick = (e) => { if (!o.locked) { c.setActiveObject(o); c.requestRenderAll(); } };
    el.querySelector('.eye').onclick = (e) => { e.stopPropagation(); o.visible = !o.visible; c.requestRenderAll(); renderLayers(); scheduleLive(); pushHistory(); };
    el.querySelector('.lk').onclick = (e) => { e.stopPropagation(); setLocked(o, !o.locked); };
  }
}
function setLocked(o, v) {
  o.locked = v; o.selectable = !v; o.evented = !v;
  if (v && S.canvas.getActiveObject() === o) S.canvas.discardActiveObject();
  S.canvas.requestRenderAll(); renderLayers(); pushHistory();
}

// ------------------------------------------------------------------ propiedades
let propsObj = null;
function showProps() {
  const c = S.canvas; if (!c) return;
  const o = c.getActiveObject(); propsObj = o;
  $('#props-none').hidden = !!o; $('#props-body').hidden = !o; renderLayers();
  if (!o) return;
  const single = o.type !== 'activeSelection';
  $('#p-name').value = o.name || '';
  const f0 = fillTargets(o)[0] || o; const fill = typeof f0.fill === 'string' && f0.fill ? f0.fill : '';
  $('#p-pattern').value = o.pat || ''; $('#p-patscale').value = o.patScale || 1; $('#p-grad').value = o.grad || ''; if (o.grad2) $('#p-grad2').value = o.grad2;
  $('#p-nofill').checked = !fill; $('#p-fill').value = toHex(fill || '#ffffff');
  $('#p-stroke').value = toHex(o.stroke || '#000000'); $('#p-strokew').value = o.strokeWidth || 0;
  $('#p-opacity').value = o.opacity ?? 1; $('#p-blend').value = o.globalCompositeOperation || 'source-over';
  $('#p-left').value = Math.round(o.left); $('#p-top').value = Math.round(o.top);
  $('#p-width').value = Math.round(o.getScaledWidth()); $('#p-height').value = Math.round(o.getScaledHeight());
  $('#p-angle').value = Math.round(o.angle || 0);
  const isText = single && o.type === 'i-text';
  $('#props-text').hidden = !isText;
  if (isText) {
    $('#p-text').value = o.text; $('#p-font').value = o.fontFamily; $('#p-bold').checked = o.fontWeight === 'bold';
    $('#p-italic').checked = o.fontStyle === 'italic'; $('#p-spacing').value = o.charSpacing || 0;
  }
  $('#p-lock').textContent = o.locked ? '🔓' : '🔒';
}
function toHex(col) {
  if (/^#[0-9a-f]{6}$/i.test(col)) return col;
  try { const c = new fabric.Color(col).getSource(); return '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); } catch (e) { return '#ffffff'; }
}
function setProp(fn) {
  const o = propsObj; if (!o) return;
  const targets = o.type === 'activeSelection' ? o.getObjects() : [o];
  for (const t of targets) fn(t);
  if (fn.deep) for (const t of targets) for (const ch of fillTargets(t)) if (ch !== t) fn(ch);
  o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); S.dirty = true;
}
const P = (id) => $('#' + id);
P('p-name').onchange = (e) => setProp((t) => (t.name = e.target.value)) || renderLayers();
const deep = (fn) => { fn.deep = true; return fn; };
P('p-fill').oninput = (e) => { P('p-nofill').checked = false; setProp(deep((t) => { t.set('fill', e.target.value); t.pat = null; t.grad = null; t.dirty = true; })); P('p-pattern').value = ''; P('p-grad').value = ''; };
P('p-nofill').onchange = (e) => setProp(deep((t) => { t.set('fill', e.target.checked ? '' : P('p-fill').value); t.dirty = true; }));
P('p-pattern').onchange = (e) => { if (propsObj) applyPattern(propsObj, e.target.value, +P('p-patscale').value || 1); };
P('p-patscale').onchange = (e) => { if (propsObj && propsObj.pat) applyPattern(propsObj, propsObj.pat, +e.target.value || 1); };
P('p-grad').onchange = (e) => { if (propsObj) applyGradient(propsObj, e.target.value, P('p-grad2').value); };
P('p-grad2').oninput = (e) => { if (propsObj && propsObj.grad) applyGradient(propsObj, propsObj.grad, e.target.value); };
P('p-stroke').oninput = (e) => setProp(deep((t) => t.set('stroke', e.target.value)));
P('p-strokew').oninput = (e) => setProp(deep((t) => t.set({ stroke: t.stroke || P('p-stroke').value, strokeWidth: +e.target.value })));
P('p-opacity').oninput = (e) => setProp((t) => t.set('opacity', +e.target.value));
P('p-blend').onchange = (e) => setProp((t) => t.set('globalCompositeOperation', e.target.value));
P('p-left').onchange = (e) => { if (propsObj) { propsObj.set('left', +e.target.value); propsObj.setCoords(); S.canvas.requestRenderAll(); pushHistory(); } };
P('p-top').onchange = (e) => { if (propsObj) { propsObj.set('top', +e.target.value); propsObj.setCoords(); S.canvas.requestRenderAll(); pushHistory(); } };
P('p-angle').onchange = (e) => { if (propsObj) { propsObj.rotate(+e.target.value); propsObj.setCoords(); S.canvas.requestRenderAll(); pushHistory(); } };
P('p-width').onchange = (e) => sizeObj(+e.target.value, null);
P('p-height').onchange = (e) => sizeObj(null, +e.target.value);
function sizeObj(w, h) {
  const o = propsObj; if (!o) return;
  const keep = P('p-lockratio').checked;
  if (w) { const s = w / o.width; o.scaleX = s; if (keep) o.scaleY = s * (o.scaleY / o.scaleX || 1) || s; }
  if (h) { const s = h / o.height; o.scaleY = s; if (keep) o.scaleX = s; }
  if (keep && w) o.scaleY = o.scaleX; if (keep && h) o.scaleX = o.scaleY;
  o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); showProps();
}
P('p-text').oninput = (e) => setProp((t) => t.set('text', e.target.value));
P('p-font').onchange = (e) => setProp((t) => t.set('fontFamily', e.target.value));
P('p-bold').onchange = (e) => setProp((t) => t.set('fontWeight', e.target.checked ? 'bold' : 'normal'));
P('p-italic').onchange = (e) => setProp((t) => t.set('fontStyle', e.target.checked ? 'italic' : 'normal'));
P('p-spacing').onchange = (e) => setProp((t) => t.set('charSpacing', +e.target.value));
P('p-flipx').onclick = () => setProp((t) => t.set('flipX', !t.flipX));
P('p-flipy').onclick = () => setProp((t) => t.set('flipY', !t.flipY));
P('p-dup').onclick = duplicate;
P('p-mirror').onclick = () => duplicate(true);
P('p-up').onclick = () => { if (propsObj) { S.canvas.bringForward(propsObj); pushHistory(); renderLayers(); scheduleLive(); } };
P('p-down').onclick = () => { if (propsObj) { S.canvas.sendBackwards(propsObj); pushHistory(); renderLayers(); scheduleLive(); } };
P('p-lock').onclick = () => { if (propsObj) setLocked(propsObj, !propsObj.locked); };
P('p-del').onclick = deleteSel;
function deleteSel() {
  const c = S.canvas; const objs = c.getActiveObjects(); if (!objs.length) return;
  c.discardActiveObject(); for (const o of objs) c.remove(o); c.requestRenderAll();
}
function duplicate(mirror = false) {
  const o = propsObj; if (!o) return;
  o.clone((cl) => {
    cl.set({ name: (o.name || o.type) + (mirror ? ' (espejo)' : ' copia'), kind: o.kind });
    if (mirror) { cl.set({ flipX: !o.flipX, angle: -o.angle }); cl.set('left', S.W - o.left); }
    else cl.set({ left: o.left + 30, top: o.top + 30 });
    if (cl.type === 'activeSelection') { cl.canvas = S.canvas; cl.forEachObject((x) => S.canvas.add(x)); cl.setCoords(); }
    else S.canvas.add(cl);
    S.canvas.setActiveObject(cl); S.canvas.requestRenderAll();
  }, PROPS_EXTRA);
}

// atajos
document.addEventListener('keydown', (e) => {
  if (!S.canvas || $('#view-editor').hidden) return;
  const tag = document.activeElement?.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || S.canvas.getActiveObject()?.isEditing;
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveAll(); return; }
  if (typing) return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(S.hpos - 1); }
  else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); restoreHistory(S.hpos + 1); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (e.key === 'Escape') { disarm(); if (S.canvas.isDrawingMode) toggleBrush(false); S.canvas.discardActiveObject(); S.canvas.requestRenderAll(); }
  else if (['+', '-', '[', ']'].includes(e.key)) {
    const o = S.canvas.getActiveObject(); if (!movable(o)) return; e.preventDefault();
    if (e.key === '+' || e.key === '-') { const f = e.key === '+' ? 1.05 : 1 / 1.05; o.set({ scaleX: o.scaleX * f, scaleY: o.scaleY * f }); }
    else o.rotate(((o.angle || 0) + (e.key === ']' ? 5 : -5) + 360) % 360);
    o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); showProps();
  }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const o = S.canvas.getActiveObject(); if (!o) return; e.preventDefault();
    const d = e.shiftKey ? 10 : 1; o.set({ left: o.left + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), top: o.top + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0) });
    o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive();
  }
});

// ------------------------------------------------------------------ render de la textura
function renderTexture(scale = 1) {
  const c = S.canvas; const ov = c.overlayImage;
  c.overlayImage = null; S.inRender = true;      // toCanvasElement ya renderiza sin controles (interactive=false)
  const vpt = c.viewportTransform, zoom = c.getZoom();
  try { return c.toCanvasElement(scale / zoom, { left: vpt[4], top: vpt[5], width: S.W * zoom, height: S.H * zoom }); }
  finally { c.overlayImage = ov; S.inRender = false; }
}
let liveT = null, liveRAF = 0;
function scheduleLive() { clearTimeout(liveT); liveT = setTimeout(updateLive, 120); }
function liveNow() { if (!liveRAF) liveRAF = requestAnimationFrame(() => { liveRAF = 0; updateLive(); }); }
function updateLive() {
  if (!S.canvas || !V.liveTex || !S.W) return;
  const scale = Math.min(1, 1024 / Math.max(S.W, S.H));
  const el = renderTexture(scale);
  const act = S.noOutline ? null : S.canvas.getActiveObject();
  if (act && act.kind !== 'base') drawOutline(el, act, scale);
  V.liveTex.image = el; V.liveTex.needsUpdate = true;
}
/** Contorno de la capa seleccionada sobre el coche (sólo en la vista 3D, nunca en el DDS ni en la preview). */
function drawOutline(el, o, scale) {
  const k = o.aCoords || o.calcACoords(); const pts = [k.tl, k.tr, k.br, k.bl];
  const ctx = el.getContext('2d'); ctx.save(); ctx.beginPath();
  pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x * scale, p.y * scale)); ctx.closePath();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ff7a1a'; ctx.stroke(); ctx.restore();
}

// ------------------------------------------------------------------ guardar
async function saveAll() {
  if (!S.canvas || !S.tex) return;
  status('Guardando…'); $('#btn-save').disabled = true;
  try {
    const el = renderTexture(1);
    const blob = await new Promise((r) => el.toBlob(r, 'image/png'));
    const q = `?fmt=${enc($('#ed-fmt').value)}&keep_alpha=${$('#ed-keepalpha').checked ? 1 : 0}`;
    const r = await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/tex/${enc(S.tex)}${q}`, { method: 'PUT', body: blob });
    stashCurrent();
    await postJSON(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/project`, S.proj, 'PUT');
    S.dirty = false;
    status(`Guardado ${r.name} (${r.format}, ${(r.bytes / 1048576).toFixed(1)} MB)`); toast('Skin guardada: ' + r.name);
    const t = S.textures.find((x) => x.name === S.tex); if (t) t.in_skin = true;
  } catch (e) { toast('Error al guardar: ' + e.message, true); status(''); }
  $('#btn-save').disabled = false;
}
$('#btn-save').onclick = saveAll;
$('#btn-restore').onclick = async () => {
  if (!confirm(`¿Restaurar el ${S.tex} original de la skin (antes de la primera edición)?`)) return;
  try { await postJSON(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/restore/${enc(S.tex)}`, {}); toast('Original restaurado'); bind3DTexture(true); }
  catch (e) { toast(e.message, true); }
};
$('#btn-export-png').onclick = () => { const a = document.createElement('a'); a.href = renderTexture(1).toDataURL('image/png'); a.download = S.tex.replace(/\.dds$/i, '') + '.png'; a.click(); };
$('#btn-preview').onclick = async () => {
  if (!V.model) return toast('Aún no hay modelo 3D', true);
  S.noOutline = true; updateLive();
  try {
    const png = await render3DShot(1022, 576);
    await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/preview`, { method: 'PUT', body: png });
    const liv = await render3DShot(128, 128);
    await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/livery`, { method: 'PUT', body: liv });
    toast('preview.jpg y livery.png generados');
  } catch (e) { toast(e.message, true); }
  S.noOutline = false; updateLive();
};
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ================================================================== VISTA 3D
const V = { renderer: null, scene: null, camera: null, controls: null, model: null, liveTex: null, texLoader: null, mats: [], center: null, radius: 3 };
function init3D() {
  const cv = $('#v3d');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
  V.renderer = r;
  V.scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r); V.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  V.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  V.controls = new OrbitControls(V.camera, cv); V.controls.enableDamping = true; V.controls.autoRotateSpeed = 1.5;
  V.controls.maxPolarAngle = Math.PI / 2 + 0.05;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334, 0.6); V.scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(4, 8, 3); V.scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: 0x1d2028, roughness: 0.9, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.name = '__ground'; V.scene.add(ground);
  V.liveTex = new THREE.CanvasTexture(document.createElement('canvas'));
  V.liveTex.flipY = false; V.liveTex.colorSpace = THREE.SRGBColorSpace; V.liveTex.anisotropy = r.capabilities.getMaxAnisotropy();
  V.texLoader = new THREE.TextureLoader();
  resize3D();
  r.setAnimationLoop(() => { V.controls.update(); r.render(V.scene, V.camera); });
}
function resize3D() {
  if (!V.renderer) return;
  const el = $('#viewer'); const w = el.clientWidth, h = el.clientHeight;
  V.renderer.setSize(w, h, false); V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
}
async function load3DModel() {
  $('#v3d-status').textContent = 'cargando modelo…';
  try {
    const gltf = await new GLTFLoader().loadAsync(`/api/cars/${enc(S.car)}/model.glb`);
    V.model = gltf.scene; V.mats = [];
    V.model.traverse((m) => {
      if (!m.isMesh) return;
      const ex = m.material.userData || {}; const texs = ex.textures || {};
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.25, roughness: 0.45, side: THREE.DoubleSide,
        transparent: m.material.transparent, alphaTest: m.material.alphaTest || 0, envMapIntensity: 1.0 });
      mat.userData = { diffuse: texs.txDiffuse || null, shader: ex.shader };
      if (ex.shader && /Alpha|Glass|Refl/i.test(ex.shader) && !texs.txDiffuse) mat.transparent = true;
      if (m.userData.transparent) mat.transparent = true;
      if (mat.transparent) mat.depthWrite = false;
      m.material = mat; V.mats.push(mat);
      if (mat.userData.diffuse) loadMatTexture(mat, mat.userData.diffuse);
    });
    const box = new THREE.Box3().setFromObject(V.model); const size = box.getSize(new THREE.Vector3());
    V.center = box.getCenter(new THREE.Vector3()); V.radius = Math.max(size.x, size.y, size.z) / 2 || 2;
    const g = V.scene.getObjectByName('__ground'); g.position.y = box.min.y - 0.005; g.scale.setScalar(V.radius / 3);
    V.scene.add(V.model); setCam('iso'); bind3DTexture();
    $('#v3d-status').textContent = `${V.mats.length} materiales`;
  } catch (e) { $('#v3d-status').textContent = 'sin modelo 3D: ' + e.message; console.error(e); }
}
function loadMatTexture(mat, name) {
  V.texLoader.load(texUrl(name, 'skin'), (t) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = V.renderer.capabilities.getMaxAnisotropy();
    if (mat.userData.live) return;
    mat.map = t; mat.needsUpdate = true;
  }, undefined, () => { /* textura no disponible: se queda gris */ });
}
function bind3DTexture(reload = false) {
  for (const mat of V.mats) {
    const isLive = mat.userData.diffuse && S.tex && mat.userData.diffuse.toLowerCase() === S.tex.toLowerCase();
    if (isLive) { mat.userData.live = true; mat.map = V.liveTex; mat.needsUpdate = true; }
    else if (mat.userData.live || reload) { mat.userData.live = false; if (mat.userData.diffuse) loadMatTexture(mat, mat.userData.diffuse); }
  }
  updateLive();
}
function setCam(view) {
  if (!V.center) return;
  const c = V.center, r = V.radius * 2.6;
  const pos = { iso: [-r * 0.75, r * 0.45, r * 0.75], front: [0, r * 0.25, r], rear: [0, r * 0.25, -r], side: [-r, r * 0.2, 0], top: [0, r * 1.3, 0.01] }[view];
  V.camera.position.set(c.x + pos[0], c.y + pos[1], c.z + pos[2]); V.controls.target.copy(c); V.controls.update();
}
$('#btn-cam-front').onclick = () => setCam('front'); $('#btn-cam-rear').onclick = () => setCam('rear');
$('#btn-cam-side').onclick = () => setCam('side'); $('#btn-cam-top').onclick = () => setCam('top');
$('#btn-rot').onclick = (e) => { V.controls.autoRotate = !V.controls.autoRotate; e.target.classList.toggle('active', V.controls.autoRotate); };
async function render3DShot(w, h) {
  const r = V.renderer; const old = new THREE.Vector2(); r.getSize(old); const asp = V.camera.aspect;
  r.setSize(w, h, false); V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
  r.render(V.scene, V.camera);
  const blob = await new Promise((res) => r.domElement.toBlob(res, 'image/png'));
  r.setSize(old.x, old.y, false); V.camera.aspect = asp; V.camera.updateProjectionMatrix();
  return blob;
}

// ------------------------------------------------------------------ arranque
window.ACP = { S, V, fabric, THREE };   // acceso desde la consola / pruebas
loadSettings().then(route);
