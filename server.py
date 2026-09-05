#!/usr/bin/env python3
"""Editor web local de skins (liveries) de Assetto Corsa, estilo Forza Horizon.

    python server.py [puerto]     -> http://localhost:8766
    AC_ROOT=... o settings.json   -> carpeta de Assetto Corsa (o configúrala desde la web)
"""
import hashlib
import io
import os
import subprocess
import sys

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from acpaint import __version__, cars, dds, gltf, kn5

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "cache")
os.makedirs(CACHE, exist_ok=True)
app = FastAPI(title="AssettoCorsaCarPaint", version=__version__)
app.mount("/web", StaticFiles(directory=os.path.join(ROOT, "web")), name="web")


@app.middleware("http")
async def no_cache(request, call_next):
    resp = await call_next(request)
    if request.url.path.startswith("/api/") or request.url.path == "/":
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


def err(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except FileExistsError as e:
        raise HTTPException(409, f"ya existe: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/", response_class=HTMLResponse)
def index():
    return HTMLResponse(open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read())


# ------------------------------------------------------------------ ajustes
class SettingsReq(BaseModel):
    ac_root: str


@app.get("/api/settings")
def api_settings():
    s = cars.settings()
    ok = bool(s.get("ac_root")) and os.path.isdir(os.path.join(s.get("ac_root", ""), "content", "cars"))
    return {"ac_root": s.get("ac_root", ""), "ok": ok, "version": __version__, "platform": sys.platform}


@app.post("/api/settings")
def api_settings_set(r: SettingsReq):
    root = r.ac_root.strip().strip('"')
    if not os.path.isdir(os.path.join(root, "content", "cars")):
        raise HTTPException(400, f"No encuentro content/cars dentro de {root}")
    s = cars.settings(); s["ac_root"] = root; cars.save_settings(s)
    return api_settings()


# ------------------------------------------------------------------ coches
@app.get("/api/cars")
def api_cars():
    return err(cars.list_cars)


@app.get("/api/cars/{car}/badge")
def api_badge(car: str):
    p = os.path.join(err(cars.car_path, car), "ui", "badge.png")
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "max-age=3600"})


@app.get("/api/cars/{car}/textures")
def api_car_textures(car: str, skin: str = ""):
    tex = err(cars.car_textures, car)
    present = {f.lower() for f in os.listdir(err(cars.skin_path, car, skin))} if skin else set()
    for t in tex:
        t["in_skin"] = t["name"].lower() in present
    # las texturas que ya están en la skin son las "pintables": primero
    tex.sort(key=lambda t: (not t["in_skin"], -t["vertices"]))
    return tex


def _cached_file(key, ext, build):
    path = os.path.join(CACHE, key + ext)
    if not os.path.isfile(path):
        data = build()
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
    return path


@app.get("/api/cars/{car}/model.glb")
def api_model(car: str):
    p = err(cars.main_kn5, car)
    sig = f"{os.path.getsize(p)}_{int(os.path.getmtime(p))}"
    path = _cached_file(f"model_{car}_{sig}", ".glb", lambda: gltf.kn5_to_glb(cars.load_kn5(car)))
    return FileResponse(path, media_type="model/gltf-binary", headers={"Cache-Control": "max-age=3600"})


@app.get("/api/cars/{car}/uv/{name}")
def api_uv(car: str, name: str, size: int = 2048):
    size = max(256, min(size, 4096))
    p = err(cars.main_kn5, car)
    sig = f"{os.path.getsize(p)}_{int(os.path.getmtime(p))}"
    key = "uv_" + hashlib.md5(f"{car}|{name}|{size}|{sig}".encode()).hexdigest()

    def build():
        im = kn5.uv_template(cars.load_kn5(car), name, size)
        b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()
    return FileResponse(_cached_file(key, ".png", build), media_type="image/png")


# ------------------------------------------------------------------ skins
class SkinReq(BaseModel):
    name: str
    clone_from: str | None = None
    meta: dict = {}


class MetaReq(BaseModel):
    meta: dict


class RenameReq(BaseModel):
    name: str


@app.get("/api/cars/{car}/skins")
def api_skins(car: str):
    return err(cars.list_skins, car)


@app.post("/api/cars/{car}/skins")
def api_skin_create(car: str, r: SkinReq):
    err(cars.create_skin, car, r.name, r.clone_from, r.meta)
    return {"ok": True, "skin": r.name}


@app.put("/api/cars/{car}/skins/{skin}/meta")
def api_skin_meta(car: str, skin: str, r: MetaReq):
    return err(cars.save_meta, car, skin, r.meta)


@app.post("/api/cars/{car}/skins/{skin}/rename")
def api_skin_rename(car: str, skin: str, r: RenameReq):
    err(cars.rename_skin, car, skin, r.name)
    return {"ok": True, "skin": r.name}


@app.delete("/api/cars/{car}/skins/{skin}")
def api_skin_delete(car: str, skin: str):
    err(cars.delete_skin, car, skin)
    return {"ok": True}


@app.get("/api/cars/{car}/skins/{skin}/preview")
def api_skin_preview(car: str, skin: str):
    p = os.path.join(err(cars.skin_path, car, skin), "preview.jpg")
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/cars/{car}/skins/{skin}/tex/{name}")
def api_tex(car: str, skin: str, name: str, src: str = "skin"):
    raw, src = err(cars.texture_bytes, car, skin or "", name, src)
    key = "tex_" + hashlib.md5(raw).hexdigest()

    def build():
        return dds.to_png(raw) if raw[:4] == b"DDS " else raw
    return FileResponse(_cached_file(key, ".png", build), media_type="image/png", headers={"X-Source": src})


@app.get("/api/cars/{car}/skins/{skin}/texinfo/{name}")
def api_texinfo(car: str, skin: str, name: str):
    return err(cars.texture_info, car, skin, name)


@app.put("/api/cars/{car}/skins/{skin}/tex/{name}")
async def api_tex_write(car: str, skin: str, name: str, request: Request, fmt: str = "", keep_alpha: int = 1):
    body = await request.body()
    if body[:8] != b"\x89PNG\r\n\x1a\n":
        raise HTTPException(400, "se esperaba un PNG")
    return err(cars.write_texture, car, skin, name, body, fmt or None, bool(keep_alpha))


@app.post("/api/cars/{car}/skins/{skin}/restore/{name}")
def api_tex_restore(car: str, skin: str, name: str):
    err(cars.restore_original, car, skin, name)
    return {"ok": True}


@app.get("/api/cars/{car}/skins/{skin}/project")
def api_project(car: str, skin: str):
    return err(cars.project_load, car, skin) or {}


@app.put("/api/cars/{car}/skins/{skin}/project")
async def api_project_save(car: str, skin: str, request: Request):
    proj = await request.json()
    err(cars.project_save, car, skin, proj)
    return {"ok": True}


@app.put("/api/cars/{car}/skins/{skin}/preview")
async def api_preview_write(car: str, skin: str, request: Request):
    err(cars.write_preview, car, skin, await request.body())
    return {"ok": True}


@app.put("/api/cars/{car}/skins/{skin}/livery")
async def api_livery_write(car: str, skin: str, request: Request):
    err(cars.write_livery, car, skin, await request.body())
    return {"ok": True}


@app.get("/api/cars/{car}/skins/{skin}/decals")
def api_decals(car: str, skin: str):
    d = err(cars.decals_dir, car, skin)
    return sorted(f for f in os.listdir(d) if f.lower().endswith(".png"))


@app.post("/api/cars/{car}/skins/{skin}/decals")
async def api_decal_upload(car: str, skin: str, request: Request, name: str = "decal.png"):
    n = err(cars.save_decal, car, skin, name, await request.body())
    return {"ok": True, "name": n}


@app.get("/api/cars/{car}/skins/{skin}/decal/{name}")
def api_decal(car: str, skin: str, name: str):
    p = os.path.join(err(cars.decals_dir, car, skin), cars._check(name))
    if not os.path.isfile(p):
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png")


@app.get("/api/cars/{car}/skins/{skin}/export.zip")
def api_export(car: str, skin: str):
    data = err(cars.export_zip, car, skin)
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{car}_{skin}.zip"'})


@app.post("/api/cars/{car}/import")
async def api_import(car: str, request: Request, name: str = ""):
    created = err(cars.import_zip, car, await request.body(), name or None)
    return {"ok": True, "skins": created}


@app.post("/api/cars/{car}/skins/{skin}/open")
def api_open(car: str, skin: str):
    p = err(cars.skin_path, car, skin)
    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # noqa
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
        else:
            subprocess.Popen(["xdg-open", p])
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"ok": True, "path": p}


if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print(f"AssettoCorsaCarPaint v{__version__} -> http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
