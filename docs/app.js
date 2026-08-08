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

function bubble({ mine, who, text, rssi, snr }) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (mine ? 'sent' : 'recv');

  if (who || rssi !== undefined) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (who) {
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = who;
      meta.appendChild(w);
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
}

function handleLine(raw) {
  const ev = parseLine(raw);
  if (!ev) return;

  switch (ev.kind) {
    case 'sent':
      if (isPosition(ev.text)) {
        note(`sent position (${myPos ? myPos.source : 'unknown'})`);
      } else {
        bubble({ mine: true, text: ev.text });
      }
      break;
    case 'recv': {
      lastRssi = ev.rssi;
      updateSubtitle();

      // Radio-settings traffic between the boards is status, not conversation.
      if (ev.text.startsWith('!CFGOK')) {
        note(`${ev.from || 'peer'} confirmed the new radio settings`);
        break;
      }
      if (ev.text.startsWith('!CFG ')) {
        note(`${ev.from || 'peer'} changed the radio: ${ev.text.slice(5)}`);
        break;
      }

      const pos = isPosition(ev.text) ? decodePosition(ev.text) : null;
      if (pos) {
        const who = ev.from || 'unknown';
        peers.set(who, { ...pos, at: Date.now(), rssi: ev.rssi });
        const rel = describeRelative(myPos, pos);
        note(`${who} is at ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` +
             (rel ? ` — ${rel} of you` : ' (set your own position to get range)'));
        renderPosition();
        break;
      }
      // A malformed !POS falls through and is shown as an ordinary message
      // rather than being silently swallowed.
      bubble({ mine: false, who: ev.from, text: ev.text, rssi: ev.rssi, snr: ev.snr });
      break;
    }
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
    await transport.send(text);
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
