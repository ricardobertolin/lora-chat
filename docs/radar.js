// A north-up radar of who is around you, drawn from shared GPS positions.
//
// Bearing genuinely requires GPS at both ends. One omnidirectional antenna
// gives you a distance estimate and nothing else - direction needs a
// directional antenna or several receivers. So a peer with no position is not
// plotted; it is listed as out-of-fix instead of guessed at.

// Rings land on round numbers so the scale label reads sensibly.
const SCALES = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];

export function pickScale(maxDistanceM) {
  if (!Number.isFinite(maxDistanceM) || maxDistanceM <= 0) return SCALES[0];
  return SCALES.find((s) => s >= maxDistanceM) ?? SCALES[SCALES.length - 1];
}

// Bearing is degrees clockwise from north, and north is up, so it maps to
// screen coordinates with y inverted.
export function polarToXY(distanceM, bearingDeg, scaleM, radiusPx) {
  const r = Math.min(1, distanceM / scaleM) * radiusPx;
  const a = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

export function formatScale(metres) {
  return metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
}

// Read from the stylesheet so the accent setting reaches the canvas too.
function palette() {
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement)
    : null;
  const v = (name, fallback) => (css?.getPropertyValue(name) || '').trim() || fallback;
  return {
    grid: v('--line-dim', '#4a4d48'),
    axis: v('--ink-dim', '#8d918a'),
    blip: v('--acid', '#d8ff2f'),
    self: v('--ink', '#eef0ea'),
    text: v('--ink-dim', '#8d918a'),
    stale: v('--line-dim', '#4a4d48'),
  };
}

// contacts: [{ name, distanceM, bearingDeg, stale }]
export function drawRadar(canvas, contacts, { deviceRatio = 1 } = {}) {
  const cssSize = canvas.clientWidth || 240;
  canvas.width = cssSize * deviceRatio;
  canvas.height = cssSize * deviceRatio;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const radius = cssSize / 2 - 18;   // leave room for labels

  const COLOURS = palette();
  const plotted = contacts.filter((c) => Number.isFinite(c.distanceM));
  const scale = pickScale(Math.max(0, ...plotted.map((c) => c.distanceM)));

  ctx.font = '10px monospace';
  ctx.textBaseline = 'middle';

  // rings
  ctx.strokeStyle = COLOURS.grid;
  ctx.lineWidth = 1;
  for (const frac of [1 / 3, 2 / 3, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.stroke();
  }

  // cross hairs
  ctx.strokeStyle = COLOURS.grid;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  ctx.fillStyle = COLOURS.axis;
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - radius - 8);
  ctx.fillStyle = COLOURS.text;
  ctx.fillText(formatScale(scale), cx, cy + radius + 9);

  // me, a square rather than a dot to match the rest of the interface
  ctx.fillStyle = COLOURS.self;
  ctx.fillRect(cx - 3, cy - 3, 6, 6);

  for (const c of plotted) {
    const { x, y } = polarToXY(c.distanceM, c.bearingDeg, scale, radius);
    ctx.fillStyle = c.stale ? COLOURS.stale : COLOURS.blip;

    ctx.beginPath();
    ctx.arc(cx + x, cy + y, 4, 0, Math.PI * 2);
    ctx.fill();

    // A line back to the centre makes the bearing readable at a glance.
    ctx.strokeStyle = c.stale ? COLOURS.stale : COLOURS.grid;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + x, cy + y);
    ctx.stroke();

    ctx.textAlign = x > 0 ? 'right' : 'left';
    ctx.fillText(c.name, cx + x + (x > 0 ? -8 : 8), cy + y);
  }

  if (!plotted.length) {
    ctx.fillStyle = COLOURS.text;
    ctx.textAlign = 'center';
    ctx.fillText('no positions yet', cx, cy + radius / 2);
  }
  return { scale, plotted: plotted.length };
}
