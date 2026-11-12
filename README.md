# Inventario del hogar

Aplicación web para saber qué hay en casa y dónde está. Los objetos se guardan
en contenedores, y los contenedores pueden estar dentro de otros contenedores:

```
Casa
└── Dormitorio            (habitación)
    └── Armario empotrado (armario)
        ├── Caja de cartón (caja)
        │   └── Adornos de Navidad
        └── Maleta azul
```

- Los tipos de contenedor son configurables (por defecto: casa, habitación,
  armario y caja).
- Un contenedor se puede trasladar a otro con todo su contenido (por ejemplo,
  una caja de un armario a otro de otra habitación).
- Búsqueda de objetos mostrando la ruta completa hasta ellos.
- Fotografías de objetos y contenedores.

## Cómo funciona

- **Sin servidor**: es una aplicación estática (Angular). Todo el código se
  ejecuta en el navegador.
- **Los datos son suyos**: se guardan en la carpeta de datos de aplicación
  (`appDataFolder`) del Google Drive de quien inicia sesión. La aplicación
  solo pide el permiso `drive.appdata`, por lo que **no puede ver ni tocar el
  resto de archivos de su Drive**.
- **Varios dispositivos a la vez**: cualquier cambio hecho en un dispositivo
  aparece en los demás en unos segundos. La ubicación de los objetos nunca se
  guarda en caché local; solo las fotografías.
- **Instalable**: es una PWA con *service worker* y diseño *mobile-first*.
  Necesita conexión para funcionar.
- Hay que iniciar sesión con una cuenta de Google. El inventario es privado de
  esa cuenta y no se puede compartir con otras, así que se usa **una cuenta de
  Gmail común de la casa** en todos los dispositivos, no la personal de cada
  miembro.
- **Sin costes**: la API de Drive es gratuita para este volumen de uso y el
  proyecto de Google Cloud no necesita cuenta de facturación. Solo se consume
  espacio de almacenamiento de la cuenta común, básicamente por las
  fotografías (detalle en la sección 3.1 del plan).

Producción: <https://inventario.linaresdigital.com>

El diseño detallado, la arquitectura y las fases de implementación están en
[Plan.md](Plan.md).

> **Estado**: fase 6 (sincronización entre dispositivos). Ya se pueden crear,
> editar, mover y eliminar contenedores y objetos, y los cambios de otros
> dispositivos aparecen solos; faltan la búsqueda y las fotografías.

## Prueba de concepto (fase 0)

[poc/index.html](poc/index.html) es una página estática que comprueba contra
la API real los supuestos del plan: crea unos archivos de prueba en
`appDataFolder`, los modifica, verifica el aviso de cambios y los borra.

1. Cree el cliente OAuth (apartado 1 de la sección siguiente) con
   `http://localhost:4200` entre los orígenes autorizados.
2. Sirva la página en ese puerto:

   ```bash
   python3 -m http.server 4200 --bind 127.0.0.1 --directory poc
   ```

3. Abra <http://localhost:4200>, pegue el identificador de cliente, inicie
   sesión con la cuenta común y pulse «Ejecutar pruebas».
4. Pasada una hora (cuando el token haya caducado) o en cualquier momento,
   pulse «Renovar token en silencio» para comprobar la renovación.

## Puesta en marcha de una instancia propia

Para desplegar su propia copia necesita tres cosas: un cliente OAuth de
Google, una variable en el repositorio de GitHub y GitHub Pages con el dominio
configurado.

### 1. Proyecto y credenciales en Google Cloud

La aplicación es un cliente público: no hay *backend* que pueda guardar un
secreto, así que se usa un cliente OAuth de tipo «Aplicación web» **sin
secreto de cliente** y sin clave de API. Lo único que se configura es el
identificador de cliente, que es público.

1. **Crear el proyecto**. En <https://console.cloud.google.com/> abra el
   selector de proyectos → *Proyecto nuevo*. Nombre sugerido:
   `inventario-hogar`.

   > Los datos de cada usuario quedan asociados a este proyecto. Si lo elimina
   > o cambia a un cliente OAuth de otro proyecto, la aplicación dejará de ver
   > los inventarios existentes.

2. **Habilitar la API de Drive**. *APIs y servicios → Biblioteca* → busque
   «Google Drive API» → *Habilitar*.

3. **Configurar la pantalla de consentimiento**. *Google Auth Platform*
   (antes «Pantalla de consentimiento de OAuth»):
   - **Información de la marca** (*Branding*): nombre de la aplicación, correo
     de asistencia, y en *Dominios autorizados* añada `linaresdigital.com`
     (su dominio, sin subdominio).
   - **Público** (*Audience*): tipo de usuario **Externo**.
     - En estado *Prueba* solo podrán entrar las cuentas que añada como
       *usuarios de prueba* (máximo 100). Para uso en casa basta con añadir
       la cuenta común.
     - Para abrirla a cualquiera, pulse *Publicar aplicación*. El permiso que
       se solicita no es sensible ni restringido, así que no hace falta la
       revisión de seguridad de Google; solo se le pedirá verificar la marca
       si quiere mostrar logotipo.
   - **Acceso a los datos** (*Data Access*) → *Agregar o quitar permisos* →
     marque únicamente:

     ```
     https://www.googleapis.com/auth/drive.appdata
     ```

     La lista está paginada de 10 en 10 y el permiso no sale en la primera
     página: escriba `appdata` en el campo *Filtro* y pulse Intro. Aparece
     como «Google Drive API — …/auth/drive.appdata». Márquelo, pulse
     *Actualizar* y después *Save* al pie de la página. (Solo se listan los
     permisos de las API habilitadas, por eso hay que habilitar antes la de
     Drive.)

4. **Crear el cliente OAuth**. *Google Auth Platform → Clientes → Crear
   cliente*:
   - Tipo de aplicación: **Aplicación web**.
   - **Orígenes de JavaScript autorizados**:

     ```
     https://inventario.linaresdigital.com
     http://localhost:4200
     ```

     (el segundo solo es necesario para desarrollo local).
   - **URI de redireccionamiento autorizados**: déjelo vacío. El inicio de
     sesión usa la ventana emergente de Google Identity Services y no
     necesita redirección.

5. **Copiar el identificador de cliente**. Tiene esta forma:

   ```
   123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com
   ```

   El «secreto de cliente» que también muestra la consola **no se usa**: no lo
   copie al repositorio ni a ninguna variable.

La protección del identificador de cliente la dan los orígenes autorizados:
Google solo entrega credenciales a páginas servidas desde esos orígenes. Por
eso no es un secreto y puede ir en el código que recibe el usuario.

### 2. Variables del repositorio en GitHub

Solo hay una variable, y es una **variable** de Actions, no un secreto (acaba
publicada en el JavaScript de la aplicación en cualquier caso).

| Nombre | Tipo | Valor |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Variable de repositorio | Identificador de cliente OAuth del paso anterior |

Desde la web: *Settings → Secrets and variables → Actions → pestaña
Variables → New repository variable*.

Desde la terminal, con [GitHub CLI](https://cli.github.com/):

```bash
gh variable set GOOGLE_CLIENT_ID --body "123456789012-xxxxxxxx.apps.googleusercontent.com"
```

Para comprobarla:

```bash
gh variable list
```

El flujo de despliegue la lee como `${{ vars.GOOGLE_CLIENT_ID }}` y la inyecta
en la compilación. No hace falta ningún secreto: el despliegue a GitHub Pages
se autentica con el `GITHUB_TOKEN` que Actions genera automáticamente.

### 3. GitHub Pages y dominio

1. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
2. En el DNS del dominio, cree un registro `CNAME`:

   | Nombre | Tipo | Valor |
   |---|---|---|
   | `inventario` | `CNAME` | `<usuario-u-organización>.github.io.` |

3. *Settings → Pages → Custom domain*: `inventario.linaresdigital.com` →
   *Save*. Cuando GitHub termine de comprobar el DNS y emitir el certificado,
   active **Enforce HTTPS**.
4. Cada `push` a `master` compila y publica la aplicación. También se puede
   lanzar a mano desde la pestaña *Actions*.

Si usa otro dominio, recuerde cambiarlo en los tres sitios: orígenes de
JavaScript autorizados, dominios autorizados de la pantalla de consentimiento
y dominio personalizado de Pages.

## Desarrollo local

Requisitos: Node.js 24 (ver `.nvmrc`; Angular 22 exige 24.15 o posterior) y npm.

```bash
nvm use
```

```bash
npm ci
```

Cree un archivo `.env` (no se versiona) con el identificador de cliente:

```bash
echo 'GOOGLE_CLIENT_ID=123456789012-xxxxxxxx.apps.googleusercontent.com' > .env
```

```bash
npm start
```

La aplicación queda en <http://localhost:4200>, que debe figurar entre los
orígenes de JavaScript autorizados del cliente OAuth.

| Orden | Qué hace |
|---|---|
| `npm start` | Servidor de desarrollo con recarga |
| `npm test -- --watch=false` | Pruebas unitarias (Vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Compilación de producción en `dist/inventario-drive/browser` |

Para probar la interfaz sin cuenta de Google, abra
<http://localhost:4200/?demo>: carga un inventario de ejemplo en memoria que
se pierde al recargar. Solo existe en el servidor de desarrollo; «Cerrar
sesión» sale de ese modo.

Todas ejecutan antes `scripts/set-env.mjs`, que genera
`src/environments/environment.ts` (no versionado) a partir de `.env` o de la
variable de entorno `GOOGLE_CLIENT_ID`. El service worker solo se activa en la
compilación de producción.

## Privacidad y copias de seguridad

- La aplicación no envía datos a ningún servidor distinto de Google.
- Los archivos de `appDataFolder` no aparecen en la interfaz de Drive. Se
  pueden eliminar en Drive → *Configuración → Gestionar aplicaciones* →
  *Eliminar datos ocultos de aplicaciones*; esa acción borra el inventario.
- Para revocar el acceso: <https://myaccount.google.com/permissions>.
- La aplicación incluirá exportación e importación del inventario en JSON
  para conservar copias propias.

## Licencia

[GPL-3.0](LICENSE).
