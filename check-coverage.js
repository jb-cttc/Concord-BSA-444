// node check-coverage.js : checks the street coverage math.
import assert from 'node:assert/strict';
import { Coverage, decodePath, distM, encodePath, makeProjector, overpassQuery, parseOverpass, pointInPolygon } from './coverage.js';

const p = makeProjector(37.97, -122.03);
const ll = (x, y) => p.toLL([x, y]);

// Distances are right to within 1%.
assert.ok(Math.abs(distM(ll(0, 0), ll(300, 400)) - 500) < 5);

// Path encoding round-trips at 5 decimals.
const path = [ll(0, 0), ll(100, 0), ll(100, 100)];
decodePath(encodePath(path)).forEach((q, i) => assert.ok(distM(q, path[i]) < 2));

// Two parallel 200 m streets, 100 m apart.
const streets = {
  wA: { name: 'A St', pts: encodePath([ll(0, 0), ll(200, 0)]) },
  wB: { name: 'B St', pts: [ll(0, 100), ll(200, 100)] },
};
let c = new Coverage(streets);
assert.ok(c.pieces.length >= 16 && c.pieces.length <= 18);
assert.ok(Math.abs(c.stats().total - 400) < 4);
assert.equal(c.stats().covered, 0);

// Walking A St on the sidewalk (10 m off) covers A St only.
c.addStep(ll(-5, 10), ll(205, 10));
let s = c.stats();
assert.ok(c.wayStats('wA').pct > 0.99, 'A St covered');
assert.equal(c.wayStats('wB').covered, 0, 'B St untouched');
assert.ok(Math.abs(s.pct - 0.5) < 0.02);

// A walk 40 m away from B St does not count.
c.addStep(ll(0, 140), ll(200, 140));
assert.equal(c.wayStats('wB').covered, 0);

// Marking a street done by hand covers it, and undoing restores it.
c.setWayDone('wB', true);
assert.ok(c.stats().pct > 0.99);
c.setWayDone('wB', false);
assert.ok(Math.abs(c.stats().pct - 0.5) < 0.02);

// Pieces outside the area are left out.
const area = [ll(-10, -10), ll(100, -10), ll(100, 110), ll(-10, 110)];
assert.ok(pointInPolygon(ll(50, 50), area));
assert.ok(!pointInPolygon(ll(150, 50), area));
c = new Coverage(streets, area);
assert.ok(Math.abs(c.stats().total - 200) < 30, 'only the half inside the area');

// Overpass parsing and query.
const parsed = parseOverpass({
  elements: [
    { type: 'way', id: 7, tags: { name: 'Elm St', highway: 'residential' }, geometry: [{ lat: 37.97, lon: -122.03 }, { lat: 37.971, lon: -122.03 }] },
    { type: 'way', id: 8, tags: { highway: 'residential' }, geometry: [{ lat: 37.97, lon: -122.03 }] },
    { type: 'node', id: 9 },
  ],
});
assert.deepEqual(Object.keys(parsed), ['w7']);
assert.equal(parsed.w7.name, 'Elm St');
assert.match(overpassQuery(area), /poly:"37\.\d+ -122\.\d+ /);

// Speed: a 1000-house neighbourhood is ~30 km of street; 10 walkers x 3 h.
const big = {};
for (let i = 0; i < 30; i++) big['h' + i] = { name: 'H' + i, pts: [ll(0, i * 60), ll(1000, i * 60)] };
c = new Coverage(big);
const t0 = Date.now();
let prev = ll(0, 0);
for (let k = 0; k < 20000; k++) {
  const next = ll((k * 7) % 1000, Math.floor(k / 143) * 6);
  c.addStep(prev, next);
  prev = next;
}
const ms = Date.now() - t0;
assert.ok(ms < 3000, `coverage of 20k points took ${ms} ms`);

console.log(`coverage checks passed (${c.pieces.length} pieces, 20k points in ${ms} ms)`);
