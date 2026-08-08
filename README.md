# Heltec WiFi LoRa 32 (V3) point-to-point link

Two Heltec V3 boards (ESP32-S3 + SX1262) talking to each other over raw LoRa.
There are two sketches:

- **`lora_chat`** - you type, the other board prints it. Same firmware on both.
- **`lora_pingpong`** - automatic link test, `COM4` pings every 3 s and `COM6`
  answers. Good for checking the radio without touching a keyboard.

`lora_chat` is what is currently flashed to both boards.

## Layout

| Path | What it is |
| --- | --- |
| `lora_chat/lora_chat.ino` | Manual chat firmware. Identical on both boards; each names itself from its MAC. |
| `lora_pingpong/lora_pingpong.ino` | Automatic ping/pong. Role picked at build time by `-DROLE_PING`. |
| `flash.ps1` | Compile + upload a role (`chat`, `ping`, `pong`) to one or more ports. |
| `chat.py` | Terminal chat client for one port. |
| `docs/` | Browser chat client for desktop + Android, published by GitHub Pages. See its own README. |
| `monitor.py` | Print both serial ports side by side, read-only. |
| `arduino/libraries/` | RadioLib + Adafruit SSD1306/GFX/BusIO. Not tracked - see Toolchain. |
| `build/` | Build output, safe to delete. Not tracked. |

The web app is live at
<https://ricardobertolin.github.io/lora_chat_app/> - GitHub Pages serves the `docs/`
folder, which is why it is named that and not `webapp/`.

## First time on a new machine

The libraries are not in the repo. Install them once:

```powershell
$cli = "C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
& $cli lib install RadioLib "Adafruit SSD1306" --install-dir .\arduino
```

You also need the **esp32 core 3.3.8+** (Arduino IDE: Boards Manager -> esp32).

## Chatting

### From the Arduino IDE

1. **File > Open** -> `lora_chat/lora_chat.ino`.
2. **Tools > Board > esp32 > Heltec WiFi LoRa 32(V3)**.
3. **Tools > Port > COM4**, then Upload.
4. Open the Serial Monitor (magnifier icon), set **115200 baud** and line ending
   **Newline**.
5. To watch both boards at once you need two monitors, and the IDE only gives
   one per window: **File > New Window**, open the same sketch, select **COM6**,
   and open its Serial Monitor there.

Type in the monitor's input box, press Enter, and the line appears on the other
board.

### From a terminal

```powershell
.\flash.ps1 -Role chat -Port COM4,COM6   # identical firmware on both boards
python chat.py COM4                      # then, in one terminal
python chat.py COM6                      # and another
```

Only one program can hold a port, so close the IDE's Serial Monitor first.

### From a phone or a browser

Open <https://ricardobertolin.github.io/lora_chat_app/> in Chrome or Edge, or run it
locally:

```powershell
cd docs
python serve.py
```

A page that talks to the board over USB - Web Serial on desktop, WebUSB on
Android. Same code both places, installable as a PWA, works offline. See
[`docs/README.md`](docs/README.md); Android additionally needs a USB-C OTG cable.

Either way it looks like this:

```
=== LoRa chat - this board is "8424" ===
on 915.0 MHz, SF9. Type a message and press Enter.
>> hello from the COM4 board
<< 3D2C: and this is COM6 answering  (RSSI -20.0 dBm, SNR 11.2 dB)
```

`>>` is what this board sent, `<<` what it heard. Board names are the last two
bytes of the MAC (`8424` on COM4, `3D2C` on COM6); set `NODE_NAME` in the sketch
to override.

### On the OLED

`lora_chat` mirrors everything to the onboard 128x64 screen, so you can unplug a
board, walk off with it on USB power and still see the link:

```
8424            915.0
---------------------
< 3D2C: hi back

RSSI -20  SNR 11.2
TX 3   RX 5
```

`<` marks a received message and `>` one you sent; RSSI/SNR are shown only for
received packets, since they describe the incoming signal. Long messages are
truncated with `~` at three lines so the counters can never be pushed off the
bottom. If `radio.begin()` ever fails the screen shows `HALTED` and the error
code instead of the board just going quiet.

A missing screen is not fatal - the sketch logs `OLED not found at 0x3C` and
carries on as a serial-only chat.

## Ping/pong link test

```powershell
.\flash.ps1 -Role ping -Port COM4
.\flash.ps1 -Role pong -Port COM6
python monitor.py            # Ctrl-C to stop, or: python monitor.py 20
```

Expected output:

```
[COM4] [TX] "PING #1" ... ok
[COM6] [RX] "PING #1"  RSSI -25.0 dBm  SNR 10.2 dB
[COM6] [TX] "PONG #1 re: PING #1" ... ok
[COM4] [RX] "PONG #1 re: PING #1"  RSSI -24.0 dBm  SNR 10.8 dB
```

## Radio settings

915 MHz, SF9, BW 125 kHz, CR 4/7, sync word `0x12`, 14 dBm, preamble 8. They
live at the top of the `.ino`; **both boards must agree on all of them**, so
change a value and reflash both. 915 MHz suits Brazil/AU915; use 868.0 if you
are on an EU868 plan. The SX1262 on this board will do up to 22 dBm.

Range vs. speed: raise `LORA_SF` (up to 12) for more range and slower packets,
lower it (down to 7) for the opposite.

## Board notes

Details that trip people up on the V3 specifically, all handled in the sketch:

- The variant header names the SX1262's **DIO1** pin `DIO0` (GPIO14) - a
  carry-over from the SX127x-based V2. NSS=8, RST=12, BUSY=13, SCK=9, MISO=11,
  MOSI=10.
- The SX1262 runs off a **1.8 V TCXO**, so `radio.begin()` gets `1.8`. Passing
  the RadioLib default of 1.6 makes `begin()` fail with a timeout.
- The RF frontend switch is driven from **DIO2**, hence `setDio2AsRfSwitch(true)`.
  Without it packets transmit "successfully" but almost nothing radiates.
- `transmit()` raises DIO1 on TxDone, which sets the same flag the RX interrupt
  uses. The sketch clears it after every send to avoid a phantom receive.

- The Serial Monitor's line-ending dropdown decides whether a newline is ever
  sent. `lora_chat` also flushes after 80 ms of input silence, so it works even
  on "No Line Ending" - at the cost of splitting a character-at-a-time paste
  into several packets.
- The OLED is powered through the **Vext** switch (GPIO36, **active LOW**) and
  needs a reset pulse on GPIO21 before `Wire.begin(17, 18)`. Skipping the Vext
  step is the usual cause of a V3 screen that stays black while I2C scans find
  nothing at 0x3C.

## Toolchain

`flash.ps1` uses the `arduino-cli` bundled inside the Arduino IDE install rather
than a separate one:

```
C:\Program Files\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe
```

There is no arduino-cli config file. The default data directory already holds
the installed esp32 core, and `--libraries .\arduino\libraries` points the
compile at this project's copies - which keeps machine-specific absolute paths
out of the repo.

Libraries live in **two places on purpose**: under `arduino/libraries/` for
`flash.ps1`, and in the Arduino IDE's sketchbook
(`%USERPROFILE%\...\Arduino\libraries\`) so the IDE can find them when you open
a sketch there. If you update one, update the other.

## Ideas from here

- Measure real range by walking one board around while the other pings, reading
  RSSI off the OLED as you go.
- Mirror the OLED code into `lora_pingpong` for a hands-free range test.
- Swap the string payload for a packed struct of sensor readings.
