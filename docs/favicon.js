// Redraws the tab icon in the current accent colour.
//
// The icon is small enough to rebuild as an SVG data URI on every change, which
// stays crisp at any tab size and needs no canvas.
//
// The installed home-screen icon cannot follow along: Android bakes it at
// install time from the manifest, so changing the accent only affects the
// browser tab until the app is reinstalled.

const ICON_SVG = (accent, ink) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">
<rect width="32" height="32" fill="#000000"/>
<rect x="2" y="2" width="28" height="28" fill="none" stroke="${accent}" stroke-width="2"/>
<g fill="none" stroke="${accent}" stroke-width="2.5">
<path d="M9 17a9 9 0 0 1 14 0"/>
<path d="M12.5 21a5 5 0 0 1 7 0"/>
</g>
<rect x="14" y="23" width="4" height="4" fill="${ink}"/>
</svg>`;

export function paintFavicon(accent = '#d8ff2f', ink = '#eef0ea') {
  const svg = ICON_SVG(accent, ink);
  const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  let link = document.querySelector('link#dynIcon');
  if (!link) {
    link = document.createElement('link');
    link.id = 'dynIcon';
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.href = href;
  return href;
}
