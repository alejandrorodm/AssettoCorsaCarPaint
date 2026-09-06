"""Crea un content/cars falso con un coche sintético (kn5 v5) para probar el editor sin AC.
    python tests/make_fake_car.py [dest_root]
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from acpaint import dds as D  # noqa: E402


def _s(t):
    b = t.encode(); return struct.pack("<i", len(b)) + b


def box(size, uv_rect, center=(0, 0, 0)):
    """Caja con normales y UV: cada cara en la región uv_rect (u0,v0,u1,v1)."""
    sx, sy, sz = size; cx, cy, cz = center
    u0, v0, u1, v1 = uv_rect
    faces = [((1, 0, 0), (0, 0, 1), (0, 1, 0)), ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),
             ((0, 1, 0), (1, 0, 0), (0, 0, 1)), ((0, -1, 0), (1, 0, 0), (0, 0, -1)),
             ((0, 0, 1), (-1, 0, 0), (0, 1, 0)), ((0, 0, -1), (1, 0, 0), (0, 1, 0))]
    V, I = [], []
    for fi, (n, a, b) in enumerate(faces):
        n, a, b = np.array(n, float), np.array(a, float), np.array(b, float)
        half = np.array([sx, sy, sz]) / 2
        base = len(V)
        for k, (sa, sb) in enumerate([(-1, -1), (1, -1), (1, 1), (-1, 1)]):
            p = (n + sa * a + sb * b) * half + np.array([cx, cy, cz])
            u = u0 + (sa + 1) / 2 * (u1 - u0); v = v0 + (1 - sb) / 2 * (v1 - v0)
            V.append([*p, *n, u, v, *a])
        I += [base, base + 1, base + 2, base, base + 2, base + 3]
    return np.array(V, np.float32), np.array(I, np.uint16)


def mesh_bytes(name, V, I, mat):
    b = struct.pack("<i", 2) + _s(name) + struct.pack("<iB", 0, 1) + struct.pack("<BBB", 1, 1, 0)
    b += struct.pack("<i", len(V)) + V.astype("<f4").tobytes()
    b += struct.pack("<i", len(I)) + I.astype("<u2").tobytes()
    c = (V[:, :3].min(0) + V[:, :3].max(0)) / 2; r = float(np.linalg.norm(V[:, :3] - c, axis=1).max())
    b += struct.pack("<iiff", mat, 0, 0, 0) + struct.pack("<3ff", *c, r) + struct.pack("<B", 1)
    return b


def dummy_bytes(name, children, pos=(0, 0, 0)):
    m = np.eye(4, dtype="<f4"); m[3, :3] = pos
    b = struct.pack("<i", 1) + _s(name) + struct.pack("<iB", len(children), 1) + m.tobytes()
    return b + b"".join(children)


def material(name, tex, shader="ksPerPixelMultiMap"):
    b = _s(name) + _s(shader) + struct.pack("<BBi", 0, 0, 0)
    props = [("ksAmbient", 0.4), ("ksDiffuse", 0.5), ("ksSpecular", 0.6), ("ksSpecularEXP", 40.0)]
    b += struct.pack("<i", len(props))
    for n, v in props:
        b += _s(n) + struct.pack("<f", v) + b"\0" * 36
    b += struct.pack("<i", 1) + _s("txDiffuse") + struct.pack("<i", 0) + _s(tex)
    return b


def body_texture(size=1024):
    im = Image.new("RGBA", (size, size), (200, 30, 30, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, size, size // 2], fill=(220, 220, 225, 255))          # techo/capó claro
    d.rectangle([size // 2, 0, size, size], fill=(30, 40, 160, 255))         # laterales azules
    for i in range(0, size, 128):
        d.line([(0, i), (size, i)], fill=(0, 0, 0, 255), width=2)
        d.line([(i, 0), (i, size)], fill=(0, 0, 0, 255), width=2)
    d.text((40, size // 2 + 40), "ACPAINT", fill=(255, 255, 255, 255))
    return im


def main(root):
    car = "acpaint_testcar"
    cp = os.path.join(root, "content", "cars", car)
    os.makedirs(os.path.join(cp, "ui"), exist_ok=True)
    os.makedirs(os.path.join(cp, "skins", "default"), exist_ok=True)
    os.makedirs(os.path.join(cp, "skins", "azul"), exist_ok=True)
    json.dump({"name": "ACPaint Test Car", "brand": "ACPaint", "class": "race", "tags": ["test"], "year": 2026},
              open(os.path.join(cp, "ui", "ui_car.json"), "w"))
    Image.new("RGBA", (64, 64), (255, 128, 0, 255)).save(os.path.join(cp, "ui", "badge.png"))
    body = D.encode(body_texture(), "DXT5")
    wheel = D.encode(Image.new("RGBA", (256, 256), (40, 40, 40, 255)), "DXT1")
    glass = D.encode(Image.new("RGBA", (64, 64), (120, 160, 200, 120)), "DXT5")
    # carrocería: capó/techo/laterales en la mitad superior/inferior de la textura
    V1, I1 = box((1.8, 0.6, 4.2), (0, 0, 1, 1), (0, 0.55, 0))
    V2, I2 = box((1.5, 0.5, 2.0), (0, 0, 1, 1), (0, 1.1, -0.3))
    wheels = []
    for i, (x, z) in enumerate([(-0.9, 1.4), (0.9, 1.4), (-0.9, -1.4), (0.9, -1.4)]):
        Vw, Iw = box((0.25, 0.65, 0.65), (0, 0, 1, 1))
        wheels.append(dummy_bytes(f"WHEEL_{'LR'[i % 2]}{'FR'[i // 2]}", [mesh_bytes(f"wheel_{i}", Vw, Iw, 1)], (x, 0.33, z)))
    Vg, Ig = box((1.4, 0.45, 1.8), (0, 0, 1, 1), (0, 1.1, -0.3))
    root_node = dummy_bytes(car, [mesh_bytes("body", V1, I1, 0), mesh_bytes("roof", V2, I2, 0),
                                  mesh_bytes("glass", Vg, Ig, 2)] + wheels)
    with open(os.path.join(cp, car + ".kn5"), "wb") as f:
        f.write(b"sc6969" + struct.pack("<i", 5))
        f.write(struct.pack("<i", 3))
        for n, data in (("Skin_00.dds", body), ("wheel.dds", wheel), ("glass.dds", glass)):
            f.write(struct.pack("<i", 1) + _s(n) + struct.pack("<i", len(data)) + data)
        f.write(struct.pack("<i", 3))
        f.write(material("Body", "Skin_00.dds") + material("Wheel", "wheel.dds", "ksPerPixel") + material("Glass", "glass.dds", "ksPerPixelAlpha"))
        f.write(root_node)
    open(os.path.join(cp, "lods.ini"), "w").write(f"[LOD_0]\nFILE={car}.kn5\nIN=0\nOUT=30\n")
    os.makedirs(os.path.join(cp, "skins", "plano"), exist_ok=True)
    for skin, col in (("default", (200, 30, 30)), ("azul", (30, 40, 160)), ("plano", (240, 200, 40))):
        sp = os.path.join(cp, "skins", skin)
        im = body_texture()
        if skin == "azul":
            im = Image.merge("RGBA", (im.getchannel("B"), im.getchannel("G"), im.getchannel("R"), im.getchannel("A")))
        if skin == "plano":   # coche de un solo color: textura 4x4 (como car_paint.dds de muchos coches)
            im = Image.new("RGBA", (4, 4), col + (255,))
        open(os.path.join(sp, "Skin_00.dds"), "wb").write(D.encode(im, "DXT5"))
        json.dump({"skinname": skin.title(), "drivername": "Piloto", "country": "Spain", "team": "ACPaint", "number": "7", "priority": 1},
                  open(os.path.join(sp, "ui_skin.json"), "w"))
        Image.new("RGB", (1022, 576), col).save(os.path.join(sp, "preview.jpg"))
        Image.new("RGB", (32, 32), col).save(os.path.join(sp, "livery.png"))
    print("coche de prueba en", cp)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "fake_ac"))
