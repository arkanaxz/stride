# Stride Running Dashboard

Stride is a full-stack Next.js application with React and TypeScript. It supports local SQLite for development and remote SQLite through Turso for Vercel hosting. A username and password are required to access the dashboard and its API routes.

## Local development

- Node.js 22.13 or later
- pnpm 10 or later

Run `pnpm install`, then `pnpm dev`, and open [http://127.0.0.1:4190](http://127.0.0.1:4190). Without `TURSO_DATABASE_URL`, local data is stored in `data/stride.sqlite` (or the path set in `STRIDE_DB_PATH`).

## Vercel deployment

Vercel Functions do not provide a persistent local disk, so configure Turso through Vercel Marketplace before deploying. The project requires these Vercel environment variables:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from the Turso integration
- `STRIDE_USERNAME` and a long, unique `STRIDE_PASSWORD`
- `STRIDE_SESSION_SECRET`, generated from at least 32 random bytes

Set them for Production (and Preview only if you want preview deployments usable), then deploy. The dashboard, data APIs, Excel import, AI analysis, and the legacy default-data URL are behind the login gate. Sessions are signed, HTTP-only, and expire after seven days.

## Move local data to Turso

1. Create/connect Turso through the Vercel Marketplace and create an empty database.
2. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to a local `.env.local` file (never commit it).
3. Stop the local Stride server and run `pnpm migrate:turso` from this project folder. The script refuses to overwrite a non-empty cloud database and reports only record counts.
4. Deploy with the same Turso credentials configured in Vercel. Verify the data and keep a private backup of the local SQLite file.

Weather and run location remain manual. AI review sends the selected run details and the API key to the chosen provider; the key is not saved by Stride. Keep cloud access private because the log includes health and training data.
