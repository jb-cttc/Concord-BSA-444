// Street coverage math. No browser APIs here, so it runs in Node tests too.
//
// Streets come from OpenStreetMap as polylines. Each street is cut into short
// pieces (about 25 m). A piece counts as covered when a walker's GPS track
// passes within RADIUS metres of it, or when someone marks the whole street
// done by hand (the fallback for GPS gaps).

export const PIECE_M = 25;
export const RADIUS_M = 25;
const CELL_M = 50;

// Flat x/y in metres around a reference point. Accurate to well under 1% over
// a neighbourhood, which is all we need.
export function makeProjector(lat0, lng0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  return {
    toXY: ([lat, lng]) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLL: ([x, y]) => [lat0 + y / ky, lng0 + x / kx],
  };
}

export function distM(a, b) {
  const p = makeProjector(a[0], a[1]);
  const [x, y] = p.toXY(b);
  return Math.hypot(x, y);
}

export function pointInPolygon([lat, lng], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Compact text form for paths ("lat,lng lat,lng ..."), 5 decimals (~1 m).
// Stored this way so the realtime database keeps it as one small string.
export function encodePath(pts) {
  return pts.map(([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`).join(' ');
}
export function decodePath(s) {
  if (!s) return [];
  return s.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
}

// Overpass JSON ("out geom") -> { w123: { name, pts: "lat,lng ..." } }
export function parseOverpass(json) {
  const streets = {};
  for (const el of (json && json.elements) || []) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const name = (el.tags && (el.tags.name || el.tags.ref)) || 'Unnamed street';
    streets['w' + el.id] = { name, pts: encodePath(el.geometry.map((g) => [g.lat, g.lon])) };
  }
  return streets;
}

export function overpassQuery(area) {
  const poly = area.map(([a, b]) => `${a.toFixed(6)} ${b.toFixed(6)}`).join(' ');
  return (
    '[out:json][timeout:25];' +
    `way["highway"~"^(residential|living_street|unclassified|tertiary|secondary)$"](poly:"${poly}");` +
    'out geom;'
  );
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

export class Coverage {
  // streets: { wayId: { name, pts } } with pts encoded or as [[lat,lng],...]
  // area: optional [[lat,lng],...]; pieces whose midpoint is outside are dropped
  constructor(streets, area, { pieceM = PIECE_M, radiusM = RADIUS_M } = {}) {
    this.radius2 = radiusM * radiusM;
    this.pieces = [];
    this.ways = {};
    this.hit = new Set();
    this.doneWays = new Set();
    this.grid = new Map();

    const all = [];
    for (const [wayId, s] of Object.entries(streets || {})) {
      const pts = typeof s.pts === 'string' ? decodePath(s.pts) : s.pts;
      all.push([wayId, s.name, pts]);
    }
    const anchor = (area && area[0]) || (all[0] && all[0][2][0]) || [0, 0];
    this.proj = makeProjector(anchor[0], anchor[1]);

    for (const [wayId, name, pts] of all) {
      const xy = pts.map(this.proj.toXY);
      for (let i = 1; i < xy.length; i++) {
        const [ax, ay] = xy[i - 1];
        const [bx, by] = xy[i];
        const len = Math.hypot(bx - ax, by - ay);
        const n = Math.max(1, Math.ceil(len / pieceM));
        for (let k = 0; k < n; k++) {
          const p0 = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
          const p1 = [ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n];
          const mid = this.proj.toLL([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
          if (area && area.length >= 3 && !pointInPolygon(mid, area)) continue;
          this.addPiece(wayId, name, p0, p1, len / n);
        }
      }
    }
  }

  addPiece(wayId, name, p0, p1, len) {
    const idx = this.pieces.length;
    this.pieces.push({ wayId, a: this.proj.toLL(p0), b: this.proj.toLL(p1), xy: [p0, p1], len });
    if (!this.ways[wayId]) this.ways[wayId] = { wayId, name, len: 0, pieces: [] };
    this.ways[wayId].len += len;
    this.ways[wayId].pieces.push(idx);
    const r = Math.sqrt(this.radius2);
    const x0 = Math.floor((Math.min(p0[0], p1[0]) - r) / CELL_M);
    const x1 = Math.floor((Math.max(p0[0], p1[0]) + r) / CELL_M);
    const y0 = Math.floor((Math.min(p0[1], p1[1]) - r) / CELL_M);
    const y1 = Math.floor((Math.max(p0[1], p1[1]) + r) / CELL_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = x + ':' + y;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(idx);
      }
    }
  }

  isCovered(idx) {
    return this.hit.has(idx) || this.doneWays.has(this.pieces[idx].wayId);
  }

  // Returns indexes of pieces newly hit by this point.
  addPoint(ll) {
    const [px, py] = this.proj.toXY(ll);
    const cell = this.grid.get(Math.floor(px / CELL_M) + ':' + Math.floor(py / CELL_M));
    const fresh = [];
    if (!cell) return fresh;
    for (const idx of cell) {
      if (this.hit.has(idx)) continue;
      const [[ax, ay], [bx, by]] = this.pieces[idx].xy;
      if (segDist2(px, py, ax, ay, bx, by) <= this.radius2) {
        this.hit.add(idx);
        fresh.push(idx);
      }
    }
    return fresh;
  }

  // Fill in the line between two consecutive GPS fixes, so a walker who got a
  // fix every 40 m still covers the street between them.
  addStep(from, to, stepM = 10) {
    const d = distM(from, to);
    const n = Math.max(1, Math.ceil(d / stepM));
    const fresh = [];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      fresh.push(...this.addPoint([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]));
    }
    return fresh;
  }

  setWayDone(wayId, done) {
    if (done) this.doneWays.add(wayId);
    else this.doneWays.delete(wayId);
    return this.ways[wayId] ? this.ways[wayId].pieces : [];
  }

  wayStats(wayId) {
    const w = this.ways[wayId];
    let covered = 0;
    for (const idx of w.pieces) if (this.isCovered(idx)) covered += this.pieces[idx].len;
    return { wayId, name: w.name, len: w.len, covered, pct: w.len ? covered / w.len : 0, done: this.doneWays.has(wayId) };
  }

  stats() {
    let total = 0;
    let covered = 0;
    const ways = Object.keys(this.ways).map((id) => this.wayStats(id));
    for (const w of ways) {
      total += w.len;
      covered += w.covered;
    }
    return { total, covered, pct: total ? covered / total : 0, ways };
  }
}
