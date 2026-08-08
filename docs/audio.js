// Sounds, synthesised with WebAudio rather than loaded as files - the page has
// to work offline and under a strict cache, so shipping no assets is simplest.

let ctx = null;
let enabled = true;
let ringTimer = null;

export function setEnabled(on) {
  enabled = !!on;
  if (!enabled) stopRinging();
}

export function isEnabled() {
  return enabled;
}

export function isRinging() {
  return ringTimer !== null;
}

// Mobile browsers refuse to make noise until the user has interacted with the
// page, and a context created before that starts suspended. Call this from a
// click handler.
export function unlock() {
  const c = context();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function context() {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

// One shaped tone. The short ramps matter: a raw gate on an oscillator clicks.
function tone({ freq, startAt = 0, duration = 0.12, gain = 0.18, type = 'sine' }) {
  const c = context();
  if (!c) return;

  const osc = c.createOscillator();
  const amp = c.createGain();
  const t0 = c.currentTime + startAt;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.setValueAtTime(gain, t0 + duration - 0.02);
  amp.gain.linearRampToValueAtTime(0, t0 + duration);

  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// A message arrived: two quick rising notes, easy to ignore.
export function chirpReceived() {
  if (!enabled) return;
  tone({ freq: 880, startAt: 0, duration: 0.08 });
  tone({ freq: 1320, startAt: 0.09, duration: 0.1 });
}

// Something went wrong: one low note.
export function chirpError() {
  if (!enabled) return;
  tone({ freq: 220, duration: 0.22, type: 'triangle' });
}

// A probe going out. Low and very short - during a survey this fires every few
// seconds for as long as you are walking, so it has to stay unobtrusive.
export function tickSent() {
  if (!enabled) return;
  tone({ freq: 523, duration: 0.025, gain: 0.05 });
}

// A probe reply. Higher than the outgoing tick, so the pair reads as
// call-and-answer and a miss is audible as a tick with no echo.
export function tickProbe() {
  if (!enabled) return;
  tone({ freq: 1568, duration: 0.03, gain: 0.06 });
}

function ringOnce() {
  tone({ freq: 1046, startAt: 0.0, duration: 0.18, gain: 0.22, type: 'square' });
  tone({ freq: 784, startAt: 0.22, duration: 0.18, gain: 0.22, type: 'square' });
  tone({ freq: 1046, startAt: 0.5, duration: 0.18, gain: 0.22, type: 'square' });
  tone({ freq: 784, startAt: 0.72, duration: 0.18, gain: 0.22, type: 'square' });
}

// Repeats until answered or cancelled. Deliberately insistent - the whole point
// is to be noticed from a pocket.
export function startRinging(periodMs = 2500) {
  if (!enabled || ringTimer !== null) return;
  unlock();
  ringOnce();
  ringTimer = setInterval(ringOnce, periodMs);
}

export function stopRinging() {
  if (ringTimer !== null) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}
