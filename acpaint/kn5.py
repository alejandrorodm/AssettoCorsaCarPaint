"""Lector del formato KN5 (Assetto Corsa) con jerarquía de nodos y matrices aplicadas.

Devuelve texturas embebidas, materiales (con sus slots de textura) y mallas en coordenadas de
mundo. Sólo lectura: las skins nunca tocan el kn5.
"""
import struct

import numpy as np

VERT_SIZE = 44          # pos3 + normal3 + uv2 + tangent3 (float32)
SKIN_VERT_SIZE = 76     # + 4 pesos + 4 índices de hueso


class Kn5:
    def __init__(self):
        self.version = 0
        self.textures = {}     # nombre -> bytes (normalmente DDS)
        self.materials = []    # [{name, shader, blend, alpha_tested, depth_mode, props, textures}]
        self.meshes = []       # [{name, path, verts (N,11) float32 mundo, idx (M,) uint32, material, active, renderable, transparent, lod_in, lod_out}]


def read(path):
    data = open(path, "rb").read()
    if data[:6] not in (b"sc6969", b"sshhhh"):
        raise ValueError("no es un fichero KN5")
    k = Kn5()
    pos = [6]

    def rd(fmt):
        v = struct.unpack_from("<" + fmt, data, pos[0]); pos[0] += struct.calcsize("<" + fmt)
        return v if len(v) > 1 else v[0]

    def rs():
        n = rd("i"); s = data[pos[0]:pos[0] + n].decode("utf-8", "replace"); pos[0] += n; return s

    k.version = rd("i")
    if k.version > 5:
        rd("i")
    for _ in range(rd("i")):
        rd("i"); name = rs(); size = rd("i")
        k.textures[name] = data[pos[0]:pos[0] + size]; pos[0] += size
    for _ in range(rd("i")):
        m = {"name": rs(), "shader": rs()}
        m["blend"], m["alpha_tested"], m["depth_mode"] = rd("BBi")
        m["props"] = {}
        for _ in range(rd("i")):
            pn = rs(); fv = rd("f"); pos[0] += 8 + 12 + 16
            m["props"][pn] = fv
        m["textures"] = {}
        for _ in range(rd("i")):
            slot = rs(); rd("i"); m["textures"][slot] = rs()
        k.materials.append(m)

    def node(parent_m, path, parent_active):
        t = rd("i"); name = rs(); nch, active = rd("iB")
        active = bool(active) and parent_active
        path = path + [name]
        if t == 1:
            m = np.frombuffer(data[pos[0]:pos[0] + 64], dtype="<f4").reshape(4, 4).astype(np.float64); pos[0] += 64
            world = m @ parent_m                      # convención fila-vector: v' = v·M_local·M_parent
        elif t in (2, 3):
            world = parent_m
            _, visible, transparent = rd("BBB")
            if t == 3:
                for _ in range(rd("i")):
                    rs(); pos[0] += 64
            nv = rd("i"); vs = VERT_SIZE if t == 2 else SKIN_VERT_SIZE
            raw = np.frombuffer(data[pos[0]:pos[0] + nv * vs], dtype="<f4").reshape(nv, vs // 4); pos[0] += nv * vs
            ni = rd("i")
            idx = np.frombuffer(data[pos[0]:pos[0] + ni * 2], dtype="<u2").astype(np.uint32); pos[0] += ni * 2
            mat, layer, lod_in, lod_out = rd("iiff")
            renderable = True
            if t == 2:
                rd("3ff"); renderable = bool(rd("B"))
            v = raw[:, :11].astype(np.float32).copy()
            p = np.c_[v[:, :3], np.ones(nv)] @ world
            v[:, :3] = p[:, :3]
            n = v[:, 3:6] @ world[:3, :3]
            nl = np.linalg.norm(n, axis=1, keepdims=True); n = n / np.maximum(nl, 1e-9)
            v[:, 3:6] = n
            k.meshes.append({"name": name, "path": "/".join(path[1:]), "verts": v, "idx": idx, "material": mat,
                             "active": active, "visible": bool(visible), "transparent": bool(transparent),
                             "renderable": renderable, "lod_in": lod_in, "lod_out": lod_out})
        else:
            raise ValueError(f"tipo de nodo desconocido {t} en {name}")
        for _ in range(nch):
            node(world, path, active)

    node(np.eye(4), [], True)
    return k


def texture_usage(k):
    """{textura: {"materials": [...], "meshes": [...], "vertices": n}} para los slots txDiffuse."""
    use = {}
    for m in k.meshes:
        if m["material"] < 0 or m["material"] >= len(k.materials):
            continue
        mat = k.materials[m["material"]]
        for slot, tex in mat["textures"].items():
            if slot != "txDiffuse":
                continue
            u = use.setdefault(tex, {"materials": set(), "meshes": [], "vertices": 0})
            u["materials"].add(mat["name"]); u["meshes"].append(m["name"]); u["vertices"] += len(m["verts"])
    for u in use.values():
        u["materials"] = sorted(u["materials"])
    return use


def uv_template(k, texture, size=2048, color=(0, 0, 0, 255), bg=(0, 0, 0, 0)):
    """Imagen RGBA con los bordes de los triángulos de todas las mallas que usan `texture` como
    txDiffuse (plantilla de UV para colocar vinilos). v de AC = v de imagen (0 arriba)."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (size, size), bg)
    d = ImageDraw.Draw(img)
    mats = {i for i, m in enumerate(k.materials) if m["textures"].get("txDiffuse") == texture}
    for m in k.meshes:
        if m["material"] not in mats or not m["renderable"]:
            continue
        uv = m["verts"][:, 6:8] * size
        tri = m["idx"].reshape(-1, 3)
        seg = set()
        for a, b, c in tri:
            for p, q in ((a, b), (b, c), (c, a)):
                seg.add((p, q) if p < q else (q, p))
        for p, q in seg:
            d.line([tuple(uv[p]), tuple(uv[q])], fill=color, width=1)
    return img
