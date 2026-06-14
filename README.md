# World Cup Bet

Web para gestionar una porra del Mundial 2026 con login email/password, predicciones, reestructuracion, bloqueo de escritura por Firestore y puntuacion en tiempo real.

## Stack

- Vite + React + TypeScript
- GitHub Pages para alojar la web estatica
- Firebase Authentication
- Cloud Firestore

Requisito local: Node.js 20 o superior. Si usas `nvm`, ejecuta `nvm use` en la raiz del repo.

## Enfoque de arquitectura

GitHub Pages aloja la aplicacion React ya compilada en `dist/`. No hay servidor propio, API backend ni infraestructura que mantener.

Firebase sigue siendo necesario, pero solo como backend administrado:

- **Firebase Authentication** valida usuarios con email/password.
- **Cloud Firestore** guarda equipos, partidos, predicciones, clasificacion y configuracion de bloqueo.
- **Firestore Rules** impiden escrituras cuando `app/config.writeEnabled` esta cerrado.

Las variables `VITE_FIREBASE_*` no son secretos de servidor: Firebase las usa para identificar la app web. La seguridad real esta en Authentication y Firestore Rules.

## Modelo de datos

### `app/config`

Configuracion global leida en tiempo real por todos los clientes.

```ts
{
  writeEnabled: boolean,
  writeScope: "initial" | "round32" | "round16" | "quarter" | "closed",
  activeRound: "group" | "round32" | "round16" | "quarter" | "semi" | "final",
  lockedMessage: "No se pueden actualizar datos en este momento",
  actualAwards: {
    championTeamId?: string,
    mvpName?: string,
    topScorerName?: string
  }
}
```

Si `writeEnabled` es `false`, las reglas de Firestore bloquean escritura en `bets/{uid}` para participantes. La UI muestra el mensaje exacto de `lockedMessage`.

En cliente, una porra con `status: "submitted"` queda bloqueada durante `writeScope: "initial"`. Vuelve a permitir cambios solo si el admin abre una ventana de reestructuracion (`round32`, `round16` o `quarter`).

### `users/{uid}`

```ts
{
  uid: string,
  displayName: string,
  email: string,
  role: "admin" | "participant"
}
```

Solo un admin puede promover usuarios a `admin`.

### `teams/{teamId}`

```ts
{
  id: string,
  name: string,
  shortName: string,
  group: string,
  flagCode: string,
  emoji: string
}
```

`flagCode` se usa con `https://flagcdn.com/w80/{flagCode}.png`. Para Inglaterra y Escocia se usa codigo regional `gb-eng` / `gb-sct` y fallback visual.

### `matches/{matchId}`

```ts
{
  id: string,
  order: number,
  round: "group" | "round32" | "round16" | "quarter" | "semi" | "final",
  group?: string,
  date?: string,
  venue?: string,
  homeTeamId?: string,
  awayTeamId?: string,
  homeSlot?: string,
  awaySlot?: string,
  actualHomeScore?: number,
  actualAwayScore?: number,
  winnerTeamId?: string,
  status: "scheduled" | "completed",
  predictionsLocked?: boolean
}
```

Los 72 partidos de fase de grupos estan presembrados. Las eliminatorias arrancan como slots `TBD` para actualizarlas cuando se confirme el cuadro.

Cuando `predictionsLocked` es `true`, la UI impide crear o modificar pronosticos de ese partido aunque el usuario siga en draft y aunque `app/config.writeEnabled` este abierto. Al introducir un resultado oficial desde el panel admin, el partido se bloquea automaticamente.

### `bets/{uid}`

```ts
{
  uid: string,
  displayName: string,
  status: "draft" | "submitted",
  matchPredictions: {
    [matchId]: {
      homeScore?: number,
      awayScore?: number,
      winnerTeamId?: string,
      updatedAt?: string
    }
  },
  advancement: {
    round32?: string[],
    round16?: string[],
    quarter?: string[],
    semi?: string[],
    final?: string[]
  },
  awards: {
    championTeamId?: string,
    mvpName?: string,
    topScorerName?: string
  },
  restructures: [
    {
      id: string,
      phase: "round32" | "round16" | "quarter",
      teamOutId: string,
      teamInId: string,
      cost: number,
      createdAt: string
    }
  ],
  submittedAt?: string,
  updatedAt?: string
}
```

La puntuacion se calcula en cliente en tiempo real comparando `bets/{uid}` con `matches` y `app/config.actualAwards`. Para una porra con dinero, el siguiente paso natural es duplicar ese calculo en Cloud Functions para guardar snapshots auditables.

## Configurar Firebase desde cero

1. En Firebase Console abre el proyecto `wolrd-cup-bet`.
2. En **Authentication > Sign-in method**, activa **Email/Password**.
3. En **Firestore Database**, crea una base de datos en modo production.
4. En **Authentication > Settings > Authorized domains**, agrega el dominio de GitHub Pages:

```text
TU_USUARIO.github.io
```

Si usas dominio personalizado, agrega tambien ese dominio.

5. En **Project settings > General**, crea una Web App y copia la configuracion.
6. Crea `.env.local` a partir de `.env.example` para desarrollo local:

```bash
cp .env.example .env.local
```

7. Rellena:

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=wolrd-cup-bet.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=wolrd-cup-bet
VITE_FIREBASE_STORAGE_BUCKET=wolrd-cup-bet.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

8. Instala dependencias con Node 20+:

```bash
nvm use
npm install
```

9. Instala o usa Firebase CLI y autentica. Esto despliega solo reglas e indices de Firestore, no hosting:

```bash
npm install -g firebase-tools
firebase login
firebase use wolrd-cup-bet
firebase deploy --only firestore:rules,firestore:indexes
```

10. Siembra equipos, partidos y config. Opcion recomendada:

```bash
gcloud auth application-default login
npm run seed
```

Alternativa con service account:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/ruta/service-account.json
npm run seed
```

11. Arranca en local:

```bash
npm run dev
```

12. Crea tu usuario desde la web. Despues, en Firestore, edita `users/{tuUid}.role` a `admin`.
13. Como admin, abre/cierra escritura desde la tarjeta **Admin**. Tambien puedes editar directamente `app/config.writeEnabled`.

## Despliegue con GitHub Pages

El repo incluye el workflow `.github/workflows/deploy-github-pages.yml`. Cada push a `main` construye la app y publica `dist/` en GitHub Pages.

### 1. Activar GitHub Pages

En GitHub:

1. Abre el repositorio.
2. Ve a **Settings > Pages**.
3. En **Build and deployment**, selecciona **GitHub Actions**.

La URL final sera normalmente:

```text
https://TU_USUARIO.github.io/world-cup-bet/
```

### 2. Configurar variables de GitHub Actions

En **Settings > Secrets and variables > Actions > Variables**, crea estas repository variables:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Usa los mismos valores de `.env.local`.

### 3. Publicar

Haz push a `main`:

```bash
git push origin main
```

El workflow instalara dependencias, ejecutara `npm run build` y publicara la carpeta `dist/`.

### Dominio personalizado opcional

Si usas dominio propio, configuralo en **Settings > Pages** y crea una variable:

```text
VITE_BASE_PATH=/
```

Si usas el dominio normal `TU_USUARIO.github.io/world-cup-bet/`, no necesitas tocar `VITE_BASE_PATH`; el workflow configura automaticamente el base path `/world-cup-bet/`.

## Operaciones despues del despliegue

Firebase se sigue administrando aparte:

```bash
firebase deploy --only firestore:rules,firestore:indexes
npm run seed
```

No ejecutes `firebase deploy --only hosting`: la web vive en GitHub Pages.

## Bloqueo de escritura

- Escritura cerrada: `app/config.writeEnabled = false`
- Mensaje mostrado: `app/config.lockedMessage`
- Reestructuracion abierta: `writeEnabled = true` y `writeScope = "round32" | "round16" | "quarter"`
- Semifinales y final: usar `writeEnabled = false` para dejar el cuadro bloqueado definitivamente.

## Reglas de puntuacion implementadas

| Fase | Ganador | Exacto |
| --- | ---: | ---: |
| Grupos | 1 | 3 |
| Dieciseisavos | 3 | 5 |
| Octavos | 5 | 7 |
| Cuartos | 7 | 9 |
| Semifinales | 10 | 12 |
| Final | 12 | 15 |

Bonus: campeon, MVP y maximo goleador suman 15 puntos cada uno. Reestructuracion resta 4, 6 u 8 puntos segun fase.
