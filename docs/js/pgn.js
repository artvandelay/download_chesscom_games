// PGN parsing utilities. No DOM access; runs in browser and Node 18+.

/**
 * Split a multi-game PGN blob into individual raw game blocks.
 * @param {string} text
 * @returns {string[]}
 */
export function splitPgn(text) {
  return text
    .split(/\n\s*\n(?=\[Event )/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Parse a single raw PGN game block into a Game object.
 * @param {string} raw
 * @param {number} idx
 * @returns {{id:string, headers:Object<string,string>, movetext:string, raw:string}}
 */
export function parseGame(raw, idx) {
  const headers = {};
  const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
  let match;
  let lastHeaderEnd = 0;
  while ((match = headerRe.exec(raw)) !== null) {
    headers[match[1]] = match[2];
    lastHeaderEnd = headerRe.lastIndex;
  }
  const movetext = raw.slice(lastHeaderEnd).trim();
  return { id: 'g' + idx, headers, movetext, raw };
}

/**
 * Parse all games out of a PGN text blob.
 * @param {string} text
 * @returns {Array<{id:string, headers:Object<string,string>, movetext:string, raw:string}>}
 */
export function parseAllGames(text) {
  return splitPgn(text).map((raw, idx) => parseGame(raw, idx));
}

/**
 * Extract per-move clock times (in seconds) from PGN movetext comments.
 * @param {string} movetext
 * @returns {{white:number[], black:number[]}}
 */
export function extractClocks(movetext) {
  const clockRe = /\{\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]\}/g;
  const white = [];
  const black = [];
  let match;
  let i = 0;
  while ((match = clockRe.exec(movetext)) !== null) {
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    i += 1;
    if (i % 2 === 1) {
      white.push(seconds);
    } else {
      black.push(seconds);
    }
  }
  return { white, black };
}

/**
 * Count the number of full moves in a PGN movetext.
 * @param {string} movetext
 * @returns {number}
 */
export function countMoves(movetext) {
  const moveRe = /(\d+)\.\s/g;
  let highest = 0;
  let match;
  while ((match = moveRe.exec(movetext)) !== null) {
    const n = Number(match[1]);
    if (n > highest) highest = n;
  }
  return highest;
}
