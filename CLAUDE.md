# AssettoCorsaCarPaint — guía para Claude

Editor web local de skins/liveries de Assetto Corsa (estilo Forza Horizon). Hermano de
`../AssettoCorsaTrackMaker`: mismas reglas de trabajo (autoría git `alejandrorodm
<134231424+alejandrorodm@users.noreply.github.com>`, sin trailers ni Co-Authored-By; commits por
función; resumen enumerado al acabar para que el usuario pruebe en AC).

## Entorno
- El usuario prueba en su PC Windows (AC 1.16.4 + CSP); esta máquina es una VM Linux (192.168.1.13).
  Para editar sus coches reales el servidor debe correr en Windows (`start.bat`) o apuntar `ac_root`
  a la carpeta de AC. En la VM se prueba con `python tests/make_fake_car.py` (crea `tests/fake_ac`,
  ignorado por git) y `AC_ROOT=tests/fake_ac nohup python3 server.py 8766 &`.
- Pruebas de interfaz sin extensión de Chrome: puppeteer-core contra `/usr/bin/google-chrome` headless
  (`--use-angle=swiftshader` para WebGL); el guion de referencia está en el scratchpad de la sesión.
- Subir la versión visible (`acpaint/__init__.py` `__version__`, se muestra en la cabecera) y el
  `?v=` de `app.js`/`style.css` en `index.html` cuando cambie la web.

## Arquitectura
- `server.py` (FastAPI, puerto 8766) → `acpaint/cars.py`. Rutas `/api/cars/{car}/skins/{skin}/...`:
  `tex/{name}?src=skin|orig|kn5` (PNG descodificado, caché por md5 en `cache/`), `PUT tex/{name}`
  (PNG del lienzo → DDS con mips, `?fmt=DXT1|DXT5&keep_alpha=1`), `project` (JSON de Fabric por
  textura), `preview`/`livery`, `decals`, `export.zip`, `restore/{name}`; `/api/cars/{car}/model.glb`
  y `/uv/{name}?size=`.
- Dentro de la skin se crea `acpaint/` (project.json, decals/, original/ con el DDS previo a la primera
  edición). AC ignora esa carpeta; el zip de exportación la excluye.
- `acpaint/kn5.py`: matrices fila-vector (`world = local @ parent`), nodos tipo 1/2/3; el GLB pasa las
  coordenadas de AC tal cual (three.js coincide, verificado en TrackMaker) y las UV con `flipY=false`.
- DDS: Pillow 12 codifica DXT1/DXT5 por nivel; `dds.encode` monta la cadena de mips hasta 4×4 (igual que
  las texturas del TrackMaker, que AC acepta). Pillow descodifica DXT1/3/5, BC5/BC7 y sin comprimir.
- `web/app.js`: estado `S` (coche, skin, texturas, proyecto), historial JSON, `renderTexture(scale)`
  usa `toCanvasElement` con recorte al viewport para exportar a resolución real; la vista 3D usa una
  `CanvasTexture` a ≤1024 px que se refresca con retardo de 120 ms; `bind3DTexture` sustituye el mapa
  de los materiales cuyo `txDiffuse` es la textura en edición.

## Hechos verificados
- Fabric 5.3.0 usa `textBaseline='alphabetical'` (aviso en Chrome nuevo): parcheado a `alphabetic` en
  `web/vendor/fabric.min.js`.
- `[hidden]` necesita `display:none !important` porque `.sub`/`.props` fijan `display:flex`.
- Al cerrar el editor hay que poner `S.tex=null`; si no, `stashCurrent()` de la siguiente apertura
  machaca el proyecto con el lienzo vacío.
