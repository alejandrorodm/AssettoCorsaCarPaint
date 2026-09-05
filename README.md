# AssettoCorsaCarPaint

Editor web local de **skins (liveries) de Assetto Corsa** al estilo Forza Horizon: eliges un coche
del garaje, creas o duplicas una skin, pintas la textura en 2D por capas (color base, formas, franjas,
texto, dorsal, logos PNG, pincel) y ves el resultado **en 3D en vivo** sobre el modelo real del coche.
Al guardar se escribe el DDS (DXT1/DXT5 con mipmaps) directamente en `content/cars/<coche>/skins/<skin>/`,
junto con `ui_skin.json`, `preview.jpg` y `livery.png`. No requiere Content Manager ni Photoshop.

## Uso

```bash
pip install -r requirements.txt
python server.py            # -> http://localhost:8766
```

En Windows basta con doble clic en `start.bat`. La primera vez indica la carpeta de Assetto Corsa en
**⚙ Ajustes** (p. ej. `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa`); se detecta sola si
está en la ruta de Steam habitual. También vale la variable de entorno `AC_ROOT`.

## Flujo

1. **Garaje**: lista de coches (nombre, marca, badge, nº de skins) con buscador.
2. **Skins** del coche: previews, datos (`ui_skin.json`), nueva skin (copiando las texturas de otra),
   duplicar, exportar/importar zip, abrir carpeta, borrar.
3. **Editor**:
   - Selector de textura (★ = las que ya tiene la skin; se listan todas las `txDiffuse` del kn5 con sus mallas).
   - Base del lienzo: la textura original de la skin (se guarda una copia en `acpaint/original/` antes
     de la primera edición, así se puede re-editar sin acumular capas), la del kn5 o ninguna.
   - Capas: color base, rectángulo, círculo, anillo, triángulo, franja, estrella, chevrón, texto, dorsal,
     imágenes PNG (se guardan en `acpaint/decals/` de la skin) y pincel. Modos de mezcla (multiplicar,
     superponer, color…), opacidad, borde, voltear, espejo, duplicar, bloquear, orden, deshacer/rehacer.
   - Plantilla **UV** (bordes de los triángulos de las mallas que usan esa textura) para colocar vinilos.
   - Vista 3D con el kn5 real (texturas de la skin + la que editas en vivo), cámaras F/L/T/R y giro.
   - **Guardar** (Ctrl+S): escribe el DDS con mips y el proyecto (`acpaint/project.json`) para reabrirlo.
     Por defecto se conserva el canal alpha del original (en `ksPerPixelMultiMap` controla el brillo).
   - **Preview**: genera `preview.jpg` (1022×576) y `livery.png` (32×32) desde la vista 3D.

## Estructura

- `server.py` FastAPI: API REST + estáticos. `acpaint/cars.py` (content/cars, skins, backups, zips),
  `acpaint/kn5.py` (lector KN5 v5/v6 con jerarquía), `acpaint/dds.py` (DDS DXT1/DXT5 + mips vía Pillow),
  `acpaint/gltf.py` (kn5 → GLB para la vista 3D).
- `web/` sin build: `app.js` (Fabric.js para el 2D, three.js para el 3D), librerías en `web/vendor`.
- `tests/make_fake_car.py` crea un `content/cars` falso con un coche sintético para probar sin AC.
- `cache/` guarda GLB, PNG de texturas y plantillas UV (se puede borrar).
