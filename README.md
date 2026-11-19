# Llegada

**Recordatorios que te encuentran, no al revés.**

Llegada es una app **para Android** con recordatorios por ubicación, y también una PWA web. Lanza avisos cuando entras o sales de un lugar. Tú eliges el radio, el tiempo de espera y qué hacer cuando suena: completarlo o posponerlo como una alarma.

La app Android usa un **servicio en primer plano con GPS**, alarma nativa y permisos de ubicación en segundo plano. Se publica en GitHub y se actualiza desde GitHub sin pasar por una tienda.

- **App web:** https://carpediego.github.io/Llegada/
- **APK Android:** https://github.com/carpediego/Llegada/releases/latest
- **Repositorio:** https://github.com/carpediego/Llegada
- **Releases y paquetes:** https://github.com/carpediego/Llegada/releases

---

## Qué hace

- Recordatorios con **geocerca** de 30 m a 1 km.
- Aviso **al llegar** o **al salir**.
- Aviso **al instante** o **X minutos después** (hasta 3 horas).
- Margen automático según la precisión del GPS y cancelación si sales del área antes de que termine la espera.
- Alarma con **sonido, vibración, notificación a pantalla completa** y opción de posponer.
- En Android: **servicio en primer plano** que sigue vigilando con la pantalla apagada y aviso aunque cierres la app.
- Permisos guiados para **ubicación todo el tiempo**, notificaciones y **exclusión del ahorro de batería**.
- **Repetir en cada visita** o completar una sola vez.
- Mapa para buscar una dirección, tocar el punto exacto o usar tu ubicación actual.
- Datos y recordatorios guardados **solo en tu dispositivo**.
- **Actualizaciones desde GitHub**: búsqueda, descarga del APK, verificación de firma e instalación del sistema. En la versión web se actualiza el paquete y el service worker.


---

## Probar en local

Necesitas Node.js 20 o superior.

```powershell
npm install
npm start
```

Abre `http://127.0.0.1:4173`.

También puedes usar `iniciar.cmd` en Windows: instala dependencias si hace falta, compila y abre el navegador.

> La geolocalización solo funciona en `localhost` o en HTTPS. En `file://` el navegador no entrega la ubicación y el service worker no se registra.

### Compilar el APK Android

Requisitos: JDK 17 y Android SDK 35.

```powershell
npm run build
node scripts/build-android.mjs
cd android
.\gradlew.bat assembleRelease
```

El APK queda en `android/app/build/outputs/apk/release/app-release.apk`.

Para firmar el release se necesitan estas variables de entorno (la clave no se versiona):

```
LLEGADA_KEYSTORE
LLEGADA_KEYSTORE_PASSWORD
LLEGADA_KEY_ALIAS
LLEGADA_KEY_PASSWORD
```

GitHub Actions usa los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`.

### En el teléfono

**Android (recomendado):**

1. Abre el APK desde [Releases](https://github.com/carpediego/Llegada/releases/latest) en el teléfono.
2. Permite instalar apps de esta fuente cuando Android lo pregunte.
3. Abre Llegada y concede ubicación precisa y notificaciones.
4. En **Ajustes → Modo Android en segundo plano**, pulsa:
   - **Ubicación todo el tiempo** y elige “Permitir todo el tiempo”.
   - **Quitar ahorro de batería** y confirma “Sin restricciones”.
5. En algunos fabricantes (Xiaomi, Samsung, Huawei, Oppo) activa también **Autoarranque** en los ajustes del sistema.

**iPhone / navegador:** la versión web se instala desde Chrome o Safari, pero el navegador no mantiene el GPS con la pantalla apagada.

1. Abre la URL de GitHub Pages.
2. Instálala desde el menú del navegador: **Instalar aplicación** o **Compartir → Añadir a pantalla de inicio**.
3. Activa la ubicación y las notificaciones.
4. Mantén la app abierta mientras quieras vigilar una geocerca.

---

## Cómo se usa

1. Pulsa **Nuevo recordatorio**.
2. Escribe qué quieres recordar.
3. Elige el lugar:
   - busca una dirección,
   - toca el mapa,
   - o pulsa **Usar mi ubicación**.
4. Ajusta el **radio**. Si el GPS suele fallar en interiores, usa un radio más amplio.
5. Elige **Al llegar** o **Al salir** y el tiempo de espera.
6. Guarda y activa la **vigilancia de ubicación**.

Cuando la app detecta la entrada (o salida), empieza la cuenta. Si configuraste “cancelar si me voy antes”, salir del radio cancela el aviso.

---

## Actualizaciones desde GitHub

La app no depende de una tienda. El flujo es:

1. Se cambia la versión en `package.json` y se añaden las notas en `CHANGELOG.md`.
2. Se hace commit y push a `main`.
3. GitHub Actions compila la web, el APK firmado, crea el release `vX.Y.Z`, adjunta `.zip` y `.apk`, y publica en Pages.
4. En **Ajustes → Actualizaciones**, la app consulta la versión publicada en GitHub Pages y el último release.
5. **Android:** descarga el APK con el gestor del sistema, abre el instalador de Android y actualiza conservando tus recordatorios.
6. **Web:** descarga el paquete, verifica el SHA-256 de cada archivo, lo guarda en caché y recarga.
7. **Descargar .zip / APK** guarda el paquete completo para copia manual.

La comprobación automática ocurre como máximo una vez cada 6 horas y también puede lanzarse a mano.

### Publicar una versión nueva

```powershell
npm run release:patch   # o release:minor / release:major
```

Después edita `CHANGELOG.md` con la sección de la nueva versión:

```markdown
## 1.0.1 — 2026-11-20

- Corrige el cálculo del radio con señal débil.
- Añade un aviso de batería.
```

Luego:

```powershell
git add -A
git commit -m "Llegada v1.0.1"
git push origin main
```

El workflow `.github/workflows/deploy.yml` hace el resto:

- `npm ci`
- `npm run build`
- crea `llegada-vX.Y.Z.zip` en `dist/downloads/`
- crea el release si no existe
- publica `dist/` en GitHub Pages

### Archivos del actualizador

| Archivo | Función |
| --- | --- |
| `version.json` | Última versión publicada, notas, tamaño y URL del `.zip`. |
| `update.json` | Lista de archivos con SHA-256 y tamaño para la instalación. |
| `downloads/llegada-vX.Y.Z.zip` | Paquete completo descargable. |
| `sw.js` | Service worker generado con la versión y la lista de precarga. |
| `build-info.js` | Versión y datos del repositorio que usa la app. |

`scripts/build.mjs` genera todo lo anterior en `dist/`. La carpeta `dist/` no se versiona; GitHub Actions la reconstruye.

> El SHA-256 garantiza que el paquete no llegó corrupto o alterado en tránsito. No sustituye a una firma criptográfica de código. Si más adelante quieres verificación de autor, se puede añadir firma con una clave pública.

---

## Límites importantes (leer antes de confiar una alarma crítica)

**Android:**

- La app usa un servicio en primer plano con GPS y alarma nativa. Funciona con la pantalla apagada y al cerrar la pantalla, siempre que el sistema no detenga el servicio.
- Para máxima estabilidad: ubicación **todo el tiempo**, **sin ahorro de batería** y, en fabricantes agresivos, **autoarranque** permitido.
- Si el teléfono reinicia, Llegada intenta retomar la vigilancia si estaba activa.
- El GPS puede fallar en interiores, sótanos o con señal débil. El radio y el margen de precisión ayudan, pero no hacen magia.
- No es una app de Play Store; se instala el APK firmado desde GitHub.

**Web / iPhone:**

- La geocerca funciona mientras la pestaña está abierta o reciente.
- Si el sistema operativo suspende el navegador o cierra la app, la geocerca deja de actualizarse.
- Para una geocerca 24/7 real usamos la app Android, no la PWA.

La app intenta ser honesta: si no puede vigilar, lo dice en pantalla.

---

## Privacidad

- No hay cuentas, backend propio ni analítica.
- Los recordatorios, coordenadas y ajustes se guardan en `localStorage` del navegador.
- Las búsquedas de direcciones se envían a Nominatim/OpenStreetMap.
- Los mapas cargan teselas de OpenStreetMap; como cualquier mapa, el proveedor recibe la zona aproximada que se está viendo.
- La comprobación de actualizaciones consulta GitHub Pages y la API pública de GitHub.
- No se envía tu ubicación a ningún servidor de Llegada.

---

## Estructura

```
index.html                 Interfaz y diálogos
styles.css                 Diseño responsive
js/app.js                  Lógica principal, geocercas, alarmas y UI
js/native.js               Puente entre la interfaz y Android
js/geo.js                  Geolocalización web y cálculo de distancias
js/map.js                  Mapas Leaflet (dashboard y selector)
js/store.js                Persistencia local, validación e import/export
js/audio.js                Sonido de alarma con Web Audio
js/notifications.js        Notificaciones web
js/updater.js              Búsqueda, descarga, SHA-256 e instalación
sw.template.js             Plantilla del service worker
android/                   Proyecto Android (WebView + servicio + alarma)
android/app/src/main/java/com/carpediego/llegada/GeofenceService.kt
                           Servicio GPS en primer plano y geocercas nativas
android/app/src/main/java/com/carpediego/llegada/MainActivity.kt
                           WebView, permisos, alarmas y actualización del APK
scripts/build.mjs          Build web, manifiestos, hashes y ZIP
scripts/build-android.mjs  Copia assets y genera versión de Android
scripts/finalize-apk.mjs   Añade tamaño y SHA-256 del APK
server.js                  Servidor local sin dependencias
.github/workflows/deploy.yml  APK + release + GitHub Pages
```

### Comandos

```powershell
npm start          # build + servidor local
npm run build      # genera dist/
npm run serve      # sirve dist/ sin recompilar
npm run release:patch
npm run release:minor
npm run release:major
```

---

## Solución de problemas

**No aparece el permiso de ubicación**  
Comprueba que estás en `localhost` o HTTPS. En Chrome: candado de la barra → Ubicación → Permitir. En iPhone: Ajustes → Safari → Ubicación.

**La app dice “Sin señal”**  
Sal al exterior, activa el GPS y vuelve a pulsar Reintentar. Si estás en un edificio, sube el radio a 250–500 m.

**La alarma no suena con la pantalla apagada**  
En Android revisa: Ubicación → Permitir todo el tiempo; Batería → Sin restricciones; Autoarranque permitido. En la versión web es el límite del navegador: mantén Llegada abierta o usa el APK.

**Android actualiza pero no instala**  
Permite “Instalar apps desconocidas” para Llegada cuando el sistema lo pida. El APK se descarga desde GitHub Pages y se abre con el instalador oficial.

**No aparece una actualización**  
Pulsa **Buscar actualizaciones** en Ajustes. Si el release existe pero Pages aún no terminó de desplegar, espera un minuto. También puedes descargar el `.zip` desde GitHub Releases.

**El service worker se quedó con una versión vieja**  
Cierra todas las pestañas de Llegada, vuelve a abrirla y busca actualizaciones. En último caso, borra los datos del sitio desde el navegador (perderás los recordatorios; exporta una copia antes).

---

## Licencia

MIT. Consulta [LICENSE](LICENSE).

Tipografías: Fraunces y Manrope, bajo SIL Open Font License (archivos OFL en `assets/fonts/`). Mapas: Leaflet (BSD-2-Clause) y datos de OpenStreetMap (ODbL).
