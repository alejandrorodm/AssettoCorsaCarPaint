"""Acceso a content/cars de Assetto Corsa: coches, skins, texturas, metadatos y backups."""
import configparser
import io
import json
import os
import re
import shutil
import zipfile

from PIL import Image

from . import dds as D
from . import kn5 as K

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS = os.path.join(ROOT, "settings.json")
CACHE = os.path.join(ROOT, "cache")
WORK_DIR = "acpaint"                       # subcarpeta dentro de la skin: proyecto, calcomanías, originales
SAFE = re.compile(r"^[A-Za-z0-9 _.\-()\[\]!#@&+,'ñÑáéíóúÁÉÍÓÚ]+$")

CANDIDATES = [
    r"C:\Program Files (x86)\Steam\steamapps\common\assettocorsa",
    r"D:\Steam\steamapps\common\assettocorsa", r"D:\SteamLibrary\steamapps\common\assettocorsa",
    r"E:\SteamLibrary\steamapps\common\assettocorsa", r"C:\SteamLibrary\steamapps\common\assettocorsa",
    os.path.expanduser("~/.steam/steam/steamapps/common/assettocorsa"),
    os.path.expanduser("~/.local/share/Steam/steamapps/common/assettocorsa"),
]


def _json(path, default=None):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return default


def settings():
    s = _json(SETTINGS, {}) or {}
    if not s.get("ac_root"):
        env = os.environ.get("AC_ROOT")
        if env:
            s["ac_root"] = env
        else:
            for c in CANDIDATES:
                if os.path.isdir(os.path.join(c, "content", "cars")):
                    s["ac_root"] = c; break
    return s


def save_settings(s):
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)


def cars_dir():
    r = settings().get("ac_root")
    if not r:
        raise FileNotFoundError("No se ha configurado la carpeta de Assetto Corsa (ac_root)")
    d = os.path.join(r, "content", "cars")
    if not os.path.isdir(d):
        raise FileNotFoundError(f"No existe {d}")
    return d


def _check(name):
    if not name or name in (".", "..") or "/" in name or "\\" in name or not SAFE.match(name):
        raise ValueError(f"nombre no válido: {name!r}")
    return name


def car_path(car):
    p = os.path.join(cars_dir(), _check(car))
    if not os.path.isdir(p):
        raise FileNotFoundError(f"coche {car} no encontrado")
    return p


def skin_path(car, skin, must_exist=True):
    p = os.path.join(car_path(car), "skins", _check(skin))
    if must_exist and not os.path.isdir(p):
        raise FileNotFoundError(f"skin {skin} no encontrada")
    return p


# ------------------------------------------------------------------ listados
def list_cars():
    out = []
    for c in sorted(os.listdir(cars_dir()), key=str.lower):
        p = os.path.join(cars_dir(), c)
        if not os.path.isdir(p):
            continue
        ui = _json(os.path.join(p, "ui", "ui_car.json"), {}) or {}
        skins = os.path.join(p, "skins")
        n = len([s for s in os.listdir(skins) if os.path.isdir(os.path.join(skins, s))]) if os.path.isdir(skins) else 0
        out.append({"id": c, "name": ui.get("name") or c, "brand": ui.get("brand") or "", "cls": ui.get("class") or "",
                    "tags": ui.get("tags") or [], "year": ui.get("year"), "skins": n,
                    "badge": os.path.isfile(os.path.join(p, "ui", "badge.png"))})
    return out


def list_skins(car):
    p = os.path.join(car_path(car), "skins")
    out = []
    if not os.path.isdir(p):
        return out
    for s in sorted(os.listdir(p), key=str.lower):
        sp = os.path.join(p, s)
        if not os.path.isdir(sp):
            continue
        meta = _json(os.path.join(sp, "ui_skin.json"), {}) or {}
        dds = sorted(f for f in os.listdir(sp) if f.lower().endswith(".dds"))
        out.append({"id": s, "meta": meta, "textures": dds, "preview": os.path.isfile(os.path.join(sp, "preview.jpg")),
                    "project": os.path.isfile(os.path.join(sp, WORK_DIR, "project.json"))})
    return out


def main_kn5(car):
    p = car_path(car)
    lods = os.path.join(p, "lods.ini")
    if os.path.isfile(lods):
        cp = configparser.ConfigParser(strict=False, interpolation=None)
        try:
            cp.read(lods, encoding="utf-8-sig")
            f = cp.get("LOD_0", "FILE", fallback=None)
            if f and os.path.isfile(os.path.join(p, f)):
                return os.path.join(p, f)
        except Exception:
            pass
    for cand in (car + ".kn5",):
        if os.path.isfile(os.path.join(p, cand)):
            return os.path.join(p, cand)
    ks = sorted((os.path.getsize(os.path.join(p, f)), f) for f in os.listdir(p) if f.lower().endswith(".kn5"))
    if not ks:
        raise FileNotFoundError("el coche no tiene kn5")
    return os.path.join(p, ks[-1][1])


_KN5 = {}


def load_kn5(car):
    path = main_kn5(car)
    key = (path, os.path.getmtime(path))
    if key not in _KN5:
        _KN5.clear()
        _KN5[key] = K.read(path)
    return _KN5[key]


def car_textures(car):
    """Texturas txDiffuse del kn5 con uso (mallas, vértices) y tamaño; ordenadas por relevancia."""
    k = load_kn5(car)
    use = K.texture_usage(k)
    out = []
    for name, u in use.items():
        raw = k.textures.get(name)
        fmt = w = h = None
        if raw:
            try:
                fmt, w, h, _ = D.info(raw)
            except Exception:
                try:
                    im = Image.open(io.BytesIO(raw)); w, h = im.size; fmt = im.format
                except Exception:
                    pass
        out.append({"name": name, "materials": u["materials"], "meshes": u["meshes"][:40], "vertices": u["vertices"],
                    "format": fmt, "width": w, "height": h, "embedded": raw is not None})
    out.sort(key=lambda t: -t["vertices"])
    return out


def texture_bytes(car, skin, name, src="skin"):
    """DDS (o PNG) de la textura. src: "skin" = la de la skin (o kn5 si no existe), "orig" = la copia
    original guardada antes de pintar (si la hay; si no, la de la skin), "kn5" = la embebida en el kn5."""
    _check(name)
    if skin and src == "orig":
        o = os.path.join(skin_path(car, skin), WORK_DIR, "original", name)
        if os.path.isfile(o):
            return open(o, "rb").read(), "orig"
    if skin and src in ("skin", "orig"):
        sp = skin_path(car, skin)
        for f in os.listdir(sp):
            if f.lower() == name.lower():
                return open(os.path.join(sp, f), "rb").read(), "skin"
    k = load_kn5(car)
    for n, raw in k.textures.items():
        if n.lower() == name.lower():
            return raw, "kn5"
    raise FileNotFoundError(name)


def texture_png(car, skin, name, src="skin"):
    raw, src = texture_bytes(car, skin, name, src)
    if raw[:4] == b"DDS ":
        return D.to_png(raw), src
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue(), src


def texture_uv_info(car, name):
    k = load_kn5(car)
    return K.uv_info(k, name)


def texture_info(car, skin, name):
    raw, src = texture_bytes(car, skin, name)
    if raw[:4] == b"DDS ":
        fmt, w, h, mips = D.info(raw)
    else:
        im = Image.open(io.BytesIO(raw)); w, h = im.size; fmt = im.format; mips = 1
    return {"name": name, "source": src, "format": fmt, "width": w, "height": h, "mips": mips, "bytes": len(raw)}


# ------------------------------------------------------------------ skins
DEFAULT_META = {"skinname": "", "drivername": "", "country": "", "team": "", "number": "", "priority": 1}


def create_skin(car, skin, clone_from=None, meta=None):
    dst = skin_path(car, _check(skin), must_exist=False)
    if os.path.exists(dst):
        raise FileExistsError(f"la skin {skin} ya existe")
    if clone_from:
        src = skin_path(car, clone_from)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(WORK_DIR))
    else:
        os.makedirs(dst)
    m = dict(DEFAULT_META)
    if clone_from:
        m.update(_json(os.path.join(dst, "ui_skin.json"), {}) or {})
    m.update(meta or {})
    if not m.get("skinname"):
        m["skinname"] = skin
    save_meta(car, skin, m)
    return dst


def save_meta(car, skin, meta):
    sp = skin_path(car, skin)
    m = dict(DEFAULT_META); m.update(_json(os.path.join(sp, "ui_skin.json"), {}) or {}); m.update(meta)
    m["priority"] = int(m.get("priority") or 1)
    with open(os.path.join(sp, "ui_skin.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
    return m


def delete_skin(car, skin):
    shutil.rmtree(skin_path(car, skin))


def rename_skin(car, skin, new):
    dst = skin_path(car, _check(new), must_exist=False)
    if os.path.exists(dst):
        raise FileExistsError(new)
    os.rename(skin_path(car, skin), dst)


def work_dir(car, skin):
    d = os.path.join(skin_path(car, skin), WORK_DIR)
    os.makedirs(d, exist_ok=True)
    return d


def project_load(car, skin):
    return _json(os.path.join(skin_path(car, skin), WORK_DIR, "project.json"), None)


def project_save(car, skin, proj):
    with open(os.path.join(work_dir(car, skin), "project.json"), "w", encoding="utf-8") as f:
        json.dump(proj, f, ensure_ascii=False)


def backup_original(car, skin, name):
    """Guarda una copia del DDS original de la skin (sólo la primera vez) antes de sobrescribirlo."""
    sp = skin_path(car, skin)
    src = os.path.join(sp, name)
    if not os.path.isfile(src):
        return None
    d = os.path.join(work_dir(car, skin), "original"); os.makedirs(d, exist_ok=True)
    dst = os.path.join(d, name)
    if not os.path.isfile(dst):
        shutil.copy2(src, dst)
    return dst


def write_texture(car, skin, name, png_bytes, fmt=None, keep_alpha=True):
    """Escribe <skin>/<name> como DDS con mips a partir del PNG del lienzo.
    fmt: DXT1/DXT5 (por defecto el del original; DXT5 si no había). keep_alpha: conserva el canal
    alpha del original (en ksPerPixelMultiMap suele controlar el brillo) en vez del del lienzo."""
    _check(name)
    if not name.lower().endswith(".dds"):
        raise ValueError("sólo se escriben texturas .dds")
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    # el DDS se escribe al tamaño del lienzo: así una textura de color plano (1×1/4×4) puede ampliarse a
    # 2048/4096 para pintar vinilos; AC acepta cualquier tamaño potencia de 2
    if img.width & (img.width - 1) or img.height & (img.height - 1):
        w = 1 << max(2, (img.width - 1).bit_length()); h = 1 << max(2, (img.height - 1).bit_length())
        img = img.resize((w, h), Image.LANCZOS)
    orig = None
    try:
        raw, _ = texture_bytes(car, skin, name)
        if raw[:4] == b"DDS ":
            ofmt, w, h, _ = D.info(raw)
            orig = D.decode(raw)
            if fmt is None:
                fmt = "DXT1" if ofmt == "DXT1" else "DXT5"
    except FileNotFoundError:
        pass
    fmt = fmt or "DXT5"
    if keep_alpha and orig is not None:
        alpha = orig.getchannel("A")
        if alpha.size != img.size:
            alpha = alpha.resize(img.size, Image.LANCZOS)
        img.putalpha(alpha)
    backup_original(car, skin, name)
    data = D.encode(img, fmt)
    with open(os.path.join(skin_path(car, skin), name), "wb") as f:
        f.write(data)
    return {"name": name, "format": fmt, "width": img.width, "height": img.height, "bytes": len(data)}


def restore_original(car, skin, name):
    src = os.path.join(skin_path(car, skin), WORK_DIR, "original", _check(name))
    if not os.path.isfile(src):
        raise FileNotFoundError("no hay original guardado")
    shutil.copy2(src, os.path.join(skin_path(car, skin), name))


def write_preview(car, skin, png_bytes):
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    im.save(os.path.join(skin_path(car, skin), "preview.jpg"), "JPEG", quality=92)


def write_livery(car, skin, png_bytes):
    im = Image.open(io.BytesIO(png_bytes)).convert("RGBA").resize((32, 32), Image.LANCZOS)
    im.save(os.path.join(skin_path(car, skin), "livery.png"), "PNG")


def decals_dir(car, skin):
    d = os.path.join(work_dir(car, skin), "decals"); os.makedirs(d, exist_ok=True); return d


def save_decal(car, skin, filename, data):
    base = _check(os.path.basename(filename))
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    if im.width > 2048 or im.height > 2048:
        im.thumbnail((2048, 2048), Image.LANCZOS)
    name = os.path.splitext(base)[0] + ".png"
    b = io.BytesIO(); im.save(b, "PNG")
    with open(os.path.join(decals_dir(car, skin), name), "wb") as f:
        f.write(b.getvalue())
    return name


def export_zip(car, skin):
    """Zip con la estructura content/cars/<car>/skins/<skin>/… (sin la carpeta de trabajo)."""
    sp = skin_path(car, skin)
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(sp):
            dirs[:] = [d for d in dirs if d != WORK_DIR]
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, sp).replace(os.sep, "/")
                z.write(full, f"content/cars/{car}/skins/{skin}/{rel}")
    return b.getvalue()


def import_zip(car, data, name=None):
    """Importa un zip de skin (con o sin la ruta content/cars/…). Devuelve los nombres creados."""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = [n for n in z.namelist() if not n.endswith("/")]
    created = []
    # localizar carpetas que contengan ui_skin.json o algún .dds
    roots = set()
    for n in names:
        low = n.lower()
        if low.endswith("ui_skin.json") or low.endswith(".dds"):
            roots.add(os.path.dirname(n))
    if not roots:
        raise ValueError("el zip no contiene ninguna skin (ui_skin.json o .dds)")
    for r in sorted(roots):
        sname = name if (name and len(roots) == 1) else (os.path.basename(r) or "importada")
        dst = skin_path(car, _check(sname), must_exist=False)
        os.makedirs(dst, exist_ok=True)
        for n in names:
            if os.path.dirname(n) == r:
                with open(os.path.join(dst, os.path.basename(n)), "wb") as f:
                    f.write(z.read(n))
        if not os.path.isfile(os.path.join(dst, "ui_skin.json")):
            save_meta(car, sname, {"skinname": sname})
        created.append(sname)
    return created
