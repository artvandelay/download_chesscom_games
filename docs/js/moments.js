// Rules layer (browser port of spike/moments.js): replays a game's real moves with
// chess.js and returns a fully code-verified "moment sheet". Nothing in this file is
// LLM-authored; every field is derived deterministically from the game's own PGN
// headers/movetext. No DOM access; runs in browser (via <script type="module">) and
// Node 18+ (docs/test/*.mjs).
import { Chess } from './vendor/chess.js';
import { extractClocks } from './pgn.js';

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const ARCHETYPES = {
  TIMEOUT: 'timeout-scramble',
  MATERIAL: 'material-collapse',
  OPENING: 'opening-disaster',
  RESIGN_HOLDABLE: 'resigned-in-holdable',
  LATE_NIGHT: 'late-night',
  OTHER: 'other',
};

function materialFor(board, side) {
  let total = 0;
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.color === side) total += PIECE_VALUES[sq.type];
    }
  }
  return total;
}

/**
 * Parse a human opening name out of a chess.com ECOUrl slug.
 * e.g. ".../openings/Scandinavian-Defense" -> "Scandinavian Defense"
 * ".../openings/Nimzowitsch-Larsen-Attack-Modern-Variation-2.Bb2-d6-3.e3" -> "Nimzowitsch Larsen Attack Modern Variation"
 * @param {string|undefined} ecoUrl
 * @returns {string}
 */
export function parseOpeningName(ecoUrl) {
  if (!ecoUrl) return 'Unknown opening';
  let slug;
  try {
    slug = new URL(ecoUrl).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    slug = ecoUrl.split('/').filter(Boolean).pop() || '';
  }
  const tokens = slug.split('-');
  const nameTokens = [];
  for (const tok of tokens) {
    if (/^\d/.test(tok)) break; // move-number annotations (e.g. "2.Bb2") mark the end of the opening name
    nameTokens.push(tok);
  }
  return nameTokens.length ? nameTokens.join(' ') : slug || 'Unknown opening';
}

/**
 * Replay one game's real moves via chess.js and build a fully verified moment sheet
 * from one player's point of view. Every fact here is computed, never guessed.
 *
 * Includes a `fen` on `collapseMove` and each `finalMoves` entry (the position AFTER
 * that ply) so the optional Deep Analysis engine (docs/js/engine.js) can evaluate
 * exactly these rule-preselected key positions without ever needing to touch the LLM
 * or re-derive positions itself.
 *
 * @param {{id:string, headers:Object<string,string>, movetext:string}} game
 * @param {'w'|'b'} color which side this player played
 */
export function buildMomentSheet(game, color) {
  const headers = game.headers || {};
  const oppColor = color === 'w' ? 'b' : 'w';

  const chess = new Chess();
  let loadOk = true;
  try {
    // chess.js's PGN loader accepts chess.com's {[%clk ...]} comments directly.
    chess.loadPgn(game.movetext || '');
  } catch {
    loadOk = false;
  }

  const sanHistory = loadOk ? chess.history() : [];
  const clocks = extractClocks(game.movetext || '');

  const replay = new Chess();
  const timeline = [];
  for (let i = 0; i < sanHistory.length; i += 1) {
    try {
      replay.move(sanHistory[i]);
    } catch {
      break; // never fabricate past an unparseable move; timeline is honestly truncated instead
    }
    const mover = i % 2 === 0 ? 'w' : 'b';
    const board = replay.board();
    const myMaterial = materialFor(board, color);
    const oppMaterial = materialFor(board, oppColor);
    const clockArr = mover === 'w' ? clocks.white : clocks.black;
    const clockSeconds = clockArr[Math.floor(i / 2)] ?? null;
    timeline.push({
      ply: i + 1,
      moveNo: Math.floor(i / 2) + 1,
      mover,
      san: sanHistory[i],
      clockSeconds,
      materialDelta: myMaterial - oppMaterial,
      fen: replay.fen(),
    });
  }

  // collapseMove: the single ply with the largest adverse swing in the player's material delta.
  let collapseMove = null;
  let worstSwing = 0;
  for (let i = 0; i < timeline.length; i += 1) {
    const deltaBefore = i === 0 ? 0 : timeline[i - 1].materialDelta;
    const deltaAfter = timeline[i].materialDelta;
    const swing = deltaAfter - deltaBefore;
    if (swing < worstSwing) {
      worstSwing = swing;
      const entry = timeline[i];
      const priorSameMover = timeline.slice(0, i).filter((t) => t.mover === entry.mover).pop();
      collapseMove = {
        moveNo: entry.moveNo,
        san: entry.san,
        mover: entry.mover,
        clockBefore: priorSameMover ? priorSameMover.clockSeconds : null,
        clockAfter: entry.clockSeconds,
        deltaBefore,
        deltaAfter,
        fenBefore: i === 0 ? new Chess().fen() : timeline[i - 1].fen,
        fenAfter: entry.fen,
      };
    }
  }

  const finalMoves = timeline.slice(-6).map((t) => ({
    moveNo: t.moveNo,
    mover: t.mover,
    san: t.san,
    clockSeconds: t.clockSeconds,
    fen: t.fen,
  }));

  const finalMaterialDelta = timeline.length ? timeline[timeline.length - 1].materialDelta : 0;
  const movesTotal = timeline.length ? timeline[timeline.length - 1].moveNo : 0;

  const rawResult = headers.Result;
  let result = 'unknown';
  if (rawResult === '1/2-1/2') result = 'draw';
  else if (rawResult === '1-0') result = color === 'w' ? 'win' : 'loss';
  else if (rawResult === '0-1') result = color === 'b' ? 'win' : 'loss';

  const termination = headers.Termination || 'unknown';
  const termLower = termination.toLowerCase();

  const ownEloRaw = color === 'w' ? headers.WhiteElo : headers.BlackElo;
  const oppEloRaw = color === 'w' ? headers.BlackElo : headers.WhiteElo;
  const ownElo = parseInt(ownEloRaw, 10);
  const oppElo = parseInt(oppEloRaw, 10);
  const ratingDelta = Number.isFinite(ownElo) && Number.isFinite(oppElo) ? oppElo - ownElo : null;

  const opponent = (color === 'w' ? headers.Black : headers.White) || 'unknown';

  let hourUtc = null;
  if (headers.UTCTime) {
    const h = Number(headers.UTCTime.slice(0, 2));
    if (!Number.isNaN(h)) hourUtc = h;
  }

  const mated = loadOk && sanHistory.length > 0 && chess.isCheckmate();

  // archetype: rule-based label, most specific/diagnostic condition wins.
  let archetype = ARCHETYPES.OTHER;
  if (collapseMove && collapseMove.moveNo <= 12) {
    archetype = ARCHETYPES.OPENING;
  } else if (termLower.includes('time')) {
    archetype = ARCHETYPES.TIMEOUT;
  } else if (termLower.includes('resignation') && finalMaterialDelta >= -2) {
    archetype = ARCHETYPES.RESIGN_HOLDABLE;
  } else if (collapseMove && worstSwing <= -5) {
    archetype = ARCHETYPES.MATERIAL;
  } else if (hourUtc !== null && hourUtc >= 0 && hourUtc <= 5) {
    archetype = ARCHETYPES.LATE_NIGHT;
  }

  return {
    id: game.id,
    link: headers.Link || null,
    color,
    opponent,
    result,
    termination,
    ratingDelta,
    opening: parseOpeningName(headers.ECOUrl),
    materialTimeline: timeline.map((t) => t.materialDelta),
    collapseMove,
    finalMoves,
    endState: {
      result,
      term: termination,
      finalMaterialDelta,
      movesTotal,
      mated,
    },
    archetype,
  };
}
