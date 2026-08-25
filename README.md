# Plataforma NFC — Proyectos de Estructura Metálica

Plataforma web para consultar, desde el celular y con una etiqueta NFC pegada en el proyecto,
toda la información de fabricación: planos, listado de piezas con su peso, especificaciones de
soldadura, modelo 3D en Autodesk y un checklist de avance que se guarda solo.

---

## Cómo funciona

**Ingeniería / Administrador** — asistente de 4 pasos

1. **Lista de piezas.** Sube el Excel/CSV **o pega las filas copiadas de Excel**. De ahí se leen
   solas las piezas, sus pesos, el número de dibujo y — si el archivo las trae — las columnas
   *Nombre Proyecto*, *Proyecto*, *Cliente* y *Code_Cliente*.
2. **Datos del proyecto.** Llegan ya llenos con lo detectado; sólo confirmas y pones la
   **fecha de entrega** y las etapas del checklist.
3. **Planos.** Sube la carpeta completa (PDF, DXF, DWG, imágenes; se respetan las subcarpetas)
   y los PDF de especificaciones de soldadura.
4. **Modelo 3D.** Pega el link del visor de Autodesk.

Al guardar, la plataforma genera sola la página del proyecto, **el enlace listo para grabar en la
NFC** y el código QR para imprimir.

**Personal de taller (Usuario)**
1. Acerca el celular a la etiqueta NFC pegada en el proyecto.
2. Se abre la página; si no ha iniciado sesión, se le pide su correo y contraseña (una sola vez,
   la sesión dura 30 días).
3. Ve el modelo 3D, los planos, las especificaciones de soldadura y la lista de piezas con su peso.
4. Marca el checklist conforme avanza la fabricación. **Se guarda al instante** y todos ven el avance.

---

## Instalación en Hostinger

En el panel de Hostinger, sección **Sitios web → Node.js** (o *Aplicaciones Node.js*):

1. **Sube los archivos** del proyecto a la carpeta de la aplicación (por FTP, el Administrador de
   archivos o Git). No subas la carpeta `node_modules`.
2. Configura la aplicación:
   - **Versión de Node:** 18 o superior (sirve cualquiera: 18, 20, 22...).
   - **Archivo de inicio / Startup file:** `server.js`
   - **Carpeta de la aplicación:** donde subiste los archivos.
3. Ejecuta **NPM Install** desde el panel (o `npm install` por SSH).

> La plataforma **no usa módulos nativos**: no necesita compilador, Python ni
> node-gyp. Por eso `npm install` funciona en hostings compartidos, donde esas
> herramientas no están disponibles. La base de datos es SQLite corriendo en
> WebAssembly, y el archivo `data/plataforma.db` es un SQLite normal que puedes
> abrir con DB Browser for SQLite o mover a otro servidor.
4. Crea el archivo `.env` (copia `.env.example` y edítalo). Lo mínimo:

   ```
   APP_URL=https://tudominio.com
   SESSION_SECRET=una-cadena-larga-y-aleatoria
   ```

5. Inicia la aplicación (**Start / Restart**).
6. Abre `https://tudominio.com` en tu navegador: la primera vez te muestra la pantalla de
   **Instalación** para crear al administrador. Solo aparece una vez.

> **Importante:** `APP_URL` debe ser la dirección real y definitiva del sitio, porque con ella se
> generan los enlaces que grabas en las etiquetas NFC. Si la cambias después, las etiquetas ya
> grabadas dejan de funcionar.

### Correo (invitaciones y recuperación de contraseña)

Con una cuenta de correo de tu dominio en Hostinger, agrega al `.env`:

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@tudominio.com
SMTP_PASS=la-contraseña-del-correo
SMTP_FROM="Estructura Metalica <no-reply@tudominio.com>"
```

Puedes probar la conexión en **Ajustes → Probar conexión de correo**.

Si no configuras el correo, la plataforma **sigue funcionando**: al invitar a alguien te muestra
el enlace de invitación en pantalla para que se lo mandes por WhatsApp.

---

## Uso local (para probar en tu computadora)

```bash
npm install
cp .env.example .env      # y edita APP_URL=http://localhost:3000
npm start
```

Abre `http://localhost:3000`.

---

## Cómo grabar la etiqueta NFC

1. En el proyecto, presiona **Copiar enlace** (o entra a *Enlaces NFC* para verlos todos).
2. En tu celular abre **NFC Tools** o **NXP TagWriter**.
3. Elige **Escribir → URL / Dirección web**, pega el enlace y acerca la etiqueta.
4. Recomendado: bloquea la etiqueta para que nadie la reescriba y pega el QR junto a ella
   (para celulares sin NFC).

---

## Formato del Excel de piezas

La fila de encabezados manda; **el orden de las columnas no importa**. Se reconocen estos
nombres y sus variantes (singular/plural, con o sin acentos):

### Columnas de la pieza

| Columna | Se reconoce como | ¿Obligatoria? |
|---|---|---|
| **Marca** | Marca, Piece Mark, Part Mark, Pieza, Elemento, Clave, Código | **Sí** |
| **Dibujo** | Dibujo, No. Dibujo, Plano, Drawing, DWG | No (pero muy recomendable) |
| **Descripción** | Descripción, Pieza, Elemento, Concepto, Detalle | No |
| **Perfil** | Perfil, Sección, Medida, Dimensión | No |
| **Material** | Material, Grado, Acero, Norma | No |
| **Cantidad** | Cantidad, Cant, Pzas, Qty | No (por defecto 1) |
| **Peso** | Peso, Kg — *se toma como el total del renglón* | **Sí** (o el total) |
| **Peso unitario** | Peso unitario, Peso c/u, Kg/pza | **Sí** (o el total) |
| **Peso total** | Peso total, Total kg, Kg total | **Sí** (o el unitario) |
| **Lote** | Lote, Fase, Etapa, Área, Zona, Nivel, Eje | No |

### Columnas del proyecto (opcionales, para llenar el alta automáticamente)

| Columna | Se reconoce como | Llena |
|---|---|---|
| **Nombre Proyecto** | Nombre Proyecto, Project Name | El nombre del proyecto |
| **Proyecto** | Proyecto, Orden de trabajo, Shop Order, Job | El código del proyecto |
| **Cliente** | Cliente, Customer | El cliente |
| **Code_Cliente** | Code_Cliente, Código Cliente | El código de cliente |

Si la hoja trae **Marca** y **Pieza** a la vez, *Marca* se usa como marca y *Pieza* como
descripción, sin importar cuál columna venga primero.

### Detalles útiles

- **Pegar en vez de subir:** en el paso 1 puedes copiar las filas en Excel (con encabezados)
  y pegarlas directo en pantalla, sin generar archivo.
- **Columna "Peso" a secas:** se toma como el **peso total del renglón** (no por pieza), que es como
  lo entrega el sistema de ingeniería. El peso unitario se calcula solo dividiendo entre la cantidad.
  En el alta puedes cambiar esa interpretación si algún archivo viene al revés; al cambiarla se
  recalcula todo y te muestra un ejemplo con tus propios números. Una columna llamada
  *"Peso unitario"* siempre se entiende como peso por pieza.
- Si falta el peso total, se calcula con `unitario × cantidad` (y al revés).
- **Decimales:** se analiza la columna completa para decidir si el punto es decimal o separador de
  miles. Así `417.726` junto a `995.629656` se entiende bien como 417.726 kg, no como 417 726 kg.
  Acepta `1.234,50`, `1,234.50`, `850,25` y `12 500,75 kg`.
- Los guiones sueltos al final de una marca se quitan: `UPPER HV CLAMP-` → `UPPER HV CLAMP`.
- Las filas de **TOTAL / SUMA** al final se ignoran solas.
- Si una marca se repite (mismo lote), se suman sus cantidades y pesos en un solo renglón.
- Acepta `.xlsx`, `.xls` y `.csv` (con coma, punto y coma o tabulador).
- Los encabezados pueden estar en cualquiera de las primeras 20 filas — no importa si arriba
  traes el título del proyecto o el logo.

---

## Cómo se vinculan los planos con las piezas

La plataforma revisa el **nombre de cada archivo** (y su subcarpeta) buscando primero el
**número de dibujo** y, si la pieza no tiene, su **marca**.

| Dato en el Excel | Archivos que sí reconoce | Archivos que NO |
|---|---|---|
| Dibujo `1ZXX461026C8242` | `1ZXX461026C8242.pdf`, `1ZXX-461026-C8242 rev2.pdf` | `1ZXX461026C82420.pdf` |
| Marca `V-101` | `V-101.pdf`, `V101_rev2.pdf`, `TRABE V 101.dxf`, `v_101.dwg` | `V-1010.pdf` |
| Marca `C1` | `C1.pdf`, `Columna C-1 montaje.pdf` | `C12.pdf` |

Los guiones, puntos, guiones bajos y espacios son indistintos: `1ZXX-461026-C8242` y
`1ZXX461026C8242` se consideran el mismo dibujo.

Si un plano quedó sin vincular, corrige el nombre del archivo, vuelve a subirlo y usa el botón
**Revincular** en la pestaña de Documentos del proyecto.

---

## El visor de Autodesk

Pega en el proyecto el enlace público que te da Autodesk al compartir el modelo.

- Si el enlace es de **A360 / Autodesk Viewer** con permiso para incrustarse, el modelo se
  muestra **dentro** de la página (botón *Mostrar visor*).
- Si el dominio no permite incrustarse (pasa con algunos enlaces de ACC / BIM 360), se muestra un
  **botón grande** que abre el modelo en una pestaña nueva. Funciona igual de bien desde el celular.

---

## Tipos de cuenta

| | Usuario | Administrador |
|---|---|---|
| Ver proyectos, planos y piezas | ✔ | ✔ |
| Marcar el checklist | ✔ | ✔ |
| Descargar el avance | ✔ | ✔ |
| Dar de alta proyectos y subir archivos | | ✔ |
| Generar enlaces NFC y códigos QR | | ✔ |
| Dar de alta y administrar usuarios | | ✔ |

Las altas siempre son por invitación: el administrador captura nombre y correo, y la persona
recibe un enlace personal (vence en 7 días) para crear su propia contraseña.

---

## Respaldos

Todo lo importante vive en dos carpetas:

- `data/` — base de datos (usuarios, proyectos, piezas, checklist).
- `storage/projects/` — los archivos subidos (planos, PDFs de soldadura).

Cópialas periódicamente. Para mover la plataforma a otro servidor, basta con llevarte esas dos
carpetas junto con el código y el `.env`.

---

## Estructura del proyecto

```
server.js              Arranque del servidor y middlewares
src/
  db.js                Base de datos SQLite y esquema
  auth.js              Sesiones, contraseñas y permisos
  mailer.js            Correos de invitación y recuperación
  importer.js          Lectura del Excel/CSV de piezas
  storage.js           Subida de archivos y vínculo plano-pieza
  utils.js             Utilerías (slug, formatos, visor Autodesk)
  icons.js             Iconos SVG
  routes/
    auth.routes.js     Entrar, salir, alta, recuperar contraseña
    admin.routes.js    Tablero, proyectos, usuarios, ajustes
    project.routes.js  Página del proyecto (NFC), checklist, archivos
views/                 Pantallas (EJS)
public/                Estilos y JavaScript del navegador
data/                  Base de datos
storage/projects/      Archivos de cada proyecto
```

---

## Preguntas frecuentes

**¿Se puede usar sin NFC?**
Sí. Cada proyecto tiene su código QR y su enlace, que puedes mandar por WhatsApp o correo.

**¿Qué pasa si dos personas marcan la misma pieza?**
El checklist es del proyecto, no de cada persona: se guarda quién marcó cada etapa y cuándo,
y todos ven el mismo avance en tiempo real al recargar.

**¿Puedo cambiar las etapas del checklist?**
Sí, por proyecto. Desde *Piezas → Etapas del checklist* escribe las que quieras separadas por
comas (por ejemplo: `Habilitado, Armado, Soldado, Pintura, Embarcado`).

**Un archivo pesa más de 200 MB.**
Sube el límite con `MAX_FILE_MB` en el `.env`. Considera el espacio de tu plan de hosting.

**¿Aguanta proyectos grandes?**
Sí. Un proyecto de 1 500 piezas con 3 etapas de checklist y 300 planos se da de alta en
~3 segundos, la página pesa 65 KB comprimidos en el celular y cada palomita se guarda en ~16 ms.

**¿Cómo doy de baja a alguien que ya no trabaja aquí?**
En *Usuarios*, con el candado lo desactivas (conserva su historial) o con el bote lo eliminas.
