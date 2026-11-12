# Plan de implementación — Inventario del hogar en Google Drive

Aplicación web (PWA, *mobile-first*) para inventariar los objetos de casa en
contenedores anidados. No tiene servidor propio: todo el código llega al
navegador y los datos se guardan en la carpeta de datos de aplicación
(`appDataFolder`) del Google Drive del usuario.

- URL de producción: <https://inventario.linaresdigital.com>
- Despliegue: GitHub Actions → GitHub Pages con dominio personalizado.

## 1. Decisiones principales

| Tema | Decisión |
|---|---|
| Framework | Angular (última versión estable), componentes *standalone*, *signals*, Angular Material |
| Almacenamiento | Un archivo de Drive por entidad en `appDataFolder`, con los datos en los **metadatos** del archivo |
| Consultas | En memoria, en el cliente, sobre el inventario completo cargado con `files.list` |
| Concurrencia | Escrituras atómicas por entidad (`PATCH`) + sondeo incremental con `changes.list` |
| Autenticación | Google Identity Services (modelo de token, sin secreto de cliente) |
| Permiso (scope) | Solo `https://www.googleapis.com/auth/drive.appdata` |
| Caché local | Solo el *app shell* (service worker) y las fotografías. Nunca la estructura ni las ubicaciones |
| Hosting | GitHub Pages |

## 2. Estudio: ¿hoja de cálculo, árbol de directorios u otro método?

### 2.1 Alternativas evaluadas

| Alternativa | Consultas | Concurrencia entre dispositivos | Encaje con `appDataFolder` | Veredicto |
|---|---|---|---|---|
| **A. Hoja de cálculo de Google** (Sheets API / lenguaje de consulta de Visualization) | Buenas en teoría (`select … where …`) | Buena por celda/fila | **Malo**: `appDataFolder` está pensado para archivos de la aplicación, no para documentos de Google Workspace; además exige un permiso adicional (`drive.file` o `spreadsheets`) y la hoja queda visible y editable a mano por el usuario | Descartada |
| **B. Un único `inventario.json`** | Triviales en memoria | **Mala**: cada escritura reemplaza el archivo entero y Drive v3 no ofrece un «comparar e intercambiar» fiable; dos dispositivos se pisan cambios | Bueno | Descartada |
| **C. Árbol de carpetas real de Drive** (contenedor = carpeta, objeto = archivo) | Hay que listar igualmente todo | Buena (mover = cambiar `parents`) | Bueno | Viable, pero borrar una carpeta arrastra a sus descendientes sin papelera y acopla el modelo a la semántica de carpetas de Drive |
| **D. Un archivo por entidad, plano, con datos en metadatos** (`name`, `description`, `appProperties`) | Triviales en memoria tras un `files.list` paginado | **Muy buena**: cada cambio es un `PATCH` atómico sobre un solo archivo; las propiedades se fusionan por clave | Bueno | **Elegida** |
| **E. Instantánea + registro de operaciones** (*event sourcing*) | En memoria tras reproducir el registro | Muy buena | Bueno | Sobredimensionada para este caso; queda como evolución posible |

### 2.2 Por qué no la hoja de cálculo

La ventaja aparente de la hoja de cálculo es el lenguaje de consulta. En la
práctica no compensa:

1. **Volumen**: un inventario doméstico tiene cientos o pocos miles de
   entradas. Filtrar y buscar en memoria es instantáneo y mucho más flexible
   (búsqueda difusa, ruta completa del contenedor, etc.) que una consulta
   remota.
2. **La jerarquía es recursiva** («¿en qué habitación está esto?»). El lenguaje
   de consulta de las hojas no hace recorridos de árbol; habría que traerse
   igualmente todas las filas.
3. **Rompe el requisito de `appDataFolder`** y obliga a pedir permisos más
   amplios.
4. Mover una fila o borrarla en una hoja desde dos dispositivos obliga a
   gestionar índices de fila que cambian, lo cual es más frágil que un archivo
   con identificador estable.

### 2.3 Diseño elegido (alternativa D)

Cada contenedor, objeto, tipo de contenedor y fotografía es **un archivo** en
`appDataFolder`. Los archivos de contenedores, objetos y tipos no necesitan
contenido: sus datos viven en los metadatos, que `files.list` devuelve en
bloque (hasta 1000 archivos por página) sin descargar nada más.

| Dato | Campo de Drive |
|---|---|
| Identificador | `id` del archivo (pregenerado con `files.generateIds`, `space=appDataFolder`) |
| Nombre | `name` |
| Notas / descripción | `description` |
| Clase de entidad | `appProperties.k` = `c` (contenedor), `o` (objeto), `t` (tipo), `f` (foto) |
| Contenedor padre | `appProperties.p` = id del padre (ausente = raíz) |
| Tipo de contenedor | `appProperties.t` = id del tipo |
| Cantidad (objetos) | `appProperties.q` |
| Foto principal | `appProperties.f` = id del archivo de foto |
| Etiquetas | `appProperties.g` (lista corta separada por comas) |
| Borrado lógico | `appProperties.d` = marca de tiempo |
| Versión de esquema | `appProperties.v` |
| Fechas | `createdTime`, `modifiedTime` (las mantiene Drive) |

Las claves son de una letra porque cada propiedad admite como máximo 124 bytes
(clave + valor en UTF-8) y hay un máximo de 30 propiedades privadas por archivo.

Las **fotografías** son archivos con contenido binario (imagen redimensionada
en el cliente a ~1600 px y miniatura de ~320 px), con `appProperties.k = f` y
`appProperties.p` = id de la entidad a la que pertenecen.

Los **tipos de contenedor** (`k = t`) llevan nombre, icono (`appProperties.i`)
y orden (`appProperties.o`). En el primer arranque se crean los tipos por
defecto: Casa, Habitación, Armario y Caja.

**Mover** un contenedor (con todo su contenido) o un objeto es un único
`PATCH` que cambia `appProperties.p`. Nada más se toca, por lo que el
movimiento es atómico y no entra en conflicto con ediciones de otras entidades.

**Borrar**: los archivos de `appDataFolder` no pasan por la papelera de Drive,
así que el borrado es lógico (`appProperties.d`); la aplicación ofrece una
papelera propia y purga definitivamente lo borrado hace más de 30 días. Un
contenedor solo se puede borrar vacío, o reubicando antes su contenido en el
contenedor padre.

## 3. Funcionamiento simultáneo desde varios dispositivos

Requisito: mínimo dos dispositivos a la vez, sin caché local de ubicaciones.

1. **Sin estado persistente de datos**: el inventario vive solo en memoria
   (almacén de *signals*). Cada arranque hace una carga completa con
   `files.list` (`spaces=appDataFolder`, campos mínimos, paginado).
2. **Sincronización incremental**: tras la carga se guarda un
   `startPageToken` y se consulta `changes.list` (`spaces=appDataFolder`):
   - cada 20 s mientras la aplicación esté visible;
   - al recuperar el foco, la visibilidad o la conexión;
   - inmediatamente antes de abrir el diálogo de mover y después de cada
     escritura propia.
3. **Escrituras**: siempre `PATCH` parcial sobre un archivo. Dos dispositivos
   que editen entidades distintas no interfieren nunca. Si editan la misma
   entidad, gana la última escritura **por campo** (Drive fusiona
   `appProperties` clave a clave), y el otro dispositivo ve el resultado en el
   siguiente sondeo.
4. **Detección de edición obsoleta**: el formulario de edición recuerda el
   `modifiedTime` con el que se abrió; si al guardar ha cambiado, se avisa y se
   muestran los valores actuales antes de sobrescribir.
5. **Ciclos**: la interfaz impide mover un contenedor dentro de sí mismo o de
   un descendiente. Dos movimientos simultáneos cruzados podrían aun así crear
   un ciclo; al cargar y tras cada sondeo se valida el árbol y, si hay un
   ciclo o un padre inexistente, la entidad afectada se muestra en
   «Sin ubicar» para que el usuario la recoloque.
6. **Sin conexión**: la aplicación es solo en línea. Sin red se muestra un
   aviso y se deshabilita la escritura; no hay cola de cambios pendientes.

**Cuenta compartida**: `appDataFolder` es privado por cuenta de Google y no se
puede compartir, así que el inventario se usa con **una cuenta de Gmail común
de la casa**, no con la personal de cada miembro. Todos los dispositivos
inician sesión con esa cuenta. Consecuencias:

- No hay autoría por persona: Drive atribuye todos los cambios a la misma
  cuenta.
- La cuota por usuario de la API (§3.1) se reparte entre todos los
  dispositivos.
- En cada dispositivo la aplicación solo obtiene el permiso `drive.appdata`,
  pero quien inicia sesión necesita la contraseña de la cuenta común; conviene
  que esa cuenta no se use para nada más.
- Mientras la aplicación esté en estado *Prueba* en Google Cloud, basta con
  añadir esa única cuenta como usuario de prueba.

### 3.1 Coste de la API y del sondeo

Datos de la [guía de límites de la API de Drive](https://developers.google.com/workspace/drive/api/guides/limits)
consultada el 11-11-2026 (cuotas vigentes para proyectos creados desde el
1-5-2026):

- El uso estándar de la API **no tiene coste**. Google ha anunciado que el
  exceso sobre **400 000 000 unidades de cuota al día por proyecto** pasará a
  facturarse «más adelante en 2026», con al menos 90 días de aviso. Por debajo
  de ese umbral no se cobra.
- Cada llamada consume unidades: lectura 5, listado 100, edición 50,
  descarga 200.
- Límites por minuto: 1 000 000 unidades por proyecto y 325 000 por usuario.
  Superarlos no genera cargos: devuelve un error 403/429 y se reintenta con
  espera exponencial.

Consumo previsto (tomando `changes.list` como «listado», el caso más caro):

| Concepto | Unidades |
|---|---|
| Un sondeo | 100 |
| Un dispositivo con la aplicación visible, por minuto (3 sondeos) | 300 (0,09 % del límite por usuario) |
| Un dispositivo con la aplicación visible **24 h seguidas** | 432 000 al día |
| Umbral gratuito diario | 400 000 000 (≈ 925 dispositivos abiertos 24 h) |
| Carga inicial de 5 000 entidades (5 páginas) | 500 |

El sondeo solo corre con la aplicación en primer plano, por lo que el consumo
real de una casa queda varios órdenes de magnitud por debajo del umbral. **No
hace falta asociar una cuenta de facturación al proyecto de Google Cloud**, y
sin ella no puede generarse ningún cargo.

El único consumo real es el **almacenamiento** de la cuenta compartida (15 GB
gratuitos): los archivos de contenedores y objetos no tienen contenido (a
confirmar en la fase 0 que ocupan 0 bytes) y cada fotografía ocupa unos
200–400 kB más su miniatura, es decir, unas 3 000 fotos por GB.

Si el inventario se llegara a compartir entre cuentas distintas, habría que
migrar a una carpeta visible con el permiso `drive.file`; la capa de
repositorio (§5.3) se aísla precisamente para que ese cambio no afecte al
resto.

## 4. Framework de frontal

**Recomendación: Angular**, que coincide con la preferencia inicial.

| Criterio | Angular | Alternativas (SvelteKit, Vue + Vite) |
|---|---|---|
| PWA / service worker | Integrado (`@angular/pwa`, `ngsw-config.json`) | Complemento externo (`vite-plugin-pwa`) |
| Componentes móviles | Angular Material (Material 3) y CDK oficiales | Bibliotecas de terceros |
| Enrutado, formularios, HTTP, pruebas | Incluidos y coherentes | A elegir y ensamblar |
| Estado | *Signals* nativos, suficiente sin NgRx | Equivalente |
| Tamaño del paquete | Mayor (aceptable tras la primera carga gracias al service worker) | Menor |

El único punto a favor de las alternativas es el tamaño inicial, que en una
PWA instalada apenas importa. Angular evita decisiones de integración y tiene
ciclo de versiones predecible.

Dependencias previstas: `@angular/material`, `@angular/cdk`,
`@angular/service-worker`. Sin SDK de Google: se usa el script de Google
Identity Services y llamadas REST directas a Drive con `HttpClient`.

## 5. Arquitectura

### 5.1 Vista general

```
┌──────────────────────── Navegador (PWA) ────────────────────────┐
│  Componentes de interfaz (Angular Material)                      │
│        │                                                         │
│  InventoryStore (signals, solo memoria) ──► consultas / árbol    │
│        │                                                         │
│  SyncService (changes.list)   PhotoService ──► Cache Storage     │
│        │                           │                             │
│  InventoryRepository (interfaz) ◄──┘                             │
│        │                                                         │
│  DriveApiService (REST v3) ◄── interceptor de autenticación      │
│        │                              │                          │
│  Service worker (solo app shell)   AuthService (GIS)             │
└────────┼──────────────────────────────┼──────────────────────────┘
         ▼                              ▼
  www.googleapis.com/drive/v3    accounts.google.com
```

### 5.2 Estructura del repositorio

```
poc/index.html            prueba de concepto de la fase 0 (página estática)
.github/workflows/
  ci.yml                  lint + pruebas + build en cada PR
  deploy.yml              build + despliegue a GitHub Pages desde master
scripts/
  set-env.mjs             genera environment.ts a partir de variables de entorno
src/
  environments/           environment.ts (desarrollo) / generado en CI
  app/
    core/
      auth/               AuthService, authInterceptor, authGuard
      drive/              DriveApiService, tipos de la API
      inventory/          modelos, InventoryRepository, DriveInventoryRepository,
                          InventoryStore, SyncService, tree-utils
      photos/             PhotoService (redimensionado, subida, caché)
      pwa/                UpdateService, ConnectivityService
    features/
      login/              pantalla de inicio de sesión
      browse/             navegación por contenedores (pantalla principal)
      search/             búsqueda global
      entity-form/        alta/edición de contenedor y objeto
      move/               selector de destino
      settings/           tipos de contenedor, exportar/importar, cerrar sesión
      trash/              papelera
    shared/               breadcrumb, tarjeta de entidad, selector de tipo,
                          visor de fotos, diálogos de confirmación
  manifest.webmanifest
ngsw-config.json
```

### 5.3 Servicios

- **`AuthService`**: carga `https://accounts.google.com/gsi/client` bajo
  demanda y crea el cliente de token
  (`google.accounts.oauth2.initTokenClient`) con el identificador de cliente y
  el permiso `drive.appdata`. Guarda el token de acceso en memoria y en
  `sessionStorage` (para sobrevivir a una recarga) con su caducidad, y el
  correo de la cuenta en `localStorage` como pista para el siguiente inicio.
  Expone `signIn()`, `signOut()`, `validToken()`, `renew()` y las señales
  `status` (`signedOut`, `signedIn`, `expired`) y `user`. Los datos del
  usuario se obtienen de `about.get?fields=user` de Drive, sin pedir más
  permisos. **`signOut()` no revoca el permiso en Google**: la cuenta es
  compartida y revocarlo invalidaría la sesión de los demás dispositivos;
  solo borra la sesión local.
- **`authInterceptor`**: añade `Authorization: Bearer …` a las llamadas a
  `googleapis.com`. Ante un 401 intenta una renovación silenciosa
  (`requestAccessToken({prompt: '', login_hint: correo})`, para que Google no
  muestre el selector de cuentas) y reintenta una vez; si el navegador
  bloquea la ventana por no haber gesto del usuario, la sesión pasa a
  `expired` y la barra superior muestra un aviso con el botón
  «Reanudar sesión».
- **`DriveApiService`**: envoltorio fino de la API REST v3 (`files.list`,
  `files.create`, `files.update`, `files.delete`, `files.generateIds`,
  `files.get?alt=media`, subida `multipart`, `changes.getStartPageToken`,
  `changes.list`). Reintentos con espera exponencial ante 429/5xx.
- **`InventoryRepository`** (interfaz) y **`DriveInventoryRepository`**:
  traducen entre el modelo de dominio y los metadatos de Drive (§2.3). Es la
  única capa que conoce el formato de almacenamiento.
- **`InventoryStore`**: estado en memoria con *signals*: mapa de entidades por
  id, índice de hijos por padre, tipos; señales derivadas para ruta
  (*breadcrumb*), contenido de un contenedor, recuento recursivo, resultados
  de búsqueda y entidades sin ubicar.
- **`SyncService`**: carga inicial, sondeo de cambios (§3) y aplicación de los
  cambios al almacén.
- **`PhotoService`**: captura (`<input type="file" accept="image/*"
  capture="environment">`), redimensionado en `canvas`, subida y descarga con
  token; guarda los binarios en Cache Storage indexados por id de archivo
  (inmutables: una foto nueva es un archivo nuevo).
- **`UpdateService`**: avisa de nueva versión de la aplicación (`SwUpdate`).

### 5.4 Modelo de dominio

```ts
type EntityId = string;                       // id de archivo de Drive

interface ContainerType { id: EntityId; name: string; icon: string; order: number; }

interface BaseEntity {
  id: EntityId;
  name: string;
  notes: string;
  parentId: EntityId | null;                  // null = raíz
  photoId: EntityId | null;
  tags: string[];
  createdAt: string;
  modifiedAt: string;
  deletedAt: string | null;
}
interface Container extends BaseEntity { kind: 'container'; typeId: EntityId; }
interface Item      extends BaseEntity { kind: 'item'; quantity: number; }
```

### 5.5 Pantallas y rutas

| Ruta | Pantalla |
|---|---|
| `/login` | Botón «Iniciar sesión con Google» y explicación del permiso |
| `/` | Contenedores raíz (casas) |
| `/c/:id` | Contenido de un contenedor: ruta, subcontenedores, objetos, botón flotante de alta |
| `/o/:id` | Ficha de un objeto |
| `/buscar` | Búsqueda por nombre, notas y etiquetas; cada resultado muestra su ruta completa |
| `/sin-ubicar` | Entidades huérfanas o en ciclo |
| `/papelera` | Restaurar o eliminar definitivamente |
| `/ajustes` | Tipos de contenedor, exportar/importar copia en JSON, sesión |

Pautas de interfaz: una columna, barra inferior de navegación (Inicio, Buscar,
Ajustes), acciones principales al alcance del pulgar, diálogos a pantalla
completa en móvil; a partir de 840 px, disposición en dos paneles (árbol +
detalle). Mover: acción «Mover a…» que abre un selector de destino con el
mismo navegador de contenedores, excluyendo el propio contenedor y sus
descendientes. Las rutas `/c/:id` son estables, lo que permite más adelante
imprimir etiquetas con código QR para las cajas.

### 5.6 PWA y service worker

- `manifest.webmanifest`: `display: standalone`, iconos 192/512 y
  *maskable*, `start_url: /`, idioma `es`.
- `ngsw-config.json`: precarga del *app shell* y recursos estáticos. **No** se
  declaran `dataGroups` para `googleapis.com`: las respuestas de Drive nunca se
  sirven desde caché.
- Política de seguridad de contenido (meta CSP en `src/index.html`):
  `script-src 'self' https://accounts.google.com/gsi/client`; `connect-src
  'self' https://www.googleapis.com https://accounts.google.com`; `frame-src
  https://accounts.google.com`; `img-src 'self' blob: data:
  https://*.googleusercontent.com`; estilos y fuentes de Google Fonts. La
  compilación de producción desactiva el CSS crítico en línea
  (`inlineCritical: false`) porque usa un manejador `onload` que la política
  bloquearía.

## 6. Configuración y despliegue

### 6.1 Configuración en tiempo de compilación

El único valor de configuración es el identificador de cliente OAuth. No es un
secreto (viaja en el JavaScript de todos modos); su seguridad depende de los
orígenes autorizados configurados en Google. Se guarda como **variable** de
repositorio `GOOGLE_CLIENT_ID` y `scripts/set-env.mjs` la vuelca en
`src/environments/environment.ts` antes de compilar. En local se lee de un
archivo `.env` no versionado.

### 6.2 Flujos de GitHub Actions

`ci.yml` (en *pull requests*): `npm ci` → lint → pruebas unitarias → build.

`deploy.yml` (en `push` a `master` y manual):

```yaml
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: lts/*, cache: npm }
      - run: npm ci
      - run: node scripts/set-env.mjs
        env: { GOOGLE_CLIENT_ID: "${{ vars.GOOGLE_CLIENT_ID }}" }
      - run: npm test -- --watch=false
      - run: npx ng build --configuration production
      - run: cp dist/inventario-drive/browser/index.html dist/inventario-drive/browser/404.html
      - uses: actions/upload-pages-artifact@v5
        with: { path: dist/inventario-drive/browser }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }
    steps:
      - id: d
        uses: actions/deploy-pages@v5
```

(Usar las versiones mayores vigentes de cada acción al implementarlo.) La copia
a `404.html` hace que GitHub Pages sirva la aplicación en rutas profundas
como `/c/abc`.

### 6.3 Infraestructura

- DNS: registro `CNAME` `inventario.linaresdigital.com` → `ojgarciab.github.io`.
- GitHub → *Settings → Pages*: origen «GitHub Actions», dominio personalizado
  `inventario.linaresdigital.com`, «Enforce HTTPS» activado.
- Google Cloud: proyecto, API de Drive, pantalla de consentimiento y cliente
  OAuth web (detalle en `README.md`).

## 7. Fases de implementación

| Fase | Contenido | Criterio de aceptación |
|---|---|---|
| **0. Prueba de concepto** | Página mínima con GIS + `files.create`/`files.list`/`changes.list` en `appDataFolder` | Confirmados los supuestos de §9 |
| **1. Esqueleto** | `ng new`, Material, PWA, lint, pruebas, `ci.yml`, `deploy.yml`, dominio | «Hola mundo» instalable en la URL de producción |
| **2. Sesión** | `AuthService`, interceptor, guarda de rutas, pantalla de inicio de sesión | Inicio, renovación y cierre de sesión en móvil y escritorio |
| **3. Datos** | `DriveApiService`, repositorio, `InventoryStore`, tipos por defecto | Pruebas unitarias del mapeo y de las utilidades de árbol |
| **4. Navegación y altas** | Pantallas de contenedor y objeto, formularios, ruta | Crear casa → habitación → armario → caja → objeto |
| **5. Mover y borrar** | Selector de destino, papelera, sin ubicar | Mover una caja entre armarios; el contenido la acompaña |
| **6. Sincronización** | `SyncService`, aviso de edición obsoleta, estado sin conexión | Un cambio en un dispositivo aparece en el otro en < 30 s |
| **7. Búsqueda** | Búsqueda global con ruta en resultados | Encontrar un objeto y ver dónde está en dos toques |
| **8. Fotografías** | Captura, redimensionado, subida, caché | Foto visible en un segundo dispositivo; sin nueva descarga al reabrir |
| **9. Ajustes** | Tipos configurables, exportar/importar JSON | Añadir tipo «Estantería»; copia de seguridad restaurable |
| **10. Pulido** | Accesibilidad, Lighthouse, iconos, aviso de actualización | Lighthouse PWA/Accesibilidad ≥ 90 |

Posibles ampliaciones: etiquetas QR para contenedores, lector de QR, inventario
compartido entre cuentas (`drive.file`), historial de movimientos.

## 8. Pruebas

- **Unitarias**: mapeo entidad ↔ metadatos de Drive, utilidades de árbol
  (ruta, descendientes, detección de ciclos), aplicación de cambios en el
  almacén, lógica de renovación del interceptor. `DriveApiService` se prueba
  con `HttpTestingController`.
- **Componentes**: formularios y selector de destino con un repositorio en
  memoria (`InMemoryInventoryRepository`), que sirve también para desarrollar
  sin cuenta de Google.
- **Manual de concurrencia**: lista de comprobación con dos dispositivos
  (alta, movimiento, edición simultánea de la misma entidad, movimiento
  cruzado).

## 9. Supuestos a verificar en la fase 0 y riesgos

| Supuesto / riesgo | Si no se cumple |
|---|---|
| `changes.list` con `spaces=appDataFolder` informa de cambios de metadatos | Sondeo con `files.list` filtrando por `modifiedTime` |
| `about.get` funciona solo con el permiso `drive.appdata` | Añadir los permisos `openid profile email` |
| Longitud admitida por `description` suficiente para notas | Guardar las notas en el contenido del archivo y cargarlas al abrir la ficha |
| `files.generateIds` admite `space=appDataFolder` | Crear primero y usar el id devuelto |
| La renovación silenciosa del token puede requerir gesto del usuario (sobre todo en iOS) | Ya previsto: botón «Reanudar sesión» |
| Los datos de `appDataFolder` están ligados al proyecto de Google Cloud: si se elimina el proyecto, o el usuario borra los datos ocultos de la aplicación desde la configuración de Drive, se pierden | Exportación a JSON desde Ajustes; no eliminar ni sustituir el proyecto de Cloud |
| Cuotas y futura facturación del exceso de la API de Drive (§3.1) | Consumo muy inferior al umbral gratuito; proyecto sin cuenta de facturación; reintentos con espera exponencial; el intervalo de sondeo es configurable |

La fase 0 se ejecuta con la página `poc/index.html` (instrucciones en el
`README.md`).

### 9.1 Resultados de la fase 0 (11-11-2026)

Ejecutada contra la API real con el proyecto `inventario-hogar`.

| Supuesto | Resultado |
|---|---|
| `about.get` solo con `drive.appdata` | Confirmado: devuelve nombre, correo y foto |
| `files.generateIds` con `space=appDataFolder` | Confirmado; el id pregenerado se respeta al crear |
| Archivo solo con metadatos | Confirmado: `size=0` y `quotaBytesUsed=0`, no consume almacenamiento |
| `files.list` devuelve todos los metadatos | Confirmado |
| `PATCH` fusiona `appProperties` por clave | Confirmado; además `modifiedTime` cambia con cambios de metadatos, así que sirve para detectar ediciones obsoletas |
| `changes.list` en `appDataFolder` | Confirmado: el cambio aparece entre 0,4 y 2,7 s después (dos ejecuciones) con los metadatos nuevos; los borrados llegan con `removed=true` |
| Longitud de `description` | Admite 16 000 caracteres de 2 bytes y rechaza 32 000. **Decisión**: las notas se limitan a 8 000 caracteres en el formulario (margen suficiente aunque el límite sea en bytes) |
| Límite de `appProperties` | Confirmado: 124 bytes admitido, 125 rechazado |
| Subida `multipart` y descarga de fotos | Confirmado; la foto ocupa exactamente sus bytes |
| Hoja de cálculo en `appDataFolder` | Confirmado que no es posible: «Method not supported for files within the Application Data folder» |
| Renovación silenciosa del token | Sin `login_hint` Google muestra el selector de cuentas; con `login_hint` se obtiene un token nuevo en ~2 s sin intervención. **Decisión**: `AuthService` guarda el correo de la sesión y lo pasa como `login_hint`. Probado en escritorio; falta comprobarlo en móvil (fase 2) |
