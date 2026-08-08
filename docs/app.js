// Wires the transport to the chat UI. The firmware needs no changes: it already
// speaks newline-delimited text at 115200 in both directions.

import { parseLine, signalLevel } from './protocol.js';
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
};

let transport = null;
let nodeName = null;
let lastRssi = null;

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
      bubble({ mine: true, text: ev.text });
      break;
    case 'recv':
      lastRssi = ev.rssi;
      bubble({ mine: false, who: ev.from, text: ev.text, rssi: ev.rssi, snr: ev.snr });
      updateSubtitle();
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
