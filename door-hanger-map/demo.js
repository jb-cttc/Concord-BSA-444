// The guided demo ("?demo" in the address): a pretend neighbourhood and four
// pretend adults who walk it. No browser APIs here, so check-demo.js can run
// it in Node and confirm the story the demo tells.
//
// Everything is planned up front: each walker gets the streets nearest their
// part of the neighbourhood, and a route that walks every one of them on the
// sidewalk, crossing over other streets where needed. Two things are left
// unfinished on purpose, so the "Streets left" list has something to show:
//   - Quail Ct: nobody is sent there.
//   - Wren Way: one walker's phone "locks" halfway along it.

import { encodePath, makeProjector } from './coverage.js';

export const TOUR_CENTER = [37.978, -122.031]; // only anchors the maths; no map tiles are shown

// Streets in metres (x east, y north), laid out taller than wide so the
// whole neighbourhood fits a phone held upright. Vertices sit exactly on
// crossings so the streets join up into one network.
const XS = [-200, -60, 80, 220];
const YS = [-280, -160, -40, 80, 200];
// Ridge Loop bulges east from the top-right corner to the bottom-right one.
const LOOP = Array.from({ length: 11 }, (_, k) => {
  const a = (Math.PI * k) / 10;
  return [Math.round(220 + 120 * Math.sin(a)), Math.round(-40 + 240 * Math.cos(a))];
});
const STREETS = [
  ['oak', 'Oak St', XS.map((x) => [x, 200])],
  ['elm', 'Elm St', XS.map((x) => [x, 80])],
  ['pine', 'Pine St', XS.map((x) => [x, -40])],
  ['maple', 'Maple St', XS.map((x) => [x, -160])],
  ['walnut', 'Walnut St', XS.map((x) => [x, -280])],
  ['alder', 'Alder Ave', YS.map((y) => [-200, y])],
  ['birch', 'Birch Ave', YS.map((y) => [-60, y])],
  ['cedar', 'Cedar Ave', YS.map((y) => [80, y])],
  ['dogwood', 'Dogwood Ave', YS.map((y) => [220, y])],
  ['ridge', 'Ridge Loop', LOOP],
  ['wren', 'Wren Way', [[220, -40], LOOP[5]]],
  ['heron', 'Heron Ct', [[-60, 200], [-60, 290]]],
  ['quail', 'Quail Ct', [[80, -280], [80, -410]]],
];
const AREA = [[-235, -440], [375, -440], [375, 320], [-235, 320]];
const MEET = [80, 80]; // meeting spot: Cedar Ave and Elm St
const SKIP = new Set(['quail']); // nobody gets to it
const GAP_WAY = 'wren'; // a phone locks partway along this one
const GAP_FROM = 0.08;
const GAP_TO = 0.97;
const SIDEWALK_M = 6; // walkers keep to the right-hand sidewalk
const WOBBLE_M = 2.5; // pretend GPS error, which drifts slowly like the real thing

export const TOUR_WALKERS = [
  // name, group, colour (from the app's group list), where their part of the neighbourhood is
  { uid: 'tour-lee', name: 'Mr. Lee', group: 'Blue', color: '#1a73e8', seed: [-130, 140] },
  { uid: 'tour-ortiz', name: 'Ms. Ortiz', group: 'Gold', color: '#b58900', seed: [-130, -200] },
  { uid: 'tour-shah', name: 'Mr. Shah', group: 'Purple', color: '#9334e6', seed: [210, -200] },
  { uid: 'tour-kim', name: 'Mrs. Kim', group: 'Orange', color: '#e8710a', seed: [210, 140] },
];

const key = ([x, y]) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// Street network: nodes at every vertex, one edge per straight run.
export function buildGraph(streets = STREETS) {
  const nodes = new Map();
  const edges = [];
  const node = (xy) => {
    const k = key(xy);
    if (!nodes.has(k)) nodes.set(k, { k, xy, adj: [] });
    return nodes.get(k);
  };
  for (const [wayId, , pts] of streets) {
    for (let i = 1; i < pts.length; i++) {
      const a = node(pts[i - 1]);
      const b = node(pts[i]);
      const e = { id: edges.length, wayId, a: a.k, b: b.k, len: dist(a.xy, b.xy) };
      edges.push(e);
      a.adj.push({ to: b.k, edge: e.id });
      b.adj.push({ to: a.k, edge: e.id });
    }
  }
  return { nodes, edges };
}

// Shortest walking distance from one node to every other (Dijkstra; the
// network is small, so a plain scan for the next node is fast enough).
// Streets in "avoid" cost extra to pass through, so walkers don't cut
// through the street whose gap the demo shows.
function shortest(g, from, avoid) {
  const d = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let cur = null;
    for (const [k, v] of d) if (!done.has(k) && (cur === null || v < d.get(cur))) cur = k;
    if (cur === null) break;
    done.add(cur);
    for (const { to, edge } of g.nodes.get(cur).adj) {
      const e = g.edges[edge];
      const nd = d.get(cur) + e.len * (avoid.has(e.wayId) ? 20 : 1);
      if (!d.has(to) || nd < d.get(to)) { d.set(to, nd); prev.set(to, { from: cur, edge }); }
    }
  }
  return { d, prev };
}

// Who walks which street: the walker whose part of the neighbourhood is
// nearest the middle of it.
export function assignEdges(g, walkers = TOUR_WALKERS) {
  const out = walkers.map(() => []);
  for (const e of g.edges) {
    if (SKIP.has(e.wayId)) continue;
    const a = g.nodes.get(e.a).xy;
    const b = g.nodes.get(e.b).xy;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = 0;
    walkers.forEach((w, i) => { if (dist(mid, w.seed) < dist(mid, walkers[best].seed)) best = i; });
    out[best].push(e.id);
  }
  return out;
}

// A route that walks every assigned edge: from where you are, go to the
// nearest end of the nearest street not yet walked, then walk it. Returns
// the steps in order, each { from, to, edge, work } (work = an assigned
// street rather than just passing through).
export function planRoute(g, start, edgeIds, avoid = new Set([GAP_WAY])) {
  const todo = new Set(edgeIds);
  const steps = [];
  let cur = start;
  const walk = (from, to, edge, work) => { steps.push({ from, to, edge, work }); todo.delete(edge); };
  while (todo.size) {
    const { d, prev } = shortest(g, cur, avoid);
    let pick = null;
    for (const id of todo) {
      const e = g.edges[id];
      for (const [near, far] of [[e.a, e.b], [e.b, e.a]]) {
        const v = d.get(near);
        if (v != null && (!pick || v < pick.v)) pick = { id, near, far, v };
      }
    }
    if (!pick) break; // unreachable; the demo network is all connected
    const path = [];
    for (let k = pick.near; k !== cur; k = prev.get(k).from) path.unshift(prev.get(k));
    let at = cur;
    for (const p of path) {
      const e = g.edges[p.edge];
      const next = e.a === at ? e.b : e.a;
      walk(at, next, p.edge, todo.has(p.edge));
      at = next;
    }
    walk(pick.near, pick.far, pick.id, true);
    cur = pick.far;
  }
  return steps;
}

// Small repeatable random numbers, so the demo and its checks match.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Houses: a small square every ~17 m along both sides of every street,
// kept clear of corners. Drawn as a pretend base map; not counted.
function houses(g, proj) {
  const out = [];
  for (const e of g.edges) {
    const A = g.nodes.get(e.a);
    const B = g.nodes.get(e.b);
    const margin = (n) => (n.adj.length >= 3 ? 24 : n.adj.length === 2 ? 4 : 8);
    const m0 = margin(A);
    const m1 = margin(B);
    const usable = e.len - m0 - m1;
    if (usable < 10) continue;
    const n = Math.max(1, Math.round(usable / 17));
    const ux = (B.xy[0] - A.xy[0]) / e.len;
    const uy = (B.xy[1] - A.xy[1]) / e.len;
    for (let i = 0; i < n; i++) {
      const along = m0 + (usable * (i + 0.5)) / n;
      for (const side of [1, -1]) {
        const cx = A.xy[0] + ux * along - uy * side * 17;
        const cy = A.xy[1] + uy * along + ux * side * 17;
        const h = 5.5;
        out.push([[-h, -h], [h, -h], [h, h], [-h, h]].map(([p, q]) => proj.toLL([cx + ux * p - uy * q, cy + uy * p + ux * q])));
      }
    }
  }
  return out;
}

// Where to print each street's name: the middle of one of its longest runs,
// staggered so labels of parallel streets don't line up in one column.
function labels(streets, proj) {
  return streets.map(([wayId, name, pts], i) => {
    const runs = pts.slice(1).map((p, k) => ({ k, len: dist(pts[k], p) }));
    const longest = Math.max(...runs.map((r) => r.len));
    const ties = runs.filter((r) => r.len > longest - 1);
    const { k } = ties[i % ties.length];
    const mid = [(pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2];
    const vertical = Math.abs(pts[k + 1][0] - pts[k][0]) < Math.abs(pts[k + 1][1] - pts[k][1]);
    return { wayId, name, ll: proj.toLL(mid), vertical };
  });
}

// Everything the demo needs, as lat/lng:
//   area, streets (the app's stored street format), houses, labels,
//   walkers: [{ uid, name, group, color, samples: [{ ll, gap }] }]
// A sample is one recorded GPS point. "gap" samples are while the phone is
// locked: the walker keeps moving but sends nothing.
export function makeTour({ center = TOUR_CENTER, stepM = 8, seed = 444 } = {}) {
  const proj = makeProjector(center[0], center[1]);
  const g = buildGraph();
  const rand = rng(seed);
  const streets = {};
  for (const [wayId, name, pts] of STREETS) streets[wayId] = { name, pts: encodePath(pts.map(proj.toLL)) };
  const start = key(MEET);
  const assigned = assignEdges(g);
  const walkers = TOUR_WALKERS.map((w, i) => {
    const steps = planRoute(g, start, assigned[i]);
    const samples = [];
    let len = 0;
    const err = [0, 0];
    for (const st of steps) {
      const a = g.nodes.get(st.from).xy;
      const b = g.nodes.get(st.to).xy;
      const L = dist(a, b);
      len += L;
      const off = [((b[1] - a[1]) / L) * SIDEWALK_M, (-(b[0] - a[0]) / L) * SIDEWALK_M]; // to the right
      const n = Math.max(1, Math.ceil(L / stepM));
      const gapHere = st.work && g.edges[st.edge].wayId === GAP_WAY;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        err[0] = err[0] * 0.8 + (rand() - 0.5) * WOBBLE_M;
        err[1] = err[1] * 0.8 + (rand() - 0.5) * WOBBLE_M;
        const xy = [a[0] + (b[0] - a[0]) * t + off[0] + err[0], a[1] + (b[1] - a[1]) * t + off[1] + err[1]];
        samples.push({ ll: proj.toLL(xy).map((v) => +v.toFixed(6)), gap: gapHere && t > GAP_FROM && t < GAP_TO });
      }
    }
    return { uid: w.uid, name: w.name, group: w.group, color: w.color, samples, routeM: Math.round(len) };
  });
  return {
    area: AREA.map(proj.toLL),
    streets,
    houses: houses(g, proj),
    labels: labels(STREETS, proj),
    meet: proj.toLL(MEET),
    walkers,
    unfinished: ['Quail Ct', 'Wren Way'],
  };
}
