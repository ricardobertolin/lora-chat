"""Terminal chat client for one board running lora_chat.

    python chat.py COM4

Type a line and press Enter to send it over LoRa; incoming messages print as
they arrive. Ctrl-C to quit. Run it in two terminals (one per port) to talk to
yourself across both boards.
"""

import sys
import threading
import time

import serial

BAUD = 115200


def reader(ser):
    buf = b""
    while True:
        try:
            buf += ser.read(256)
        except (serial.SerialException, OSError):
            return
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            text = line.decode("utf-8", "replace").rstrip("\r")
            if text:
                print(text, flush=True)


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else "COM4"
    try:
        ser = serial.Serial(port, BAUD, timeout=0.2)
    except serial.SerialException as exc:
        sys.exit(f"cannot open {port}: {exc}\n"
                 "(close the Arduino IDE Serial Monitor if it holds the port)")

    with ser:
        threading.Thread(target=reader, args=(ser,), daemon=True).start()
        # Opening the port toggles DTR/RTS, which resets the board.
        print(f"--- {port} connected, waiting for boot ---", flush=True)
        time.sleep(2.5)
        try:
            for line in sys.stdin:
                ser.write(line.rstrip("\n").encode("utf-8") + b"\n")
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
