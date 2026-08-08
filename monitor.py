"""Watch both Heltec boards at once.

    python monitor.py             # follow COM4 + COM6 until Ctrl-C
    python monitor.py 20          # stop after 20 seconds
    python monitor.py 20 COM4 COM7

Opening the port toggles DTR/RTS, so each board resets as the monitor attaches
and you will see its banner again.
"""

import sys
import threading
import time

import serial

BAUD = 115200


def follow(port, stop_at, lock):
    try:
        ser = serial.Serial(port, BAUD, timeout=0.2)
    except serial.SerialException as exc:
        with lock:
            print(f"[{port}] cannot open: {exc}")
        return

    with ser:
        buf = b""
        while stop_at is None or time.monotonic() < stop_at:
            buf += ser.read(256)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode("utf-8", "replace").rstrip("\r")
                if text:
                    with lock:
                        print(f"[{port}] {text}", flush=True)


def main():
    args = sys.argv[1:]
    seconds = None
    if args and args[0].replace(".", "", 1).isdigit():
        seconds = float(args[0])
        args = args[1:]
    ports = args or ["COM4", "COM6"]

    stop_at = None if seconds is None else time.monotonic() + seconds
    lock = threading.Lock()
    threads = [
        threading.Thread(target=follow, args=(p, stop_at, lock), daemon=True)
        for p in ports
    ]
    for t in threads:
        t.start()
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
