# Gestor de Adoraciones

Aplicación web para registrar, clasificar, aprobar y buscar canciones de YouTube, y preparar los enlaces exactos que se usarán en un culto o fin de semana.

## Arquitectura V1

- React + TypeScript + Vite
- Firebase Realtime Database
- Sin Firebase Authentication
- Código fijo de administración/aprobación en `VITE_ADMIN_CODE`
- GitHub + GitHub Actions
- GitHub Pages
- Sin backend, Cloud Functions, App Hosting ni servicios que requieran Blaze

## Desarrollo local

1. Instala Node.js 20+ (22 recomendado).
2. En la raíz del proyecto:

```bash
npm install
```

3. Copia `.env.example` a `.env.local` y completa la configuración de la Web App de Firebase y el código administrativo.
4. Inicia:

```bash
npm run dev
```

5. Build de comprobación:

```bash
npm run build
```

## Realtime Database

Crea un proyecto Firebase en Spark y luego una Realtime Database. Las rutas usadas son:

```text
/songs
/servicePlans
/config
```

El archivo `database.rules.json` contiene las reglas compatibles con esta arquitectura sin login.

### Nota importante sobre el código fijo

`VITE_ADMIN_CODE` cumple el flujo solicitado de pedir un código antes de aprobar, editar, borrar, guardar cultos o cambiar configuración. Como esta V1 es una app estática sin login ni backend, cualquier variable `VITE_*` termina dentro del JavaScript enviado al navegador. Por tanto, el código funciona como barrera de uso en la interfaz, no como un secreto criptográficamente protegido ante alguien técnico que inspeccione la aplicación.

Una protección real de permisos en Realtime Database requeriría una identidad verificable (por ejemplo Firebase Authentication) o un backend; ambos están fuera del requisito actual de “sin login”.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` compila y publica `dist/` cuando se hace push a `main`.

Configura estos GitHub Actions Secrets:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_ADMIN_CODE
```

Después, en GitHub > Settings > Pages, selecciona **GitHub Actions** como Source.
