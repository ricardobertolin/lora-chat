# LoRa Chat web app

**Live: <https://ricardobertolin.github.io/lora-chat/>**

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
| `sw.js`, `manifest.webmanifest` | PWA shell, so it installs and runs offline. |
| `serve.py` | Local dev server on localhost. |
| `make_icons.py` | Regenerates the PNG icons. Stdlib only. |
| `test/` | `npm test`, or `node --test test/` |

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

Open <https://ricardobertolin.github.io/lora-chat/> in **Chrome** and plug the
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

| Symptom | Cause |
| --- | --- |
| No device in the picker | Something else holds the port, or the cable is charge-only |
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
