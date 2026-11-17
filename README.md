# Cylinder Ops

Cylinder Ops is a Next.js and MongoDB application for LPG agency bookings, stock, deliveries, collections and support. It has separate staff, customer and driver workspaces.

## Run locally

Use Node.js 22 and a MongoDB replica set. Copy `.env.example` to `.env.local`. Set `CREDENTIAL_KEY` to 32 random bytes encoded in base64. For example, run `node -p "require('crypto').randomBytes(32).toString('base64')"`.

1. Run `npm ci`.
2. Start a local replica set with `docker compose up -d` or run `npm run db:local` in a separate terminal. For `db:local`, set port `27028` in the `MONGODB_URI` in `.env.local`. This command starts a loopback-only MongoDB process and persists development data in `.local/mongodb`.
3. Run `npm run db:init` to create collections and indexes.
4. For synthetic development records, set `ALLOW_DEMO_SEED=true` in `.env.local` and run `npm run seed`. The seed writes the records to MongoDB. Rerunning it updates older demo credentials without duplicating the existing sample data.
5. Run `npm run dev`. Use `admin` as both the user ID and password in the [staff workspace](http://localhost:3000/login), [customer portal](http://localhost:3000/portal/login), or [delivery portal](http://localhost:3000/delivery/login). Each sign-in page selects the corresponding demo role. The shared demo login requires a local development app. Point `MONGODB_URI` at a dedicated demo database, which can be local or hosted.
6. In a separate terminal run `npm run worker` to process queued events.

Use a dedicated development database. The local test runner may need to download the platform's MongoDB binary. If MongoDB is installed already, set `MONGOMS_SYSTEM_BINARY` to its executable path. The Docker Compose MongoDB instance is for local development.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test` uses a temporary MongoDB replica set. `TEST_MONGODB_URI` may point to a dedicated test replica set.
- `npm run build`
- `npx playwright install chromium` followed by `npm run e2e` after building. To use installed Chrome, set `PLAYWRIGHT_CHANNEL=chrome`. The test runs the production build with an isolated database.

## Documentation

- [Requirements and architecture](docs/specification.md)
- [Deployment and operational limits](docs/deployment.md)
- [Administrator guide](docs/administrator.md)
- [OpenAPI contract](docs/openapi.json)
- [Winquly contract requirements](docs/winquly.md)
