// Same-origin Worker entry point for the CDN-hosted Stockfish "lite single-threaded"
// WASM build. See docs/js/engine.js for the full CDN/vendoring rationale and keep
// ENGINE_JS_URL here in sync with ENGINE_VERSION there if the pinned version is ever
// bumped.
//
// This tiny wrapper exists because `new Worker(<cross-origin CDN URL>)` is disallowed
// by the browser's same-origin policy for classic Worker scripts - confirmed live
// while building this feature ("Failed to construct 'Worker': Script at '...' cannot
// be accessed from origin ..."). Instead, the Worker is created pointed at THIS
// same-origin file, which then `importScripts()`s the CDN script - that import IS
// allowed cross-origin (subject to CSP `script-src`, which docs/index.html allowlists
// for this CDN). The imported script then needs to know where to fetch its `.wasm`
// companion from; left to its own defaults it would incorrectly resolve that relative
// to *this* wrapper's own URL (it reads `self.location`, which inside a Worker is
// this file's URL, not the CDN's). engine.js works around that by constructing this
// Worker with a URL fragment (`#<url-encoded wasm URL>`), which this Stockfish build
// explicitly supports reading via `self.location.hash` as a wasm-location override -
// verified live end-to-end (UCI handshake + a real `go depth` search) while building
// this feature.
const ENGINE_JS_URL = 'https://unpkg.com/stockfish@18.0.8/bin/stockfish-18-lite-single.js';
importScripts(ENGINE_JS_URL);
