import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseAllGames } from '../js/pgn.js';
import { buildLedger, ledgerCsv } from '../js/ledger.js';

const text = fs.readFileSync(new URL('./fixture.pgn', import.meta.url), 'utf8');
const username = 'darshak05';

const games = parseAllGames(text);
assert.ok(games.length > 20, `expected > 20 games, got ${games.length}`);

for (const g of games) {
  assert.ok(g.headers.White && g.headers.White.length > 0, `game ${g.id} missing headers.White`);
  assert.ok(g.movetext && g.movetext.length > 0, `game ${g.id} missing movetext`);
}

const involvedCount = games.filter(g => {
  const white = (g.headers.White || '').toLowerCase();
  const black = (g.headers.Black || '').toLowerCase();
  return white === username.toLowerCase() || black === username.toLowerCase();
}).length;

const { rows, store } = buildLedger(games, username);
assert.equal(rows.length, involvedCount, `expected rows.length === games count involving ${username}`);
assert.ok(store instanceof Map, 'store should be a Map');

for (const row of rows) {
  assert.ok(row.res === 'W' || row.res === 'L' || row.res === 'D', `unexpected res ${row.res} on row ${row.id}`);
}

for (let i = 1; i < rows.length; i++) {
  assert.ok(rows[i].epochStart >= rows[i - 1].epochStart, `rows not sorted by epochStart at index ${i}`);
}

if (rows.length > 0) {
  assert.equal(rows[0].gapS, 0, 'first row gapS should be 0');
}

for (const row of rows) {
  assert.ok(row.sess >= 1, `row ${row.id} has sess < 1`);
}

const csv = ledgerCsv(rows);
const lines = csv.split('\n');
assert.equal(lines.length, rows.length + 1, `expected ${rows.length + 1} CSV lines, got ${lines.length}`);

for (let i = 1; i < lines.length; i++) {
  const commaCount = (lines[i].match(/,/g) || []).length;
  assert.ok(commaCount >= 15, `data line ${i} has fewer than 15 commas: ${lines[i]}`);
}

assert.ok(!csv.includes('NaN'), 'csv should not contain NaN');

console.log('ledger.test OK');
