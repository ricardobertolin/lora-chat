"""Generate the PWA icons: concentric radio waves on the app's dark background.

    python make_icons.py

Writes icon-192.png and icon-512.png. Pure stdlib - no Pillow needed.
"""

import math
import struct
import zlib

BG = (11, 16, 32)
ACCENT = (76, 141, 255)
DOT = (232, 236, 248)


def render(size):
    cx, cy = size / 2, size * 0.60
    dot_r = size * 0.055
    rings = [(0.16, 0.030), (0.26, 0.030), (0.36, 0.030)]

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            dist = math.hypot(dx, dy) / size
            colour = BG

            if dist <= dot_r / size:
                colour = DOT
            else:
                # Only draw the upper arc of each ring, so it reads as a signal
                # radiating from the dot rather than a bullseye.
                angle = math.degrees(math.atan2(-dy, dx))
                if 30 <= angle <= 150:
                    for radius, width in rings:
                        if abs(dist - radius) <= width / 2:
                            colour = ACCENT
                            break
            row += bytes(colour)
        rows.append(bytes(row))

    raw = b"".join(b"\x00" + r for r in rows)
    return png(size, size, raw)


def png(width, height, raw_rgb):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw_rgb, 9))
        + chunk(b"IEND", b"")
    )


for size in (192, 512):
    name = f"icon-{size}.png"
    with open(name, "wb") as fh:
        fh.write(render(size))
    print(f"wrote {name}")
