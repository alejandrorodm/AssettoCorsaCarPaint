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
  proj: null, canvas: null, W: 0, H: 0, hist: [], hpos: -1, loading: false, dirty: false, uvImg: null };

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
const PROPS_EXTRA = ['name', 'locked', 'kind'];

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
  loadDecals();
  await load3DModel();
  if (first) { sel.value = first; await switchTexture(first); }
  else status('El coche no tiene texturas txDiffuse');
}

function closeEditor() {
  if (S.canvas) { stashCurrent(); S.canvas.dispose(); S.canvas = null; }
  S.tex = null; S.texInfo = null; S.proj = null; S.dirty = false;
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
  c.on('selection:created', showProps); c.on('selection:updated', showProps); c.on('selection:cleared', showProps);
  c.on('after:render', () => { if (!S.loading) scheduleLive(); });
  c.on('path:created', (o) => { o.path.set({ name: 'Trazo', kind: 'brush' }); renderLayers(); });
}
function onResize() {
  if (!S.canvas) return;
  const wrap = $('#canvas-wrap'); S.canvas.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
  resize3D();
}
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
}
$('#ed-texture').onchange = (e) => switchTexture(e.target.value);
$('#ed-base').onchange = async () => { await loadBase(); S.canvas.requestRenderAll(); S.dirty = true; };

function loadBase() {
  const c = S.canvas; const src = $('#ed-base').value;
  return new Promise((res) => {
    if (src === 'none') { c.setBackgroundImage(null, () => { c.requestRenderAll(); res(); }); return; }
    fabric.Image.fromURL(texUrl(S.tex, src), (img) => {
      if (!img || !img.width) { c.setBackgroundImage(null, res); return; }
      img.set({ scaleX: S.W / img.width, scaleY: S.H / img.height, originX: 'left', originY: 'top' });
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
  const j = JSON.stringify(S.canvas.toJSON(PROPS_EXTRA));
  if (S.hist[S.hpos] === j) return;
  S.hist = S.hist.slice(0, S.hpos + 1); S.hist.push(j); if (S.hist.length > 60) S.hist.shift();
  S.hpos = S.hist.length - 1;
}
function restoreHistory(pos) {
  if (pos < 0 || pos >= S.hist.length) return;
  S.hpos = pos; S.loading = true;
  const bg = S.canvas.backgroundImage, ov = S.canvas.overlayImage, clip = S.canvas.clipPath;
  S.canvas.loadFromJSON(S.hist[pos], () => {
    S.canvas.backgroundImage = bg; S.canvas.overlayImage = ov; S.canvas.clipPath = clip;
    S.loading = false; S.canvas.requestRenderAll(); renderLayers(); showProps(); scheduleLive();
  });
}
$('#btn-undo').onclick = () => restoreHistory(S.hpos - 1);
$('#btn-redo').onclick = () => restoreHistory(S.hpos + 1);

// ------------------------------------------------------------------ añadir objetos
const DEF = () => ({ fill: $('#brush-color').value || '#ffffff', stroke: null, strokeWidth: 0, originX: 'center', originY: 'center', left: S.W / 2, top: S.H / 2 });
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

$('#file-decal').onchange = async (e) => {
  for (const f of e.target.files) {
    try {
      const r = await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/decals?name=${enc(f.name)}`, { method: 'POST', body: await f.arrayBuffer() });
      addDecal(r.name);
    } catch (err) { toast(err.message, true); }
  }
  e.target.value = ''; loadDecals();
};
function decalUrl(name) { return `/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/decal/${enc(name)}`; }
function addDecal(name) {
  fabric.Image.fromURL(decalUrl(name), (img) => {
    const s = Math.min(1, (S.W / 4) / img.width); img.set({ ...DEF(), fill: undefined, scaleX: s, scaleY: s });
    add(img, name, 'image');
  }, { crossOrigin: 'anonymous' });
}
async function loadDecals() {
  try {
    const list = await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/decals`);
    $('#decal-list').innerHTML = list.map((n) => `<img src="${decalUrl(n)}" title="${esc(n)}" data-n="${esc(n)}">`).join('') || '<span class="hint">Sube PNG con "Imagen…" (logos, vinilos)</span>';
    for (const im of $$('#decal-list img')) im.onclick = () => addDecal(im.dataset.n);
  } catch (e) { /* */ }
}

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
  const fill = typeof o.fill === 'string' && o.fill ? o.fill : '';
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
  o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive(); S.dirty = true;
}
const P = (id) => $('#' + id);
P('p-name').onchange = (e) => setProp((t) => (t.name = e.target.value)) || renderLayers();
P('p-fill').oninput = (e) => { P('p-nofill').checked = false; setProp((t) => t.set('fill', e.target.value)); };
P('p-nofill').onchange = (e) => setProp((t) => t.set('fill', e.target.checked ? '' : P('p-fill').value));
P('p-stroke').oninput = (e) => setProp((t) => t.set('stroke', e.target.value));
P('p-strokew').oninput = (e) => setProp((t) => t.set({ stroke: t.stroke || P('p-stroke').value, strokeWidth: +e.target.value }));
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
  else if (e.key === 'Escape') { if (S.canvas.isDrawingMode) toggleBrush(false); S.canvas.discardActiveObject(); S.canvas.requestRenderAll(); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const o = S.canvas.getActiveObject(); if (!o) return; e.preventDefault();
    const d = e.shiftKey ? 10 : 1; o.set({ left: o.left + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), top: o.top + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0) });
    o.setCoords(); S.canvas.requestRenderAll(); pushHistory(); scheduleLive();
  }
});

// ------------------------------------------------------------------ render de la textura
function renderTexture(scale = 1) {
  const c = S.canvas; const ov = c.overlayImage; const act = c.getActiveObject();
  c.overlayImage = null; if (act) c.discardActiveObject();
  const vpt = c.viewportTransform, zoom = c.getZoom();
  const el = c.toCanvasElement(scale / zoom, { left: vpt[4], top: vpt[5], width: S.W * zoom, height: S.H * zoom });
  c.overlayImage = ov; if (act) c.setActiveObject(act); c.requestRenderAll();
  return el;
}
let liveT = null;
function scheduleLive() { clearTimeout(liveT); liveT = setTimeout(updateLive, 120); }
function updateLive() {
  if (!S.canvas || !V.liveTex || !S.W) return;
  const scale = Math.min(1, 1024 / Math.max(S.W, S.H));
  V.liveTex.image = renderTexture(scale); V.liveTex.needsUpdate = true;
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
  try {
    const png = await render3DShot(1022, 576);
    await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/preview`, { method: 'PUT', body: png });
    const liv = await render3DShot(128, 128);
    await api(`/api/cars/${enc(S.car)}/skins/${enc(S.skin)}/livery`, { method: 'PUT', body: liv });
    toast('preview.jpg y livery.png generados');
  } catch (e) { toast(e.message, true); }
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
loadSettings().then(route);
