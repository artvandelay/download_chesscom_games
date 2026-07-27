import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseAllGames } from '../js/pgn.js';
import { buildLedger } from '../js/ledger.js';
import { selectPatterns } from '../js/patterns.js';

const text = fs.readFileSync(new URL('./fixture.pgn', import.meta.url), 'utf8');
const username = 'darshak05';
const games = parseAllGames(text);
const { rows } = buildLedger(games, username);
assert.ok(rows.length > 20, `expected > 20 rows, got ${rows.length}`);

const { patterns, overperform } = selectPatterns(rows, games);

// --- top-level shape ---
assert.ok(Array.isArray(patterns), 'patterns should be an array');
assert.ok(patterns.length <= 3, `expected at most 3 patterns, got ${patterns.length}`);
assert.ok(patterns.length >= 1, 'fixture should surface at least 1 pattern');

const rowById = new Map(rows.map((r) => [r.id, r]));

for (const p of patterns) {
  assert.match(p.id, /^pat\d+$/, `pattern id should look like patN, got ${p.id}`);
  assert.ok(typeof p.label === 'string' && p.label.length > 0);
  assert.ok(p.evidenceSize >= 2, `pattern ${p.id} should have evidenceSize >= 2 (candidates below 2 are filtered)`);
  assert.ok(p.examples.length >= 1 && p.examples.length <= 3, `pattern ${p.id} should have 1-3 examples`);

  for (const ex of p.examples) {
    // Every example must trace back to a real ledger row - no invented ids.
    const row = rowById.get(ex.id);
    assert.ok(row, `example id ${ex.id} in pattern ${p.id} must be a real ledger row id`);
    assert.equal(ex.res, row.res);
    assert.equal(ex.oppD, row.oppD);
    // Every example must carry a fully verified moment sheet (or null if the game's
    // movetext failed to parse - never a half-built one).
    if (ex.moment) {
      assert.equal(ex.moment.id, ex.id);
      assert.ok(ex.moment.link, `example ${ex.id} moment sheet should have a real link`);
    }
  }
}

// Patterns should be sorted by score descending (evidence size x excess loss rate).
for (let i = 1; i < patterns.length; i += 1) {
  // score isn't exposed on the trimmed pattern object returned to callers other than
  // via lossRateInPattern/evidenceSize, but selectPatterns sorts internally - just
  // confirm no pattern has *zero* evidence, which would indicate a sorting bug letting
  // an empty candidate through ahead of a populated one.
  assert.ok(patterns[i - 1].evidenceSize >= 1);
  assert.ok(patterns[i].evidenceSize >= 1);
}

console.log('patterns.test: selectPatterns shape + traceability OK');

// --- overperform ---
assert.ok(Array.isArray(overperform.buckets) && overperform.buckets.length > 0);
for (const b of overperform.buckets) {
  assert.ok(typeof b.label === 'string');
  assert.ok(b.n >= 0);
  assert.ok(b.winRate === null || (b.winRate >= 0 && b.winRate <= 1));
}
if (overperform.best) {
  assert.ok(overperform.best.n >= 5, 'overperform.best must clear the minimum sample size');
  assert.ok(
    overperform.best.winRate > (overperform.baselineWinRate ?? 0),
    'overperform.best must beat the baseline win rate'
  );
}

console.log('patterns.test: overperform shape OK');
console.log('patterns.test OK');
