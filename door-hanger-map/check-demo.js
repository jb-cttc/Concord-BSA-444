// node check-demo.js : checks the guided demo tells the story it promises.
// It replays the pretend walkers through the same coverage maths the app uses.
import assert from 'node:assert/strict';
import { Coverage, decodePath, distM } from './coverage.js';
import { assignEdges, buildGraph, makeTour, planRoute } from './demo.js';

const tour = makeTour();

// The same every time, so what people see matches these checks.
assert.deepEqual(makeTour().walkers.map((w) => w.samples.length), tour.walkers.map((w) => w.samples.length));

// The street network is joined up: every route reaches all its streets.
const g = buildGraph();
const assigned = assignEdges(g);
assigned.forEach((ids, i) => {
  const route = planRoute(g, '800,800', ids);
  const walked = new Set(route.map((s) => s.edge));
  ids.forEach((id) => assert.ok(walked.has(id), `walker ${i} reaches edge ${id}`));
  for (let k = 1; k < route.length; k++) assert.equal(route[k].from, route[k - 1].to, 'route is continuous');
});

// Work is shared out fairly: no walker's route is more than 1.6x another's.
const lens = tour.walkers.map((w) => w.routeM);
assert.ok(Math.max(...lens) / Math.min(...lens) < 1.6, `route lengths ${lens}`);

// Recorded points are about 8 m apart, except across the locked-phone gap.
for (const w of tour.walkers) {
  const s = w.samples;
  for (let k = 1; k < s.length; k++) {
    if (!s[k].gap && !s[k - 1].gap) assert.ok(distM(s[k - 1].ll, s[k].ll) < 30, `${w.name} jumps at point ${k}`);
  }
}
const gappy = tour.walkers.filter((w) => w.samples.some((s) => s.gap));
assert.equal(gappy.length, 1, 'exactly one phone locks');

// Replay, breaking the trail at the gap the way the app does.
const c = new Coverage(tour.streets, tour.area);
for (const w of tour.walkers) {
  let prev = null;
  for (const s of w.samples) {
    if (s.gap) { prev = null; continue; }
    if (prev) c.addStep(prev, s.ll); else c.addPoint(s.ll);
    prev = s.ll;
  }
}
const byName = Object.fromEntries(c.stats().ways.map((w) => [w.name, w.pct]));
const left = Object.entries(byName).filter(([, pct]) => pct < 0.9).map(([n]) => n).sort();
assert.deepEqual(left, [...tour.unfinished].sort(), `streets left: ${JSON.stringify(byName)}`);
assert.ok(byName['Quail Ct'] < 0.4, `Quail Ct ${byName['Quail Ct']}`);
assert.ok(byName['Wren Way'] > 0.1 && byName['Wren Way'] < 0.85, `Wren Way ${byName['Wren Way']}`);
const pct = c.stats().pct;
assert.ok(pct > 0.9 && pct < 1, `overall ${pct}`);

// The pretend neighbourhood is big enough to feel real, and all inside the area.
assert.ok(tour.houses.length > 300 && tour.houses.length < 900, `${tour.houses.length} houses`);
for (const s of Object.values(tour.streets)) assert.ok(decodePath(s.pts).length >= 2);

const total = tour.walkers.reduce((a, w) => a + w.samples.length, 0);
console.log(`demo checks passed (${tour.houses.length} houses, ${total} points, routes ${lens.join('/')} m, ` +
  `${Math.round(pct * 100)}% covered, left: ${left.join(', ')})`);
