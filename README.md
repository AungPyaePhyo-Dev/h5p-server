# h5p-server

NestJS backend wrapping [`@lumieducation/h5p-server`](https://github.com/Lumieducation/H5P-Nodejs-library)
with a PostgreSQL content registry (via Prisma). Serves the H5P editor and
player to the [h5p-client](../h5p-client) frontend.

## Setup

```bash
npm install
npm run h5p:fetch       # downloads H5P core + editor static assets into h5p-data/{core,editor}
npm run prisma:generate
npm run prisma:migrate  # requires Postgres running per .env
```

### Why `h5p:fetch`

`@lumieducation/h5p-server` manages libraries and content but does not ship
the browser-side H5P runtime (core + editor JS/CSS/fonts — ~30MB, owned by
the H5P Group, versioned separately). The script fetches them once from
`h5p/h5p-php-library` and `h5p/h5p-editor-php-library` into
`h5p-data/core` and `h5p-data/editor`. Safe to re-run — skips if already present.

## Run

```bash
npm run start:dev       # :3000
```

## HTTP surface

### Custom (Nest controllers)

| Method | Path                           | Purpose                                   |
|--------|--------------------------------|-------------------------------------------|
| GET    | `/h5p/libraries`               | List installed libraries (summary)        |
| GET    | `/h5p/content`                 | List saved content records                |
| GET    | `/h5p/editor-model/:id?`       | Payload for `<H5PEditorUI>` (`id='new'` for fresh) |
| GET    | `/h5p/player-model/:id`        | Payload for `<H5PPlayerUI>`               |
| POST   | `/h5p/content/:id?`            | Save content from editor (`id='new'` creates) |

### Provided by `@lumieducation/h5p-express` router

Mounted at `/h5p` in `main.ts`:

| Method      | Path                                | Purpose                       |
|-------------|-------------------------------------|-------------------------------|
| GET / POST  | `/h5p/ajax`                         | Editor AJAX (Hub, translations, library upload/install) |
| GET         | `/h5p/libraries/:uberName/:file*`   | Library static files          |
| GET         | `/h5p/content/:id/:file*`           | Content static files          |
| GET         | `/h5p/params/:id`                   | Content params (`content.json`) |
| GET         | `/h5p/core/*`                       | H5P core JS/CSS               |
| GET         | `/h5p/editor/*`                     | H5P editor JS/CSS             |
| GET         | `/h5p/download/:id`                 | Export content as `.h5p` file |
| GET         | `/h5p/temp-files/*`                 | Temporary upload files        |
