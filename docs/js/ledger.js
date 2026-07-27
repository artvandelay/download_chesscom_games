// Ledger construction: turns parsed Games into per-game behavioral rows + CSV.
// No DOM access; runs in browser and Node 18+.

import { CSV_HEADER, SESSION_GAP_S } from './constants.js';
import { extractClocks, countMoves } from './pgn.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a chess.com UTC date+time pair into epoch seconds and a display ts.
 * @param {string} dateStr 'YYYY.MM.DD'
 * @param {string} timeStr 'HH:MM:SS'
 * @returns {{epoch:number, ts:string}|null}
 */
function parseUtcDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const dateParts = dateStr.split('.').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  if (dateParts.length !== 3 || timeParts.length !== 3) return null;
  const [y, mo, da] = dateParts;
  const [hh, mi, se] = timeParts;
  if ([y, mo, da, hh, mi, se].some((n) => Number.isNaN(n))) return null;
  const epoch = Math.floor(Date.UTC(y, mo - 1, da, hh, mi, se) / 1000);
  const ts = `${y}-${pad2(mo)}-${pad2(da)}T${pad2(hh)}:${pad2(mi)}`;
  return { epoch, ts };
}

/**
 * Parse a chess.com TimeControl header into base seconds + increment seconds.
 * @param {string} tc
 * @returns {{base:number, inc:number}}
 */
function parseTimeControl(tc) {
  if (typeof tc !== 'string') return { base: 0, inc: 0 };
  const match = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim());
  if (!match) return { base: 0, inc: 0 };
  return { base: Number(match[1]), inc: match[2] ? Number(match[2]) : 0 };
}

function classifyTermination(termination) {
  const t = (termination || '').toLowerCase();
  if (t.includes('abandon')) return 'abandon';
  if (t.includes('checkmate')) return 'mate';
  if (t.includes('resignation')) return 'resign';
  if (t.includes('time')) return 'timeout';
  if (['agreement', 'stalemate', 'repetition', 'insufficient', '50'].some((s) => t.includes(s))) {
    return 'draw';
  }
  return 'other';
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Build the behavioral ledger (rows + raw-PGN store) for a player from parsed games.
 * @param {Array<{id:string, headers:Object<string,string>, movetext:string, raw:string}>} games
 * @param {string} username
 * @returns {{rows: Array<Object>, store: Map<string,string>}}
 */
export function buildLedger(games, username) {
  const uname = (username || '').toLowerCase();
  const store = new Map();
  const rows = [];

  for (const game of games) {
    const headers = game.headers || {};
    const white = (headers.White || '').toLowerCase();
    const black = (headers.Black || '').toLowerCase();
    if (white !== uname && black !== uname) continue;

    const color = white === uname ? 'W' : 'B';

    const result = headers.Result;
    let res;
    if (result === '1/2-1/2') {
      res = 'D';
    } else if (result === '1-0') {
      res = color === 'W' ? 'W' : 'L';
    } else if (result === '0-1') {
      res = color === 'B' ? 'W' : 'L';
    } else {
      res = 'D';
    }

    const ownEloRaw = color === 'W' ? headers.WhiteElo : headers.BlackElo;
    const oppEloRaw = color === 'W' ? headers.BlackElo : headers.WhiteElo;
    const rating = parseInt(ownEloRaw, 10) || 0;
    const oppElo = parseInt(oppEloRaw, 10) || 0;
    const oppD = oppElo - rating;

    const start = parseUtcDateTime(headers.UTCDate, headers.UTCTime);
    const end = parseUtcDateTime(headers.EndDate, headers.EndTime) || start;
    const epochStart = start ? start.epoch : 0;
    const epochEnd = end ? end.epoch : epochStart;
    const ts = start ? start.ts : '';

    const term = classifyTermination(headers.Termination);

    const { base, inc } = parseTimeControl(headers.TimeControl);
    const clocks = extractClocks(game.movetext || '');
    const myClocks = color === 'W' ? clocks.white : clocks.black;

    let clk12pct = 0;
    let mvU30s = null;
    let finclkS = 0;

    if (base > 0 && myClocks.length) {
      const idx12 = Math.min(11, myClocks.length - 1);
      clk12pct = clamp(Math.round((100 * (base - myClocks[idx12])) / base), 0, 100);

      const t = [];
      t[0] = Math.max(0, base - myClocks[0] + inc);
      for (let i = 1; i < myClocks.length; i += 1) {
        t[i] = Math.max(0, myClocks[i - 1] - myClocks[i] + inc);
      }

      const underPressureTimes = [];
      for (let i = 1; i < myClocks.length; i += 1) {
        if (myClocks[i - 1] < 30) underPressureTimes.push(t[i]);
      }
      const medianTime = median(underPressureTimes);
      mvU30s = medianTime === null ? null : Math.round(medianTime * 10) / 10;
      finclkS = Math.round(myClocks[myClocks.length - 1] * 10) / 10;
    }

    const moves = countMoves(game.movetext || '');
    const eco = headers.ECO || '?';
    const tc = headers.TimeControl || '?';

    rows.push({
      id: game.id,
      ts,
      epochStart,
      epochEnd,
      color,
      res,
      oppD,
      rating,
      tc,
      eco,
      term,
      gapS: 0,
      sess: 1,
      lstreak: 0,
      clk12pct,
      mvU30s,
      finclkS,
      moves,
    });
    store.set(game.id, game.raw);
  }

  rows.sort((a, b) => a.epochStart - b.epochStart);

  let prevEnd = null;
  let prevSess = 0;
  let streak = 0;
  for (const row of rows) {
    row.gapS = prevEnd === null ? 0 : Math.max(0, row.epochStart - prevEnd);
    row.sess = prevEnd === null || row.gapS > SESSION_GAP_S ? 1 : prevSess + 1;
    row.lstreak = streak;
    streak = row.res === 'L' ? streak + 1 : 0;
    prevEnd = row.epochEnd;
    prevSess = row.sess;
  }

  return { rows, store };
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Render ledger rows as CSV text (frozen column order).
 * @param {Array<Object>} rows
 * @returns {string}
 */
export function ledgerCsv(rows) {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.ts,
        row.color,
        row.res,
        signed(row.oppD),
        row.rating,
        row.tc,
        row.eco,
        row.term,
        row.gapS,
        row.sess,
        row.lstreak,
        row.clk12pct,
        row.mvU30s === null || row.mvU30s === undefined ? '' : row.mvU30s,
        row.finclkS,
        row.moves,
      ].join(',')
    );
  }
  return lines.join('\n');
}

/**
 * Build a short plain-text stats preamble for the given ledger rows.
 * @param {Array<Object>} rows
 * @param {string} username
 * @returns {string}
 */
export function summaryHeader(rows, username) {
  const total = rows.length;
  const wins = rows.filter((r) => r.res === 'W').length;
  const losses = rows.filter((r) => r.res === 'L').length;
  const draws = rows.filter((r) => r.res === 'D').length;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const lateNight = rows.filter((r) => {
    const hour = Number((r.ts || '').slice(11, 13));
    return !Number.isNaN(hour) && hour >= 0 && hour <= 5;
  }).length;
  const longLosingStreaks = rows.filter((r) => r.lstreak >= 3).length;

  const lines = [
    `Player: ${username}`,
    `Total games: ${total} (W:${wins} L:${losses} D:${draws})`,
    `First game: ${first ? first.ts : 'n/a'} (rating ${first ? first.rating : 'n/a'})`,
    `Last game: ${last ? last.ts : 'n/a'} (rating ${last ? last.rating : 'n/a'})`,
    `Games between 00:00-05:59 UTC: ${lateNight}`,
    `Games following a losing streak of 3+: ${longLosingStreaks}`,
  ];
  return lines.join('\n');
}
