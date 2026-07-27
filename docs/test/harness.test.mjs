// Tests for the reworked "facts by code, judgment by LLM" harness: the mock provider
// exercises the facts-only-shaped path (its response JSON doesn't match the judgment
// contract, so no LLM prose survives - which is exactly the degrade-gracefully
// behavior this architecture promises), and an unrecognized provider name exercises
// the explicit LLM-failure fallback path. Both must still produce a fully useful,
// code-verified report.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Chess } from '../js/vendor/chess.js';
import { parseAllGames } from '../js/pgn.js';
import { runTiltMirror, buildFactSheet, assembleMarkdown, verifyAssembledReport } from '../js/harness.js';
import { buildLedger } from '../js/ledger.js';

const text = fs.readFileSync(new URL('./fixture.pgn', import.meta.url), 'utf8');
const username = 'darshak05';
const fixtureGames = parseAllGames(text);

// Ground truth index built directly from the raw fixture PGNs (NOT via the pipeline's
// own factSheet) - mirrors the independence of the Phase 1 spike's verify.js script.
const realByLink = new Map();
for (const g of fixtureGames) {
  if (g.headers.Link) realByLink.set(g.headers.Link, g);
}

function expectedResult(headers, color) {
  const raw = headers.Result;
  if (raw === '1/2-1/2') return 'draw';
  if (raw === '1-0') return color === 'w' ? 'win' : 'loss';
  if (raw === '0-1') return color === 'b' ? 'win' : 'loss';
  return 'unknown';
}

function colorOf(headers) {
  const uname = username.toLowerCase();
  if ((headers.White || '').toLowerCase() === uname) return 'w';
  if ((headers.Black || '').toLowerCase() === uname) return 'b';
  return null;
}

function sanOccursAtMove(movetext, moveNo, mover, san) {
  const chess = new Chess();
  chess.loadPgn(movetext || '');
  const history = chess.history();
  const idx = (moveNo - 1) * 2 + (mover === 'w' ? 0 : 1);
  return history[idx] === san;
}

const EXAMPLE_RE =
  /^- \*\*(g\d+)\*\* - \[(.*?)\]\((.*?)\) - vs (.*?) \((\w+), (.*?), opp ([+-]?\d+|n\/a), (.*?)\)$/;
const COLLAPSE_RE = /^\s*- Collapse: move (\d+) `(.*?)` swung material from ([+-]?\d+) to ([+-]?\d+)/;
const SECTION_RE = /^(##|- \*\*)/;

function parseExamplesFromMarkdown(md) {
  const lines = md.split('\n');
  const examples = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = EXAMPLE_RE.exec(lines[i]);
    if (!m) continue;
    const ex = { id: m[1], link: m[3], result: m[5], termination: m[6] };
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j += 1) {
      const cm = COLLAPSE_RE.exec(lines[j]);
      if (cm) {
        ex.collapseMoveNo = Number(cm[1]);
        ex.collapseSan = cm[2];
        break;
      }
      if (SECTION_RE.test(lines[j])) break;
    }
    examples.push(ex);
  }
  return examples;
}

function crossCheckMarkdownAgainstRawPgns(md) {
  const examples = parseExamplesFromMarkdown(md);
  assert.ok(examples.length > 0, 'should have parsed at least one example game out of the report');
  for (const ex of examples) {
    const real = realByLink.get(ex.link);
    assert.ok(real, `link "${ex.link}" cited in report must match a real game in the fixture PGNs`);
    const color = colorOf(real.headers);
    assert.ok(color, `matched game for ${ex.id} must have ${username} as White or Black`);
    assert.equal(
      expectedResult(real.headers, color),
      ex.result,
      `result mismatch for ${ex.id}: report says "${ex.result}"`
    );
    assert.equal(
      real.headers.Termination || '',
      ex.termination,
      `termination mismatch for ${ex.id}: report says "${ex.termination}"`
    );
    if (ex.collapseMoveNo && ex.collapseSan) {
      const okAsWhite = sanOccursAtMove(real.movetext, ex.collapseMoveNo, 'w', ex.collapseSan);
      const okAsBlack = sanOccursAtMove(real.movetext, ex.collapseMoveNo, 'b', ex.collapseSan);
      assert.ok(
        okAsWhite || okAsBlack,
        `collapse move "${ex.collapseSan}" at move ${ex.collapseMoveNo} for ${ex.id} must independently re-derive from the real movetext`
      );
    }
  }
  return examples;
}

// --- 1. Mock provider path (existing coverage, kept + strengthened) ---
{
  const statusLines = [];
  const report = await runTiltMirror({
    games: fixtureGames,
    username,
    provider: 'mock',
    apiKey: '',
    model: 'mock',
    userCustomization: '',
    onStatus: (s) => {
      statusLines.push(s);
      console.log('[status]', s);
    },
  });

  assert.ok(report.startsWith('# '), 'report should start with "# "');
  assert.ok(report.length > 40, `report should have length > 40, got ${report.length}`);
  assert.ok(statusLines.length >= 1, 'expected at least one status line to be emitted');
  assert.ok(report.includes('## Where you overperform'), 'report should always include the overperform section');
  assert.ok(!statusLines.some((s) => s.includes('VERIFICATION WARNING')), 'no verification warnings expected');

  crossCheckMarkdownAgainstRawPgns(report);

  console.log('harness.test: mock provider path OK');
}

// --- 2. Facts-only fallback path: an unrecognized provider makes chat() throw
// synchronously (no network needed), which must be caught and degrade to a
// facts-only report rather than propagate or produce a broken report. ---
{
  const statusLines = [];
  const report = await runTiltMirror({
    games: fixtureGames,
    username,
    provider: 'not-a-real-provider',
    apiKey: 'irrelevant',
    model: 'irrelevant',
    userCustomization: '',
    onStatus: (s) => statusLines.push(s),
  });

  assert.ok(report.startsWith('# '), 'facts-only report should still start with "# "');
  assert.ok(
    report.includes('Facts-only report'),
    'report should clearly disclose that it fell back to facts-only'
  );
  assert.ok(
    statusLines.some((s) => s.includes('falling back to a facts-only report')),
    'onStatus should report the LLM failure and the fallback'
  );
  // The banner is allowed (and expected) to surface the underlying error message for
  // transparency/debuggability - it is disclosed plainly inside the fallback banner,
  // never smuggled in as if it were LLM judgment prose.
  assert.ok(report.includes('Unknown provider'), 'the fallback banner should transparently disclose why the LLM call failed');

  const examples = crossCheckMarkdownAgainstRawPgns(report);
  assert.ok(examples.length > 0, 'facts-only report must still contain real, verified example games');

  console.log('harness.test: facts-only fallback path OK');
}

// --- 3. Assembler unit-level check: llmJson={} (no LLM at all) must still produce a
// complete, correctly-structured report with no prose slots rendered. ---
{
  const { rows, store } = buildLedger(fixtureGames, username);
  void store;
  const factSheet = buildFactSheet(username, rows, fixtureGames);
  const warnings = [];
  const md = assembleMarkdown(factSheet, {}, warnings, null);

  assert.ok(md.startsWith('# Tilt Mirror - ' + username));
  assert.equal(warnings.length, 0, 'no LLM text was given, so the sanitizer should have nothing to strip');
  assert.ok(!md.includes('Facts-only report'), 'no llmFailureReason was passed, so no fallback banner should render');

  const verification = verifyAssembledReport(md, factSheet);
  assert.ok(verification.ok, `verification should pass by construction: ${JSON.stringify(verification.issues)}`);

  console.log('harness.test: assembler with empty llmJson OK');
}

// --- 4. Sanitizer safety net: if the LLM ever DID leak a link/move-number/SAN token
// into a prose field (it shouldn't be able to - buildLlmPayload never gives it one),
// the assembler must strip it before it reaches the rendered report. ---
{
  const { rows } = buildLedger(fixtureGames, username);
  const factSheet = buildFactSheet(username, rows, fixtureGames);
  const warnings = [];
  const fakeLlmJson = {
    intro: 'Check out https://www.chess.com/game/live/999999 for proof, and note move 12 Nxg4 was key.',
    patterns: [],
    overperform: '',
    closing: '',
  };
  const md = assembleMarkdown(factSheet, fakeLlmJson, warnings, null);

  assert.ok(warnings.length >= 3, `expected sanitizer to flag the leaked url/move-number/SAN, got ${warnings.length}`);
  assert.ok(!md.includes('chess.com/game/live/999999'), 'leaked URL must not survive into the rendered report');
  assert.ok(!md.includes('Nxg4'), 'leaked SAN token must not survive into the rendered report');
  // Note: legitimate code-rendered example lines ("Collapse: move 12 `Qxf1#` ...")
  // also contain the words "move" + a number, so we don't assert their absence from
  // the whole document - only that the LLM's specific fabricated phrase is gone.
  assert.ok(!md.includes('note move 12 Nxg4'), 'leaked move-number+SAN phrase must not survive verbatim');

  console.log('harness.test: sanitizer strip-on-sight safety net OK');
}

// --- 5. Regression: game ids in the g1-g8 range are character-for-character
// identical to real chess squares (file g, rank 1-8), so the SAN-stripping regex
// must not eat a legitimate game-id citation the LLM copied verbatim from its
// payload (e.g. "g2" referring to game g2, not the square g2). ---
{
  const { rows } = buildLedger(fixtureGames, username);
  const factSheet = buildFactSheet(username, rows, fixtureGames);
  assert.ok(
    factSheet.patterns.some((p) => p.examples.some((ex) => /^g[1-8]$/.test(ex.id))),
    'fixture should exercise at least one game id in the g1-g8 collision range for this test to be meaningful'
  );
  const collidingId = factSheet.patterns
    .flatMap((p) => p.examples)
    .map((ex) => ex.id)
    .find((id) => /^g[1-8]$/.test(id));

  const warnings = [];
  const fakeLlmJson = {
    intro: '',
    patterns: [
      {
        id: factSheet.patterns[0].id,
        diagnosis: `Games like ${collidingId} and others show this pattern repeatedly.`,
        prescription: '',
      },
    ],
    overperform: '',
    closing: '',
  };
  const md = assembleMarkdown(factSheet, fakeLlmJson, warnings, null);

  assert.ok(
    md.includes(`Games like ${collidingId} and others`),
    `game id "${collidingId}" must survive the sanitizer intact, not be redacted as a SAN square`
  );
  assert.ok(
    !warnings.some((w) => w.includes('SAN-move-shaped')),
    `no SAN warning should fire for a whitelisted game id, got: ${JSON.stringify(warnings)}`
  );

  console.log('harness.test: game-id vs SAN-square collision regression OK');
}

// --- 6. Opening-move invention cleanup: if the LLM writes "1.b3" / "1.e4" from its
// own chess knowledge, the final prose must not contain "[move removed]" markers -
// dangling redaction artifacts are scrubbed into readable language. ---
{
  const { rows } = buildLedger(fixtureGames, username);
  const factSheet = buildFactSheet(username, rows, fixtureGames);
  const warnings = [];
  const fakeLlmJson = {
    intro: 'You keep reaching for 1.b3 even though the Nimzowitsch-Larsen keeps backfiring.',
    patterns: [
      {
        id: factSheet.patterns[0].id,
        diagnosis: 'Ban 1.b3 for a month and play 1.e4 or 1.d4 instead.',
        prescription: 'If the urge hits, play 1.Nf3.',
      },
    ],
    overperform: '',
    closing: '',
  };
  const md = assembleMarkdown(factSheet, fakeLlmJson, warnings, null);

  assert.ok(!md.includes('[move removed]'), 'final report must not contain visible [move removed] markers');
  assert.ok(!md.includes('1.b3'), 'invented opening move 1.b3 must not survive');
  assert.ok(!md.includes('1.e4'), 'invented opening move 1.e4 must not survive');
  assert.ok(warnings.some((w) => w.includes('SAN-move-shaped')), 'sanitizer should still flag the invented SAN');
  assert.ok(md.includes('that opening') || md.includes('Nimzowitsch'), 'prose should still read after scrub');

  console.log('harness.test: opening-move invention cleanup OK');
}

// --- 7. Opening-reply list debris: "against 1.d4 or 1.e4 or 1.c4" must not become
// "against or or" in the final report. ---
{
  const { rows } = buildLedger(fixtureGames, username);
  const factSheet = buildFactSheet(username, rows, fixtureGames);
  const warnings = [];
  const fakeLlmJson = {
    intro: '',
    patterns: [
      {
        id: factSheet.patterns[0].id,
        diagnosis: '',
        prescription:
          'When you queue up, write down the first move you will play as Black against 1.d4 or 1.e4 or 1.c4 on a Post-it note.',
      },
    ],
    overperform: '',
    closing: '',
  };
  const md = assembleMarkdown(factSheet, fakeLlmJson, warnings, null);
  assert.ok(!md.includes('[move removed]'), 'no redaction markers');
  assert.ok(!/\bor\s+or\b/i.test(md), `must not leave "or or" debris, got: ${md}`);
  assert.ok(md.toLowerCase().includes('against common replies') || !md.includes('against or'), 'debris scrubbed');

  console.log('harness.test: opening-reply list debris cleanup OK');
}

console.log('harness.test OK');
