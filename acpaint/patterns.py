"""Texturas procedurales repetibles (fibra de carbono, camuflaje, hexágonos…) para rellenos y capas."""
import io
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PATTERNS = [
    ("carbon", "Fibra de carbono"), ("carbon_big", "Carbono grueso"), ("hex", "Hexágonos"), ("honeycomb", "Panal"),
    ("camo", "Camuflaje"), ("camo_digital", "Camuflaje digital"), ("checker", "Ajedrez"), ("stripes", "Rayas diagonales"),
    ("stripes_h", "Rayas horizontales"), ("brushed", "Metal cepillado"), ("flakes", "Metalizado (flakes)"),
    ("dots", "Puntos (halftone)"), ("noise", "Ruido / desgaste"), ("scratches", "Arañazos"), ("leather", "Cuero"),
    ("grid", "Rejilla"), ("diamond", "Rombos (chapa)"), ("plate", "Chapa diamantada"),
]


def _hex(c, default):
    c = (c or default).lstrip("#")
    if len(c) == 3:
        c = "".join(x * 2 for x in c)
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default if isinstance(default, tuple) else _hex(default, (128, 128, 128))


def _mix(a, b, t):
    """Mezcla dos colores RGB según una máscara t (h, w) en [0, 1] -> array (h, w, 3) uint8."""
    a = np.array(a, np.float32); b = np.array(b, np.float32)
    return (a[None, None] * (1 - t[..., None]) + b[None, None] * t[..., None]).clip(0, 255).astype(np.uint8)


def _tileable_noise(size, scale, seed, octaves=4):
    """Ruido de valor periódico (tileable) en [0, 1]."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        n = max(2, int(scale * 2 ** o))
        g = rng.random((n, n)).astype(np.float32)
        big = np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((size + size // n, size + size // n), Image.BICUBIC), np.float32) / 255
        # recorte periódico: la imagen ampliada de una rejilla de n celdas es periódica en size píxeles
        out += big[:size, :size] * amp; tot += amp; amp *= 0.5
    return out / tot


def make(name, c1="#1a1a1a", c2="#4a4a4a", size=512, seed=1):
    a, b = _hex(c1, (26, 26, 26)), _hex(c2, (74, 74, 74))
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    rng = np.random.default_rng(seed)
    alpha = None
    if name in ("carbon", "carbon_big"):
        cell = 16 if name == "carbon" else 40
        # tejido sarga: bandas alternas de hilos horizontales/verticales con sombreado
        u = (x % cell) / cell; v = (y % cell) / cell
        block = ((x // cell) + (y // cell)) % 2
        thread = np.where(block == 0, np.sin(v * math.pi * 6) * 0.5 + 0.5, np.sin(u * math.pi * 6) * 0.5 + 0.5)
        edge = np.where(block == 0, np.abs(u - 0.5) * 2, np.abs(v - 0.5) * 2) ** 3
        t = (thread * 0.7 + 0.3) * (1 - edge * 0.6) * np.where(block == 0, 1.0, 0.75)
        rgb = _mix(a, b, t)
    elif name in ("hex", "honeycomb"):
        r = size / 8; h = r * math.sqrt(3)
        img = Image.new("RGB", (size, size), a); d = ImageDraw.Draw(img)
        for row in range(-1, int(size / h) + 3):
            for col in range(-1, int(size / (1.5 * r)) + 3):
                cx = col * 1.5 * r; cy = row * h + (h / 2 if col % 2 else 0)
                pts = [(cx + r * 0.92 * math.cos(math.pi / 3 * k), cy + r * 0.92 * math.sin(math.pi / 3 * k)) for k in range(6)]
                d.polygon(pts, fill=b if name == "hex" else a, outline=b if name == "honeycomb" else None, width=max(1, size // 200))
        rgb = np.asarray(img)
    elif name == "camo":
        n = _tileable_noise(size, 3, seed)
        c3 = tuple(int(v * 0.6) for v in b)
        rgb = _mix(a, b, (n > 0.55).astype(np.float32)); rgb = np.where((n < 0.4)[..., None], np.array(c3, np.uint8), rgb)
    elif name == "camo_digital":
        cell = size // 32
        n = _tileable_noise(size, 4, seed)
        n = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((size // cell, size // cell), Image.BOX).resize((size, size), Image.NEAREST), np.float32) / 255
        c3 = tuple(int(v * 0.6) for v in b)
        rgb = _mix(a, b, (n > 0.55).astype(np.float32)); rgb = np.where((n < 0.4)[..., None], np.array(c3, np.uint8), rgb)
    elif name == "checker":
        cell = size // 8; rgb = _mix(a, b, (((x // cell) + (y // cell)) % 2).astype(np.float32))
    elif name == "stripes":
        rgb = _mix(a, b, (((x + y) % (size // 8)) < size // 16).astype(np.float32))
    elif name == "stripes_h":
        rgb = _mix(a, b, ((y % (size // 8)) < size // 16).astype(np.float32))
    elif name == "grid":
        w = max(1, size // 128); rgb = _mix(a, b, ((x % (size // 8) < w) | (y % (size // 8) < w)).astype(np.float32))
    elif name == "brushed":
        lines = rng.random((size, 1)).astype(np.float32) * np.ones((1, size), np.float32)
        lines = np.asarray(Image.fromarray((lines * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)), np.float32) / 255
        fine = rng.random((size, size)).astype(np.float32) * 0.25
        rgb = _mix(a, b, (lines * 0.75 + fine).clip(0, 1))
    elif name == "flakes":
        n = rng.random((size, size)).astype(np.float32)
        t = (n > 0.93).astype(np.float32) * rng.random((size, size)).astype(np.float32)
        rgb = _mix(a, b, t)
    elif name == "dots":
        cell = size // 16; cx = (x % cell) - cell / 2; cy = (y % cell) - cell / 2
        rgb = _mix(a, b, (cx ** 2 + cy ** 2 < (cell * 0.35) ** 2).astype(np.float32))
    elif name == "noise":
        rgb = _mix(a, b, _tileable_noise(size, 6, seed, 5))
    elif name == "scratches":
        img = Image.new("L", (size, size), 0); d = ImageDraw.Draw(img)
        for _ in range(size // 3):
            x0, y0 = rng.random(2) * size; ang = rng.random() * math.pi; ln = rng.random() * size / 3
            d.line([(x0, y0), (x0 + math.cos(ang) * ln, y0 + math.sin(ang) * ln)], fill=int(80 + rng.random() * 175), width=1)
        rgb = _mix(a, b, np.asarray(img, np.float32) / 255)
    elif name == "leather":
        n = _tileable_noise(size, 12, seed, 3)
        cells = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES), np.float32) / 255
        rgb = _mix(a, b, (n * 0.5 + cells * 1.5).clip(0, 1))
    elif name == "diamond":
        cell = size // 8; u = np.abs((x % cell) - cell / 2) / (cell / 2); v = np.abs((y % cell) - cell / 2) / (cell / 2)
        rgb = _mix(a, b, (1 - np.maximum(u, v)).clip(0, 1) ** 0.7)
    elif name == "plate":
        cell = size // 6; u = (x % cell) / cell - 0.5; v = (y % cell) / cell - 0.5
        rot = np.abs(u + v) + np.abs(u - v)
        rgb = _mix(a, b, ((rot < 0.5) * (1 - rot * 2) * 1.5).clip(0, 1))
    else:
        raise KeyError(name)
    img = Image.fromarray(np.ascontiguousarray(rgb), "RGB").convert("RGBA")
    if alpha is not None:
        img.putalpha(Image.fromarray(alpha))
    bio = io.BytesIO(); img.save(bio, "PNG"); return bio.getvalue()
