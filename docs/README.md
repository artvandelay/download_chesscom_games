# Tilt Mirror

## What Tilt Mirror is

Tilt Mirror analyzes YOUR chess.com games for psychological failure patterns — tilt, session fatigue, time panic, ego effects — using your own LLM API key. It runs fully client-side: there's no server and no build step, and no data leaves your browser except direct calls to chess.com, your chosen LLM provider, and (only if you opt in) the CDN that hosts the optional Deep Analysis chess engine.

## Architecture: facts by code, judgment by LLM

Every fact in a Tilt Mirror report — every link, result, opening name, collapse move, and statistic — is computed deterministically by code and never touches the LLM's output. The LLM is only ever asked for *judgment*: the psychological read on a pattern, a prescription, a closing note. Concretely:

1. **`js/pgn.js` + `js/ledger.js`** parse your PGNs into a behavioral ledger (one row per game: result, rating gap, session position, clock pressure, etc).
2. **`js/moments.js`** replays each game's real moves with a chess rules engine ([chess.js](https://github.com/jhlywa/chess.js), vendored at `js/vendor/chess.js`) to build a verified "moment sheet" per game: the opponent, result, opening, the single worst material swing ("collapse move"), the final few moves, and a rule-based archetype label (`timeout-scramble`, `material-collapse`, `opening-disaster`, etc). Nothing here is guessed — it's all replayed and computed.
3. **`js/patterns.js`** scores behavioral patterns (instant requeue after a loss, session decay, late-night play, time panic, opening ruts, ego losses, abandon tells) purely from ledger numbers, picks the top 3 by evidence size × excess loss rate, and attaches 2–3 verified example games (with their moment sheets) to each. This produces a **fact sheet**.
4. **`js/prompts.js`** builds a stripped-down view of the fact sheet for the LLM: qualitative archetype labels, material-point deltas, and aggregate stats only — **no links, no SAN move text, no move numbers, and none of the two ledger fields (`clk12pct`, `mvU30s`) that turned out to need a glossary to use correctly**. The LLM is asked to return a small JSON judgment object (`{intro, patterns:[{id, diagnosis, prescription}], overperform, closing}`) that references example games only by their internal id.
5. **`js/harness.js`** calls the LLM once with that payload, then **deterministically assembles the final markdown**: every link, number, and move comes from the fact sheet; the LLM's JSON only fills the prose slots (intro / diagnosis / prescription / overperform / closing). A sanitizer strips any URL, move-number, or SAN-move-shaped text the LLM might still try to write into those slots (it shouldn't be able to — it was never given one — but this is a strip-on-sight safety net, not the thing that makes the report correct). A final verification pass re-scans the assembled markdown and confirms every rendered link traces back to the fact sheet.

This means the report is **useful even with no working LLM at all**: if the LLM call fails (bad key, rate limit, network down, or you're just running the "Mock" provider), the harness catches it and returns a facts-only report — the same stats, patterns, and example games, minus the coach's narration, with a clear banner explaining what happened. This degrade-gracefully behavior is load-bearing, not a fallback bolted on afterward: the assembler is the same code path either way, it just has less prose to render.

## Optional: Deep analysis (Stockfish)

Off by default. Enabling the "Deep analysis" checkbox lets Tilt Mirror confirm a couple of key positions per pattern — the collapse move and the final position — with a real chess engine ([Stockfish](https://github.com/nmrugg/stockfish.js), the "lite single-threaded" WASM build, loaded from a CDN) running in a Web Worker in your browser. This is the *only* place in the app that ever makes a soundness/"blunder"-style claim; without it, the report only speaks in provable material/clock terms ("went from up a rook to down a knight"), never "blunder" (per the project's honesty boundary: material facts don't need an engine, soundness claims do).

- Runs single-threaded, so it needs no special cross-origin-isolation (COOP/COEP) headers — it works on plain GitHub Pages.
- Fully optional: `js/engine.js` is only ever dynamically imported when you check the box, and the core report works perfectly if the engine never loads (offline, blocked, or you never opted in).
- Evaluates a small, fixed, rule-preselected set of positions (not every move) — usually well under 20 engine calls per report.

### CDN details and the offline/vendoring fallback

Two things were confirmed *live* while building this feature (not just read about):

1. **jsdelivr does not work for this package.** jsdelivr refuses to serve individual files out of the `stockfish` npm package because the package's *unpacked* size (it bundles several engine builds) exceeds jsdelivr's 150MB per-package limit — every jsdelivr URL for it returns HTTP 403, even for one small file. [unpkg.com](https://unpkg.com) serves the same npm package's individual files fine, so that's what's used: `https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.js` (+ its `.wasm` companion).
2. **You can't construct a cross-origin classic Worker directly.** `new Worker('https://unpkg.com/.../stockfish-18-lite-single.js')` is rejected by the browser with a same-origin-policy error. `js/engine.js` works around this via a tiny same-origin wrapper, `js/engine-worker.js`, which `importScripts()`s the CDN file instead (that *is* allowed cross-origin, subject to the CSP `script-src` in `index.html`, which allowlists `unpkg.com`). The imported script then needs to know where to fetch its `.wasm` companion from; by default it would incorrectly resolve that relative to the wrapper's own same-origin URL, so `engine.js` constructs the Worker with a URL hash fragment (`#<url-encoded wasm URL>`) that this Stockfish build explicitly supports reading as a wasm-location override.

Both of the above were verified with a real UCI handshake and a real `go depth` search (not just a reachability check) — see the inline comments in `js/engine.js` and `js/engine-worker.js` for the exact mechanism.

**If unpkg.com ever becomes unreachable** (network policy, outage, or you're deploying somewhere fully offline) and you want Deep Analysis to keep working, vendor it locally instead of relying on the CDN:

1. Download these two files from the [Stockfish releases page](https://github.com/nmrugg/stockfish.js/releases) (or `npm pack stockfish@18.0.8` and pull them from `bin/`): `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm`. Place both under `docs/js/vendor/` (same directory as `chess.js`).
2. In `docs/js/engine-worker.js`, change `ENGINE_JS_URL` from the unpkg URL to a relative path, e.g. `'../js/vendor/stockfish-18-lite-single.js'`.
3. In `docs/js/engine.js`, change `ENGINE_WASM_URL` similarly to a relative/absolute same-origin path to the vendored `.wasm` file.
4. You can then remove `https://unpkg.com` from the CSP `script-src`/`worker-src`/`connect-src` directives in `index.html` if you want to fully lock the app down to same-origin plus your chosen LLM provider and chess.com.

## Getting your games

**Option A — just enter your username.** Tilt Mirror uses chess.com's free Public Data API, which needs no account, API key, or subscription. Pick a date range and click "Fetch games".

**Option B — manual export.** On chess.com, go to your profile → Games → Archive, select the games you want, click Download, and choose PGN. Then upload the file(s) in the app's "Upload PGN files" tab.

## API keys

Tilt Mirror supports four LLM providers (plus a no-key "Mock" mode for trying out the UI):

- [OpenAI](https://platform.openai.com/api-keys)
- [Anthropic](https://console.anthropic.com/settings/keys)
- [Google Gemini](https://aistudio.google.com/apikey)
- [OpenRouter](https://openrouter.ai/keys)

**Use a spend-limited, revocable key.** Create a dedicated key for this app, set a low monthly budget / rate limit where the provider allows it, and revoke it when you're done.

Your key is used directly from your browser to call the provider's API — it is never sent to Tilt Mirror's host. If you check "remember key for this browser tab", it's kept in `sessionStorage` only (cleared when the tab closes). Older installs that saved keys in `localStorage` are migrated once and then cleared.

Browser hardening: report HTML is sanitized with DOMPurify, CDN scripts are version-pinned with Subresource Integrity, and a Content Security Policy restricts network calls to chess.com, the chosen LLM providers, and (only for the optional Deep Analysis engine) unpkg.com.

## Customizing the report

The "Customize" prompt box lets you tell the coach what to focus on in plain English. The hint chips below it are shortcuts — click one to append a suggestion (e.g. "Focus on time management" or "Roast me: harsh but fair") to your instructions.

## Running locally

From the repo root:

```sh
python3 -m http.server -d docs 8080
```

Then open `http://localhost:8080` in your browser.

## Running the tests

From the repo root (plain Node 18+, no dependencies, no test runner needed):

```sh
node docs/test/ledger.test.mjs
node docs/test/moments.test.mjs
node docs/test/patterns.test.mjs
node docs/test/harness.test.mjs
```

`docs/js/engine.js` and `docs/js/engine-worker.js` are browser-only (they use the `Worker` API, which doesn't exist in plain Node) and are exercised by manual/browser testing rather than the Node test suite.

## Deploying

This folder (`docs/`) is the GitHub Pages site root for
[`artvandelay/download_chesscom_games`](https://github.com/artvandelay/download_chesscom_games).

1. Push a branch that contains `docs/`.
2. In the repo: **Settings → Pages**.
3. Source: **Deploy from a branch** → choose the branch → folder **`/docs`** → Save.

Live URL: [https://artvandelay.github.io/download_chesscom_games/](https://artvandelay.github.io/download_chesscom_games/)

Local preview (no build step):

```sh
python3 -m http.server -d docs 8080
# open http://localhost:8080
```
