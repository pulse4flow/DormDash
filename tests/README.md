# Operations HTTP integration tests

These tests exercise a running DormDash server and a disposable **local PostgreSQL test database**. They create uniquely named records and never reset or truncate the database. The test refuses to run unless `OPS_TEST_DATABASE_URL` is set, points to localhost, contains `test` in the database name, and exactly matches `DATABASE_URL`. It also requires a local `OPS_TEST_BASE_URL`.

For a local run, start an empty PostgreSQL database named `dormdash_mvp_test`, then use the same isolated URL for migration, server, and test:

```bash
export DATABASE_URL='postgresql://dormdash:dormdash_test_only@127.0.0.1:55432/dormdash_mvp_test'
export OPS_TEST_DATABASE_URL="$DATABASE_URL"
export OPS_TEST_BASE_URL='http://127.0.0.1:3100'
export AUTH_SECRET='local-integration-secret-at-least-32-characters'
export ADMIN_REGISTRATION_KEY='local-test-key'
npm run prisma:generate
npx prisma migrate deploy
npm run build
npm run start -- --hostname 127.0.0.1 --port 3100
```

In another terminal with the same environment variables:

```bash
npm run test:ops
```

The first run creates the initial property through the setup API. Later runs create a new test property directly in the isolated database so the one-time setup rule remains testable. The suite covers login and role checks, property scoping, date validation, concurrent overlapping booking requests, check-in, check-out, housekeeping, and blocking repairs.

GitHub Actions starts its own PostgreSQL service, applies migrations, checks types and lint, builds the app, then runs this suite against a local production server.
