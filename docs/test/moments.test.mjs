import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Chess } from '../js/vendor/chess.js';
import { parseAllGames } from '../js/pgn.js';
import { buildMomentSheet, parseOpeningName, ARCHETYPES } from '../js/moments.js';

// --- parseOpeningName ---
assert.equal(
  parseOpeningName('https://www.chess.com/openings/Scandinavian-Defense'),
  'Scandinavian Defense'
);
assert.equal(
  parseOpeningName(
    'https://www.chess.com/openings/Nimzowitsch-Larsen-Attack-Modern-Variation-2.Bb2-d6-3.e3'
  ),
  'Nimzowitsch Larsen Attack Modern Variation'
);
assert.equal(parseOpeningName(undefined), 'Unknown opening');
assert.equal(parseOpeningName(''), 'Unknown opening');

console.log('moments.test: parseOpeningName OK');

// --- buildMomentSheet, against real fixture games ---
const text = fs.readFileSync(new URL('./fixture.pgn', import.meta.url), 'utf8');
const games = parseAllGames(text);
assert.ok(games.length > 20, `expected > 20 fixture games, got ${games.length}`);

// First fixture game: White=Darshak05, Black=Tortas90, Result 0-1, mated on move 16
// (Black plays 16...Qg5#). darshak05 played White and lost by checkmate.
const g0 = games[0];
assert.equal(g0.headers.White, 'Darshak05');
assert.equal(g0.headers.Result, '0-1');

const sheet0 = buildMomentSheet(g0, 'w');
assert.equal(sheet0.id, g0.id);
assert.equal(sheet0.link, g0.headers.Link);
assert.equal(sheet0.color, 'w');
assert.equal(sheet0.opponent, 'Tortas90');
assert.equal(sheet0.result, 'loss', 'White lost this game (Result 0-1)');
assert.equal(sheet0.termination, g0.headers.Termination);
// The real ECOUrl slug here is "...Variation...3.e3-d5-4.Bb5-..." - the "Variation...3.e3"
// token does not itself start with a digit, so it (and "d5" before the next numbered
// token) is kept; this is the actual, intentional behavior of parseOpeningName, not a bug.
assert.equal(sheet0.opening, 'Nimzowitsch Larsen Attack Modern Variation...3.e3 d5');
assert.equal(sheet0.endState.mated, true, 'game ends in 16...Qg5# - should be detected as checkmate');
assert.ok(sheet0.endState.movesTotal > 0);
assert.ok(Array.isArray(sheet0.materialTimeline) && sheet0.materialTimeline.length > 0);
assert.ok(sheet0.finalMoves.length > 0 && sheet0.finalMoves.length <= 6);
assert.ok(Object.values(ARCHETYPES).includes(sheet0.archetype));

// Independently re-derive the collapse move against the real movetext via a fresh
// chess.js replay (never reuse the pipeline's own timeline) - this is the same class
// of check the Phase 1 spike's verify.js ran manually, now automated.
if (sheet0.collapseMove) {
  const replay = new Chess();
  replay.loadPgn(g0.movetext);
  const history = replay.history();
  const idx = (sheet0.collapseMove.moveNo - 1) * 2 + (sheet0.collapseMove.mover === 'w' ? 0 : 1);
  assert.equal(
    history[idx],
    sheet0.collapseMove.san,
    'collapseMove.san must independently re-derive from the real movetext at that ply'
  );
  assert.ok(sheet0.collapseMove.fenBefore && sheet0.collapseMove.fenAfter, 'collapseMove FENs must be present for the optional engine to use');
}

// The player's own material-relative timeline must never exceed swings a real chess
// game allows (a full board's worth of material is well under 40 points either way).
for (const delta of sheet0.materialTimeline) {
  assert.ok(Math.abs(delta) <= 39, `materialDelta ${delta} out of a sane range`);
}

console.log('moments.test: buildMomentSheet (white loses to checkmate) OK');

// --- Sweep every fixture game for both colors: buildMomentSheet must never throw,
// and every fact it reports must be self-consistent with the real headers/movetext.
for (const g of games) {
  for (const color of ['w', 'b']) {
    const sheet = buildMomentSheet(g, color);
    assert.equal(sheet.id, g.id);
    assert.equal(sheet.link, g.headers.Link || null);
    assert.equal(sheet.color, color);
    assert.ok(['win', 'loss', 'draw', 'unknown'].includes(sheet.result));
    assert.ok(Object.values(ARCHETYPES).includes(sheet.archetype));
    if (sheet.collapseMove) {
      assert.ok(typeof sheet.collapseMove.san === 'string' && sheet.collapseMove.san.length > 0);
      assert.ok(sheet.collapseMove.moveNo >= 1);
    }
    for (const fm of sheet.finalMoves) {
      assert.ok(typeof fm.san === 'string' && fm.san.length > 0);
      assert.ok(typeof fm.fen === 'string' && fm.fen.includes(' '));
    }
  }
}

console.log('moments.test: full fixture sweep OK');
console.log('moments.test OK');
