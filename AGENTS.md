# Catalyst

Outreach tool specified in `spec/catalyst-spec.md`. The spec is the source of truth. When code and spec disagree, or the spec is silent, say so instead of quietly picking one. A schema change goes into the spec (§6) and the Drizzle schema together. Spec §20.1 records what is built, how it was verified, and every decision made where the spec was silent; update it when work lands.

## What exists

- `packages/core`: pure domain logic with no I/O and no dependencies. Thread derivation (`deriveThread`), follow-up sequences, business-day and sending-window maths, the capacity plan and domain ramp, reputation scores and breakers, the classification and autonomy policies, ID prefixes.
- `packages/email`: everything about email itself. Subject normalisation, thread matching, deterministic inbound classification, delivery-status and `Authentication-Results` parsing, tracking tokens, the content linter, address verification, DNS checks, Liquid template rendering, MIME building and parsing, and the SMTP (Nodemailer) and IMAP (ImapFlow) transports behind `SmtpTransport` and `ImapConnector`. Transport tests run against in-process servers (smtp-server, hoodiecrow-imap).
- `packages/db`: the Drizzle schema for every table in spec §6, the generated migrations in `packages/db/migrations`, TypeID generation, the suppression check, and `@catalyst/db/testing` for integration tests.
- `packages/contract`: the API contract. Operations are declared once with zod (`src/operations`), and the OpenAPI 3.1 document is generated from them.
- `packages/server`: the API runtime (`src/api`: API-key and session auth (Better Auth, `src/auth`), scopes, validation, problem responses, idempotency keys, ETags, cursor pagination) and the services behind each operation, by area (`contacts`, `campaigns`, `threads`, `sending`, `outbound`, `inbound`, `imports`, `public`, …). Shared by the web app and the worker. External services (DNS, the job queue, storage, secrets, SMTP, IMAP) come in through `AppDeps` in `src/runtime.ts`, so tests swap in fakes.
- `packages/ai`: the agent's model-facing half (spec §10): task schemas, versioned prompts in `prompts/`, context assembly, guardrails, and the Claude client on `@anthropic-ai/sdk`. Tests use a scripted client; nothing in the test suite calls the API.
- `packages/mcp`: MCP tools generated from the contract; `tools.snapshot.json` is the reviewed tool list (`UPDATE_SNAPSHOTS=1` regenerates it).
- `packages/jobs`: the job catalog with typed payloads, on pg-boss. `packages/storage`: object storage (filesystem, or S3/MinIO when `S3_BUCKET` is set).
- `apps/worker`: `src/main.ts` runs the jobs in `src/jobs.ts` from the queue (evaluation, verification, imports, the scheduler and send path, Sent-folder jobs, mailbox polling), registers the cron schedules and queues catch-up polls on start.
- `apps/web`: the Next.js app: thin route files under `src/app/api/v1`, `/api/mcp`, `/api/auth` (Better Auth) and the public tracking and unsubscribe routes (`/t/o`, `/t/c`, `/u`); and the UI: `/sign-in`, the shell, the Dashboard, Needs you, the Inbox, the Thread view, the Campaigns list and detail, Contacts with Import, Companies, Lists, Knowledge, Deliverability with the mailbox wizard, Settings, the campaign builder and the ⌘K palette (Tailwind v4, TanStack Query over an `openapi-fetch` client typed from the contract; regenerate `src/lib/api-types.ts` with `pnpm --filter @catalyst/web generate:api` after changing the contract). `apps/web/e2e` is the Playwright suite (spec §19.9): each test seeds its own workspace through `e2e/support/data.ts`, which also does the few worker jobs a test needs, since no worker runs.
- Every view of spec §15 is built; §20.1 lists what each still lacks. Not built at all: the eval suite (it calls billed models), IP blocklists for dedicated IPs, the visual snapshots of §19.9. Jev (TypeSafe) classifies when `TYPESAFE_API_KEY` and a pinned `TYPESAFE_MODEL` are set: each reply, a person's own email, campaign goal changes, and replies in external agent mode.

## Commands

- `pnpm install`, then `pnpm test` and `pnpm typecheck` (both run every package).
- Database tests need a PostgreSQL 15+ server with the `citext` and `pg_trgm` extensions available. Point `TEST_DATABASE_URL` at any database on it; each run creates and drops its own database. Without the variable those tests are skipped.
- After changing `packages/db/src/schema`: `pnpm --filter @catalyst/db generate`, and commit the new migration.
- End-to-end tests: `TEST_DATABASE_URL=… pnpm --filter @catalyst/web test:e2e` builds the app, then runs Playwright in Chromium (`pnpm --filter @catalyst/web exec playwright install chromium` once). After a build, `pnpm --filter @catalyst/web exec playwright test` runs it again; `--ui` or a file name narrows it. It starts `next start` on port 3210 (`E2E_PORT`) against a database it creates on that server and drops afterwards, with AI, Jev, push, OAuth and system mail off, so nothing it does is billed or leaves the machine except the DNS lookups of the mailbox wizard's connection test.
- To run the app: set `DATABASE_URL` and `ENCRYPTION_KEYS` (and `BETTER_AUTH_SECRET` with `APP_URL` for people to sign in; see `apps/web/.env.example`), `pnpm --filter @catalyst/db migrate`, create a workspace and a key with `pnpm --filter @catalyst/server catalyst workspace …` and `… catalyst api-key …` (run it without arguments for usage), then `pnpm --filter @catalyst/web dev` and, for background jobs, `pnpm --filter @catalyst/worker start`. The AI agent runs only with `AI_ENABLED=true` on the worker, and then calls the Claude API (billed), and Jev too when `TYPESAFE_API_KEY` is set (billed).

## Conventions

- TypeScript must be erasable: no enums, namespaces or parameter properties. Relative imports end in `.ts`.
- `packages/core` never reads the clock, the zone database or a random source itself. `now`, the `ZoneCalendar` and the `Rng` are arguments, so everything is testable with a fake clock (spec §19.1).
- String unions in `packages/core/src/types.ts` mirror the Postgres enums in spec §6.2; a type-level test in `packages/db` fails if they drift.
- Table and column names in the Drizzle schema are the SQL names (snake_case), matching the spec and the API's field names.
- An API operation is added in three places: its declaration in `packages/contract/src/operations`, its handler in `packages/server/src/api/handlers.ts` (a missing one is a compile error), and a route file export (checked by `route-coverage.test.ts`). Handlers return plain data; the route factory does everything the contract promises.
- Every query in a service is scoped to the caller's workspace. Tests must show that another workspace's key gets 404.
- Every API operation must pass the contract tests in `packages/contract/src/contract.test.ts`, which encode the lint rules of spec §19.8 (described parameters and enum values, examples that validate, problem responses).
- Tests use Vitest, with fast-check for properties (spec §19.3). Assertions use `node:assert/strict`.
- Time-zone conversion sits behind the `ZoneCalendar` interface and currently uses `Intl`. The spec names Luxon (§4.2).
- Integration tests use `TEST_DATABASE_URL`. The spec names Testcontainers (§19.1), which needs Docker.
