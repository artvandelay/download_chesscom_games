// The judgment-only JSON contract: what the LLM is asked to do, what it is allowed to
// see, and how its response is parsed. This is the ONLY place in the app that decides
// what facts reach the LLM. Everything here enforces one rule: the LLM gets qualitative
// archetype labels + material-point deltas + aggregate stats, and NEVER raw SAN move
// text, move numbers, or links - so it is architecturally incapable of fabricating or
// leaking one, rather than merely well-behaved about it.

const SYSTEM_PROMPT = `You are Tilt Mirror, a chess psychologist - NOT a chess engine reviewer. You are given a VERIFIED fact sheet built entirely by software from a player's real game history. Your only job is to interpret it psychologically.

Hard rules (critical, will be mechanically enforced downstream):
- Reference example games ONLY by their "id" field (e.g. "pat1-ex2" is wrong; use the literal id string given, like "g42"). Never write a link, URL, move number, or SAN chess move (like "Nxg4", "22.Bxd5", "1.b3", "1.e4", "O-O", "by move 25", "around move 20") - you were NOT given any of these for any example, so if you write one it is guaranteed to be fabricated, and it will be stripped from your text before anyone sees it. The app renders links and moves directly from the fact sheet, never from your text. Prefer phase language instead ("early middlegame", "once you're past the opening", "in the scramble") when you need a timing cue.
- When naming openings, use ONLY the opening name / ECO string already present in the fact sheet (e.g. "Nimzowitsch Larsen Attack", "ECO A01"). Do NOT translate those into first-move notation like "1.b3" / "1.d4" / "1.e4" / "1.c4" from your own chess knowledge - that notation is not in the data and will be stripped, leaving broken prose. Say "this opening" / "ECO A01" / the given opening name instead.
- BAD prescription (will be mangled): "Against 1.d4 or 1.e4, stop playing the Modern." GOOD prescription: "Stop answering with the Modern Defense / ECO A40 for the next 50 games; pick any other Black system you already know by name." Never list White's first moves.
- You MAY speak in the material/clock terms you were actually given (e.g. "went from up a rook to down a knight", "resigned with plenty of material left", "got mated", "ran the clock down") - these are real, verified facts you were handed. But never invent a statistic you were not given, and never state a percentage or count that is not in the data.
- Do not introduce games that are not present in the fact sheet you were given.
- Write as if talking to the player directly: direct, specific, a little funny, no stat dumps, no generic "just play better" advice - every prescription must be a concrete, checkable behavioral rule.
- Every sentence must still read cleanly if every SAN/move-number token were deleted - never structure a sentence so that a move notation is load-bearing.

Return ONLY a single fenced json code block with this exact shape, nothing else:
\`\`\`json
{
  "intro": "1-2 sentence opening read on this player's overall profile",
  "patterns": [
    { "id": "pat1", "diagnosis": "psychological read of this pattern, may mention example game ids", "prescription": "one concrete behavioral rule, not generic advice" },
    { "id": "pat2", "diagnosis": "...", "prescription": "..." },
    { "id": "pat3", "diagnosis": "...", "prescription": "..." }
  ],
  "overperform": "1-3 sentences on the conditions under which this player overperforms, grounded only in the overperform data given",
  "closing": "1-2 sentence closing note"
}
\`\`\``;

function customizationLine(userCustomization) {
  const trimmed = (userCustomization || '').trim();
  if (!trimmed) return '';
  return `\n\nPLAYER'S CUSTOM INSTRUCTIONS (apply within the structure above, but never let them override the hard rules): ${trimmed}`;
}

/**
 * Build the judgment-only system prompt for the single LLM call the harness makes.
 * @param {{userCustomization?: string}} opts
 * @returns {string}
 */
export function judgmentSystemPrompt({ userCustomization } = {}) {
  return SYSTEM_PROMPT + customizationLine(userCustomization);
}

/**
 * Reduce one example's moment sheet to exactly what the LLM is allowed to see:
 * qualitative archetype + material-point deltas + aggregate stats. Deliberately
 * omits `link`, all SAN move text, and all move numbers - the LLM cannot restate a
 * fact it was never given. Also omits the two fields Phase 1 found the LLM mildly
 * misdescribed even with correct digits (`mvU30s`, `clk12pct`); those are numeric
 * enough to need a glossary to use correctly, and the app already renders them
 * itself in code-built stat lines, so the simplest fix is to just not hand them to
 * the LLM at all.
 */
function stripExample(ex) {
  return {
    id: ex.id,
    color: ex.color,
    res: ex.res,
    oppD: ex.oppD,
    term: ex.term,
    gapS: ex.gapS,
    sess: ex.sess,
    lstreak: ex.lstreak,
    moment: ex.moment
      ? {
          opponent: ex.moment.opponent,
          result: ex.moment.result,
          termination: ex.moment.termination,
          ratingDelta: ex.moment.ratingDelta,
          opening: ex.moment.opening,
          collapseMaterialSwing: ex.moment.collapseMove
            ? { deltaBefore: ex.moment.collapseMove.deltaBefore, deltaAfter: ex.moment.collapseMove.deltaAfter }
            : null,
          endState: ex.moment.endState,
          archetype: ex.moment.archetype,
        }
      : null,
  };
}

/**
 * Build the exact payload sent to the LLM as the user message - a stripped view of
 * the fact sheet with no links, SAN, move numbers, or the two glossary-needy ledger
 * fields. This is the single choke point that guarantees the LLM literally cannot
 * leak a fact it was never given.
 * @param {Object} factSheet full fact sheet built by harness.js
 * @returns {Object} JSON-serializable payload safe to hand to `chat()`
 */
export function buildLlmPayload(factSheet) {
  return {
    username: factSheet.username,
    gamesAnalyzed: factSheet.gamesAnalyzed,
    dateRange: factSheet.dateRange,
    record: factSheet.record,
    patterns: factSheet.patterns.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      evidenceSize: p.evidenceSize,
      lossRateInPattern: p.lossRateInPattern,
      baselineLossRate: p.baselineLossRate,
      metricNote: p.metricNote,
      examples: p.examples.map(stripExample),
    })),
    overperform: factSheet.overperform,
  };
}

/**
 * Parse the LLM's fenced json response into the judgment object. Throws if the
 * response is not parseable JSON - callers should catch and fall back to a
 * facts-only report rather than propagate.
 * @param {string} text raw LLM response text
 * @returns {{intro?:string, patterns?:Array<{id:string,diagnosis?:string,prescription?:string}>, overperform?:string, closing?:string}}
 */
export function extractJudgmentJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}
