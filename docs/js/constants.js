export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter', 'mock'];
export const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-5',
  gemini: 'gemini-2.5-flash',
  openrouter: 'anthropic/claude-sonnet-4.5',
  mock: 'mock',
};
export const RAW_TOKEN_BUDGET = 100000;
// Above this many games, close-reading every PGN in one prompt causes the model to
// conflate games (wrong results, mismatched links). Larger sets use ledger + get_games.
export const CLOSE_READ_MAX_GAMES = 15;
export const LEDGER_TOKEN_BUDGET = 150000;
export const MAX_TOOL_ROUNDS = 5;
export const MAX_IDS_PER_CALL = 10;
export const SESSION_GAP_S = 900;
export const CSV_HEADER = 'id,ts,color,res,oppD,rating,tc,eco,term,gap_s,sess,lstreak,clk12pct,mvU30_s,finclk_s,moves';
export const HINT_CHIPS = [
  'Quote specific moves and moments (move-level detail)',
  'Big ideas only, no move lists',
  'Roast me: harsh but fair',
  'Focus on time management',
  'Focus on tilt and emotions',
  'Short: only my #1 pattern',
];
export function estimateTokens(text) { return Math.ceil(text.length / 4); }
