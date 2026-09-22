#!/usr/bin/env python3
"""Generate the launcher icon PNGs with no third-party deps.

Draws at 4x and box-downsamples, which gives clean edges on the rounded
corners and the bars without pulling in an imaging library.
"""
import os
import struct
import zlib

SS = 4  # supersample factor


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_rect(x, y, w, h, r, px, py):
    """True if (px,py) is inside the rounded rect."""
    if px < x or py < y or px >= x + w or py >= y + h:
        return False
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= r * r


def render(size):
    n = size * SS
    top = (0x34, 0xD3, 0x99)     # emerald
    bot = (0x0D, 0x94, 0x88)     # teal
    fg = (0xFF, 0xFF, 0xFF)

    radius = n * 0.235
    # three ascending bars
    bar_w = n * 0.132
    gap = n * 0.076
    total = bar_w * 3 + gap * 2
    bx0 = (n - total) / 2
    base = n * 0.745
    heights = [n * 0.20, n * 0.315, n * 0.43]
    bar_r = bar_w * 0.36

    buf = bytearray()
    for py in range(size):
        buf.append(0)  # PNG filter: none
        for px in range(size):
            ar = ag = ab = aa = 0
            for sy in range(SS):
                fy = py * SS + sy + 0.5
                for sx in range(SS):
                    fx = px * SS + sx + 0.5
                    if not rounded_rect(0, 0, n, n, radius, fx, fy):
                        continue
                    col = lerp(top, bot, fy / n)
                    for i in range(3):
                        bx = bx0 + i * (bar_w + gap)
                        bh = heights[i]
                        if rounded_rect(bx, base - bh, bar_w, bh, bar_r, fx, fy):
                            col = fg
                            break
                    ar += col[0]; ag += col[1]; ab += col[2]; aa += 255
            k = SS * SS
            # composite the coverage-weighted colour over transparency
            if aa == 0:
                buf.extend((0, 0, 0, 0))
            else:
                cov = aa // k
                buf.extend((ar * k // aa, ag * k // aa, ab * k // aa, cov))
    return bytes(buf)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "res")
    for bucket, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                         ("xxhdpi", 144), ("xxxhdpi", 192)):
        d = os.path.join(root, "mipmap-" + bucket)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "ic_launcher.png")
        write_png(p, size, render(size))
        print("%-8s %3dpx  %6d bytes" % (bucket, size, os.path.getsize(p)))


if __name__ == "__main__":
    main()
