// Wires the transport to the chat UI. The firmware needs no changes: it already
// speaks newline-delimited text at 115200 in both directions.

import { parseLine, signalLevel } from './protocol.js';
import {
  encodePosition,
  decodePosition,
  isPosition,
  describeRelative,
  formatAge,
  MAX_ACCURACY_M,
} from './position.js';
import { deriveKey, encryptMessage, decryptMessage, isEncrypted } from './crypto.js';
import * as history from './history.js';
import * as survey from './survey.js';
import * as audio from './audio.js';
import {
  pickTransport,
  describeCapabilities,
  probeAnyUsbDevice,
  alreadyPermitted,
  WebSerialTransport,
  WebUsbCp210xTransport,
} from './transport.js';

const els = {
  connect: document.getElementById('connect'),
  status: document.getElementById('status'),
  statusText: document.getElementById('statusText'),
  sub: document.getElementById('sub'),
  banner: document.getElementById('banner'),
  log: document.getElementById('log'),
  form: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  diag: document.getElementById('diag'),
  posBtn: document.getElementById('posBtn'),
  posPanel: document.getElementById('posPanel'),
  myPos: document.getElementById('myPos'),
  useGps: document.getElementById('useGps'),
  manualBtn: document.getElementById('manualBtn'),
  manualRow: document.getElementById('manualRow'),
  mLat: document.getElementById('mLat'),
  mLon: document.getElementById('mLon'),
  mSave: document.getElementById('mSave'),
  shareBtn: document.getElementById('shareBtn'),
  posClear: document.getElementById('posClear'),
  peers: document.getElementById('peers'),
  setBtn: document.getElementById('setBtn'),
  setPanel: document.getElementById('setPanel'),
  passIn: document.getElementById('passIn'),
  encOn: document.getElementById('encOn'),
  encOff: document.getElementById('encOff'),
  encState: document.getElementById('encState'),
  histState: document.getElementById('histState'),
  histClear: document.getElementById('histClear'),
  soundState: document.getElementById('soundState'),
  soundToggle: document.getElementById('soundToggle'),
  testBtn: document.getElementById('testBtn'),
  testPanel: document.getElementById('testPanel'),
  testInterval: document.getElementById('testInterval'),
  testStart: document.getElementById('testStart'),
  testStop: document.getElementById('testStop'),
  testCsv: document.getElementById('testCsv'),
  testState: document.getElementById('testState'),
  testStats: document.getElementById('testStats'),
  callBtn: document.getElementById('callBtn'),
  callBanner: document.getElementById('callBanner'),
  callText: document.getElementById('callText'),
  answerBtn: document.getElementById('answerBtn'),
  dismissBtn: document.getElementById('dismissBtn'),
};

let transport = null;
let nodeName = null;
let lastRssi = null;

// Position sharing --------------------------------------------------------
// One update a minute. At SF9 a position costs roughly a third of a second of
// airtime, so this stays a rounding error on a channel shared by a few people.
const SHARE_INTERVAL_MS = 60000;
const STORE_KEY = 'lora-chat-position';

let myPos = null;      // { lat, lon, accuracy, source }
let watchId = null;
let shareTimer = null;
const peers = new Map();  // node name -> { lat, lon, accuracy, at, rssi }

// Encryption --------------------------------------------------------------
// The passphrase is kept in localStorage so the app is usable across reloads.
// That means anyone with the unlocked device can read it - the threat this
// protects against is someone listening on the air, not someone holding
// your phone.
const PASS_KEY = 'lora-chat-passphrase';
let cryptoKey = null;

let log = [];  // persisted chat history

// Link test and calling ---------------------------------------------------
const SOUND_KEY = 'lora-chat-sound';
const CALL_REPEAT_MS = 4000;

let currentSf = 9;         // tracked from the firmware's settings lines
let activeSurvey = null;
let surveyTimer = null;
let surveyRender = null;
let probeSeq = 0;

let callTimer = null;      // we are calling out
let ringingFrom = null;    // someone is calling us

function setConnected(on) {
  els.status.classList.toggle('on', on);
  els.statusText.textContent = on ? 'connected' : 'offline';
  els.connect.textContent = on ? 'Disconnect' : 'Connect';
  els.connect.classList.toggle('ghost', on);
  els.input.disabled = !on;
  els.send.disabled = !on;
  els.input.placeholder = on ? 'Type a message' : 'Connect a board to start';
  if (on) els.input.focus();
  updateSubtitle();
}

function updateSubtitle() {
  const bits = [];
  if (nodeName) bits.push(`node ${nodeName}`);
  if (lastRssi !== null) bits.push(`last RSSI ${lastRssi} dBm`);
  els.sub.textContent = bits.length ? bits.join(' · ') : 'not connected';
}

function atBottom() {
  return els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 60;
}

function append(node) {
  const stick = atBottom();
  els.log.appendChild(node);
  if (stick) els.log.scrollTop = els.log.scrollHeight;
}

function note(text, isError = false) {
  const d = document.createElement('div');
  d.className = 'note' + (isError ? ' err' : '');
  d.textContent = text;
  append(d);
}

function bubble({ mine, who, text, rssi, snr, locked, at, persist = true }) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine ? 'sent' : 'recv');

  if (who || rssi !== undefined || locked) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (who) {
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = who;
      meta.appendChild(w);
    }
    if (locked) {
      const l = document.createElement('span');
      l.className = 'lock';
      l.textContent = '🔒';
      l.title = 'encrypted in transit';
      meta.appendChild(l);
    }
    if (rssi !== undefined && rssi !== null) {
      const s = document.createElement('span');
      s.className = 'sig ' + signalLevel(rssi);
      s.textContent = `${rssi} dBm / ${snr} dB`;
      meta.appendChild(s);
    }
    wrap.appendChild(meta);
  }

  const body = document.createElement('div');
  body.textContent = text;
  wrap.appendChild(body);
  append(wrap);

  if (persist) {
    log = history.appendEntry(log, {
      mine,
      who: who || null,
      text,
      rssi: rssi ?? null,
      snr: snr ?? null,
      locked: !!locked,
      at: at ?? Date.now(),
    });
    history.save(log);
    renderHistoryState();
  }
}

function renderHistoryState() {
  els.histState.textContent = log.length
    ? `${log.length} message${log.length === 1 ? '' : 's'} kept`
    : 'empty';
}

// Replays the stored conversation on load. persist:false so redrawing does not
// append the same messages again.
function restoreHistory() {
  log = history.load();
  renderHistoryState();
  if (!log.length) return;

  for (const e of log) {
    bubble({
      mine: e.mine,
      who: e.who,
      text: e.text,
      rssi: e.rssi ?? undefined,
      snr: e.snr ?? undefined,
      locked: e.locked,
      persist: false,
    });
  }
  const d = document.createElement('div');
  d.className = 'note';
  d.textContent = `--- earlier (${history.formatStamp(log[log.length - 1].at)}) ---`;
  els.log.appendChild(d);
  els.log.scrollTop = els.log.scrollHeight;
}

// Everything the app sends goes through here, so encryption and the command
// exemption are applied in exactly one place.
async function sendText(text) {
  if (!transport) return false;
  const outgoing = cryptoKey && !text.startsWith('/') ? await encryptMessage(cryptoKey, text) : text;
  await transport.send(outgoing);
  return true;
}

async function handleRecv(ev) {
  lastRssi = ev.rssi;
  updateSubtitle();

  // Firmware control traffic is never encrypted - the board has to read it.
  if (ev.text.startsWith('!CFGOK')) {
    note(`${ev.from || 'peer'} confirmed the new radio settings`);
    return;
  }
  if (ev.text.startsWith('!CFG ')) {
    note(`${ev.from || 'peer'} changed the radio: ${ev.text.slice(5)}`);
    return;
  }

  const who = ev.from || 'peer';
  let text = ev.text;
  let locked = false;

  // Decrypt before classifying, so positions and probes are protected too.
  if (isEncrypted(text)) {
    if (!cryptoKey) {
      note(`${who} sent an encrypted message - set the passphrase to read it`);
      return;
    }
    const plain = await decryptMessage(cryptoKey, text);
    if (plain === null) {
      note(`could not decrypt a message from ${who} - different passphrase?`, true);
      audio.chirpError();
      return;
    }
    text = plain;
    locked = true;
  }

  // Any traffic at all means they are there, so a call in progress is answered.
  if (callTimer && !text.startsWith('!PING')) stopCalling(`${who} responded`);

  if (text.startsWith('!PING ')) {
    const seq = text.slice(6).trim();
    sendText(`!PONG ${seq}`).catch(() => {});
    return;
  }
  if (text.startsWith('!PONG ')) {
    const seq = Number(text.slice(6).trim());
    if (activeSurvey && survey.recordReply(activeSurvey, seq, {
      rssi: ev.rssi,
      snr: ev.snr,
      at: Date.now(),
    })) {
      audio.tickProbe();
      renderSurvey();
    }
    return;
  }
  if (text === '!CALL') {
    startRinging(who);
    return;
  }
  if (text === '!CALLOK') {
    stopCalling(`${who} answered`);
    return;
  }

  const pos = isPosition(text) ? decodePosition(text) : null;
  if (pos) {
    peers.set(who, { ...pos, at: Date.now(), rssi: ev.rssi });
    const rel = describeRelative(myPos, pos);
    note(`${who} is at ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` +
         (rel ? ` — ${rel} of you` : ' (set your own position to get range)'));
    renderPosition();
    return;
  }

  bubble({ mine: false, who: ev.from, text, rssi: ev.rssi, snr: ev.snr, locked });
  audio.chirpReceived();
}

async function handleSent(ev) {
  let text = ev.text;
  let locked = false;
  if (isEncrypted(text)) {
    const plain = await decryptMessage(cryptoKey, text);
    if (plain === null) {
      note('sent an encrypted message');
      return;
    }
    text = plain;
    locked = true;
  }

  // Our own probes and control messages are not conversation.
  if (/^!(PING|PONG|CALL|CALLOK)\b/.test(text)) return;
  if (isPosition(text)) {
    note(`sent position (${myPos ? myPos.source : 'unknown'})`);
    return;
  }
  bubble({ mine: true, text, locked });
}

function handleLine(raw) {
  const ev = parseLine(raw);
  if (!ev) return;

  switch (ev.kind) {
    case 'sent':
      handleSent(ev);
      break;
    case 'recv':
      handleRecv(ev);
      break;
    case 'cfg':
      currentSf = ev.sf;
      note(ev.text.replace(/^~~\s*/, ''));
      break;
    case 'banner':
      nodeName = ev.node;
      updateSubtitle();
      note(`board ready — this node is ${ev.node}`);
      break;
    case 'radio':
      els.banner.textContent = `${ev.freq} MHz · SF${ev.sf} — the other board must match`;
      els.banner.classList.add('show');
      break;
    case 'error':
      note(ev.text, true);
      break;
    default:
      // Boot ROM chatter and anything else the firmware prints.
      note(ev.text);
  }
}

function renderPosition() {
  if (!myPos) {
    els.myPos.textContent = 'off';
  } else {
    const acc = myPos.source === 'manual' ? 'fixed' : `+/-${Math.round(myPos.accuracy)} m`;
    els.myPos.textContent =
      `${myPos.lat.toFixed(5)}, ${myPos.lon.toFixed(5)} (${myPos.source}, ${acc})`;
  }
  els.shareBtn.textContent = `Share: ${shareTimer ? 'on' : 'off'}`;

  els.peers.textContent = '';
  if (!peers.size) {
    els.peers.textContent = 'no peers yet';
    return;
  }
  for (const [name, p] of [...peers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rel = describeRelative(myPos, p);
    const row = document.createElement('div');
    row.className = 'peer';
    const who = document.createElement('b');
    who.textContent = name;
    row.appendChild(who);
    row.appendChild(
      document.createTextNode(
        ` ${rel ?? `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}` +
          ` · +/-${Math.round(p.accuracy)} m · ${formatAge(Date.now() - p.at)}` +
          (p.rssi !== null ? ` · ${p.rssi} dBm` : '')
      )
    );
    els.peers.appendChild(row);
  }
}

function setPosition(pos) {
  myPos = pos;
  if (pos && pos.source === 'manual') {
    localStorage.setItem(STORE_KEY, JSON.stringify({ lat: pos.lat, lon: pos.lon }));
  }
  renderPosition();
}

function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function startGps() {
  if (!('geolocation' in navigator)) {
    note('this browser has no geolocation API', true);
    return;
  }
  stopGps();
  note('acquiring GPS fix...');
  watchId = navigator.geolocation.watchPosition(
    ({ coords }) => {
      // A desktop with no GPS answers from WiFi/IP lookup, which can be
      // kilometres out. Refuse it rather than plotting a fiction - use the
      // manual entry for fixed nodes instead.
      if (coords.accuracy > MAX_ACCURACY_M) {
        note(
          `ignoring a fix accurate only to +/-${Math.round(coords.accuracy)} m ` +
            `(limit ${MAX_ACCURACY_M} m). On a desktop use "Set manually".`,
          true
        );
        return;
      }
      setPosition({
        lat: coords.latitude,
        lon: coords.longitude,
        accuracy: coords.accuracy,
        source: 'gps',
      });
    },
    (err) => note(`GPS failed: ${err.message}`, true),
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 }
  );
}

async function sendPosition() {
  if (!myPos) {
    note('no position set', true);
    return;
  }
  if (!transport) return;
  try {
    await transport.send(encodePosition(myPos));
  } catch (err) {
    note(`position send failed: ${err.message}`, true);
  }
}

function toggleShare() {
  if (shareTimer) {
    clearInterval(shareTimer);
    shareTimer = null;
    note('position sharing off');
  } else {
    if (!myPos) {
      note('set a position first', true);
      return;
    }
    shareTimer = setInterval(sendPosition, SHARE_INTERVAL_MS);
    note(`sharing position every ${SHARE_INTERVAL_MS / 1000}s`);
    sendPosition();
  }
  renderPosition();
}

// Link test ---------------------------------------------------------------

function renderSurvey() {
  if (!activeSurvey) {
    els.testStats.textContent = 'no samples yet';
    return;
  }
  const r = survey.summarise(activeSurvey);
  const cell = (label, value) => {
    const d = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = value;
    d.appendChild(document.createTextNode(`${label} `));
    d.appendChild(b);
    return d;
  };

  const one = (s, unit, digits = 1) =>
    s ? `${s.avg.toFixed(digits)}${unit} (${s.min.toFixed(digits)}..${s.max.toFixed(digits)})` : '-';

  els.testStats.textContent = '';
  els.testStats.appendChild(cell('sent', String(r.sent)));
  els.testStats.appendChild(cell('replies', String(r.received)));
  els.testStats.appendChild(cell('lost', String(r.lost)));
  els.testStats.appendChild(cell('delivery', survey.formatPercent(r.pdr)));
  els.testStats.appendChild(cell('RSSI', one(r.rssi, ' dBm', 0)));
  els.testStats.appendChild(cell('SNR', one(r.snr, ' dB')));
  els.testStats.appendChild(cell('RTT', one(r.rtt, ' ms', 0)));
  els.testStats.appendChild(
    cell(
      `margin (SF${r.sf})`,
      r.margin === null ? '-' : `${r.margin.toFixed(1)} dB — ~${r.rangeFactor.toFixed(1)}x further`
    )
  );
  if (myPos && peers.size) {
    const [, p] = [...peers.entries()][0];
    els.testStats.appendChild(cell('distance', describeRelative(myPos, p) || '-'));
  }
}

function startSurvey() {
  if (surveyTimer) return;
  if (!transport) {
    note('connect a board first', true);
    return;
  }
  const secs = Number(els.testInterval.value.trim().replace(',', '.'));
  if (!Number.isFinite(secs) || secs < 1 || secs > 300) {
    note('interval must be between 1 and 300 seconds', true);
    return;
  }
  const intervalMs = secs * 1000;
  activeSurvey = survey.createSurvey({
    sf: currentSf,
    intervalMs,
    // Generous enough that a slow SF12 round trip is not scored as a loss.
    timeoutMs: Math.max(intervalMs * 2, 12000),
  });
  probeSeq = 0;

  const fire = () => {
    probeSeq += 1;
    survey.recordSent(activeSurvey, probeSeq, Date.now());
    sendText(`!PING ${probeSeq}`).catch((err) => note(`probe failed: ${err.message}`, true));
    renderSurvey();
  };

  fire();
  surveyTimer = setInterval(fire, intervalMs);
  surveyRender = setInterval(renderSurvey, 1000);  // keeps timeouts ticking over
  els.testState.textContent = `running, every ${secs}s at SF${currentSf}`;
  note(`link test started at SF${currentSf}, one probe every ${secs}s`);
}

function stopSurvey() {
  if (!surveyTimer) return;
  clearInterval(surveyTimer);
  clearInterval(surveyRender);
  surveyTimer = null;
  surveyRender = null;

  const r = survey.summarise(activeSurvey);
  els.testState.textContent = 'stopped';
  note(
    `link test: ${r.received}/${r.received + r.lost} delivered (${survey.formatPercent(r.pdr)})` +
      (r.snr ? `, SNR ${r.snr.avg.toFixed(1)} dB, margin ${r.margin.toFixed(1)} dB at SF${r.sf}` : '')
  );
  renderSurvey();
}

function exportCsv() {
  if (!activeSurvey || !activeSurvey.probes.length) {
    note('nothing to export yet', true);
    return;
  }
  const blob = new Blob([survey.toCsv(activeSurvey)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lora-link-sf${activeSurvey.sf}-${Date.now()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Calling -----------------------------------------------------------------

function startCalling() {
  if (!transport) {
    note('connect a board first', true);
    return;
  }
  if (callTimer) return;
  audio.unlock();
  const ring = () => sendText('!CALL').catch(() => {});
  ring();
  callTimer = setInterval(ring, CALL_REPEAT_MS);
  els.callBtn.textContent = 'Cancel';
  note('calling - the other side will ring until they answer');
}

function stopCalling(reason) {
  if (!callTimer) return;
  clearInterval(callTimer);
  callTimer = null;
  els.callBtn.textContent = 'Call';
  note(reason || 'call cancelled');
}

function startRinging(who) {
  ringingFrom = who;
  els.callText.textContent = `${who} is calling`;
  els.callBanner.classList.add('show');
  audio.startRinging();
  note(`${who} is calling`);
}

function stopRinging(sendAck, reason) {
  if (!ringingFrom) return;
  audio.stopRinging();
  els.callBanner.classList.remove('show');
  ringingFrom = null;
  if (sendAck) sendText('!CALLOK').catch(() => {});
  note(reason);
}

els.testBtn.addEventListener('click', () => {
  audio.unlock();
  els.testPanel.classList.toggle('show');
});
els.testStart.addEventListener('click', startSurvey);
els.testStop.addEventListener('click', stopSurvey);
els.testCsv.addEventListener('click', exportCsv);
els.callBtn.addEventListener('click', () =>
  callTimer ? stopCalling('call cancelled') : startCalling()
);
els.answerBtn.addEventListener('click', () => stopRinging(true, 'answered'));
els.dismissBtn.addEventListener('click', () => stopRinging(false, 'call dismissed'));

function renderSoundState() {
  els.soundState.textContent = audio.isEnabled() ? 'on' : 'off';
}

els.soundToggle.addEventListener('click', () => {
  const next = !audio.isEnabled();
  audio.setEnabled(next);
  localStorage.setItem(SOUND_KEY, next ? '1' : '0');
  renderSoundState();
  if (next) audio.chirpReceived();
});

// Encryption and history controls ----------------------------------------

function renderEncState() {
  els.encState.textContent = cryptoKey ? 'on (AES-256-GCM)' : 'off - messages are readable on air';
}

async function enableEncryption(passphrase, quiet = false) {
  try {
    cryptoKey = await deriveKey(passphrase);
    localStorage.setItem(PASS_KEY, passphrase);
    if (!quiet) note('encryption on - the other end needs the same passphrase');
  } catch (err) {
    cryptoKey = null;
    if (!quiet) note(`could not set passphrase: ${err.message}`, true);
  }
  renderEncState();
}

els.encOn.addEventListener('click', () => {
  const p = els.passIn.value;
  if (!p) {
    note('enter a passphrase first', true);
    return;
  }
  els.passIn.value = '';
  enableEncryption(p);
});

els.encOff.addEventListener('click', () => {
  cryptoKey = null;
  localStorage.removeItem(PASS_KEY);
  renderEncState();
  note('encryption off');
});

els.histClear.addEventListener('click', () => {
  history.clear();
  log = [];
  els.log.textContent = '';
  renderHistoryState();
  note('history cleared');
});

els.setBtn.addEventListener('click', () => els.setPanel.classList.toggle('show'));
els.posBtn.addEventListener('click', () => els.posPanel.classList.toggle('show'));
els.useGps.addEventListener('click', startGps);
els.manualBtn.addEventListener('click', () => {
  els.manualRow.hidden = !els.manualRow.hidden;
  if (!els.manualRow.hidden && myPos) {
    els.mLat.value = myPos.lat.toFixed(6);
    els.mLon.value = myPos.lon.toFixed(6);
  }
});
els.mSave.addEventListener('click', () => {
  const lat = Number(els.mLat.value.trim().replace(',', '.'));
  const lon = Number(els.mLon.value.trim().replace(',', '.'));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    note('latitude must be a number between -90 and 90', true);
    return;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    note('longitude must be a number between -180 and 180', true);
    return;
  }
  stopGps();
  setPosition({ lat, lon, accuracy: 0, source: 'manual' });
  els.manualRow.hidden = true;
  note(`position fixed at ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
});
els.shareBtn.addEventListener('click', toggleShare);
els.posClear.addEventListener('click', () => {
  stopGps();
  if (shareTimer) {
    clearInterval(shareTimer);
    shareTimer = null;
  }
  localStorage.removeItem(STORE_KEY);
  setPosition(null);
  note('position cleared');
});

// A fixed node keeps its coordinates across reloads; a GPS fix is re-acquired.
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) {
    myPos = { lat: saved.lat, lon: saved.lon, accuracy: 0, source: 'manual' };
  }
} catch {}

// Ages go stale on their own, so redraw even when nothing arrives.
setInterval(() => {
  if (peers.size) renderPosition();
}, 15000);

async function connect() {
  const Transport = pickTransport();
  if (!Transport) {
    note(
      'This browser has neither Web Serial nor WebUSB. Use Chrome or Edge — ' +
        'Firefox and Safari do not support either.',
      true
    );
    return;
  }

  els.connect.disabled = true;
  try {
    transport = new Transport();
    await transport.connect({
      onLine: handleLine,
      onClose: () => {
        note('board disconnected');
        transport = null;
        setConnected(false);
      },
    });
    setConnected(true);
    note(`connected over ${Transport.label}`);
  } catch (err) {
    transport = null;
    // Dismissing the browser's device picker lands here too, which is not worth
    // shouting about.
    if (err && err.name === 'NotFoundError') {
      note('no device selected');
    } else {
      note(`connect failed: ${err && err.message ? err.message : err}`, true);
    }
    setConnected(false);
  } finally {
    els.connect.disabled = false;
  }
}

async function disconnect() {
  const t = transport;
  transport = null;
  setConnected(false);
  try {
    await t?.disconnect();
  } catch {}
  note('disconnected');
}

els.connect.addEventListener('click', () => (transport ? disconnect() : connect()));

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text || !transport) return;
  els.input.value = '';
  try {
    // No local echo: the board echoes every accepted line back as ">> ...", so
    // what appears in the log is what actually went out over the air.
    await sendText(text);
  } catch (err) {
    note(`send failed: ${err && err.message ? err.message : err}`, true);
  }
  els.input.focus();
});

els.diag.addEventListener('click', async () => {
  const caps = describeCapabilities();
  note(
    `diagnostics — ${caps.chosen} · Web Serial ${caps.webSerial ? 'yes' : 'no'}` +
      ` · WebUSB ${caps.webUsb ? 'yes' : 'no'} · secure ${caps.secureContext}` +
      ` · android ${caps.android}`
  );

  try {
    const granted = await alreadyPermitted();
    note(granted.length ? `already permitted: ${granted.join(', ')}` : 'no devices permitted yet');
  } catch (err) {
    note(`getDevices failed: ${err.message}`, true);
  }

  if (!caps.webUsb) return;
  note('pick ANY device in the next dialog — this shows what the phone can see');
  try {
    const d = await probeAnyUsbDevice();
    note(`phone sees: ${d.name} — VID ${d.vendorId}, PID ${d.productId}`);
    if (d.vendorId !== '0x10c4') {
      note('that is not the CP2102 (expected VID 0x10c4, PID 0xea60)', true);
    }
  } catch (err) {
    if (err && err.name === 'NotFoundError') {
      note(
        'the picker was empty or dismissed. If empty, the phone sees no USB device ' +
          'at all — almost always a charge-only cable, or the phone not doing USB host.',
        true
      );
    } else {
      note(`probe failed: ${err.message}`, true);
    }
  }
});

// Report capability up front so an unsupported browser is obvious immediately.
const caps = describeCapabilities();
if (!caps.webSerial && !caps.webUsb) {
  note('Web Serial and WebUSB are both unavailable in this browser. Use Chrome.', true);
} else {
  note(`ready — will connect over ${caps.chosen}`);
  if (caps.chosen === 'WebUSB') {
    note('Plug the board in with a USB-C data cable (charge-only cables will not work).');
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

setConnected(false);
renderPosition();
renderEncState();
audio.setEnabled(localStorage.getItem(SOUND_KEY) !== '0');
renderSoundState();
// Browsers will not make a sound until the user has interacted with the page.
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
restoreHistory();

// A stored passphrase means encryption stays on across reloads.
const storedPass = localStorage.getItem(PASS_KEY);
if (storedPass) enableEncryption(storedPass, true);
