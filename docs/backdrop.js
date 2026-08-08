// The wireframe backdrop: dormant when offline, awake when connected, and it
// pulses on every received packet.
//
// It binds to the UI through MutationObserver rather than being called by
// app.js, so the chat logic stays unaware that any of this exists.
//
// Two departures from the original design, both for a battery-powered field
// app: three.js is vendored locally instead of imported from a CDN (there is no
// internet where LoRa is useful), and the animation stops whenever the page is
// hidden rather than rendering forever in your pocket.

import * as THREE from './vendor/three.module.min.js';
import { readAccent, hexToInt } from './theme.js';

const canvas = document.getElementById('bg3d');
if (canvas) start(canvas);

function start(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  } catch {
    return;  // no WebGL: the plain black background is a fine fallback
  }
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  cam.position.set(0, 0, 6.2);

  const group = new THREE.Group();
  scene.add(group);

  const accent = hexToInt(readAccent());
  const shellMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.5 });
  const coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const ringMat = new THREE.LineBasicMaterial({ color: 0xff2d2d, transparent: true, opacity: 0.22 });

  const shell = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.9, 2)), shellMat);
  group.add(shell);
  const core = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.05, 1)), coreMat);
  group.add(core);

  const circle = (radius) =>
    new THREE.BufferGeometry().setFromPoints(
      new THREE.EllipseCurve(0, 0, radius, radius, 0, Math.PI * 2)
        .getPoints(96)
        .map((p) => new THREE.Vector3(p.x, p.y, 0))
    );

  const rings = [];
  for (const [rx, rz] of [[Math.PI / 2, 0], [Math.PI / 2.6, Math.PI / 3], [Math.PI / 1.7, -Math.PI / 4]]) {
    const ring = new THREE.LineLoop(circle(2.8), ringMat.clone());
    ring.rotation.x = rx;
    ring.rotation.z = rz;
    rings.push(ring);
    group.add(ring);
  }

  // Expanding shockwave, fired on each incoming packet.
  const waveMat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0 });
  const wave = new THREE.LineLoop(circle(1), waveMat);
  wave.rotation.x = Math.PI / 2.2;
  group.add(wave);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let live = false;   // connected?
  let energy = 0;     // 0 dormant, 1 fully awake
  let pulse = 0;      // decays after each received packet
  let waveT = -1;     // shockwave progress, <0 idle
  let t = 0;
  let raf = null;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function firePulse() {
    if (!live) return;
    pulse = 1;
    waveT = 0;
  }

  function frame() {
    const target = live ? 1 : 0;
    energy += (target - energy) * 0.02;
    pulse *= 0.94;

    t += 0.0008 + energy * 0.0045 + pulse * 0.012;
    group.rotation.y = t;
    group.rotation.x = Math.sin(t * 0.6) * (0.08 + energy * 0.22);

    const breathe = 1 + Math.sin(Date.now() * 0.0016) * 0.015 * energy;
    group.scale.setScalar(breathe * (1 + pulse * 0.12));

    shellMat.opacity = 0.12 + energy * 0.38 + pulse * 0.35;
    coreMat.opacity = 0.1 + energy * 0.45 + pulse * 0.45;
    core.rotation.y = -t * (1.6 + pulse * 3);
    rings.forEach((r, i) => {
      r.material.opacity = 0.04 + energy * 0.18 + pulse * 0.3;
      r.rotation.z += (0.0006 + energy * 0.0022) * (i % 2 ? -1 : 1);
    });

    if (waveT >= 0) {
      waveT += 0.02;
      if (waveT > 1) {
        waveT = -1;
        wave.material.opacity = 0;
      } else {
        wave.scale.setScalar(1.1 + waveT * 2.6);
        wave.material.opacity = (1 - waveT) * 0.5;
      }
    }

    renderer.render(scene, cam);
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (raf === null && !still) raf = requestAnimationFrame(frame);
  }
  function stop() {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  // A backdrop is not worth spending battery on while the screen is off or the
  // app is in the background - which is most of a range walk.
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));

  document.addEventListener('accentchange', (e) => {
    const c = hexToInt(e.detail.hex);
    shellMat.color.setHex(c);
    waveMat.color.setHex(c);
    if (still) renderer.render(scene, cam);   // static mode needs a redraw
  });

  if (still) renderer.render(scene, cam);
  else play();

  // Wake up when the status pill turns on, pulse on each received bubble.
  const statusEl = document.getElementById('status');
  if (statusEl) {
    const sync = () => {
      live = statusEl.classList.contains('on');
    };
    new MutationObserver(sync).observe(statusEl, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  const logEl = document.getElementById('log');
  if (logEl) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList.contains('msg') && !n.classList.contains('sent')) {
            firePulse();
          }
        }
      }
    }).observe(logEl, { childList: true });
  }
}
