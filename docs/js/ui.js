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
const statusLog = document.getElementById('status-log');
const reportEl = document.getElementById('report');
const btnDownload = document.getElementById('btn-download');
const fetchStatus = document.getElementById('fetch-status');

let pgnText = '';
let uploadStatusEl = null;

function showTab(tab) {
  const isUsername = tab === 'username';
  panelUsername.hidden = !isUsername;
  panelUpload.hidden = isUsername;
  tabUsername.classList.toggle('active', isUsername);
  tabUpload.classList.toggle('active', !isUsername);
}

tabUsername.addEventListener('click', () => showTab('username'));
tabUpload.addEventListener('click', () => showTab('upload'));
showTab('username');

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
  inputApikey.value = readSavedKey(provider);
}

selectProvider.addEventListener('change', updateProviderUI);
updateProviderUI();

HINT_CHIPS.forEach((text) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = text;
  chip.addEventListener('click', () => {
    inputCustom.value += text + '. ';
  });
  chipsContainer.appendChild(chip);
});

btnFetch.addEventListener('click', async () => {
  const username = inputUsername.value.trim();
  const from = inputFrom.value;
  const to = inputTo.value;
  fetchStatus.textContent = 'Fetching…';
  try {
    pgnText = await fetchGames(username, from, to, (s) => {
      fetchStatus.textContent = s;
    });
    const count = parseAllGames(pgnText).length;
    fetchStatus.textContent = `Ready: ${count} games`;
  } catch (err) {
    fetchStatus.textContent = err.message;
  }
});

inputFiles.addEventListener('change', async () => {
  const files = Array.from(inputFiles.files);
  if (files.length === 0) return;
  const texts = await Promise.all(files.map((file) => file.text()));
  pgnText = texts.join('\n\n');
  if (!uploadStatusEl) {
    uploadStatusEl = document.createElement('p');
    uploadStatusEl.className = 'hint';
    panelUpload.appendChild(uploadStatusEl);
  }
  const count = parseAllGames(pgnText).length;
  uploadStatusEl.textContent = `Loaded ${files.length} file(s): ${count} games`;
});

btnRun.addEventListener('click', async () => {
  if (!pgnText) {
    alert('Load games first');
    return;
  }
  const username = inputUsername.value.trim();
  if (!username) {
    alert('Enter your chess.com username so I know which side is you');
    return;
  }

  const provider = selectProvider.value;
  const apiKey = inputApikey.value;
  const model = inputModel.value;
  const userCustomization = inputCustom.value;
  const deepAnalysis = checkDeepAnalysis.checked;

  if (checkSavekey.checked) {
    writeSavedKey(provider, apiKey);
  }

  btnRun.disabled = true;
  statusLog.textContent = '';
  reportEl.innerHTML = '';
  btnDownload.hidden = true;

  const onStatus = (s) => {
    statusLog.textContent += s + '\n';
  };

  try {
    const games = parseAllGames(pgnText);
    const report = await runTiltMirror({
      games,
      username,
      provider,
      apiKey,
      model,
      userCustomization,
      onStatus,
      deepAnalysis,
    });
    const html = window.marked.parse(report);
    reportEl.innerHTML = window.DOMPurify.sanitize(html);
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
    onStatus('ERROR: ' + err.message);
  } finally {
    btnRun.disabled = false;
  }
});
