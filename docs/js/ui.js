import { DEFAULT_MODELS, HINT_CHIPS } from './constants.js';
import { parseAllGames } from './pgn.js';
import { fetchGames } from './chesscom.js';
import { runTiltMirror } from './harness.js';

const tabUsername = document.getElementById('tab-username');
const tabUpload = document.getElementById('tab-upload');
const panelUsername = document.getElementById('panel-username');
const panelUpload = document.getElementById('panel-upload');
const inputUsername = document.getElementById('input-username');
const inputFrom = document.getElementById('input-from');
const inputTo = document.getElementById('input-to');
const btnFetch = document.getElementById('btn-fetch');
const inputFiles = document.getElementById('input-files');
const selectProvider = document.getElementById('select-provider');
const inputApikey = document.getElementById('input-apikey');
const checkSavekey = document.getElementById('check-savekey');
const inputModel = document.getElementById('input-model');
const inputCustom = document.getElementById('input-custom');
const chipsContainer = document.getElementById('chips');
const checkDeepAnalysis = document.getElementById('check-deep-analysis');
const btnRun = document.getElementById('btn-run');
const runHint = document.getElementById('run-hint');
const statusLog = document.getElementById('status-log');
const reportEl = document.getElementById('report');
const emptyState = document.getElementById('empty-state');
const btnDownload = document.getElementById('btn-download');
const fetchStatus = document.getElementById('fetch-status');
const uploadStatus = document.getElementById('upload-status');

let pgnText = '';
let gameCount = 0;
let running = false;

/* ---------- small helpers ---------------------------------- */

function setStatus(el, text, state) {
  el.textContent = text;
  if (state) {
    el.dataset.state = state;
  } else {
    delete el.dataset.state;
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  const labelEl = button.querySelector('.btn__label');
  if (labelEl && label) labelEl.textContent = label;
}

/* ---------- tabs -------------------------------------------- */

const tabs = [tabUsername, tabUpload];

function showTab(tab) {
  const isUsername = tab === 'username';
  panelUsername.hidden = !isUsername;
  panelUpload.hidden = isUsername;
  tabUsername.setAttribute('aria-selected', String(isUsername));
  tabUpload.setAttribute('aria-selected', String(!isUsername));
  tabUsername.tabIndex = isUsername ? 0 : -1;
  tabUpload.tabIndex = isUsername ? -1 : 0;
}

tabUsername.addEventListener('click', () => showTab('username'));
tabUpload.addEventListener('click', () => showTab('upload'));

tabs.forEach((tab, i) => {
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
});

showTab('username');

/* ---------- key storage ------------------------------------- */

const KEY_PREFIX = 'tiltmirror_key_';

function keyStorageName(provider) {
  return KEY_PREFIX + provider;
}

/** Prefer sessionStorage; migrate/clear any older localStorage keys. */
function readSavedKey(provider) {
  const name = keyStorageName(provider);
  const fromSession = sessionStorage.getItem(name);
  if (fromSession) return fromSession;
  const legacy = localStorage.getItem(name);
  if (legacy) {
    sessionStorage.setItem(name, legacy);
    localStorage.removeItem(name);
    return legacy;
  }
  return '';
}

function writeSavedKey(provider, apiKey) {
  const name = keyStorageName(provider);
  sessionStorage.setItem(name, apiKey);
  localStorage.removeItem(name);
}

function updateProviderUI() {
  const provider = selectProvider.value;
  inputModel.value = DEFAULT_MODELS[provider];
  inputApikey.disabled = provider === 'mock';
  inputApikey.value = provider === 'mock' ? '' : readSavedKey(provider);
  updateReadiness();
}

selectProvider.addEventListener('change', updateProviderUI);

/* ---------- readiness --------------------------------------- */

function readinessMessage() {
  if (!pgnText) return 'Load your games to begin.';
  if (!inputUsername.value.trim()) return 'Enter your chess.com username.';
  if (selectProvider.value !== 'mock' && !inputApikey.value.trim()) return 'Add your API key.';
  return `Ready — ${gameCount} game${gameCount === 1 ? '' : 's'} loaded.`;
}

function updateReadiness() {
  if (running) return;
  const message = readinessMessage();
  const ready = message.startsWith('Ready');
  btnRun.disabled = !ready;
  runHint.textContent = message;
  runHint.dataset.state = ready ? 'ready' : 'waiting';
}

[inputUsername, inputApikey].forEach((el) => el.addEventListener('input', updateReadiness));

/* ---------- chips ------------------------------------------- */

HINT_CHIPS.forEach((text) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = text;
  chip.addEventListener('click', () => {
    const current = inputCustom.value.trim();
    inputCustom.value = current ? `${current} ${text}. ` : `${text}. `;
    inputCustom.focus();
  });
  chipsContainer.appendChild(chip);
});

/* ---------- loading games ----------------------------------- */

function acceptGames(text) {
  pgnText = text;
  gameCount = parseAllGames(text).length;
  updateReadiness();
  return gameCount;
}

btnFetch.addEventListener('click', async () => {
  const username = inputUsername.value.trim();
  if (!username) {
    setStatus(fetchStatus, 'Enter a username first', 'error');
    inputUsername.focus();
    return;
  }
  btnFetch.disabled = true;
  setStatus(fetchStatus, 'Fetching…', 'loading');
  try {
    const text = await fetchGames(username, inputFrom.value, inputTo.value, (s) => {
      setStatus(fetchStatus, s, 'loading');
    });
    const count = acceptGames(text);
    setStatus(fetchStatus, `${count} games loaded`, 'ok');
  } catch (err) {
    setStatus(fetchStatus, err.message, 'error');
  } finally {
    btnFetch.disabled = false;
  }
});

inputFiles.addEventListener('change', async () => {
  const files = Array.from(inputFiles.files);
  if (files.length === 0) return;
  setStatus(uploadStatus, 'Reading…', 'loading');
  try {
    const texts = await Promise.all(files.map((file) => file.text()));
    const count = acceptGames(texts.join('\n\n'));
    setStatus(uploadStatus, `${count} games from ${files.length} file${files.length === 1 ? '' : 's'}`, 'ok');
  } catch (err) {
    setStatus(uploadStatus, err.message, 'error');
  }
});

/* ---------- progress console -------------------------------- */

function logLine(text, kind) {
  const line = document.createElement('div');
  line.className = 'console__line';
  line.textContent = text;
  if (kind) line.dataset.kind = kind;
  statusLog.appendChild(line);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function resetConsole() {
  statusLog.replaceChildren();
  statusLog.classList.add('is-active');
}

/* ---------- report rendering -------------------------------- */

/**
 * The assembler emits bare chess.com URLs as link text, which wraps badly.
 * Shorten the visible label only — hrefs are code-generated facts, untouched.
 */
function tidyGameLinks(root) {
  root.querySelectorAll('a[href*="chess.com"]').forEach((anchor) => {
    if (anchor.textContent.trim() !== anchor.href.trim()) return;
    const id = anchor.href.split('/').filter(Boolean).pop();
    anchor.textContent = `chess.com/${id}`;
  });
}

function renderReport(markdown) {
  const html = window.marked.parse(markdown);
  reportEl.innerHTML = window.DOMPurify.sanitize(html);
  tidyGameLinks(reportEl);
  emptyState.hidden = true;
}

/* ---------- run --------------------------------------------- */

btnRun.addEventListener('click', async () => {
  const username = inputUsername.value.trim();
  const provider = selectProvider.value;
  const apiKey = inputApikey.value;

  if (checkSavekey.checked && apiKey) {
    writeSavedKey(provider, apiKey);
  }

  running = true;
  setBusy(btnRun, true, 'Analyzing');
  runHint.textContent = 'Working — this can take a minute.';
  runHint.dataset.state = 'waiting';
  resetConsole();
  reportEl.replaceChildren();
  emptyState.hidden = true;
  btnDownload.hidden = true;

  try {
    const games = parseAllGames(pgnText);
    const report = await runTiltMirror({
      games,
      username,
      provider,
      apiKey,
      model: inputModel.value,
      userCustomization: inputCustom.value,
      onStatus: (s) => logLine(s),
      deepAnalysis: checkDeepAnalysis.checked,
    });

    renderReport(report);
    btnDownload.hidden = false;
    btnDownload.onclick = () => {
      const blob = new Blob([report], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tiltmirror-${username}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    logLine(err.message, 'error');
    emptyState.hidden = false;
  } finally {
    running = false;
    setBusy(btnRun, false, 'Run Tilt Mirror');
    updateReadiness();
  }
});

updateProviderUI();
