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
| `crypto.js` | AES-GCM encryption and passphrase key derivation. |
| `history.js` | Chat history persistence and capping. |
| `survey.js` | Probe bookkeeping, delivery ratio and link-margin maths. |
| `audio.js` | Chirps and the ring tone, synthesised with WebAudio - no assets. |
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

## Encryption

**Set** -> type a shared passphrase -> **Enable**, on both ends. Messages then go
out as:

```
!ENC <base64 of IV || AES-256-GCM ciphertext || tag>
```

The board relays that like any other text, so the **firmware needs no changes**.
GCM authenticates as well as encrypts: a wrong key, a tampered packet or a
truncated one fails to decrypt rather than producing plausible garbage.
Decrypted messages show a lock in the header.

What it does **not** hide: the sender name, which the firmware prefixes outside
the ciphertext, and the fact that a transmission happened.

Two honest caveats:

- **Fixed salt.** Both ends must derive the same key having exchanged nothing,
  which rules out a random per-conversation salt. So the passphrase alone
  determines the key - identical passphrases give identical keys. 200k PBKDF2
  iterations and a strong passphrase are what carry the security.
- **The passphrase is stored in `localStorage`** so it survives reloads. Anyone
  with the unlocked device can read it. This protects against listening on the
  air, not against someone holding your phone.

Airtime roughly doubles: 28 bytes of IV and tag plus base64's 4/3 expansion, so
a 40-character message goes from about 0.35 s to 0.7 s at SF9.

`/commands` are never encrypted - the board would not recognise them.

## History

The last 300 messages are kept in `localStorage` and replayed on load, below an
`--- earlier ---` divider. **Set -> Clear** wipes them. Only real messages are
stored; diagnostics, positions and radio chatter are not.

## Link test

**Test** -> **Start**. It sends `!PING n` at a fixed interval; the other app
auto-replies `!PONG n`, and the statistics build up live:

| Reported | Meaning |
| --- | --- |
| delivery | Replies over probes that got a verdict. In-flight probes are excluded, so the figure does not dip after every send |
| RSSI / SNR / RTT | min, mean and max |
| margin | **The number that matters.** SNR above the floor for the current SF |
| distance | From shared positions, when both ends have one |

**Export CSV** dumps every probe: `seq, sent_at_ms, delivered, rtt_ms, rssi_dbm,
snr_db, sf`.

### Why margin, and not RSSI

Two reasons RSSI misleads at range:

- **Survivor bias.** You only see RSSI for packets that *arrived*. At the edge,
  the weak ones vanish and the average quietly improves - the link looks
  healthiest just before it dies. Delivery ratio is the honest measure.
- LoRa demodulates **below** the noise floor, so SNR predicts success better.
  Each SF has a hard limit: SF7 -7.5 dB, SF9 -12.5 dB, SF12 -20 dB.

`margin = SNR - floor`, and it tells you how much further you can go:
`d2/d1 = 10^(margin / 10n)`, with *n* around 2 in free space, 3 suburban, 4+
dense urban. The app reports that multiplier at n=3.

### Making the numbers mean something

- **Both antennas vertical.** Cross-polarisation can cost 20 dB, more than the
  whole SF7-to-SF12 range.
- **Off the ground**, waist height or higher - ground blocks the Fresnel zone.
- **Consistent posture.** Your body absorbs 900 MHz; against your chest is
  several dB down on held out.
- **At least 20 probes** per point. Fading makes a single sample meaningless.
- **Fix the power** with `/power`, or you are comparing nothing.

Run the test at each `/sf` to find the fastest setting that still delivers from
where you are.

## Sound and calling

A short two-note chirp on each received message; a quieter tick for probe
replies. **Set -> Sound** toggles it, and the choice is remembered.

**Call** rings the other side repeatedly until they answer, for when the phone
is in a pocket. Their app shows an Answer banner and rings until answered or
dismissed. **Any** message from them also ends the call - replying is answering.

Browsers refuse to make noise before the first interaction with the page, so the
audio context is unlocked on the first tap.

## Radio commands

Anything typed starting with `/` is handled by the board instead of being sent:

```
/status        /sf 7..12      /freq 868.0
/bw 125        /power -9..22  /revert       /help
```

Both boards switch together - the change is broadcast on the old settings first,
then applied at both ends - and **rolls back automatically after 30 seconds if
nothing is heard**, so a bad setting cannot strand a board out of reach. The app
shows the boards' `!CFG` chatter as notes rather than chat bubbles.

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

Working on hardware: **Web Serial** on Windows desktop and **WebUSB** on
Android, both chatting through a Heltec V3.

Unit-tested (`npm test`, 67 tests): the serial line parser against output
captured from real sessions, position encoding and great-circle maths,
encryption against Node's WebCrypto (round-trip, wrong key, tampering,
truncation, unicode), history capping and corrupt-storage handling, and the
survey statistics (in-flight probes excluded from delivery ratio, duplicate
replies rejected, margin and range factor).

Not covered by tests: the two transports, WebAudio and the DOM, which need a
real browser. The `!PING`/`!PONG`/`!CALL` messages are confirmed to relay
between two boards with RSSI and SNR intact.

If Android ever stops enumerating the board, the CP2102 setup in `transport.js`
(`IFC_ENABLE`, `SET_BAUDRATE`, `SET_LINE_CTL`, `SET_MHS`, per Silicon Labs
AN571) is the place to look - but check the cable first.
