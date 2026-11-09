import { FIREBASE_CONFIG } from './config.js';
import { LocalStore, FirebaseStore, newEventCode } from './store.js';
import { Coverage, decodePath, encodePath, distM, makeProjector, overpassQuery, parseOverpass } from './coverage.js';

const GROUPS = [
  ['Red', '#d93025'], ['Blue', '#1a73e8'], ['Gold', '#b58900'], ['Orange', '#e8710a'],
  ['Purple', '#9334e6'], ['Teal', '#12a4af'], ['Pink', '#e52592'], ['Black', '#202124'],
];
// Green is kept for covered streets, so no group is green.
const MIN_MOVE_M = 8; // record a trail point after moving this far
const MAX_ACC_M = 35; // ignore fixes rougher than this for the trail
const PRESENCE_MS = 10000; // how often your dot updates for others
const BREAK_MS = 120000; // a longer gap starts a new trail line
const BREAK_M = 150; // so does a jump this long
const STALE_MS = 120000; // dots fade after this long without news
const STREET_TODO = '#8a949c';
const STREET_DONE = '#1e8e3e';
const DONE_PCT = 0.9; // a street counts as done at 90% covered

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const prefs = {
  get(k) { try { return JSON.parse(localStorage.getItem('sdh:' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('sdh:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const store = FIREBASE_CONFIG ? new FirebaseStore(FIREBASE_CONFIG) : new LocalStore();

const S = {
  code: null, uid: null, me: null, meta: null, isOwner: false, metaSig: null, fitted: false,
  people: {}, markers: {}, tracks: {}, done: {}, cov: null, pieceLines: [],
  tracking: false, watchId: null, wake: null, run: 0, lastSent: null, lastFix: null, lastPresence: 0,
  drawing: null, sim: null,
};

// ---------- map ----------
const view = prefs.get('view');
const map = L.map('map', { zoomControl: false, renderer: L.canvas({ tolerance: 10 }) })
  .setView(view ? view.c : [37.978, -122.031], view ? view.z : 15);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const areaLayer = L.layerGroup().addTo(map);
const streetLayer = L.layerGroup().addTo(map);
const trailLayer = L.layerGroup().addTo(map);
const peopleLayer = L.layerGroup().addTo(map);
window.doorHangerMap = map; // handy for debugging from the browser console
map.on('moveend', () => prefs.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));

// ---------- messages ----------
let bannerTimer = null;
function banner(text, ms = 0) {
  $('banner').textContent = text;
  $('banner').hidden = !text;
  clearTimeout(bannerTimer);
  if (text && ms) bannerTimer = setTimeout(() => ($('banner').hidden = true), ms);
}
$('banner').addEventListener('click', () => ($('banner').hidden = true));

function joinError(text) {
  $('joinError').textContent = text;
  $('joinError').hidden = !text;
}

// ---------- people and trails ----------
const colorOf = (uid) => (S.people[uid] && S.people[uid].color) || '#555';
const isLive = (p) => p && p.active && p.t && Date.now() - p.t < STALE_MS;

function drawPerson(uid, p) {
  if (!p || p.lat == null) return;
  const live = isLive(p) || (uid === S.uid && S.tracking);
  const style = {
    radius: uid === S.uid ? 10 : 8, color: '#fff', weight: 3,
    fillColor: p.color || '#555', fillOpacity: live ? 1 : 0.35, opacity: live ? 1 : 0.5,
  };
  let m = S.markers[uid];
  if (!m) {
    m = S.markers[uid] = L.circleMarker([p.lat, p.lng], style).addTo(peopleLayer);
    m.bindTooltip('', { permanent: true, direction: 'top', offset: [0, -10], className: 'who-label' });
  }
  m.setLatLng([p.lat, p.lng]).setStyle(style);
  m.setTooltipContent(esc(p.name || 'Someone') + (uid === S.uid ? ' (you)' : ''));
}

function onPerson(uid, p) {
  if (!p) return;
  const colorChanged = S.people[uid] && S.people[uid].color !== p.color;
  S.people[uid] = p;
  if (uid !== S.uid || !S.tracking) drawPerson(uid, p);
  if (colorChanged && S.tracks[uid]) S.tracks[uid].lines.forEach((l) => l.setStyle({ color: p.color }));
  scheduleRefresh();
}

function joined(prev, pt) {
  return prev.r === pt.r && pt.t - prev.t < BREAK_MS && distM([prev.lat, prev.lng], [pt.lat, pt.lng]) < BREAK_M;
}

function onPoint(uid, key, pt) {
  if (!pt || pt.lat == null) return;
  const tr = (S.tracks[uid] = S.tracks[uid] || { pts: [], keys: new Set(), lines: [], dist: 0 });
  if (tr.keys.has(key)) return;
  tr.keys.add(key);
  const prev = tr.pts[tr.pts.length - 1];
  const ll = [pt.lat, pt.lng];
  const cont = prev && joined(prev, pt);
  if (cont) {
    tr.dist += distM([prev.lat, prev.lng], ll);
    tr.lines[tr.lines.length - 1].addLatLng(ll);
  } else {
    tr.lines.push(L.polyline([ll], { color: colorOf(uid), weight: 4, opacity: 0.8, interactive: false }).addTo(trailLayer));
  }
  tr.pts.push(pt);
  if (S.cov) recolor(cont ? S.cov.addStep([prev.lat, prev.lng], ll) : S.cov.addPoint(ll));
  scheduleRefresh();
}

// ---------- streets and coverage ----------
function rebuildCoverage() {
  const area = S.meta.area ? decodePath(S.meta.area) : null;
  areaLayer.clearLayers();
  if (area) L.polygon(area, { color: '#1f5130', weight: 2, fill: false, dashArray: '6 6', interactive: false }).addTo(areaLayer);
  S.cov = S.meta.streets ? new Coverage(S.meta.streets, area) : null;
  if (S.cov) {
    for (const wayId of Object.keys(S.done)) S.cov.setWayDone(wayId, true);
    for (const tr of Object.values(S.tracks)) {
      tr.pts.forEach((pt, i) => {
        const prev = tr.pts[i - 1];
        if (prev && joined(prev, pt)) S.cov.addStep([prev.lat, prev.lng], [pt.lat, pt.lng]);
        else S.cov.addPoint([pt.lat, pt.lng]);
      });
    }
  }
  drawStreets();
  if (area && !S.fitted) {
    S.fitted = true;
    map.fitBounds(L.latLngBounds(area), { padding: [20, 20] });
  }
}

function drawStreets() {
  streetLayer.clearLayers();
  S.pieceLines = [];
  if (!S.cov) return;
  S.pieceLines = S.cov.pieces.map((pc, idx) =>
    L.polyline([pc.a, pc.b], { color: S.cov.isCovered(idx) ? STREET_DONE : STREET_TODO, weight: 7, opacity: 0.85 })
      .on('click', (e) => streetPopup(pc.wayId, e.latlng))
      .addTo(streetLayer));
}

function recolor(idxs) {
  for (const idx of idxs) {
    const line = S.pieceLines[idx];
    if (line) line.setStyle({ color: S.cov.isCovered(idx) ? STREET_DONE : STREET_TODO });
  }
  if (idxs.length) scheduleRefresh();
}

function streetPopup(wayId, latlng) {
  const w = S.cov.wayStats(wayId);
  const el = document.createElement('div');
  el.innerHTML = `<strong>${esc(w.name)}</strong><br>${Math.round(w.pct * 100)}% covered by GPS trails` +
    (w.done ? `<br>Marked done by ${esc((S.done[wayId] || {}).by || 'someone')}` : '');
  const btn = document.createElement('button');
  btn.textContent = w.done ? 'Undo "done"' : 'Mark this street section done';
  btn.onclick = () => {
    store.setDone(wayId, w.done ? null : { by: S.me.name, t: Date.now() });
    map.closePopup();
  };
  el.append(document.createElement('br'), btn);
  L.popup().setLatLng(latlng).setContent(el).openOn(map);
}

function onDone(wayId, v) {
  if (v) S.done[wayId] = v; else delete S.done[wayId];
  if (S.cov) recolor(S.cov.setWayDone(wayId, !!v));
}

// ---------- summary and menu lists ----------
let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => { refreshQueued = false; refresh(); }, 400);
}

function refresh() {
  const out = Object.values(S.people).filter(isLive).length + (S.tracking && !isLive(S.people[S.uid]) ? 1 : 0);
  const km = Object.values(S.tracks).reduce((a, t) => a + t.dist, 0) / 1000;
  let cov = 'No area set yet';
  if (S.cov) cov = `${Math.round(S.cov.stats().pct * 100)}% of streets covered`;
  $('summary').textContent = `${cov} · ${out} out now · ${km.toFixed(1)} km walked`;
  if (!$('menu').hidden) renderMenu();
}

function ago(t) {
  if (!t) return 'not started';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function renderMenu() {
  const people = Object.entries(S.people).sort(([, a], [, b]) => (isLive(b) - isLive(a)) || (a.name || '').localeCompare(b.name || ''));
  const ul = document.createElement('ul');
  ul.className = 'list';
  for (const [uid, p] of people) {
    const li = document.createElement('li');
    const km = ((S.tracks[uid] && S.tracks[uid].dist) || 0) / 1000;
    li.innerHTML = `<span class="dot" style="background:${esc(p.color)}"></span><div class="grow">` +
      `<div class="name">${esc(p.name)}${uid === S.uid ? ' (you)' : ''}</div>` +
      `<div class="muted small">${esc(p.group)} · ${isLive(p) ? 'walking now' : 'last seen ' + ago(p.t)} · ${km.toFixed(2)} km</div></div>`;
    li.onclick = () => { if (p.lat != null) { closeMenu(); map.setView([p.lat, p.lng], 18); } };
    ul.append(li);
  }
  $('tab-people').replaceChildren(people.length ? ul : Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Nobody has joined yet.' }));

  const box = $('tab-streets');
  if (!S.cov) {
    box.innerHTML = '<p class="muted">The organizer sets the area on the Event tab, and the streets inside it are listed here.</p>';
    return;
  }
  // OpenStreetMap often splits one street into several pieces; list by name.
  const byName = new Map();
  for (const w of S.cov.stats().ways) {
    const g = byName.get(w.name) || { name: w.name, len: 0, covered: 0, ways: [] };
    g.len += w.len; g.covered += w.covered; g.ways.push(w.wayId);
    byName.set(w.name, g);
  }
  const groups = [...byName.values()].sort((a, b) => (b.len - b.covered) - (a.len - a.covered));
  const left = groups.filter((g) => g.covered / g.len < DONE_PCT);
  const list = document.createElement('ul');
  list.className = 'list';
  for (const g of left) {
    const li = document.createElement('li');
    const pct = Math.round((g.covered / g.len) * 100);
    li.innerHTML = `<div class="grow"><div class="name">${esc(g.name)}</div>` +
      `<div class="muted small">${pct}% covered · ${Math.round(g.len - g.covered)} m to go</div>` +
      `<div class="bar"><div style="width:${pct}%"></div></div></div>`;
    li.onclick = () => {
      const pts = g.ways.flatMap((id) => S.cov.ways[id].pieces.flatMap((i) => [S.cov.pieces[i].a, S.cov.pieces[i].b]));
      closeMenu();
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
    };
    list.append(li);
  }
  const head = document.createElement('p');
  head.className = 'muted';
  head.textContent = `${groups.length - left.length} of ${groups.length} streets done. Tap a street on the map to mark it done by hand (for when GPS missed it).`;
  box.replaceChildren(head, list);
}

function openMenu(tab) {
  $('menu').hidden = false;
  if (tab) showTab(tab);
  renderMenu();
}
function closeMenu() { $('menu').hidden = true; }
function showTab(name) {
  document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  ['people', 'streets', 'event'].forEach((t) => ($('tab-' + t).hidden = t !== name));
}
$('menuBtn').onclick = () => openMenu();
$('menuClose').onclick = closeMenu;
document.querySelectorAll('.tabs [data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- tracking ----------
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      S.wake = await navigator.wakeLock.request('screen');
      return;
    }
  } catch { /* fall through */ }
  banner('This phone could not keep the screen on by itself. Set Auto-Lock to Never while you walk, or the trail stops when the screen locks.');
}

function setTrackUi() {
  $('trackBtn').textContent = S.tracking ? 'Stop' : prefs.get('tracking') === S.code ? 'Resume door hangers' : 'Start door hangers';
  $('trackBtn').classList.toggle('stop', S.tracking);
  if (!S.tracking) $('gps').textContent = '';
}

async function startTracking() {
  if (!('geolocation' in navigator)) { banner('This browser has no location access.'); return; }
  S.tracking = true;
  S.run = Date.now();
  S.lastSent = null;
  S.lastFix = null;
  S.lastPresence = 0;
  prefs.set('tracking', S.code);
  $('gps').textContent = 'Finding you…';
  S.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  setTrackUi();
  await keepAwake();
  banner('Keep this screen on while you walk. Locking the phone or switching apps pauses your trail.', 8000);
}

function stopTracking() {
  if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
  S.watchId = null;
  S.tracking = false;
  prefs.set('tracking', null);
  if (S.wake) S.wake.release().catch(() => {});
  S.wake = null;
  store.updatePerson(S.uid, { active: false, t: Date.now() });
  setTrackUi();
}

function onFix(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  const t = Date.now();
  if (S.lastFix && t - S.lastFix > 60000) {
    banner(`Your trail paused for ${Math.round((t - S.lastFix) / 60000)} min (screen off or another app). Tap any street you covered then to mark it done.`, 15000);
  }
  if (!S.lastFix && !(S.meta && S.meta.area)) map.setView([lat, lng], 17);
  S.lastFix = t;
  const me = { ...(S.people[S.uid] || {}), ...S.me, lat, lng, acc: Math.round(accuracy), t, active: true };
  drawPerson(S.uid, me);
  if (t - S.lastPresence >= PRESENCE_MS) {
    S.lastPresence = t;
    store.updatePerson(S.uid, { lat: +lat.toFixed(6), lng: +lng.toFixed(6), acc: Math.round(accuracy), t, active: true });
  }
  const km = ((S.tracks[S.uid] && S.tracks[S.uid].dist) || 0) / 1000;
  const status = `GPS ±${Math.round(accuracy)} m · you've walked ${km.toFixed(2)} km`;
  if (accuracy > MAX_ACC_M) {
    $('gps').textContent = status + ' · signal too rough to record';
    return;
  }
  $('gps').textContent = status;
  if (!S.lastSent || distM(S.lastSent, [lat, lng]) >= MIN_MOVE_M) {
    S.lastSent = [lat, lng];
    store.addPoint(S.uid, { lat: +lat.toFixed(6), lng: +lng.toFixed(6), t, a: Math.round(accuracy), r: S.run });
  }
}

function onGeoError(err) {
  if (err.code === 1) {
    stopTracking();
    banner('Location is blocked for this page. Allow location for this site in your phone settings (Safari: aA > Website Settings > Location), then tap Start again.');
  } else {
    $('gps').textContent = 'Waiting for GPS…';
  }
}

$('trackBtn').onclick = () => (S.tracking ? stopTracking() : startTracking());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.tracking && (!S.wake || S.wake.released)) keepAwake();
});

// ---------- organizer: area and streets ----------
let drawPreview = null;
function redrawPreview() {
  if (drawPreview) drawPreview.remove();
  drawPreview = S.drawing.length
    ? L.polygon(S.drawing, { color: '#e8710a', weight: 3, dashArray: '4 6', interactive: false }).addTo(map)
    : null;
}
function onAreaClick(e) { S.drawing.push([e.latlng.lat, e.latlng.lng]); redrawPreview(); }
function endDrawing() {
  map.off('click', onAreaClick);
  S.drawing = [];
  redrawPreview();
  S.drawing = null;
  $('areaBar').hidden = true;
}
$('setAreaBtn').onclick = () => {
  closeMenu();
  S.drawing = [];
  $('areaBar').hidden = false;
  map.on('click', onAreaClick);
};
$('areaUndo').onclick = () => { S.drawing.pop(); redrawPreview(); };
$('areaCancel').onclick = endDrawing;
$('areaDone').onclick = async () => {
  if (S.drawing.length < 3) { banner('Tap at least 3 corners first.', 4000); return; }
  const area = S.drawing.slice();
  endDrawing();
  banner('Getting the streets from OpenStreetMap…');
  let streets = null;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: new URLSearchParams({ data: overpassQuery(area) }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    streets = parseOverpass(await res.json());
    if (!Object.keys(streets).length) throw new Error('no streets found inside the area');
  } catch (err) {
    if (!confirm(`Could not get the streets (${err.message}). Save the area anyway? Trails still show, but there is no coverage count.`)) {
      banner('');
      return;
    }
    streets = null;
  }
  await saveArea(area, streets);
  banner(streets ? `Found ${Object.keys(streets).length} street sections.` : 'Area saved without streets.', 5000);
};

function saveArea(area, streets) {
  const meta = { name: S.meta.name, owner: S.meta.owner, createdAt: S.meta.createdAt, area: encodePath(area) };
  if (streets) meta.streets = streets;
  S.fitted = false;
  return store.setMeta(meta);
}

$('deleteBtn').onclick = () => {
  if (!confirm('Delete this event, its area and everyone\'s trails for good?')) return;
  if (S.tracking) stopTracking();
  store.deleteEvent();
};

// ---------- demo: synthetic streets and simulated walkers ----------
function demoGrid() {
  const c = map.getCenter();
  const p = makeProjector(c.lat, c.lng);
  const names = ['Oak St', 'Elm St', 'Pine St', 'Maple St', 'Cedar St'];
  const streets = {};
  for (let i = 0; i < 5; i++) {
    const o = (i - 2) * 110;
    streets['dh' + i] = { name: names[i], pts: encodePath([p.toLL([-240, o]), p.toLL([240, o])]) };
    streets['dv' + i] = { name: `${i + 1}${['st', 'nd', 'rd', 'th', 'th'][i]} Ave`, pts: encodePath([p.toLL([o, -240]), p.toLL([o, 240])]) };
  }
  const area = [[-270, -270], [270, -270], [270, 270], [-270, 270]].map(p.toLL);
  return { area, streets };
}

async function simulate() {
  if (S.sim) return;
  closeMenu();
  if (!S.cov) {
    const g = demoGrid();
    await saveArea(g.area, g.streets);
  }
  const ways = Object.keys(S.cov.ways);
  const walkers = [0, 1, 2].map((i) => ({
    uid: 'sim' + i, name: ['Mr. Lee', 'Ms. Ortiz', 'Mr. Shah'][i], group: GROUPS[i + 1][0], color: GROUPS[i + 1][1],
    queue: ways.filter((_, k) => k % 3 === i).map((id) => {
      const ps = S.cov.ways[id].pieces.map((n) => S.cov.pieces[n]);
      return [ps[0].a, ...ps.map((pc) => pc.b)];
    }),
    at: null, run: 1,
  }));
  walkers.forEach((w) => store.updatePerson(w.uid, { name: w.name, group: w.group, color: w.color, active: true, t: Date.now() }));
  const step = (w) => {
    if (!w.path || !w.path.length) {
      w.path = w.queue.shift();
      if (!w.path) { store.updatePerson(w.uid, { active: false, t: Date.now() }); return false; }
      w.at = w.path.shift();
      w.run++;
    }
    const target = w.path[0];
    const d = distM(w.at, target);
    const k = Math.min(1, 9 / Math.max(d, 0.01));
    w.at = [w.at[0] + (target[0] - w.at[0]) * k, w.at[1] + (target[1] - w.at[1]) * k];
    if (k === 1) w.path.shift();
    const j = () => (Math.random() - 0.5) * 0.00006;
    const pt = { lat: +(w.at[0] + j()).toFixed(6), lng: +(w.at[1] + j()).toFixed(6), t: Date.now(), a: 6, r: w.run };
    store.addPoint(w.uid, pt);
    store.updatePerson(w.uid, { lat: pt.lat, lng: pt.lng, t: pt.t, active: true });
    return true;
  };
  S.sim = setInterval(() => {
    const alive = walkers.map(step).some(Boolean);
    if (!alive) { clearInterval(S.sim); S.sim = null; }
  }, 200);
}
$('simBtn').onclick = simulate;

// ---------- share ----------
function shareLink() { return `${location.origin}${location.pathname}?e=${encodeURIComponent(S.code)}`; }
$('shareBtn').onclick = async () => {
  const url = shareLink();
  try {
    if (navigator.share) await navigator.share({ title: S.meta ? S.meta.name : 'BSA Troop 444', url });
    else { await navigator.clipboard.writeText(url); banner('Link copied.', 3000); }
  } catch { /* cancelled */ }
};
let qrLoaded = null;
function drawQr() {
  qrLoaded = qrLoaded || new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = ok;
    s.onerror = fail;
    document.head.append(s);
  });
  qrLoaded.then(() => {
    $('qr').replaceChildren();
    new window.QRCode($('qr'), { text: shareLink(), width: 180, height: 180 });
  }).catch(() => {});
}

// ---------- join, create, enter ----------
function fillJoin(code) {
  const me = prefs.get('me') || {};
  $('joinCode').value = code || '';
  $('joinName').value = me.name || '';
  $('joinGroup').replaceChildren(...GROUPS.map(([name]) => new Option(name, name, false, name === me.group)));
  $('modeNote').textContent = store.kind === 'demo'
    ? 'Demo mode: no shared database is set up yet, so the map lives in this browser only. See README.md to connect Firebase.'
    : '';
  $('join').hidden = false;
}

function readMe() {
  const name = $('joinName').value.trim();
  if (!name) { joinError('Enter your name so others know whose dot is whose.'); return null; }
  const group = $('joinGroup').value;
  const color = (GROUPS.find(([g]) => g === group) || GROUPS[0])[1];
  return { name: name.slice(0, 40), group, color };
}

$('joinBtn').onclick = () => {
  joinError('');
  const code = $('joinCode').value.trim().toLowerCase();
  if (!code) { joinError('Enter the event code from the organizer\'s link, or start a new event below.'); return; }
  const me = readMe();
  if (me) enter(code, me);
};
$('createBtn').onclick = () => {
  joinError('');
  const me = readMe();
  if (me) enter(newEventCode(), me, $('createName').value.trim() || 'Troop 444 door hangers');
};
$('leaveBtn').onclick = () => {
  if (S.tracking) stopTracking();
  location.href = `${location.pathname}?e=${encodeURIComponent(S.code)}&edit=1`;
};

const handlers = {
  meta(m) {
    S.meta = m;
    if (!m) {
      banner(`No event found for code "${S.code}". Check the link from the organizer.`);
      return;
    }
    if ($('banner').textContent.startsWith('No event found')) banner('');
    $('eventName').textContent = m.name || 'Troop 444 door hangers';
    document.title = m.name || 'BSA Troop 444';
    S.isOwner = m.owner === S.uid;
    $('ownerTools').hidden = !S.isOwner;
    $('simBtn').hidden = store.kind !== 'demo';
    const sig = (m.area || '') + '|' + JSON.stringify(m.streets || null).length;
    if (sig !== S.metaSig) { S.metaSig = sig; rebuildCoverage(); }
    scheduleRefresh();
  },
  person: onPerson,
  point: onPoint,
  done: onDone,
  deleted() {
    prefs.set('code', null);
    alert('This event has been deleted.');
    location.href = location.pathname;
  },
  error(err) { banner('Could not load the event: ' + err.message); },
};

async function enter(code, me, createName) {
  S.code = code;
  S.me = me;
  prefs.set('me', me);
  prefs.set('code', code);
  history.replaceState(null, '', `${location.pathname}?e=${encodeURIComponent(code)}`);
  $('join').hidden = true;
  $('shareLink').value = shareLink();
  $('youLine').textContent = `${me.name}, ${me.group} group`;
  store.watch(code, handlers);
  if (createName) await store.setMeta({ name: createName, owner: S.uid, createdAt: Date.now() });
  try {
    await store.updatePerson(S.uid, { ...me, active: false, t: (S.people[S.uid] && S.people[S.uid].t) || Date.now() });
  } catch { /* event missing: the meta handler explains */ }
  setTrackUi();
  if (prefs.get('tracking') === code) banner('Your trail stopped when this page reloaded. Tap Resume to carry on.');
  drawQr();
  if (createName) openMenu('event');
}

setInterval(() => {
  for (const [uid, p] of Object.entries(S.people)) if (uid !== S.uid || !S.tracking) drawPerson(uid, p);
  refresh();
}, 30000);

(async function boot() {
  try {
    S.uid = await store.init();
  } catch (err) {
    fillJoin('');
    joinError('Could not connect to the shared database: ' + err.message);
    return;
  }
  const params = new URLSearchParams(location.search);
  const code = (params.get('e') || prefs.get('code') || '').trim().toLowerCase();
  const me = prefs.get('me');
  if (code && me && me.name && !params.has('edit')) enter(code, me);
  else fillJoin(code);
})();
