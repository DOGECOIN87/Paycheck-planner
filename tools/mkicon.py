#!/usr/bin/env python3
"""Generate the launcher icons with no third-party dependencies.

The mark is a budget wheel: a ring cut into the four buckets the app splits
every paycheck into, sized to their real proportions.

    Bills 32%   zaffre       Savings 22%  fluorescent cyan
    Buffer 6%   dark violet  Spend 40%    hollywood cerise

Four layers come out of this, per density:

  ic_launcher.png              legacy square icon, pre-API 26
  ic_launcher_background.png   adaptive background layer
  ic_launcher_foreground.png   adaptive foreground layer
  ic_launcher_monochrome.png   themed-icon silhouette, API 33+

Edges are analytically anti-aliased off the signed distance to each shape,
which stays fast at 432px where supersampling would crawl.
"""
import math
import os
import struct
import zlib

# ── palette ──────────────────────────────────────────────────────────

OXFORD = (0x07, 0x0F, 0x34)
LIFT   = (0x10, 0x1E, 0x66)   # top-left of the background gradient

# (share of a paycheck, colour) clockwise from twelve o'clock
SEGMENTS = [
    (32.0, (0x42, 0x58, 0xF5)),   # bills    — zaffre, lifted for contrast
    (22.0, (0x34, 0xED, 0xF3)),   # savings  — fluorescent cyan
    ( 6.0, (0xB2, 0x3D, 0xEF)),   # buffer   — dark violet, lifted
    (40.0, (0xF7, 0x15, 0xAB)),   # spend    — hollywood cerise
]

GAP_DEG = 5.0    # wedge separation, so the ring reads as four parts


# ── helpers ──────────────────────────────────────────────────────────

def cov(signed_distance):
    """Coverage from a signed distance in pixels (>0 inside), 1px feather."""
    v = signed_distance + 0.5
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def rounded_rect_sd(px, py, x, y, w, h, r):
    """Signed distance to a rounded rect, positive inside."""
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    dx, dy = px - cx, py - cy
    d = math.hypot(dx, dy)
    if d > 0:
        return r - d
    return min(px - x, x + w - px, py - y, y + h - py)


def ring_pixel(px, py, cx, cy, r_in, r_out):
    """(colour, alpha) for the wheel at this pixel, or None."""
    dx, dy = px - cx, py - cy
    r = math.hypot(dx, dy)
    if r > r_out + 1.5 or r < r_in - 1.5:
        return None

    a_radial = min(cov(r_out - r), cov(r - r_in))
    if a_radial <= 0.0:
        return None

    # 0 deg at twelve o'clock, increasing clockwise
    ang = (math.degrees(math.atan2(dy, dx)) + 90.0) % 360.0

    total = sum(s for s, _ in SEGMENTS)
    best = None
    start = 0.0
    for share, colour in SEGMENTS:
        sweep = share / total * 360.0
        a0 = start + GAP_DEG / 2.0
        a1 = start + sweep - GAP_DEG / 2.0
        start += sweep

        # angular distance inside the wedge, as pixels along the arc
        d0 = ((ang - a0 + 180.0) % 360.0 - 180.0) * math.pi / 180.0 * r
        d1 = ((a1 - ang + 180.0) % 360.0 - 180.0) * math.pi / 180.0 * r
        a_ang = min(cov(d0), cov(d1))
        if a_ang > 0.0 and (best is None or a_ang > best[1]):
            best = (colour, a_ang)

    if best is None:
        return None
    return best[0], a_radial * best[1]


# ── layers ───────────────────────────────────────────────────────────

def render(size, kind):
    """kind: 'legacy' | 'bg' | 'fg' | 'mono'  ->  raw RGBA scanlines."""
    n = float(size)
    cx = cy = n / 2.0

    if kind == 'legacy':
        # Full-bleed rounded square. The wheel runs larger than the adaptive
        # layers because there is no 108->72dp crop here to magnify it.
        r_out, r_in, radius = n * 0.385, n * 0.240, n * 0.235
    else:
        # adaptive layers are 108dp; keep art inside the 72dp safe zone
        r_out, r_in, radius = n * 0.300, n * 0.184, None

    rows = bytearray()
    for py in range(size):
        rows.append(0)  # PNG filter: none
        fy = py + 0.5
        for px in range(size):
            fx = px + 0.5

            if kind == 'bg':
                c = mix(LIFT, OXFORD, fx / n * 0.6 + fy / n * 0.4)
                rows.extend((int(c[0]), int(c[1]), int(c[2]), 255))
                continue

            hit = ring_pixel(fx, fy, cx, cy, r_in, r_out)

            if kind == 'mono':
                a = hit[1] if hit else 0.0
                rows.extend((255, 255, 255, int(round(a * 255))))
                continue

            if kind == 'fg':
                if hit:
                    c, a = hit
                    rows.extend((c[0], c[1], c[2], int(round(a * 255))))
                else:
                    rows.extend((0, 0, 0, 0))
                continue

            # legacy: composite the wheel over the rounded tile
            tile = cov(rounded_rect_sd(fx, fy, 0, 0, n, n, radius))
            base = mix(LIFT, OXFORD, fx / n * 0.6 + fy / n * 0.4)
            if hit:
                c, a = hit
                base = mix(base, c, a)
            rows.extend((int(base[0]), int(base[1]), int(base[2]),
                         int(round(tile * 255))))

    return bytes(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        body = tag + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(raw, 9))
                + chunk(b"IEND", b""))


# ── driver ───────────────────────────────────────────────────────────

# bucket -> (legacy 48dp px, adaptive 108dp px)
DENSITIES = [
    ("mdpi",     48, 108),
    ("hdpi",     72, 162),
    ("xhdpi",    96, 216),
    ("xxhdpi",  144, 324),
    ("xxxhdpi", 192, 432),
]


def main():
    res = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "res")
    for bucket, legacy_px, adaptive_px in DENSITIES:
        d = os.path.join(res, "mipmap-" + bucket)
        os.makedirs(d, exist_ok=True)
        jobs = [
            ("ic_launcher.png",            legacy_px,   'legacy'),
            ("ic_launcher_background.png", adaptive_px, 'bg'),
            ("ic_launcher_foreground.png", adaptive_px, 'fg'),
            ("ic_launcher_monochrome.png", adaptive_px, 'mono'),
        ]
        sizes = []
        for name, size, kind in jobs:
            p = os.path.join(d, name)
            write_png(p, size, render(size, kind))
            sizes.append("%s %dpx %.1fkB" % (kind, size, os.path.getsize(p) / 1024.0))
        print("%-8s  %s" % (bucket, "  ".join(sizes)))


if __name__ == "__main__":
    main()
