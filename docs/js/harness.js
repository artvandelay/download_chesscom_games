// Orchestrator: build ledger -> build moment sheets (moments.js, via patterns.js) ->
// select patterns (patterns.js) -> build factSheet -> call chat() for judgment only ->
// deterministically assemble the final markdown. Every link/number/move in the
// rendered report is code-assembled from the factSheet; the LLM only ever fills a
// handful of prose slots (intro/diagnosis/prescription/overperform/closing), and even
// those are sanitized before rendering. If the LLM call fails or returns unusable
// output, this degrades to a facts-only report rather than throwing - the report
// should always be useful, even with no working LLM key.
import { buildLedger } from './ledger.js';
import { selectPatterns } from './patterns.js';
import { chat } from './providers.js';
import { judgmentSystemPrompt, buildLlmPayload, extractJudgmentJson } from './prompts.js';

/**
 * Build the code-only fact sheet: aggregate record + top behavioral patterns (each
 * with 2-3 verified example moment sheets) + overperformance buckets. Nothing here
 * is LLM-authored.
 * @param {string} username
 * @param {Array<Object>} rows ledger rows
 * @param {Array<Object>} games parsed games matching those rows
 */
export function buildFactSheet(username, rows, games) {
  const { patterns, overperform } = selectPatterns(rows, games);
  const wins = rows.filter((r) => r.res === 'W').length;
  const losses = rows.filter((r) => r.res === 'L').length;
  const draws = rows.filter((r) => r.res === 'D').length;

  return {
    username,
    gamesAnalyzed: rows.length,
    dateRange: { from: rows[0]?.ts ?? null, to: rows[rows.length - 1]?.ts ?? null },
    record: { wins, losses, draws },
    patterns,
    overperform,
  };
}

function fmtClock(seconds) {
  if (seconds === null || seconds === undefined) return 'n/a';
  return `${seconds}s`;
}

function fmtDelta(n) {
  if (n === null || n === undefined) return 'n/a';
  return n >= 0 ? `+${n}` : `${n}`;
}

function fmtEval(evalResult) {
  if (!evalResult) return 'n/a';
  if (evalResult.mate !== null && evalResult.mate !== undefined) {
    return evalResult.mate === 0 ? 'mate' : `mate in ${Math.abs(evalResult.mate)}`;
  }
  if (evalResult.cp === null || evalResult.cp === undefined) return 'n/a';
  const pawns = Math.round(evalResult.cp) / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

// --- Sanitizer: the LLM payload never contains links/SAN/move-numbers, so these
// should never fire in practice. They exist as a strip-on-sight safety net, not as
// the mechanism that makes the report correct (that mechanism is: the assembler
// below never reads facts out of LLM text at all).
function freshLinkRe() {
  // Excludes ')' and ']' from the URL body so links embedded in markdown syntax like
  // `[url](url)` are captured cleanly without swallowing the closing punctuation.
  return /https?:\/\/[^\s)\]]+/gi;
}
function freshMoveNoRe() {
  return /\bmove\s+\d+\b/gi;
}
// Loose SAN-shaped token matcher (piece letters + file/rank, castling, promotions).
// Requires an actual [a-h][1-8] square or a castling token, so plain English rarely
// collides with it.
function freshSanRe() {
  return /\b([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?[+#]?|O-O(-O)?[+#]?)\b/g;
}

// Game ids look like "g0", "g2", ... "g70" - and any id in the range g1-g8 is
// character-for-character identical to a real chess square (file g, rank 1-8), so
// the SAN regex below cannot tell them apart on its own. Since the id namespace is
// exactly the games in factSheet, we can whitelist them by exact match before running
// the SAN strip, then restore them, instead of misfiring on legitimate citations.
function protectKnownIds(text, knownIds) {
  if (!knownIds || !knownIds.size) return { text, restore: (s) => s };
  const placeholders = new Map();
  const protectedText = text.replace(/\bg\d+\b/g, (m) => {
    if (!knownIds.has(m)) return m;
    const key = `\u0000ID${placeholders.size}\u0000`;
    placeholders.set(key, m);
    return key;
  });
  return {
    text: protectedText,
    restore: (s) => {
      let out = s;
      for (const [key, val] of placeholders) out = out.split(key).join(val);
      return out;
    },
  };
}

// After SAN/move-number stripping, collapse dangling move-list remnants the LLM often
// leaves behind when it invents opening notation from its own chess knowledge
// (e.g. "1.b3" -> "1.[move removed]", or "1.e4 2.d4" style lists). Prefer a clean
// sentence over a report peppered with redaction markers.
function scrubDanglingMoveArtifacts(text) {
  let clean = text;
  // "1.[move removed]" / "1.[move removed].e4-ish" / "1.[move removed] 2.[move removed]"
  clean = clean.replace(/\b\d+\.\[move removed\](?:\s*\d+\.\[move removed\])*/g, 'that opening');
  // leftover standalone redaction markers that survived as sole tokens
  clean = clean.replace(/\s*\[move removed\](?:\s*\[move removed\])*/g, '');
  clean = clean.replace(/\s*\[link removed\]/g, '');
  // Lists like "against 1.d4 or 1.e4 or 1.c4" become "against or or" after SAN strip -
  // collapse that debris into readable language.
  clean = clean.replace(/\bagainst(?:\s+or)+\b/gi, 'against common replies');
  clean = clean.replace(/\b(?:\s+or){2,}\b/gi, '');
  clean = clean.replace(/\bor\s+or(?:\s+or)*/gi, 'or');
  // tidy doubled spaces / empty parens / dangling prepositions left by removals
  clean = clean.replace(/[ \t]{2,}/g, ' ');
  clean = clean.replace(/\(\s*\)/g, '');
  clean = clean.replace(/\s+([,.;:!?])/g, '$1');
  clean = clean.replace(/\b(against|as|with|to|for|on)\s+(,|\.|$)/gi, '$2');
  return clean.trim();
}

function sanitizeProse(text, warnings, where, knownIds) {
  if (typeof text !== 'string' || !text) return text;
  const { text: masked, restore } = protectKnownIds(text, knownIds);
  let clean = masked;
  if (freshLinkRe().test(clean)) {
    warnings.push(`Stripped a URL the LLM wrote into "${where}" (it was never given one, so this should not happen).`);
    clean = clean.replace(freshLinkRe(), '[link removed]');
  }
  if (freshMoveNoRe().test(clean)) {
    warnings.push(`Stripped a move-number reference from "${where}" (it was never given move numbers).`);
    // Prefer phase language over the awkward literal "a move" so prescriptions still read.
    clean = clean.replace(freshMoveNoRe(), 'the early middlegame');
  }
  const sanMatches = clean.match(freshSanRe());
  if (sanMatches && sanMatches.length) {
    warnings.push(
      `Stripped ${sanMatches.length} SAN-move-shaped token(s) from "${where}" (it was never given SAN moves).`
    );
    clean = clean.replace(freshSanRe(), '[move removed]');
  }
  clean = restore(clean);
  const scrubbed = scrubDanglingMoveArtifacts(clean);
  if (scrubbed !== clean && (clean.includes('[move removed]') || clean.includes('[link removed]'))) {
    warnings.push(`Scrubbed dangling redaction markers from "${where}" so the prose still reads cleanly.`);
  }
  return scrubbed;
}

function renderExample(ex) {
  const m = ex.moment;
  if (!m) return `- \`${ex.id}\`: (raw game data unavailable)`;
  const lines = [];
  const link = m.link ? `[${m.link}](${m.link})` : 'link unavailable';
  lines.push(
    `- **${ex.id}** - ${link} - vs ${m.opponent} (${m.result}, ${m.termination}, opp ${fmtDelta(m.ratingDelta)}, ${m.opening})`
  );
  if (m.collapseMove) {
    lines.push(
      `  - Collapse: move ${m.collapseMove.moveNo} \`${m.collapseMove.san}\` swung material from ${fmtDelta(
        m.collapseMove.deltaBefore
      )} to ${fmtDelta(m.collapseMove.deltaAfter)} (clock ${fmtClock(m.collapseMove.clockBefore)} -> ${fmtClock(
        m.collapseMove.clockAfter
      )})`
    );
    if (m.collapseMove.engine) {
      const { before, after } = m.collapseMove.engine;
      lines.push(
        `  - Deep analysis (Stockfish, code-verified, not LLM): eval right before this move was ${fmtEval(
          before
        )} (side to move), right after was ${fmtEval(after)} (side now to move)${
          before && before.bestMove ? `; engine's suggested best move there was \`${before.bestMove}\`` : ''
        }.`
      );
    }
  }
  if (m.finalMoves && m.finalMoves.length) {
    const seq = m.finalMoves
      .map((fm) => `${fm.moveNo}${fm.mover === 'w' ? '.' : '...'}${fm.san}(${fmtClock(fm.clockSeconds)})`)
      .join(' ');
    lines.push(`  - Final moves: ${seq}`);
  }
  if (m.endState.engine && m.endState.engine.final) {
    lines.push(`  - Deep analysis of final position: ${fmtEval(m.endState.engine.final)} (side to move).`);
  }
  lines.push(
    `  - End state: ${m.endState.movesTotal} moves, final material delta ${fmtDelta(
      m.endState.finalMaterialDelta
    )}, mated=${m.endState.mated}, archetype=${m.archetype}`
  );
  return lines.join('\n');
}

/**
 * Deterministically assemble the final markdown report. Every link/number/move comes
 * from `factSheet`; `llmJson` (possibly `{}` if the LLM call failed) only supplies
 * prose for the intro/diagnosis/prescription/overperform/closing slots, and even that
 * prose is sanitized first. This function alone must always produce a complete,
 * useful report even when `llmJson` is empty (the facts-only fallback path).
 * @param {Object} factSheet
 * @param {Object} llmJson parsed LLM judgment JSON, or `{}` on failure
 * @param {Array<string>} warnings mutated in place with sanitizer notes
 * @param {string|null} llmFailureReason set when the LLM call/parse failed
 */
export function assembleMarkdown(factSheet, llmJson, warnings, llmFailureReason) {
  const { username, gamesAnalyzed, dateRange, record, patterns, overperform } = factSheet;
  const knownIds = new Set();
  for (const p of patterns) for (const ex of p.examples) knownIds.add(ex.id);

  const parts = [];
  parts.push(`# Tilt Mirror - ${username}`);
  parts.push(
    `_${gamesAnalyzed} games analyzed, ${dateRange.from ?? 'n/a'} to ${dateRange.to ?? 'n/a'}. Record: ${record.wins}W / ${record.losses}L / ${record.draws}D._`
  );

  if (llmFailureReason) {
    parts.push(
      `> **Facts-only report.** The LLM commentary step didn't complete (${llmFailureReason}). Everything below - stats, patterns, and example games - is still generated and verified directly from your real games; you're just missing the psychologist's narration on top.`
    );
  }

  const intro = sanitizeProse(llmJson.intro, warnings, 'intro', knownIds);
  if (intro) parts.push(intro);

  if (!patterns.length) {
    parts.push(
      "## Patterns\n\nNot enough games yet to identify a reliable behavioral cluster (each pattern needs at least 2 games of evidence). Play some more games and re-run Tilt Mirror."
    );
  }

  for (const p of patterns) {
    const llmP = (llmJson.patterns || []).find((x) => x.id === p.id) || {};
    parts.push(`## ${p.label}`);
    parts.push(
      `**Evidence:** ${p.evidenceSize} games (${p.metricNote}). Loss rate in this pattern: ${Math.round(
        (p.lossRateInPattern ?? 0) * 100
      )}% vs baseline ${Math.round((p.baselineLossRate ?? 0) * 100)}%.`
    );
    const diagnosis = sanitizeProse(llmP.diagnosis, warnings, `pattern ${p.id} diagnosis`, knownIds);
    if (diagnosis) parts.push(diagnosis);
    parts.push('**Example games:**');
    parts.push(p.examples.map((ex) => renderExample(ex)).join('\n'));
    const prescription = sanitizeProse(llmP.prescription, warnings, `pattern ${p.id} prescription`, knownIds);
    if (prescription) parts.push(`**Prescription:** ${prescription}`);
  }

  parts.push('## Where you overperform');
  if (overperform.best) {
    parts.push(
      `Code fact: your strongest bucket is **${overperform.best.label}** - ${Math.round(
        overperform.best.winRate * 100
      )}% win rate over ${overperform.best.n} games, vs an overall baseline of ${Math.round(
        (overperform.baselineWinRate ?? 0) * 100
      )}%.`
    );
  } else {
    parts.push('Code fact: no bucket cleared the minimum-sample-size / above-baseline threshold this run.');
  }
  const overperformProse = sanitizeProse(llmJson.overperform, warnings, 'overperform', knownIds);
  if (overperformProse) parts.push(overperformProse);

  const closing = sanitizeProse(llmJson.closing, warnings, 'closing', knownIds);
  if (closing) {
    parts.push('## Closing');
    parts.push(closing);
  }

  return parts.filter((s) => s !== undefined && s !== null && s !== '').join('\n\n');
}

/**
 * Safety-net verification pass: re-scans the ASSEMBLED markdown and confirms every
 * link it contains traces back to a link that actually exists in the fact sheet, and
 * that every example's link that should have been rendered actually was. This should
 * always pass by construction (the assembler only ever writes links it read from
 * `factSheet`) - it exists to catch a future assembler bug, not to patch one now.
 * @param {string} markdown
 * @param {Object} factSheet
 * @returns {{ok: boolean, issues: string[]}}
 */
export function verifyAssembledReport(markdown, factSheet) {
  const issues = [];
  const allowedLinks = new Set();
  for (const p of factSheet.patterns) {
    for (const ex of p.examples) {
      if (ex.moment && ex.moment.link) allowedLinks.add(ex.moment.link);
    }
  }

  const urlsInMarkdown = Array.from(markdown.matchAll(freshLinkRe())).map((m) => m[0].replace(/[)\].,]+$/, ''));
  for (const url of urlsInMarkdown) {
    if (!allowedLinks.has(url)) {
      issues.push(`Rendered link "${url}" does not trace back to any example's fact-sheet link.`);
    }
  }

  for (const p of factSheet.patterns) {
    for (const ex of p.examples) {
      if (ex.moment && ex.moment.link && !markdown.includes(ex.moment.link)) {
        issues.push(`Example ${ex.id} (pattern ${p.id}) link is missing from the rendered report.`);
      }
      if (ex.moment && !markdown.includes(ex.id)) {
        issues.push(`Example ${ex.id} (pattern ${p.id}) id is missing from the rendered report.`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Run the full Tilt Mirror pipeline: ledger -> fact sheet (facts by code) -> single
 * judgment-only LLM call (judgment by LLM) -> deterministic assembly -> verification
 * safety net. Call signature is intentionally unchanged from the pre-rework harness
 * so ui.js's call site does not need to change; `deepAnalysis` is new and optional.
 * @param {{games:Array<Object>, username:string, provider:string, apiKey:string,
 *   model:string, userCustomization?:string, onStatus?:(s:string)=>void,
 *   deepAnalysis?:boolean}} args
 * @returns {Promise<string>} markdown report (always resolves - LLM failures degrade
 *   to a facts-only report instead of throwing)
 */
export async function runTiltMirror({
  games,
  username,
  provider,
  apiKey,
  model,
  userCustomization,
  onStatus,
  deepAnalysis,
}) {
  const notify = onStatus || (() => {});

  const { rows } = buildLedger(games, username);
  if (rows.length === 0) {
    throw new Error('No games found for username ' + username);
  }
  notify(`Ledger built: ${rows.length} games`);

  const factSheet = buildFactSheet(username, rows, games);
  notify(
    `Fact sheet built: ${factSheet.patterns.length} pattern(s), ${factSheet.record.wins}W/${factSheet.record.losses}L/${factSheet.record.draws}D`
  );

  if (deepAnalysis) {
    try {
      notify('Deep analysis: loading the in-browser chess engine…');
      const { annotateFactSheetWithEngine } = await import('./engine.js');
      await annotateFactSheetWithEngine(factSheet, { onStatus: notify });
    } catch (err) {
      notify(`Deep analysis unavailable (${err.message}); continuing without it.`);
    }
  }

  const llmPayload = buildLlmPayload(factSheet);
  const system = judgmentSystemPrompt({ userCustomization });

  let llmJson = {};
  let llmFailureReason = null;
  try {
    notify(`Calling ${provider} (${model})…`);
    const raw = await chat(provider, apiKey, model, system, [{ role: 'user', content: JSON.stringify(llmPayload) }]);
    llmJson = extractJudgmentJson(raw);
    if (!llmJson || typeof llmJson !== 'object') {
      throw new Error('LLM response JSON was not an object');
    }
    notify('LLM judgment received.');
  } catch (err) {
    llmFailureReason = (err && err.message) || String(err);
    notify(`LLM judgment unavailable (${llmFailureReason}) - falling back to a facts-only report.`);
    llmJson = {};
  }

  const warnings = [];
  const markdown = assembleMarkdown(factSheet, llmJson, warnings, llmFailureReason);
  for (const w of warnings) notify(`Sanitizer: ${w}`);

  const verification = verifyAssembledReport(markdown, factSheet);
  if (!verification.ok) {
    for (const issue of verification.issues) notify(`VERIFICATION WARNING: ${issue}`);
  }

  return markdown;
}
