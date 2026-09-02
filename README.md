# NR Industries — Internal Management System

A full-stack internal operations tool for a transformer manufacturer:

- **Public marketing site** — dark, glassmorphic, nothing hinting at the tool behind it.
- **Role-gated internal dashboard** — Vercel-reference UI, project/production management, per-role data scoping enforced in the database.

Stack: **Next.js 16** (App Router) · TypeScript · Tailwind v4 · Supabase (Auth / Postgres / Realtime) · Framer Motion · `@react-pdf/renderer`.

---

## 1. Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| var | where to get it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ywzwzrzlittjiosskmcy.supabase.co` (already set) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Supabase dashboard → Project Settings → API → `anon` `public`** — this could not be pulled automatically; paste it in |
| `SUPABASE_SERVICE_ROLE_KEY` | optional, same page (`service_role`) — only used by privileged server tasks |

```bash
npm run dev      # http://localhost:3000
```

---

## 2. Database

All schema + Row Level Security lives in `supabase/migrations/`. RLS is enabled on
every table from `0001` — a hidden button is not access control, a denied query is.

### Hosted project (ywzwzrzlittjiosskmcy)

```bash
npx supabase link --project-ref ywzwzrzlittjiosskmcy
npx supabase db push          # applies 0001–0004
# then run supabase/seed.sql once from the SQL editor (demo data — see §4)
```

### Local

```bash
npx supabase start
npx supabase db reset         # applies migrations + seed.sql automatically
```

Regenerate types after a schema change:

```bash
npm run types
```

### Migration files

| file | contents |
| --- | --- |
| `0001_schema.sql` | tables + enums, RLS enabled |
| `0002_functions.sql` | `SECURITY DEFINER` helpers (`has_perm`, `can_see_project`, …), `handle_new_user`, approve/reject + role-change RPCs |
| `0003_rls.sql` | every RLS policy, mirroring `lib/permissions.ts` |
| `0004_triggers.sql` | pricing-column guard, Maker status-ladder guard, audit capture, notification fan-out, realtime publication |

---

## 3. Permission model

`lib/permissions.ts` is **the single source of truth**. `PERMISSION_MATRIX` is a
typed config object; `has_perm()` in `0002_functions.sql` encodes the same table
in SQL. UI conditionals, server actions, route protection (`proxy.ts`) and RLS
all check against it — role logic is never duplicated inline.

| | Head Admin | Admin | Manager | Product Supervisor | Maker |
| --- | :-: | :-: | :-: | :-: | :-: |
| View all projects | ● | ● | assigned | assigned | assigned |
| View / edit pricing | ● | ● | ● | — | — |
| View specs | ● | ● | ● | ● | ● |
| Edit specs | ● | ● | ● | ● | — |
| Update own task status | ● | ● | ● | ● | ● |
| Create project | ● | ● | ● | — | — |
| Approve / reject signups | ● | ● | — | — | — |
| Change a user's role | ● | — | — | — | — |
| View audit log | ● | ● | — | — | — |
| Generate spec PDF | ● | ● | ● | ● | own tasks |

Pricing is never rendered blank for restricted roles — it shows a locked
`🔒 Restricted` placeholder, and is stripped from the spec PDF automatically
based on the requester's role (no manual toggle).

---

## 4. Demo accounts (dev only)

`supabase/seed.sql` — **isolated from migrations, delete before production.**
All five: password `DemoPass123!`. `is_demo_account = true` → auto-active and
**they skip the login OTP** so all five dashboards are testable immediately.

| role | email |
| --- | --- |
| Head Admin | `headadmin@demo.nrindustries.local` |
| Admin | `admin@demo.nrindustries.local` |
| Manager | `manager@demo.nrindustries.local` |
| Product Supervisor | `supervisor@demo.nrindustries.local` |
| Maker | `maker@demo.nrindustries.local` |

Seeded with two sample projects (with tasks + chat) assigned to the Manager /
Supervisor / Maker, plus one pending signup request so the approvals queue has
content.

---

## 5. Auth flow

1. **Request access** (`/signup`) — name, email, password (always required), requested role (Manager / Supervisor / Maker only). Account is created `pending`.
2. Request lands live in the Admin / Head Admin **Approvals** queue (Realtime).
3. Approve → `active` + in-app/email notification. Reject → `rejected` with a **re-apply** path (never a dead end).
4. **Login** (`/signin`) — password is the primary factor, always. Email accounts then get a 6-digit **email OTP** as a second factor (`/verify-otp`). Demo + phone accounts skip it.
5. Sessions: Supabase JWT, silent refresh. Head Admin / Admin have "sign out of all devices" in Settings.

---

## 6. Deliberate scope notes

- **Google OAuth** — skipped (no credentials yet), per spec.
- **SMS OTP** — UI is stubbed (phone registration shows "being enabled", the button is disabled; Settings shows "Coming soon"). No codes are fake-sent.
- **Permission-matrix editor** — the matrix is rendered read-only on `/dashboard/users`. Making it a runtime toggle would let the UI and the database RLS drift apart; changing it is intentionally a migration (`supabase/migrations/`) so the two move together. Flagged here rather than silently built the other way.
- `types/database.types.ts` is hand-maintained until `npm run types` is run against the live project.

---

## 7. Project layout

```
app/(public)/      marketing site + glass nav
app/(auth)/        signin · signup · verify-otp · pending-approval
app/dashboard/     Vercel-style shell: overview · projects · approvals · users · audit-log · settings
lib/permissions.ts single source of truth for the role matrix
lib/supabase/      client · server · middleware(proxy) helpers
lib/actions/       server actions (projects, admin, chat, account)
lib/pdf-generator.tsx  spec-sheet PDF, pricing gated by requester role
supabase/          migrations (RLS from 0001) + seed.sql (demo, isolated)
proxy.ts           route protection by role (Next 16 "middleware")
```
