"""KN5 -> GLB (sólo geometría + materiales con extras; las texturas las sirve el servidor aparte)."""
import json
import struct

import numpy as np

from . import kn5 as K

HIDDEN_PATTERNS = ("_LR", "COCKPIT_LR", "DAMAGE", "SHADOW", "Shadow", "_SHADOW")


def _hidden(m):
    n = m["name"]
    return (not m["active"]) or (not m["renderable"]) or any(p in n for p in HIDDEN_PATTERNS)


def kn5_to_glb(k: K.Kn5, include_hidden=False):
    bufs, views, accessors, materials, meshes, nodes = [], [], [], [], [], []
    offset = [0]

    def add_view(arr, target):
        b = arr.tobytes(); pad = (-len(b)) % 4
        bufs.append(b + b"\0" * pad)
        views.append({"buffer": 0, "byteOffset": offset[0], "byteLength": len(b), "target": target})
        offset[0] += len(b) + pad
        return len(views) - 1

    def add_acc(arr, ctype, atype, target, minmax=False):
        a = {"bufferView": add_view(arr, target), "componentType": ctype, "count": len(arr), "type": atype}
        if minmax:
            a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        accessors.append(a); return len(accessors) - 1

    for m in k.materials:
        alpha = "BLEND" if m["blend"] else ("MASK" if m["alpha_tested"] else "OPAQUE")
        materials.append({"name": m["name"], "doubleSided": True, "alphaMode": alpha,
                          "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.35, "roughnessFactor": 0.45},
                          "extras": {"shader": m["shader"], "textures": m["textures"],
                                     "props": {p: float(v) for p, v in m["props"].items()}}})
    for m in k.meshes:
        if _hidden(m) and not include_hidden:
            continue
        if m["material"] < 0 or m["material"] >= len(materials) or len(m["idx"]) == 0:
            continue
        v = m["verts"]
        prim = {"attributes": {"POSITION": add_acc(np.ascontiguousarray(v[:, :3]), 5126, "VEC3", 34962, True),
                               "NORMAL": add_acc(np.ascontiguousarray(v[:, 3:6]), 5126, "VEC3", 34962),
                               "TEXCOORD_0": add_acc(np.ascontiguousarray(v[:, 6:8]), 5126, "VEC2", 34962)},
                "indices": add_acc(m["idx"].astype(np.uint32), 5125, "SCALAR", 34963), "material": m["material"]}
        meshes.append({"name": m["name"], "primitives": [prim]})
        nodes.append({"name": m["name"], "mesh": len(meshes) - 1, "extras": {"path": m["path"], "transparent": m["transparent"]}})
    gl = {"asset": {"version": "2.0", "generator": "AssettoCorsaCarPaint"}, "scene": 0,
          "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
          "materials": materials, "accessors": accessors, "bufferViews": views,
          "buffers": [{"byteLength": offset[0]}]}
    js = json.dumps(gl, separators=(",", ":")).encode(); js += b" " * ((-len(js)) % 4)
    bin_ = b"".join(bufs)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    out += struct.pack("<II", len(bin_), 0x004E4942) + bin_
    return out
