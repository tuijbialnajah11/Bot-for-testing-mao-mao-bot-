const form = document.querySelector('#pair-form');
const phoneInput = document.querySelector('#phone-number');
const pairButton = document.querySelector('#pair-button');
const pairButtonLabel = document.querySelector('#pair-button-label');
const formError = document.querySelector('#form-error');
const badge = document.querySelector('#connection-badge');
const badgeLabel = document.querySelector('#connection-label');
const statusMessage = document.querySelector('#status-message');
const pairingResult = document.querySelector('#pairing-result');
const pairingCode = document.querySelector('#pairing-code');
const resultNumber = document.querySelector('#result-number');
const connectedResult = document.querySelector('#connected-result');
const disconnectButton = document.querySelector('#disconnect-button');
const copyButton = document.querySelector('#copy-button');
const statusLine = document.querySelector('.status-line');

let currentCode = '';
let polling = false;

const labels = {
  idle: 'Not connected',
  connecting: 'Connecting',
  pairing: 'Code ready',
  connected: 'Connected',
  disconnecting: 'Disconnecting',
  disconnected: 'Signed out',
  error: 'Needs attention',
};

function showError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

function renderStatus(status) {
  const state = status?.state || 'idle';
  badge.dataset.state = state;
  badgeLabel.textContent = labels[state] || 'Not connected';
  statusLine.dataset.state = state;
  statusMessage.textContent = status?.message || 'Enter your number to pair this bot with WhatsApp.';

  const inProgress = ['connecting', 'pairing', 'connected', 'disconnecting'].includes(state);
  pairButton.disabled = inProgress;
  phoneInput.disabled = inProgress;
  pairButtonLabel.textContent = state === 'connecting'
    ? 'Requesting code…'
    : state === 'pairing'
      ? 'Waiting for phone confirmation…'
      : state === 'connected'
        ? 'WhatsApp connected'
        : state === 'disconnecting'
          ? 'Disconnecting…'
          : 'Generate pairing code';

  const code = typeof status?.pairingCode === 'string' ? status.pairingCode : '';
  currentCode = code;
  pairingCode.textContent = code;
  pairingResult.hidden = !(state === 'pairing' && code);
  resultNumber.textContent = status?.phoneNumber || '';
  connectedResult.hidden = state !== 'connected';
  disconnectButton.hidden = !['pairing', 'connected', 'disconnecting', 'disconnected', 'error'].includes(state);
  disconnectButton.disabled = state === 'disconnecting';

  if (state !== 'error') showError('');
}

async function refreshStatus() {
  if (polling) return;
  polling = true;
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Could not read bot status.');
    renderStatus(await response.json());
  } catch (error) {
    showError(error.message || 'The bot server is not responding.');
  } finally {
    polling = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  const phoneNumber = phoneInput.value.trim();
  if (!phoneNumber) {
    showError('Enter your WhatsApp number with its country code.');
    phoneInput.focus();
    return;
  }

  pairButton.disabled = true;
  pairButtonLabel.textContent = 'Starting pairing…';
  try {
    const response = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start pairing.');
    showError('');
    await refreshStatus();
  } catch (error) {
    showError(error.message || 'Could not reach the bot server.');
    pairButton.disabled = false;
    pairButtonLabel.textContent = 'Generate pairing code';
  }
});

disconnectButton.addEventListener('click', async () => {
  disconnectButton.disabled = true;
  try {
    const response = await fetch('/api/disconnect', { method: 'POST', headers: { Accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not disconnect.');
    await refreshStatus();
  } catch (error) {
    showError(error.message || 'Could not disconnect.');
    disconnectButton.disabled = false;
  }
});

copyButton.addEventListener('click', async () => {
  if (!currentCode) return;
  try {
    await navigator.clipboard.writeText(currentCode);
    copyButton.setAttribute('aria-label', 'Pairing code copied');
    copyButton.title = 'Copied';
    setTimeout(() => {
      copyButton.setAttribute('aria-label', 'Copy pairing code');
      copyButton.title = 'Copy code';
    }, 1400);
  } catch {
    showError('Clipboard access is unavailable. Select and copy the code instead.');
  }
});

refreshStatus();
setInterval(refreshStatus, 1500);
