# LoRa Chat web app

**Live: <https://ricardobertolin.github.io/lora_chat_app/>**

A browser client for the `lora_chat` firmware. One codebase runs on desktop and
Android; it picks its USB transport at runtime.

This folder is named `docs/` because GitHub Pages can only publish from a repo's
root or from `/docs` - nothing else. Push to `main` and the site rebuilds in
about a minute.

| Platform | Browser | Transport |
| --- | --- | --- |
| Windows / Linux desktop | Chrome, Edge | Web Serial (uses the existing COM port) |
| Android | Chrome | WebUSB (drives the CP2102 directly) |
| iPhone | - | Not possible; iOS has neither API |

Firefox and Safari support neither API on any platform.

**The firmware needs no changes.** `lora_chat` already speaks newline-delimited
UTF-8 at 115200, which is exactly what this consumes - the app is `chat.py`
rewritten in JavaScript.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Markup and styling. |
| `app.js` | UI wiring. |
| `protocol.js` | Parses the firmware's serial lines. No browser APIs, so it is unit-testable. |
| `transport.js` | Web Serial and WebUSB/CP210x implementations behind one interface. |
| `position.js` | Position encoding and great-circle maths. Also browser-free and unit-tested. |
| `sw.js`, `manifest.webmanifest` | PWA shell, so it installs and runs offline. |
| `serve.py` | Local dev server on localhost. |
| `make_icons.py` | Regenerates the PNG icons. Stdlib only. |
| `test/` | `npm test` (26 tests) |

## Position sharing

Tap **Pos**. A position is sent as an ordinary chat message with a marker:

```
!POS -23.550520 -46.633309 12
```

so the **firmware needs no changes** - the board relays it like any other text,
and the receiving app renders a peer update instead of a chat bubble. Peers are
listed with distance and compass bearing from wherever you are.

Two sources, because they suit different machines:

| Source | For | Notes |
| --- | --- | --- |
| **Use GPS** | Phones | Real GNSS, works with no internet. Fixes worse than 100 m are rejected. |
| **Set manually** | Desktops, fixed nodes | Type the coordinates once; stored in `localStorage` and restored on reload. |

**Desktop geolocation is deliberately not trusted.** A PC has no GNSS, so the
browser falls back to WiFi or IP lookup - kilometres out, and it needs internet,
which is exactly what you will not have where LoRa is useful. A base station
does not move, so typing its coordinates is both more accurate and always
available. The 100 m accuracy gate is what stops an IP-derived guess from
quietly becoming a map pin.

**Share** starts a 60-second broadcast. At SF9 a position costs about a third of
a second of airtime, so it stays negligible for a handful of nodes.

## Desktop

```powershell
cd webapp
python serve.py
```

Opens <http://localhost:8000>. Click **Connect** and pick the CP210x device.

`localhost` counts as a secure context, which is what Web Serial requires - a
plain `file://` open will not work.

**Only one program can hold a COM port.** Close the Arduino IDE Serial Monitor
and any `chat.py` before connecting, or the port will not appear.

## Android

Open <https://ricardobertolin.github.io/lora_chat_app/> in **Chrome** and plug the
board in with a **USB-C OTG cable** - the phone acts as USB host and powers the
board, so no battery is needed.

The HTTPS matters: WebUSB refuses to run outside a secure context, and a phone
cannot reach your PC's `localhost`. That is the whole reason for publishing to
Pages rather than just running `serve.py`.

Then **Add to home screen**. The service worker caches everything, so after the
first load it runs with no internet at all - which is the point, since there is
no connectivity where LoRa is useful.

Bump `CACHE` in `sw.js` whenever you change a file, or the service worker will
keep serving the old copy.

## Two people, no internet

```
[Android + board] <--LoRa--> [board + desktop]
     USB-C OTG                     USB
```

Each end needs a board running `lora_chat` on matching radio settings. There is
no router, no server and no SIM in the path - the LoRa link is the network.

## Troubleshooting

Tap **?** in the header for diagnostics: which transport was chosen, whether Web
Serial/WebUSB exist, and a picker that lists *any* USB device the browser can
see. If that one is empty too, the browser sees no USB device at all and the
problem is the cable or USB host mode - not this app.

### Cables

A USB-C to USB-C **charger** cable often carries power and CC only, with no USB
2.0 data pair. The board lights up and still cannot be found, because the CP2102
needs D+/D-. Use a cable known to carry data - the one you flash the board with
from the PC - and a USB-C OTG adapter if it is USB-A on the other end.

| Symptom | Cause |
| --- | --- |
| Board powers on, picker empty | Charge-only cable, or the phone is not acting as USB host |
| No device in the picker (desktop) | Something else holds the COM port |
| Connects, no banner | Board did not reset; press its RST button |
| Garbled text | Wrong baud - the board must be on 115200 |
| "Web Serial and WebUSB unavailable" | Firefox or Safari; use Chrome |
| Messages send but never arrive | The two boards disagree on frequency or SF |

## Status

Unit-tested: the line parser, against output captured from real COM4/COM6
sessions (`node --test test/`).

Not yet verified on hardware: the Web Serial and WebUSB connect paths, which
need a real browser and a real phone. The CP2102 setup in `transport.js`
(`IFC_ENABLE`, `SET_BAUDRATE`, `SET_LINE_CTL`, `SET_MHS`) follows Silicon Labs
AN571 but is the most likely place to need iteration on Android.
