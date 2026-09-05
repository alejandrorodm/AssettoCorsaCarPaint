"""Lectura y escritura de texturas DDS (DXT1/DXT5 con mipmaps) para skins de AC."""
import io
import struct

from PIL import Image

FOURCC_DXT1, FOURCC_DXT5, FOURCC_DX10 = b"DXT1", b"DXT5", b"DX10"


def info(data):
    """(fourcc o 'RGBA'/'BC7', ancho, alto, nº mips) de la cabecera DDS."""
    if data[:4] != b"DDS ":
        raise ValueError("no es DDS")
    h, w, _, _, mips = struct.unpack_from("<IIIII", data, 12)
    flags, fourcc = struct.unpack_from("<I4s", data, 80)
    fmt = fourcc.decode("ascii", "replace") if flags & 0x4 else "RGBA"
    if fourcc == FOURCC_DX10:
        dxgi = struct.unpack_from("<I", data, 128)[0]
        fmt = {71: "DXT1", 77: "DXT5", 98: "BC7", 28: "RGBA", 87: "RGBA"}.get(dxgi, f"DXGI{dxgi}")
    return fmt, w, h, max(1, mips)


def decode(data):
    """DDS -> PIL RGBA (Pillow descodifica DXT1/3/5, BC5/BC7 y sin comprimir)."""
    im = Image.open(io.BytesIO(data)); im.load()
    return im.convert("RGBA")


def _mips(img):
    out = [img]
    while out[-1].width > 4 and out[-1].height > 4:
        p = out[-1]
        out.append(p.resize((max(1, p.width // 2), max(1, p.height // 2)), Image.LANCZOS))
    return out


def _block_bytes(fmt, w, h):
    return max(1, w // 4) * max(1, h // 4) * (8 if fmt == "DXT1" else 16)


def encode(img, fmt="DXT5", mipmaps=True):
    """PIL -> bytes DDS DXT1 o DXT5 (BC1/BC3) con cadena de mips. Los lados deben ser múltiplo de 4
    (las texturas de AC son potencias de 2)."""
    assert fmt in ("DXT1", "DXT5")
    img = img.convert("RGBA")
    if img.width % 4 or img.height % 4:
        img = img.resize(((img.width + 3) // 4 * 4, (img.height + 3) // 4 * 4), Image.LANCZOS)
    levels = _mips(img) if mipmaps else [img]
    body = b""
    for lv in levels:
        b = io.BytesIO(); lv.save(b, "DDS", pixel_format=fmt)
        chunk = b.getvalue()[128:]
        need = _block_bytes(fmt, lv.width, lv.height)
        body += chunk[:need] if len(chunk) >= need else chunk + b"\0" * (need - len(chunk))
    w, h = img.size
    DDSD = 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000 | (0x20000 if len(levels) > 1 else 0)
    hdr = struct.pack("<4sI", b"DDS ", 124)
    hdr += struct.pack("<IIIIII", DDSD, h, w, _block_bytes(fmt, w, h), 0, len(levels)) + b"\0" * 44
    hdr += struct.pack("<II4sIIIII", 32, 0x4, fmt.encode(), 0, 0, 0, 0, 0)
    caps1 = 0x1000 | (0x400000 | 0x8 if len(levels) > 1 else 0)
    hdr += struct.pack("<IIIII", caps1, 0, 0, 0, 0)
    return hdr + body


def to_png(data):
    b = io.BytesIO(); decode(data).save(b, "PNG"); return b.getvalue()
