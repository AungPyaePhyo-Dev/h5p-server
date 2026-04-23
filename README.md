# h5p-server

NestJS backend that wraps [`@lumieducation/h5p-server`](https://github.com/Lumieducation/H5P-Nodejs-library)
and exposes an HTTP API for authoring, storing, and playing H5P content.
Libraries, content, and temp files live on the local filesystem; a small
PostgreSQL table keeps a queryable registry of saved content.

## Stack

- **NestJS 10** on Express
- **@lumieducation/h5p-server** / **h5p-express** — H5P engine + Ajax router
- **Prisma 7** with the `@prisma/adapter-pg` driver against PostgreSQL
- **TypeScript**, `ts-node-dev` for local development

## Architecture

```
src/
  main.ts              bootstrap — initializes H5P editor, mounts Lumi router
  app.module.ts        Nest root module (Config + Prisma + H5P)
  h5p/
    h5p.service.ts     wraps H5PEditor / H5PPlayer, FS storage, content registry
    h5p.controller.ts  custom endpoints consumed by the React client
    h5p.module.ts
  prisma/
    prisma.service.ts  PrismaClient (pg adapter) with Nest lifecycle hooks
    prisma.module.ts
```

The Lumi Ajax router and the Nest controller both live under `/h5p`. They
are disjoint by path — the router handles H5P engine traffic
(`/h5p/ajax`, `/h5p/core/*`, `/h5p/content/:id/*`, …) and the controller
serves the custom payloads the React client needs (`editor-model`,
`player-model`, content list, save). The middleware ordering in
[src/main.ts](src/main.ts) matters: the Lumi router is registered before
`app.init()`, because Nest's Express adapter installs a catch-all 404 on
init that would otherwise swallow later `app.use()` calls.

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 13+ (local or remote)

### Install

```bash
npm install
cp .env.example .env          # then edit as needed
npm run h5p:fetch             # fetches H5P core + editor into h5p-data/
npm run prisma:generate
npm run prisma:migrate        # requires Postgres reachable via DATABASE_URL
```

### Why `h5p:fetch`

`@lumieducation/h5p-server` manages libraries and content but does not ship
the browser-side H5P runtime (core + editor JS/CSS/fonts — ~30 MB, owned
by the H5P Group and versioned separately). The
[scripts/download-h5p-core.sh](scripts/download-h5p-core.sh) script fetches
them once from `h5p/h5p-php-library` and `h5p/h5p-editor-php-library` into
`h5p-data/core` and `h5p-data/editor`. Safe to re-run — it skips download
when the target dirs already contain files.

The script also drops an empty `editor/libs/darkroom.css` stub because
h5p-server 9.x still references a file that upstream H5P replaced with
cropper.js. Remove the stub once this project upgrades to h5p-server ≥ 10.

## Run

```bash
npm run start:dev     # ts-node-dev, auto-restart on change (default :3000)
npm run start         # ts-node, no watch
npm run build         # tsc → dist/
npm run start:prod    # node dist/main.js
```

The server logs `H5P backend listening on http://localhost:<PORT>` on boot.
CORS is enabled for any origin with credentials — tune in
[src/main.ts](src/main.ts) before deploying.

## Environment

| Variable       | Default                                                 | Purpose                               |
|----------------|---------------------------------------------------------|---------------------------------------|
| `PORT`         | `3000`                                                  | HTTP port                             |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/h5p`     | Prisma/pg connection string           |
| `H5P_DATA_DIR` | `./h5p-data`                                            | Filesystem root for H5P assets + data |

## Data layout

```
h5p-data/
  core/        H5P core runtime (fetched, gitignored)
  editor/      H5P editor UI   (fetched, gitignored)
  libraries/   installed H5P libraries (written by the editor at runtime)
  content/     saved content (params + assets, keyed by content id)
  temp/        editor temp uploads
```

The Postgres `h5p_content` table ([prisma/schema.prisma](prisma/schema.prisma))
only stores the registry row — id, title, main library, timestamps. All
H5P payload data lives on the filesystem under `H5P_DATA_DIR/content/<id>`.

## HTTP surface

All endpoints are mounted under `/h5p`.

### Custom (Nest controllers)

| Method | Path                           | Purpose                                              |
|--------|--------------------------------|------------------------------------------------------|
| GET    | `/h5p/libraries`               | List installed libraries (summary)                   |
| GET    | `/h5p/content`                 | List saved content records                           |
| GET    | `/h5p/editor-model/:id?`       | Payload for `<H5PEditorUI>` (`id='new'` for fresh)   |
| GET    | `/h5p/player-model/:id`        | Payload for `<H5PPlayerUI>`                          |
| POST   | `/h5p/content/:id?`            | Save content from the editor (`id='new'` creates)    |

Both `editor-model` and `player-model` accept `?language=xx` (defaults to
`en`). The save endpoint's body matches what `@lumieducation/h5p-react`'s
`saveContentCallback` emits:

```json
{
  "library": "H5P.MultiChoice 1.16",
  "params": {
    "params": { /* content params */ },
    "metadata": { "title": "…" /* + h5p metadata */ }
  }
}
```

### Lumi router (`@lumieducation/h5p-express`)

| Method     | Path                              | Purpose                                                   |
|------------|-----------------------------------|-----------------------------------------------------------|
| GET / POST | `/h5p/ajax`                       | Editor AJAX (Hub, translations, library upload/install)   |
| GET        | `/h5p/libraries/:uberName/:file*` | Library static files                                      |
| GET        | `/h5p/content/:id/:file*`         | Content static files                                      |
| GET        | `/h5p/params/:id`                 | Content params (`content.json`)                           |
| GET        | `/h5p/core/*`                     | H5P core JS/CSS                                           |
| GET        | `/h5p/editor/*`                   | H5P editor JS/CSS                                         |
| GET        | `/h5p/download/:id`               | Export content as a `.h5p` package                        |
| GET        | `/h5p/temp-files/*`               | Temporary upload files                                    |

## Authentication

There is no auth layer yet. Every request runs as a hard-coded local user
(`H5PService#currentUser` in [src/h5p/h5p.service.ts](src/h5p/h5p.service.ts)).
Wire real identity in before exposing this service to untrusted traffic.

## Scripts reference

| Script                    | Action                                              |
|---------------------------|-----------------------------------------------------|
| `npm run start:dev`       | Dev server with auto-restart                        |
| `npm run start`           | One-shot `ts-node` run                              |
| `npm run build`           | Compile to `dist/` via `tsconfig.build.json`        |
| `npm run start:prod`      | Run compiled output                                 |
| `npm run prisma:generate` | Regenerate the Prisma client                        |
| `npm run prisma:migrate`  | Apply dev migrations against `DATABASE_URL`         |
| `npm run h5p:fetch`       | Download H5P core + editor static assets            |
