"""Generate the PWA icons in the silvercase palette.

    python make_icons.py

Acid-green signal arcs radiating from a square emitter, inside a hard frame -
square corners and no anti-aliasing, matching the app's terminal look.

Writes icon-192.png and icon-512.png. Pure stdlib - no Pillow needed.
"""

import math
import struct
import zlib

BG = (0, 0, 0)
ACID = (216, 255, 47)
INK = (238, 240, 234)


def render(size):
    cx, cy = size / 2, size * 0.62
    half_dot = size * 0.05          # square emitter, not a circle
    rings = [(0.17, 0.034), (0.28, 0.034), (0.39, 0.034)]

    frame_at = size * 0.055         # inset of the border
    frame_w = max(2, round(size * 0.022))

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            colour = BG

            # Hard frame: inside the inset band on any edge.
            edge = min(px, py, size - px, size - py)
            if frame_at <= edge < frame_at + frame_w:
                colour = ACID
            else:
                dx, dy = px - cx, py - cy
                if abs(dx) <= half_dot and abs(dy) <= half_dot:
                    colour = INK
                else:
                    # Upper arcs only, so it reads as a signal radiating from
                    # the emitter rather than a bullseye.
                    angle = math.degrees(math.atan2(-dy, dx))
                    if 32 <= angle <= 148:
                        dist = math.hypot(dx, dy) / size
                        for radius, width in rings:
                            if abs(dist - radius) <= width / 2:
                                colour = ACID
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
