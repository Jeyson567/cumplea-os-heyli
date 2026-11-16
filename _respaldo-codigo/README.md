# Invitación XV de Heyli Orrego

Sistema de invitación digital con confirmación individual. La página pública está en `index.html`. El acceso de administración es `admin.html`. La instalación del primer administrador está en `setup-privado.html` y solo se abre en local. No se publicaron cambios en Firebase.

## Qué ya funciona en este equipo

- Invitación responsive, sobre de apertura, cuenta regresiva real para el 13 de diciembre de 2026 a las 6:00 p. m. (America/Guatemala), mapa, galería con lightbox, música y confirmación.
- El plan es Firebase Spark. El navegador habla con Authentication y Firestore. No usa Cloud Functions ni servicios de pago.
- Cada invitación es un documento cuyo identificador es el token. Un invitado solo puede leer ese documento si está activo, y solo puede cambiar su respuesta. No puede listar la colección.
- El permiso de administrador es la existencia del documento `admins/{uid}`. Las reglas impiden que el cliente lo cree.

## Qué falta configurar antes de usarlo con invitados

1. Publicar las reglas de Firestore. Hoy no se hizo porque no autorizaste un despliegue. Sin ese paso, la web sigue con las reglas anteriores y no puede leer ni confirmar.
2. Activar Authentication con correo y contraseña.
3. Abrir `setup-privado.html` con Live Server, crear la cuenta y anotar el UID.
4. En Firebase Console, crear a mano `admins/{uid}` y `system/status` con `completed: true`.
5. Las fotografías de Heyli ya están en la galería, con el nombre original de cada archivo.

No hay contraseña incluida en el código. No se creó un administrador por defecto. No despliegues nada hasta autorizarlo.

## Requisitos

- Un navegador y la extensión Live Server para la instalación.
- Firebase CLI, vía `npx firebase-tools`, solo cuando autorices publicar reglas o la web.
- Proyecto `cumpleheyli`, el que está en `.firebaserc`.
- Plan Spark. No hace falta Blaze.

## Probar la invitación sin tocar producción

```powershell
cd "C:\Users\tubom\Downloads\cumpleaños heyli"
npm test
npx --yes serve -l 5173 .
```

Abre `http://127.0.0.1:5173/`. Sin `?emuladores=1`, la página usa el proyecto real `cumpleheyli`. Con ese parámetro, en localhost, Auth y Firestore apuntan a los emuladores. La invitación se ve con los datos base aunque Firestore todavía no tenga configuración.

El panel, en las mismas condiciones: `http://127.0.0.1:5173/admin.html?emuladores=1`.

## Fotografías

La galería usa los JPEG que están en la raíz del proyecto, sin copiarlos ni cambiarles el nombre. El listado está en `js/gallery-config.js`. La portada muestra la primera de esas fotografías mientras el campo “Portada” del panel esté vacío. Si una imagen no carga, aparece un recuadro de reserva.

`assets/img` conserva el icono, la imagen de enlace y cuatro dibujos temporales que ya no salen en la galería.

Para sustituir una foto desde el panel, elige “Usar esta lista” y escribe una ruta por línea: `foto.jpg | Descripción`. El nombre debe ser un archivo, sin carpetas ni `..`. Puede incluir espacios y paréntesis, como los archivos de WhatsApp. Extensiones: jpg, jpeg, png, webp, gif o svg.

## Música

La propuesta inicial es “A Thousand Years”, de Christina Perri. El botón “Buscar en Spotify” abre la búsqueda real. No hay un identificador de canción inventado.

Para reproducir dentro de la invitación:

- Pon un archivo con licencia en `assets/audio` y escribe su nombre en el panel, o
- pega un enlace real de Spotify (`https://open.spotify.com/track/...` o el embed). El sistema lo convierte solo si el identificador tiene el formato de Spotify.

Si el audio falla, la invitación sigue abriéndose. Spotify puede pedir otro toque y no garantiza la reproducción automática. Al abrir el sobre, solo se intenta un archivo local.

## Primer administrador, con Live Server

`setup-privado.html` no aparece en la invitación ni en el panel. Firebase Hosting lo ignora y `_config.yml` lo excluye de GitHub Pages. Ocultarlo no otorga el permiso. El permiso existe solo cuando el documento `admins/{uid}` está en Firestore, y las reglas rechazan cualquier intento del navegador de crearlo.

1. Firebase Console, proyecto `cumpleheyli`, Authentication, método de acceso, activa **Correo/contraseña**.
2. En VS Code, abre esta carpeta con Live Server sobre `setup-privado.html`. No uses `file://` ni `?emuladores=1` si la cuenta debe quedar en el proyecto real.
3. Escribe correo y contraseña, de 8 a 128 caracteres. La página crea el usuario y muestra el UID. La contraseña no se escribe en el código ni en Firestore.
4. En Firestore, pulsa **Iniciar colección**. ID de colección: `admins`. ID del documento: el UID copiado, carácter por carácter. Añade un campo `active` de tipo booleano en `true`. Guarda.
5. Inicia otra colección si hace falta. ID de colección: `system`. ID del documento: `status`. Campo `completed`, booleano, `true`. Guarda. Esto bloquea la pantalla de instalación. El navegador no puede escribir ese documento.
6. Vuelve a la pantalla local y pulsa **Ya autoricé este UID**. Si el documento existe, la cuenta ya puede entrar por `admin.html`.
7. En el panel, guarda una vez la configuración del evento. Eso escribe `rsvpDeadlineAt`, que es la fecha que las reglas comparan.

Para quitar un administrador, borra su documento en `admins` desde la consola y cierra su sesión. No hace falta un claim ni una función.

El plan Spark no permite apagar del todo el alta pública de Authentication. Una cuenta creada por fuera no ve invitados ni configuración privada: sin documento en `admins`, las reglas la tratan como invitado anónimo. `admin.html` no tiene formulario de registro.

La consola de Firebase ignora las reglas al editar documentos. Por eso el UID inicial se crea ahí y no en la página. No pegues el UID en un sitio público.

## Firestore

Reglas en `firestore.rules`. La política es denegar todo y abrir solo esto:

- `admins/{uid}`: el usuario puede leer el suyo. Solo un administrador puede listar. Nadie puede crear, editar ni borrar desde el cliente. El alta se hace en la consola.
- `system/status`: cualquiera puede leer si la instalación está completada. Nadie puede escribirlo desde el cliente.
- `system/bootstrap`: un usuario autenticado puede crearlo una sola vez con su propio UID. No lo puede leer el público y no concede permiso.
- `eventSettings/public`: lectura pública. Escritura solo de administrador.
- `invitations/{token}`: lectura de un documento activo, o de cualquiera si eres administrador. El listado completo solo lo hace un administrador. El invitado solo puede cambiar `status`, `confirmedCount`, `respondedAt` y `updatedAt`, dentro de los cupos y de la fecha `rsvpDeadlineAt`. No puede borrar.
- `invitations/{token}/private/profile`: teléfono y notas. Solo el administrador.
- `auditLogs`: el administrador lee y crea. No se editan ni se borran.
- `tokenIndex`, `rateLimits`, `createOps`, `secret` y `ops`: denegados. Quedan por si existían datos del diseño anterior. No se borran desde aquí.

El identificador del documento es el enlace. No está cifrado: Firestore Rules no puede buscar un hash. Quien tenga el enlace puede leer esa invitación y cambiar su propia respuesta. No puede pedir la lista. No hay límite de intentos por IP, porque eso necesitaba Cloud Functions. Dos confirmaciones seguidas se quedan con la última. El panel evita el doble registro de entrada durante 20 segundos; las reglas impiden ingresar más personas que las confirmadas.

Cuando autorices publicar las reglas, sin desplegar funciones:

```powershell
cd "C:\Users\tubom\Downloads\cumpleaños heyli"
npx firebase-tools deploy --only firestore:rules --project cumpleheyli
```

Eso no borra documentos existentes. No lances este comando hasta querer aplicarlo al proyecto real.

La carpeta `functions/` conserva el diseño anterior y no forma parte del despliegue. No la publiques. El plan Spark no puede ejecutarla.

## Hosting

Cuando autorices publicar la web:

```powershell
npx firebase-tools deploy --only hosting --project cumpleheyli
```

La invitación quedará en `https://cumpleheyli.web.app/` y el panel en `https://cumpleheyli.web.app/admin.html`. En el campo “Dirección pública” del panel conviene guardar `https://cumpleheyli.web.app` para que los enlaces de WhatsApp usen ese dominio.

También puedes servir los archivos estáticos con GitHub Pages. Las confirmaciones siguen yendo a Firestore del proyecto `cumpleheyli`. `setup-privado.html` no debe subirse.

## App Check

App Check es opcional y no sustituye las reglas. Sin una site key, la invitación no lo espera. Si más adelante registras reCAPTCHA v3, escribe la clave en `APP_CHECK_SITE_KEY` dentro de `js/firebase-config.js`.

## Emuladores

Instala Java 21 o superior y luego:

```powershell
cd "C:\Users\tubom\Downloads\cumpleaños heyli"
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"
npx firebase-tools emulators:start --project cumpleheyli
```

En otra terminal, solo si esas dos variables apuntan a localhost:

```powershell
node functions/scripts/seed-emulator.js
```

El script se niega a arrancar si no detecta el emulador. Crea un usuario de prueba, una contraseña aleatoria que imprime una sola vez y una invitación “Familia de prueba”. No modifica el proyecto real.

Abre las URLs que imprime, con `?emuladores=1`.

## Uso del panel

- Resumen en tiempo real: emitidas, pendientes, confirmadas, rechazadas, cupos autorizados, personas confirmadas, cupos que siguen sin respuesta e ingresos en puerta.
- Alta, edición, desactivación y reactivación. Desactivar no borra el registro.
- Enlace, copia, WhatsApp y QR. Regenerar revoca el enlace anterior.
- Búsqueda por nombre, filtro, orden, selección y desactivación múltiple.
- CSV con BOM y separador `;`, compatible con Excel, sin tokens. Los nombres que empiezan por `=` se neutralizan.
- Impresión de la lista visible.
- Cambio manual de la respuesta, con historial y auditoría. Tampoco puede saltarse los cupos ni las personas que ya entraron.
- Configuración del evento, incluida vestimenta y agenda, que empiezan vacías.
- Entrada por cámara, si el navegador tiene `BarcodeDetector`, o pegando el enlace. La entrada es parcial, atómica y pide confirmación si acabas de registrar a alguien.

Cada invitado abre `index.html?invitacion=TOKEN`. Ve su nombre y sus lugares, elige asistir o no, y puede corregir la respuesta hasta el límite. Rechazar guarda cero. El límite inicial es el 10 de diciembre de 2026 a las 6:00 p. m., hora de Guatemala, y se cambia en el panel.

## Pruebas ejecutadas aquí

`npm test` pasó 10 pruebas: igualdad de la validación, tokens y cifrado, horario de Guatemala (el 13 de diciembre de 2026 cae en domingo), cupos, rechazo, fecha límite, check-in parcial, tope, doble registro, tokens revocados, Spotify, nombres de archivo, CSV, QR y la comprobación de que la invitación no enlaza el panel ni las reglas permiten `if true`.

No se ejecutaron los emuladores ni se escribió en Firebase de producción: no hay Java para el emulador de Firestore y no autorizaste despliegue ni escritura remota. Por eso no hay una confirmación guardada en la nube.

En el navegador local, con `?emuladores=1`, se revisó: apertura del sobre, cuenta regresiva (30 días), mapa y búsqueda de Spotify, galería con lightbox y avance, token con forma inválida, imagen ausente (muestra “Fotografía por añadir”), panel de acceso con el emulador apagado (el intento de entrar fue a `127.0.0.1:9099` y mostró error de conexión) y el ancho de 390 px sin desbordamiento horizontal.

## Archivos

`index.html`, `admin.html`, `setup-privado.html`, `css/styles.css`, `css/admin.css`, `css/setup.css`, `js/firebase-config.js`, `js/invitation.js`, `js/admin.js`, `js/setup.js`, `js/gallery-config.js`, `js/music.js`, `functions/`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` y esta guía.
