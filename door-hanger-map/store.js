// Shared state for one event. Two implementations with the same shape:
//
//   FirebaseStore - the real thing: Firebase Realtime Database, so every phone
//                   sees every other phone within a second or two.
//   LocalStore    - demo mode when config.js has no Firebase settings. Data
//                   lives in this browser only (shared between tabs), which is
//                   enough to try the app and run the walker simulation.
//
// Data layout (same in both):
//   events/{code}/meta              { name, owner, createdAt, area, streets }
//   events/{code}/people/{uid}      { name, group, color, active, lat, lng, acc, t }
//   events/{code}/tracks/{uid}/{id} { lat, lng, t, a, r }   r = run (one Start..Stop)
//   events/{code}/done/{wayId}      { by, t }               street marked done by hand

const FIREBASE_VERSION = '10.12.2';

function randomId(n = 20) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
export const newEventCode = () => randomId(4) + '-' + randomId(4);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export class LocalStore {
  constructor() { this.kind = 'demo'; this.seq = 0; }

  async init() {
    this.uid = safeGet('sdh:uid') || randomId();
    safeSet('sdh:uid', this.uid);
    return this.uid;
  }

  load(code) {
    try {
      const s = JSON.parse(safeGet('sdh:event:' + code));
      if (s) return s;
    } catch { /* fall through */ }
    return { meta: null, people: {}, tracks: {}, done: {} };
  }

  save(code, s) {
    if (!safeSet('sdh:event:' + code, JSON.stringify(s))) console.warn('Demo storage full or blocked');
  }

  watch(code, h) {
    this.code = code;
    this.h = h;
    const s = this.load(code);
    this.state = s;
    h.meta(s.meta);
    for (const [uid, p] of Object.entries(s.people)) h.person(uid, p);
    for (const [uid, pts] of Object.entries(s.tracks)) {
      for (const [key, pt] of Object.entries(pts)) h.point(uid, key, pt);
    }
    for (const [wayId, v] of Object.entries(s.done)) h.done(wayId, v);
    if ('BroadcastChannel' in window) {
      this.chan = new BroadcastChannel('sdh:' + code);
      this.chan.onmessage = (e) => this.apply(e.data, false);
    }
  }

  apply(msg, local) {
    const s = this.state;
    if (msg.type === 'meta') { s.meta = msg.meta; this.h.meta(msg.meta); }
    if (msg.type === 'person') {
      s.people[msg.uid] = { ...(s.people[msg.uid] || {}), ...msg.p };
      this.h.person(msg.uid, s.people[msg.uid]);
    }
    if (msg.type === 'point') {
      (s.tracks[msg.uid] = s.tracks[msg.uid] || {})[msg.key] = msg.pt;
      this.h.point(msg.uid, msg.key, msg.pt);
    }
    if (msg.type === 'done') {
      if (msg.v) s.done[msg.wayId] = msg.v; else delete s.done[msg.wayId];
      this.h.done(msg.wayId, msg.v);
    }
    if (msg.type === 'deleted') { this.h.deleted(); return; }
    if (local) {
      this.save(this.code, s);
      if (this.chan) this.chan.postMessage(msg);
    }
  }

  setMeta(meta) { this.apply({ type: 'meta', meta }, true); }
  updatePerson(uid, p) { this.apply({ type: 'person', uid, p }, true); }
  addPoint(uid, pt) {
    const key = Date.now().toString(36) + (this.seq++).toString(36).padStart(4, '0') + uid.slice(0, 4);
    this.apply({ type: 'point', uid, key, pt }, true);
  }
  setDone(wayId, v) { this.apply({ type: 'done', wayId, v }, true); }
  deleteEvent() {
    safeRemove('sdh:event:' + this.code);
    if (this.chan) this.chan.postMessage({ type: 'deleted' });
    this.h.deleted();
  }
}

export class FirebaseStore {
  constructor(config) { this.kind = 'firebase'; this.config = config; }

  async init() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
    const [appMod, authMod, db] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-database.js'),
    ]);
    const app = appMod.initializeApp(this.config);
    const auth = authMod.getAuth(app);
    // Anonymous sign-in: each phone gets a stable id with no account or
    // password. The event code in the link is what lets people in.
    const cred = await authMod.signInAnonymously(auth);
    this.uid = cred.user.uid;
    this.db = db;
    this.d = db.getDatabase(app);
    return this.uid;
  }

  ref(path) { return this.db.ref(this.d, `events/${this.code}${path ? '/' + path : ''}`); }

  watch(code, h) {
    const { onValue, onChildAdded, onChildChanged, onChildRemoved } = this.db;
    this.code = code;
    this.h = h;
    const watchedTracks = new Set();
    let sawMeta = false;
    onValue(this.ref('meta'), (s) => {
      if (sawMeta && !s.exists()) h.deleted();
      sawMeta = sawMeta || s.exists();
      h.meta(s.val());
    }, (err) => h.error(err));
    const people = this.ref('people');
    const onPerson = (s) => {
      h.person(s.key, s.val());
      if (!watchedTracks.has(s.key)) {
        watchedTracks.add(s.key);
        onChildAdded(this.ref('tracks/' + s.key), (p) => h.point(s.key, p.key, p.val()));
      }
    };
    onChildAdded(people, onPerson);
    onChildChanged(people, onPerson);
    const done = this.ref('done');
    onChildAdded(done, (s) => h.done(s.key, s.val()));
    onChildChanged(done, (s) => h.done(s.key, s.val()));
    onChildRemoved(done, (s) => h.done(s.key, null));
  }

  // Writes queue up while a phone has no signal and send when it returns,
  // as long as the page stays open.
  setMeta(meta) { return this.db.set(this.ref('meta'), meta); }
  updatePerson(uid, p) { return this.db.update(this.ref('people/' + uid), p); }
  addPoint(uid, pt) { return this.db.push(this.ref('tracks/' + uid), pt); }
  setDone(wayId, v) { return this.db.set(this.ref('done/' + wayId), v); }
  deleteEvent() { return this.db.remove(this.ref('')); }
}
