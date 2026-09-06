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

- Biblioteca (`web/app.js`, bloque "biblioteca"): `VINYLS` son SVG generados en JS (dos colores) que
  se cargan con `fabric.loadSVGFromString` → grupo (`kind:'vinyl'`); los patrones son PNG del servidor
  (`/api/pattern/{name}.png?c1&c2`, `acpaint/patterns.py`) usados como `fabric.Pattern` (se serializa
  la URL, así que el proyecto guarda solo la referencia); las imágenes viven en `library/` global
  (`/api/library`) o en `acpaint/decals/` de la skin. Los props personalizados `pat/patScale/grad/grad2`
  van en `PROPS_EXTRA`. `fillTargets(obj)` aplica rellenos a los hijos de grupos/selecciones.
- Clic en el 3D (`pickUV`): raycast sólo contra mallas cuyo material es "live"; `hit.uv` es el UV crudo
  del kn5 (three r160 no aplica transformaciones) → píxel = (u·W, v·H). `S.armed` guarda el elemento
  pendiente de colocar (casilla "colocar en 3D"); Escape / cerrar editor desarma.

- Interacción 3D (`setup3DInteraction`): listener `pointerdown` en fase de captura; si se toca una capa
  se pone `V.controls.enabled=false` antes de que OrbitControls vea el evento (r160 comprueba `enabled` al
  principio de `onPointerDown`). `surfaceFrame(hit)` calcula dP/du, dP/dv del triángulo tocado y proyecta
  el "derecha/arriba" de la cámara a píxeles de textura → `angle`, `flipY` (isla en espejo) y `pxPerM`
  (tamaño en cm). El arrastre sigue el raycast; un salto > 15 % del lienzo se interpreta como cambio de
  isla UV y el objeto pasa a quedar bajo el cursor.
- Disposición: `setLayout('3d'|'2d')` mueve `#viewer` y `#canvas-wrap` entre `#main` y `#side-top`
  (los canvas conservan su contexto al moverse en el DOM); se guarda en `localStorage acpaint.layout`.
- Texturas de color plano (≤ 64 px): el lienzo pasa a 2048 (selector `#ed-size`, `resizeCanvas` escala las
  capas) y `write_texture` escribe el DDS al tamaño del lienzo (el alpha original se reescala si se conserva).
  `/api/cars/{car}/uvinfo/{name}` (`kn5.uv_info`) da cobertura/capas/espejo/degeneradas y
  `encrypted_suspect` (normales no unitarias > 20 %: mods cifrados, geometría ilegible).
- `window.ACP = {S, V, fabric, THREE}` para pruebas con puppeteer (`scratchpad/test3d.js`).

## Hechos verificados
- `toCanvasElement` de Fabric ya pone `interactive=false` (no dibuja controles) y dispara `after:render`:
  `renderTexture` marca `S.inRender` para que el handler de `after:render` no reprograme el render en vivo
  (antes había un bucle continuo cada 120 ms y se perdía la selección/edición de texto).
- Fabric 5.3.0 usa `textBaseline='alphabetical'` (aviso en Chrome nuevo): parcheado a `alphabetic` en
  `web/vendor/fabric.min.js`.
- `[hidden]` necesita `display:none !important` porque `.sub`/`.props` fijan `display:flex`.
- Al cerrar el editor hay que poner `S.tex=null`; si no, `stashCurrent()` de la siguiente apertura
  machaca el proyecto con el lienzo vacío.
