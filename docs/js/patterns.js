// Deterministic pattern selection over ledger rows (browser port of spike/patterns.js).
// Every number here is computed from the rows/games passed in - nothing is invented,
// nothing comes from the LLM. No DOM access; runs in browser and Node 18+.
import { buildMomentSheet } from './moments.js';

const COLOR_MAP = { W: 'w', B: 'b' };

function round2(n) {
  return n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}
function round3(n) {
  return n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 1000) / 1000;
}
function lossRate(rows) {
  if (!rows.length) return 0;
  return rows.filter((r) => r.res === 'L').length / rows.length;
}
function winRate(rows) {
  if (!rows.length) return null;
  return rows.filter((r) => r.res === 'W').length / rows.length;
}
function hourOf(row) {
  const h = Number((row.ts || '').slice(11, 13));
  return Number.isNaN(h) ? null : h;
}

/**
 * Build every candidate behavioral pattern with its evidence rows, then score each by
 * (evidence size x excess loss rate over baseline). Deterministic, code-only.
 */
function buildCandidates(rows) {
  const baseline = lossRate(rows);
  const candidates = [];

  const requeueRows = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i - 1].res === 'L' && rows[i].gapS <= 120) requeueRows.push(rows[i]);
  }
  candidates.push({
    type: 'requeue',
    label: 'Instant requeue after a loss',
    rows: requeueRows,
    metricNote: `${requeueRows.length} of ${rows.length} games were started within 2 minutes of a loss`,
  });

  const sessionDeepRows = rows.filter((r) => r.sess >= 3);
  candidates.push({
    type: 'session-decay',
    label: 'Performance decay deep into a session',
    rows: sessionDeepRows,
    metricNote: `${sessionDeepRows.length} of ${rows.length} games were the 3rd+ game of a session`,
  });

  const lateNightRows = rows.filter((r) => {
    const h = hourOf(r);
    return h !== null && h >= 0 && h <= 5;
  });
  candidates.push({
    type: 'late-night',
    label: 'Late-night play (00:00-05:59 UTC)',
    rows: lateNightRows,
    metricNote: `${lateNightRows.length} of ${rows.length} games were played 00:00-05:59 UTC`,
  });

  const timeoutRows = rows.filter((r) => r.term === 'timeout');
  candidates.push({
    type: 'time-panic',
    label: 'Losses on the clock (time panic)',
    rows: timeoutRows,
    metricNote: `${timeoutRows.length} of ${rows.length} games ended on time`,
  });

  const egoRows = rows.filter((r) => r.oppD <= -50 && r.res === 'L');
  candidates.push({
    type: 'ego-vs-oppD',
    label: 'Losses to notably lower-rated opponents',
    rows: egoRows,
    metricNote: `${egoRows.length} losses to opponents rated 50+ points below`,
  });

  const ecoGroups = new Map();
  for (const r of rows) {
    if (!ecoGroups.has(r.eco)) ecoGroups.set(r.eco, []);
    ecoGroups.get(r.eco).push(r);
  }
  let worstEco = null;
  let worstEcoRows = [];
  let worstEcoScore = -Infinity;
  for (const [eco, ecoRows] of ecoGroups) {
    if (eco === '?' || ecoRows.length < 3) continue;
    const lr = lossRate(ecoRows);
    if (lr <= baseline) continue;
    const s = (lr - baseline) * ecoRows.length;
    if (s > worstEcoScore) {
      worstEcoScore = s;
      worstEco = eco;
      worstEcoRows = ecoRows;
    }
  }
  candidates.push({
    type: 'opening-rut',
    label: worstEco ? `Recurring trouble in ECO ${worstEco} openings` : 'Opening rut',
    rows: worstEcoRows,
    metricNote: worstEco
      ? `${worstEcoRows.length} games opened ECO ${worstEco}, lost at ${round2(lossRate(worstEcoRows) * 100)}% vs baseline ${round2(baseline * 100)}%`
      : 'no recurring ECO code crossed the loss-rate threshold',
    meta: { eco: worstEco },
  });

  const abandonRows = rows.filter((r) => r.term === 'abandon');
  candidates.push({
    type: 'abandon-tells',
    label: 'Walking away mid-game',
    rows: abandonRows,
    metricNote: `${abandonRows.length} of ${rows.length} games were abandoned`,
  });

  return candidates.map((c) => {
    const evidenceSize = c.rows.length;
    const lr = lossRate(c.rows);
    const excess = Math.max(0, lr - baseline);
    const score = evidenceSize * excess;
    return {
      ...c,
      evidenceSize,
      lossRateInPattern: round2(lr),
      baselineLossRate: round2(baseline),
      score: round3(score),
    };
  });
}

/**
 * Explicit, deterministic example-selection rule per pattern type.
 */
function pickExampleRows(candidate) {
  const sorted = [...candidate.rows];
  switch (candidate.type) {
    case 'requeue':
      sorted.sort((a, b) => a.gapS - b.gapS); // smallest gap after a loss
      break;
    case 'time-panic':
      sorted.sort((a, b) => {
        const av = a.mvU30s === null || a.mvU30s === undefined ? Infinity : a.mvU30s;
        const bv = b.mvU30s === null || b.mvU30s === undefined ? Infinity : b.mvU30s;
        return av - bv; // lowest median seconds-per-move while under 30s
      });
      break;
    case 'session-decay':
      sorted.sort((a, b) => b.sess - a.sess); // deepest into a session first
      break;
    case 'late-night':
      sorted.sort((a, b) => Math.abs(hourOf(a) - 2.5) - Math.abs(hourOf(b) - 2.5)); // closest to ~2:30am
      break;
    case 'ego-vs-oppD':
      sorted.sort((a, b) => a.oppD - b.oppD); // most negative oppD = weakest opponent lost to
      break;
    case 'opening-rut':
    case 'abandon-tells':
      sorted.sort((a, b) => b.epochStart - a.epochStart); // most recent recurrence first
      break;
    default:
      break;
  }
  return sorted.slice(0, 3);
}

function pickRowFacts(row) {
  return {
    ts: row.ts,
    color: row.color,
    res: row.res,
    oppD: row.oppD,
    rating: row.rating,
    tc: row.tc,
    eco: row.eco,
    term: row.term,
    gapS: row.gapS,
    sess: row.sess,
    lstreak: row.lstreak,
    clk12pct: row.clk12pct,
    mvU30s: row.mvU30s,
    finclkS: row.finclkS,
    moves: row.moves,
  };
}

function buildOverperform(rows) {
  const baseline = winRate(rows);
  const buckets = [];
  const add = (key, label, subset) =>
    buckets.push({ key, label, n: subset.length, winRate: round2(winRate(subset)) });

  add('playing-up-in-rating', 'Games vs higher-rated opponents (oppD > 0)', rows.filter((r) => r.oppD > 0));
  add('playing-down-in-rating', 'Games vs lower-rated opponents (oppD < 0)', rows.filter((r) => r.oppD < 0));
  add('first-game-of-session', 'First game of a session', rows.filter((r) => r.sess === 1));
  add('deep-in-session', '3rd+ game of a session', rows.filter((r) => r.sess >= 3));
  add(
    'daytime',
    'Daytime play (06:00-17:59 UTC)',
    rows.filter((r) => {
      const h = hourOf(r);
      return h !== null && h >= 6 && h <= 17;
    })
  );
  add(
    'evening-night',
    'Evening/night play (18:00-23:59 or 00:00-05:59 UTC)',
    rows.filter((r) => {
      const h = hourOf(r);
      return h !== null && (h >= 18 || h <= 5);
    })
  );
  add('after-a-win', 'Games immediately following a win', rows.filter((r, i) => i > 0 && rows[i - 1].res === 'W'));
  add('no-recent-losses', 'Games with no losing streak going in (lstreak = 0)', rows.filter((r) => r.lstreak === 0));

  const qualifying = buckets.filter((b) => b.n >= 5 && b.winRate !== null && b.winRate > (baseline ?? 0));
  qualifying.sort((a, b) => b.winRate - a.winRate);
  const best = qualifying[0] || null;

  return { baselineWinRate: round2(baseline), buckets, best };
}

/**
 * Select the top 3 behavioral patterns by (evidence size x rating cost) and attach
 * 2-3 verified example moment sheets to each.
 * @param {Array<Object>} rows ledger rows (already sorted/annotated by buildLedger)
 * @param {Array<{id:string, headers:Object, movetext:string}>} games parsed games matching those rows
 */
export function selectPatterns(rows, games) {
  const gameById = new Map(games.map((g) => [g.id, g]));

  const candidates = buildCandidates(rows).filter((c) => c.evidenceSize >= 2);
  candidates.sort((a, b) => b.score - a.score);
  const top3 = candidates.slice(0, 3);

  const patterns = top3.map((c, idx) => {
    const exampleRows = pickExampleRows(c);
    const examples = exampleRows.map((row) => {
      const game = gameById.get(row.id);
      const color = COLOR_MAP[row.color];
      const moment = game ? buildMomentSheet(game, color) : null;
      return { id: row.id, ...pickRowFacts(row), moment };
    });
    return {
      id: `pat${idx + 1}`,
      type: c.type,
      label: c.label,
      evidenceSize: c.evidenceSize,
      lossRateInPattern: c.lossRateInPattern,
      baselineLossRate: c.baselineLossRate,
      score: c.score,
      metricNote: c.metricNote,
      examples,
    };
  });

  const overperform = buildOverperform(rows);

  return { patterns, overperform };
}
