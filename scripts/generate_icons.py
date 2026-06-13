"""
generate_icons.py — Creates PWA icon PNGs using only Python stdlib.

Produces:
  frontend/public/icon-192.png   (required by Android PWA install)
  frontend/public/icon-512.png   (required by Google Lighthouse PWA audit)
  frontend/public/apple-touch-icon.png  (180×180, required by iOS Safari PWA)

The icons are a solid-color square in Tallymancer's brand purple (#1c1c2e),
matching the SVG icon's background.  No external dependencies required.

Run from the project root:
  python scripts/generate_icons.py
"""

import struct
import zlib
import os

# Brand color: --surface #1c1c2e  (28, 28, 46)
BG_R, BG_G, BG_B = 28, 28, 46
# Accent color: --accent #818cf8  (129, 140, 248)
AC_R, AC_G, AC_B = 129, 140, 248


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Pack a PNG chunk: length + type + data + CRC."""
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", crc32(chunk_type + data))
    return length + chunk_type + data + crc


def write_png(path: str, size: int, r: int, g: int, b: int,
              stripe_r: int = None, stripe_g: int = None, stripe_b: int = None):
    """
    Write a square PNG of `size`x`size` pixels.
    Filled with (r,g,b).  Optional decorative stripe drawn near top and bottom.
    """
    # IHDR: width, height, bit_depth=8, color_type=2 (RGB)
    ihdr_data = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)

    # Build pixel rows.  PNG filter byte 0 (None) precedes each row.
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # filter byte: None

        # Stripe geometry: ~1.5% of height, at 11.7% and 86.9% from top
        stripe_h = max(1, size // 64)
        stripe_top    = size // 8 - stripe_h // 2
        stripe_bottom = size - size // 8 - stripe_h // 2

        in_stripe = (
            stripe_r is not None
            and (stripe_top <= y < stripe_top + stripe_h
                 or stripe_bottom <= y < stripe_bottom + stripe_h)
        )

        for x in range(size):
            if in_stripe:
                # Narrow accent stripe visible on all sizes
                row += bytes([stripe_r, stripe_g, stripe_b])
            else:
                row += bytes([r, g, b])

        rows.append(bytes(row))

    raw = b"".join(rows)
    idat_data = zlib.compress(raw, level=9)

    png = (
        b"\x89PNG\r\n\x1a\n"               # PNG signature
        + png_chunk(b"IHDR", ihdr_data)
        + png_chunk(b"IDAT", idat_data)
        + png_chunk(b"IEND", b"")
    )

    with open(path, "wb") as f:
        f.write(png)

    print(f"  Wrote {path}  ({size}x{size}, {len(png)} bytes)")


def main():
    # Resolve paths relative to this script's project root
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(root, "frontend", "public")
    os.makedirs(out_dir, exist_ok=True)

    sizes = [
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ]

    print("Generating PWA icons...")
    for filename, size in sizes:
        path = os.path.join(out_dir, filename)
        write_png(
            path, size,
            BG_R, BG_G, BG_B,
            stripe_r=AC_R, stripe_g=AC_G, stripe_b=AC_B,
        )

    print("Done.")


if __name__ == "__main__":
    main()
