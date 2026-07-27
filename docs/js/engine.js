// Optional "Deep analysis" engine: wraps a single-threaded stockfish.wasm build in a
// Web Worker to evaluate a small, rule-preselected set of key positions (the collapse
// move and the final position) chosen by moments.js/patterns.js. This module is
// dynamically imported by harness.js ONLY when the user opts in - the core Tilt
// Mirror report works perfectly if this file is never loaded, never reachable, or
// fails outright (network down, CSP block, browser without WASM, etc).
//
// CDN notes (both tested live end-to-end while building this module - a real UCI
// handshake plus a real `go depth` search, not just a reachability check):
// 1. jsdelivr refuses to serve individual files out of the `stockfish` npm package -
//    the package's *unpacked* size exceeds jsdelivr's 150MB per-package limit, so
//    every jsdelivr URL for it returns HTTP 403, even for a single small file.
//    unpkg.com serves the same npm package's individual files fine (HTTP 200,
//    `Access-Control-Allow-Origin: *`), so this module loads the "lite
//    single-threaded" WASM build (no COOP/COEP headers required) from unpkg.
// 2. `new Worker(<that unpkg URL>)` directly is blocked by the browser's same-origin
//    policy for classic Worker scripts (confirmed live: "Failed to construct
//    'Worker': Script at '...' cannot be accessed from origin ..."). This module
//    instead creates the worker from the same-origin docs/js/engine-worker.js, which
//    `importScripts()`s the CDN script (allowed cross-origin, unlike direct Worker
//    construction) - and passes the real wasm URL through a URL hash fragment, which
//    this Stockfish build explicitly supports as a wasm-location override (without
//    it, the script would incorrectly resolve its .wasm companion relative to the
//    *wrapper's* own same-origin URL instead of the CDN's).
// If unpkg ever becomes unavailable, see docs/README.md for exactly which two files
// to vendor locally and the one-line URL change (here and in engine-worker.js) that
// points at them instead.
const ENGINE_VERSION = '18.0.8';
const ENGINE_WASM_URL = `https://unpkg.com/stockfish@${ENGINE_VERSION}/bin/stockfish-18-lite-single.wasm`;
const HANDSHAKE_TIMEOUT_MS = 30000;
const ANALYSIS_TIMEOUT_MS = 20000;
const DEFAULT_DEPTH = 12;

let workerReadyPromise = null;
let queue = Promise.resolve();

function createWorker() {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      const workerEntryUrl = new URL('./engine-worker.js', import.meta.url).toString();
      // The hash fragment is this Stockfish build's documented wasm-location
      // override; see engine-worker.js and the CDN notes above for why it's needed.
      worker = new Worker(workerEntryUrl + '#' + encodeURIComponent(ENGINE_WASM_URL));
    } catch (err) {
      reject(new Error(`could not start the Stockfish worker (${err.message})`));
      return;
    }

    const timeout = setTimeout(() => {
      worker.onmessage = null;
      worker.onerror = null;
      reject(new Error('Stockfish worker did not complete its UCI handshake within 30s'));
    }, HANDSHAKE_TIMEOUT_MS);

    worker.onerror = (err) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `Stockfish worker failed to load from unpkg (${err.message || 'script error'}) - likely a CSP/CORS/network block`
        )
      );
    };
    worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line.includes('uciok')) {
        clearTimeout(timeout);
        worker.onmessage = null;
        resolve(worker);
      }
    };
    worker.postMessage('uci');
  });
}

function getWorker() {
  if (!workerReadyPromise) workerReadyPromise = createWorker();
  return workerReadyPromise;
}

/**
 * Analyze one FEN position to a given depth via the single-threaded engine. Calls
 * are internally serialized (there is exactly one worker/engine instance), so
 * callers may issue several calls back-to-back without their own queueing.
 * @param {string} fen
 * @param {{depth?: number}} [opts]
 * @returns {Promise<{cp: number|null, mate: number|null, bestMove: string|null}>}
 */
export function analyzePosition(fen, { depth = DEFAULT_DEPTH } = {}) {
  const run = async () => {
    const worker = await getWorker();
    return new Promise((resolve, reject) => {
      const best = { cp: null, mate: null, bestMove: null };
      const timeout = setTimeout(() => {
        worker.onmessage = null;
        reject(new Error(`Stockfish did not finish analyzing within 20s (depth ${depth})`));
      }, ANALYSIS_TIMEOUT_MS);

      worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line.startsWith('info') && line.includes(' score ')) {
          const cpMatch = / score cp (-?\d+)/.exec(line);
          const mateMatch = / score mate (-?\d+)/.exec(line);
          if (mateMatch) {
            best.mate = Number(mateMatch[1]);
            best.cp = null;
          } else if (cpMatch) {
            best.cp = Number(cpMatch[1]);
            best.mate = null;
          }
        } else if (line.startsWith('bestmove')) {
          const m = /bestmove (\S+)/.exec(line);
          best.bestMove = m ? m[1] : null;
          clearTimeout(timeout);
          worker.onmessage = null;
          resolve({ ...best });
        }
      };

      worker.postMessage('position fen ' + fen);
      worker.postMessage('go depth ' + depth);
    });
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

/**
 * Best-effort feature/availability probe: resolves true if the engine worker can be
 * created and completes its UCI handshake. Intended for the UI to disable the "Deep
 * analysis" checkbox proactively instead of only failing when the user runs a report.
 * @returns {Promise<boolean>}
 */
export async function isEngineAvailable() {
  try {
    await getWorker();
    return true;
  } catch (err) {
    console.warn('[engine] Stockfish unavailable:', err.message);
    return false;
  }
}

// UCI scores are always from the perspective of the side to move AT that FEN.
// Normalize to a single player's perspective so "before" and "after" an opponent's
// reply are directly comparable (positive = good for that player).
function toPlayerPerspective(evalResult, sideToMoveAtFen, playerColor) {
  if (!evalResult) return evalResult;
  const flip = sideToMoveAtFen !== playerColor;
  return {
    cp: evalResult.cp === null || evalResult.cp === undefined ? null : (flip ? -1 : 1) * evalResult.cp,
    mate: evalResult.mate === null || evalResult.mate === undefined ? null : (flip ? -1 : 1) * evalResult.mate,
    bestMove: evalResult.bestMove,
  };
}

/**
 * Evaluate the small, rule-preselected set of key positions (the collapse move's
 * before/after FENs, and the final position) for every example game already chosen
 * by patterns.js, and mutate `factSheet` in place with the results (all evals are
 * normalized to that example's own player's perspective). This is the only place in
 * the app that ever asserts a soundness/"blunder"-style claim - and it does so with a
 * real engine, never the LLM, honoring the honesty boundary in the project's design
 * decisions (material/clock facts don't need the engine; blunder claims do).
 * @param {Object} factSheet mutated in place
 * @param {{onStatus?: (s:string)=>void, depth?: number}} [opts]
 * @returns {Promise<{evaluated: number, skipped: boolean, reason?: string}>}
 */
export async function annotateFactSheetWithEngine(factSheet, { onStatus, depth = DEFAULT_DEPTH } = {}) {
  const notify = onStatus || (() => {});

  const jobs = [];
  for (const pattern of factSheet.patterns || []) {
    for (const example of pattern.examples || []) {
      const m = example.moment;
      if (!m) continue;
      if (m.collapseMove && m.collapseMove.fenBefore && m.collapseMove.fenAfter) {
        jobs.push({ example, kind: 'collapse' });
      }
      if (m.finalMoves && m.finalMoves.length) {
        jobs.push({ example, kind: 'final' });
      }
    }
  }

  if (!jobs.length) {
    notify('Deep analysis: no key positions to evaluate.');
    return { evaluated: 0, skipped: true, reason: 'no positions' };
  }

  notify(`Deep analysis: evaluating ${jobs.length} key position(s) at depth ${depth}…`);
  let done = 0;
  for (const job of jobs) {
    const m = job.example.moment;
    try {
      if (job.kind === 'collapse') {
        const cm = m.collapseMove;
        const rawBefore = await analyzePosition(cm.fenBefore, { depth });
        const rawAfter = await analyzePosition(cm.fenAfter, { depth });
        cm.engine = {
          before: toPlayerPerspective(rawBefore, cm.mover, m.color),
          after: toPlayerPerspective(rawAfter, cm.mover === 'w' ? 'b' : 'w', m.color),
        };
      } else {
        const last = m.finalMoves[m.finalMoves.length - 1];
        const sideToMoveAtFinal = last.mover === 'w' ? 'b' : 'w';
        const rawFinal = await analyzePosition(last.fen, { depth });
        m.endState.engine = { final: toPlayerPerspective(rawFinal, sideToMoveAtFinal, m.color) };
      }
    } catch (err) {
      notify(`Deep analysis: stopped early after ${done}/${jobs.length} position(s) (${err.message}).`);
      return { evaluated: done, skipped: true, reason: err.message };
    }
    done += 1;
    notify(`Deep analysis: ${done}/${jobs.length} position(s) evaluated.`);
  }

  return { evaluated: done, skipped: false };
}
