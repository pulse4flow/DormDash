# DormDash

## Property operations MVP

Open **`/operations`** for the new Thai-language workspace for a small property. It covers rooms, manually entered reservations, check-in/check-out, housekeeping, repairs, staff access, and a daily overview. The original resident demo remains available at `/`.

### Set up the MVP

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`, set `DATABASE_URL` to your PostgreSQL database, and replace `AUTH_SECRET` and `ADMIN_REGISTRATION_KEY` with random values. Existing shell variables or `.env.local` may override these values.
3. Run `npm run prisma:generate` and `npx prisma migrate deploy` against the intended database. Back up any existing data before applying migrations.
4. Run `npm run dev`, open `/operations`, and choose the initial setup form. Enter the registration key, property name, timezone, and the first manager account. Setup is available only before the first property exists.
5. Add rooms and staff, then enter a reservation. No legacy demo seeding is needed for operations.

Managers can change property/room settings and create accounts. Staff can manage reservations and work orders and can access guest contact details for front-desk work. Operations accounts use a separate session from the original demo's admin accounts.

### First-version rules

- One property per account, with two roles: manager and front-desk staff.
- Reservations assign one specific room and use local calendar dates with an exclusive departure date. Departing and arriving guests may therefore share the same booking boundary date.
- A room must be clean, operational, and unoccupied before check-in; unfinished work that blocks the room also prevents check-in.
- Check-out creates a housekeeping task and makes the room dirty. Completing the necessary housekeeping work makes it ready for the next guest.
- Reservation changes and state transitions are checked on the server, including concurrent attempts to reserve a room.
- Online booking, external booking channels, payments, invoicing, monthly leases, and multi-property switching are outside this release.

### Checks

`npm run lint`, `npm run typecheck`, and `npm run build` check the application. `npm run test:ops` runs the operations integration suite against a running local application and a separate local PostgreSQL test database; see [tests/README.md](tests/README.md). Never point integration tests at a live property database.

The product scope is documented in [docs/simple-resident-mvp-plan.md](docs/simple-resident-mvp-plan.md), with team responsibilities in [docs/team-readiness.md](docs/team-readiness.md).

## Original resident demo

A lightweight, demo-ready app for university **dorm life** — announcements, maintenance requests, dorm info, and a personal (device-local) task/bookmark tracker. No student accounts needed; only the admin area is protected.

Built on Next.js 15 (App Router) + TypeScript + Prisma + PostgreSQL. Announcements, repairs, categories, tags, and admins live in PostgreSQL; tasks, bookmarks, and read-state are stored per-browser in `localStorage`.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in AUTH_SECRET and ADMIN_REGISTRATION_KEY (see below)
npm run demo:setup            # applies migrations + seeds demo data
npm run dev                   # http://localhost:3000
```

### Environment variables (`.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL, e.g. `postgresql://user:password@localhost:5432/dormdash` |
| `AUTH_SECRET` | ≥ 32 chars — signs the admin JWT session cookie |
| `ADMIN_REGISTRATION_KEY` | Required to create an admin account at `/admin/register` |

```
AUTH_SECRET=$(openssl rand -hex 32)
ADMIN_REGISTRATION_KEY=$(openssl rand -hex 16)
```

### Demo account

Seeding creates one admin:

```
email:    admin@dormpoon.example
password: dormdash-admin-1234
```

Sign in at `/admin/login`.

## What's here

### Public (students — no account)
- `/` — dashboard: quick utilities, latest announcements, upcoming events with countdowns, and your device-local tasks & bookmarks
- `/announcements` — browse/filter announcements; `/search?q=` searches title/summary/content/tags
- `/announcements/[id]` — full announcement; bookmark / mark-read are stored locally
- `/maintenance` — submit a maintenance request (room + category + description) and see recent public requests
- `/dorm-info` — contacts, office hours, facilities, rules, Wi-Fi
- `/tasks`, `/bookmarks` — per-browser local state

### Admin (login required)
- `/admin` — dashboard with announcement stats
- `/admin/announcements` + `/new` + `[id]/edit` — full CRUD (status, priority, publish/expire/event dates, category, tags)
- `/admin/categories`, `/admin/tags` — manage taxonomy
- `/admin/repairs` — filter repair requests by status/category and update their status

### API
- `/api/announcements` (GET public, GET `?admin=true`, POST admin)
- `/api/announcements/[id]` (GET public/admin, PATCH/DELETE admin)
- `/api/repairs` (GET public, POST public) — no login needed to report an issue
- `/api/repairs/[id]` (GET public, PATCH admin status only)
- `/api/categories`, `/api/tags`, `/api/uploads`, `/api/auth/login|register|logout`

## Demo scripts

- `npm run demo:setup` — apply migrations, then seed (safe to re-run; seed uses upserts).
- `npm run demo:reset` — **drop and recreate** the database (all data lost), then re-seed. Stop the dev server first.

`npm run prisma:seed` reseeds without touching the schema.

## Data model

`Admin`, `Announcement` (status/priority/publishAt/expiresAt/eventAt/category/tags/attachments), `Category`, `Tag`, `AnnouncementTag`, `Attachment`, and `RepairRequest` (room, requesterName, title, description, category, status: PENDING → IN_PROGRESS → RESOLVED).

## Tech notes

- Admin auth: cookie-based JWT (`dormdash_admin`), bcrypt password hashes, 8-hour sessions.
- Status visibility: only `PUBLISHED`, published-at, and not-expired announcements are shown publicly.
- The `codex/simple-resident-mvp` branch adds property operations alongside the original resident demo. PostgreSQL migrations are stored in `prisma/migrations`.
