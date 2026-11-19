# Llegada

**Recordatorios que te encuentran, no al revés.**

Llegada es una app web instalable (PWA) **pensada para el celular**. Lanza recordatorios cuando entras o sales de un lugar. Tú eliges el radio, el tiempo de espera y qué hacer cuando suena: completarlo o posponerlo como una alarma.

La app se publica en GitHub Pages y se actualiza desde GitHub sin pasar por una tienda.

- **Demo / app publicada:** https://carpediego.github.io/Llegada/
- **Repositorio:** https://github.com/carpediego/Llegada
- **Releases y paquetes:** https://github.com/carpediego/Llegada/releases

---

## Qué hace

- Recordatorios con **geocerca** de 30 m a 1 km.
- Aviso **al llegar** o **al salir**.
- Aviso **al instante** o **X minutos después** (hasta 3 horas).
- Margen automático según la precisión del GPS y cancelación si sales del área antes de que termine la espera.
- Alarma a pantalla completa con **sonido, vibración y notificación**.
- **Posponer** 5, 10, 15 o 30 minutos (o el tiempo configurado), con repetición.
- **Repetir en cada visita** o completar una sola vez.
- Mapa para buscar una dirección, tocar el punto exacto o usar tu ubicación actual.
- Datos y recordatorios guardados **solo en tu dispositivo**.
- Funciona **sin conexión** después de la primera carga.
- **Actualizaciones desde GitHub** con búsqueda manual, descarga del paquete, verificación SHA-256 e instalación desde la propia app.

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

### En el teléfono

1. Abre la URL de GitHub Pages en Chrome (Android) o Safari (iPhone).
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
3. GitHub Actions compila, crea el release `vX.Y.Z`, adjunta el `.zip` y publica en Pages.
4. En **Ajustes → Actualizaciones**, la app consulta `version.json` y el último release de GitHub.
5. Si hay una versión nueva, muestra las notas y el tamaño.
6. **Descargar e instalar** descarga todos los archivos del manifiesto, verifica el SHA-256 de cada uno, los guarda en una caché de instalación, activa el service worker nuevo y recarga.
7. **Descargar .zip** guarda el paquete completo para copia manual o publicación en otro sitio.

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

Esta es una **PWA**, no una app nativa. Los navegadores no permiten ejecutar GPS en segundo plano de forma garantizada.

- La geocerca funciona mientras Llegada está abierta, en primer plano o en una pestaña reciente.
- Si el sistema operativo suspende el navegador, bloquea la pantalla o cierra la app, la geocerca deja de actualizarse.
- Las notificaciones del sistema pueden avisar de un evento ya detectado, pero no despiertan un GPS que el sistema haya apagado.
- En interiores, sótanos o con ahorro de batería extremo el GPS puede tardar o dar un error grande. El radio y el margen de precisión ayudan, pero no hacen magia.
- Para una geocerca 24/7 real, con la app cerrada, hace falta una app nativa con permiso de ubicación en segundo plano (Android `GeofencingClient` o iOS `Core Location`). La interfaz y la lógica de este proyecto están separadas para poder llevarlas a una envoltura nativa más adelante.

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
js/geo.js                  Geolocalización y cálculo de distancias
js/map.js                  Mapas Leaflet (dashboard y selector)
js/store.js                Persistencia local, validación e import/export
js/audio.js                Sonido de alarma con Web Audio
js/notifications.js        Notificaciones del sistema
js/updater.js              Búsqueda, descarga, SHA-256 e instalación
sw.template.js             Plantilla del service worker
scripts/build.mjs          Build, manifiestos, hashes y ZIP
server.js                  Servidor local sin dependencias
.github/workflows/deploy.yml  Release + GitHub Pages
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
Es el límite del navegador. Mantén Llegada abierta o usa una app nativa para ese caso.

**No aparece una actualización**  
Pulsa **Buscar actualizaciones** en Ajustes. Si el release existe pero Pages aún no terminó de desplegar, espera un minuto. También puedes descargar el `.zip` desde GitHub Releases.

**El service worker se quedó con una versión vieja**  
Cierra todas las pestañas de Llegada, vuelve a abrirla y busca actualizaciones. En último caso, borra los datos del sitio desde el navegador (perderás los recordatorios; exporta una copia antes).

---

## Licencia

MIT. Consulta [LICENSE](LICENSE).

Tipografías: Fraunces y Manrope, bajo SIL Open Font License (archivos OFL en `assets/fonts/`). Mapas: Leaflet (BSD-2-Clause) y datos de OpenStreetMap (ODbL).
