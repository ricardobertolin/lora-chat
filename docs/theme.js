// The accent colour, in one place.
//
// It appears in three unrelated renderers - CSS custom properties, a 2D canvas
// and a WebGL scene - so changing it broadcasts an event rather than having the
// settings panel reach into all of them.

export const ACCENT_KEY = 'lora-chat-accent';
export const DEFAULT_ACCENT = '#d8ff2f';

export function normaliseHex(value) {
  const v = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

export function readAccent() {
  try {
    return normaliseHex(localStorage.getItem(ACCENT_KEY)) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function hexToInt(hex) {
  return parseInt(normaliseHex(hex)?.slice(1) ?? DEFAULT_ACCENT.slice(1), 16);
}

// Lightened variant for the hover state on solid buttons.
export function lighten(hex, amount = 0.35) {
  const n = hexToInt(hex);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function applyAccent(hex, { persist = true } = {}) {
  const value = normaliseHex(hex) || DEFAULT_ACCENT;
  const root = document.documentElement;
  root.style.setProperty('--acid', value);
  root.style.setProperty('--acid-lit', lighten(value));
  // "good" signal shares the accent by design - it is the same idea of health.
  root.style.setProperty('--good', value);

  if (persist) {
    try {
      localStorage.setItem(ACCENT_KEY, value);
    } catch {}
  }
  document.dispatchEvent(new CustomEvent('accentchange', { detail: { hex: value } }));
  return value;
}
