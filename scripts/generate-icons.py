"""
Genera los íconos oficiales Obsidian + Emerald de InsanusChat Workstation para Tauri v2
(32x32.png, 128x128.png, 128x128@2x.png, icon.png e icon.ico) usando solo stdlib Python.
"""
import math
from pathlib import Path
import struct
import zlib

ICONS_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"


def encode_png(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def render_icon(size: int) -> bytes:
    buf = bytearray(size * size * 4)
    r_corner = size * 0.22

    def set_px(x: int, y: int, r: int, g: int, b: int, a: int):
        idx = (y * size + x) * 4
        buf[idx] = r
        buf[idx + 1] = g
        buf[idx + 2] = b
        buf[idx + 3] = a

    def dist_seg(px: float, py: float, x1: float, y1: float, x2: float, y2: float) -> float:
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(px - x1, py - y1)
        t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

    for y in range(size):
        for x in range(size):
            # Rounded square SDF
            cx = max(r_corner, min(size - 1 - r_corner, x + 0.5))
            cy = max(r_corner, min(size - 1 - r_corner, y + 0.5))
            d_box = math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r_corner
            if d_box > 1.0:
                set_px(x, y, 0, 0, 0, 0)
                continue

            alpha = 255 if d_box <= 0 else int(max(0, min(255, (1.0 - d_box) * 255)))
            # Obsidian background (#0e1017) with subtle emerald rim
            if d_box > -max(1.5, size * 0.045):
                r, g, b = 16, 185, 129  # Emerald border
            else:
                r, g, b = 14, 16, 23  # Obsidian surface

            nx, ny = (x + 0.5) / size, (y + 0.5) / size
            # Git-branch / Tree 2D glyph in Emerald (#34d399 / #10b981)
            stroke = 0.055
            d_trunk = dist_seg(nx, ny, 0.34, 0.25, 0.34, 0.75)
            d_branch = dist_seg(nx, ny, 0.34, 0.58, 0.66, 0.34)
            d_n1 = math.hypot(nx - 0.34, ny - 0.25)
            d_n2 = math.hypot(nx - 0.34, ny - 0.75)
            d_n3 = math.hypot(nx - 0.66, ny - 0.34)

            if d_trunk < stroke or d_branch < stroke:
                r, g, b = 16, 185, 129
            if d_n1 < 0.095 or d_n2 < 0.095 or d_n3 < 0.095:
                r, g, b = 52, 211, 153
            if d_n1 < 0.045 or d_n2 < 0.045 or d_n3 < 0.045:
                r, g, b = 9, 9, 11

            set_px(x, y, r, g, b, alpha)

    return encode_png(size, size, bytes(buf))


def build_ico(png_entries: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(png_entries))
    offset = 6 + 16 * len(png_entries)
    dirs = bytearray()
    blobs = bytearray()
    for sz, png_bytes in png_entries:
        w = 0 if sz >= 256 else sz
        h = 0 if sz >= 256 else sz
        dirs.extend(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(png_bytes), offset))
        offset += len(png_bytes)
        blobs.extend(png_bytes)
    return header + bytes(dirs) + bytes(blobs)


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    png32 = render_icon(32)
    png64 = render_icon(64)
    png128 = render_icon(128)
    png256 = render_icon(256)

    (ICONS_DIR / "32x32.png").write_bytes(png32)
    (ICONS_DIR / "128x128.png").write_bytes(png128)
    (ICONS_DIR / "128x128@2x.png").write_bytes(png256)
    (ICONS_DIR / "icon.png").write_bytes(png256)
    (ICONS_DIR / "icon.ico").write_bytes(build_ico([(32, png32), (64, png64), (128, png128), (256, png256)]))
    print(f"[generate-icons] Íconos Obsidian generados en {ICONS_DIR}")


if __name__ == "__main__":
    main()
