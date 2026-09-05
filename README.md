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
npx supabase db push          # applies 0001–0007
# then run supabase/seed.sql once from the SQL editor (seeds the one Head Admin — see §4)
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
| `0005_auth_overhaul.sql` | sign-up wizard schema (`last_active_at`, `phone_otp_codes`), Head Admin invisibility (RLS + `audit_log_view`), approvals split into `approvals.view`/`approvals.decide` |
| `0006_direct_messaging.sql` | `direct_conversations`/`direct_messages`, `voice-notes` Storage bucket + policies, cleanup RPCs |
| `0007_cron_cleanup.sql` | hourly `pg_cron`/`pg_net` job invoking the 60h cleanup Edge Function (needs a one-time Vault secret — see §6) |

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
| View pending-signup queue | ● | ● | — | — | — |
| Decide (approve+role / reject) signups | ● | — | — | — | — |
| Change a user's role | ● | — | — | — | — |
| View audit log | ● | ● | — | — | — |
| Generate spec PDF | ● | ● | ● | ● | own tasks |

Pricing is never rendered blank for restricted roles — it shows a locked
`🔒 Restricted` placeholder, and is stripped from the spec PDF automatically
based on the requester's role (no manual toggle).

**Head Admin is invisible to every other role.** No role/account labelled
"Head Admin" is ever returned to a non-Head-Admin session — enforced in RLS
(`profiles_select_admin`/`profiles_select_teammates` exclude the row outright,
not just hide it in the UI) and in `audit_log_view` (masks the actor on any
entry where `actor_role = 'head_admin'` for non-Head-Admin readers).
`lib/permissions.ts` exports `isRoleVisible()`/`visibleRoles()` for the rare
UI code that iterates roles (e.g. the permission-matrix table below), and
`ASSIGNABLE_ROLES` (all roles except `head_admin`) for role-assignment
dropdowns — head_admin can never be granted, only ever seeded once.

---

## 4. Seed data

`supabase/seed.sql` — **isolated from migrations**, runs automatically on
`supabase db reset`. Seeds exactly **one** real account, the Head Admin:

| role | email | password |
| --- | --- | --- |
| Head Admin | `manikrana831@gmail.com` | `Manikrana1414` |

This is a real production credential, not a shared demo password — rotate it
if this repo's history is ever exposed, and unlike the old demo seed, do not
delete this row before going live. No Admin / Manager / Product Supervisor /
Maker accounts are seeded — those are created by real users through the
sign-up + approval flow below, with Head Admin assigning the role at approval.

---

## 5. Auth flow

**Sign-up** (`/signup`, everyone except Head Admin) is a wizard, no role
selection anywhere in it:

1. Full name.
2. Choose **either** email or phone (not both).
3. "Next" sends an OTP — real email OTP via Supabase Auth; phone is a stub
   (no SMS integration — the code is logged server-side and shown in a dev
   banner on the OTP step).
4. Enter the OTP to verify.
5. Set a password — **exactly 6 digits, numbers only**, regex-enforced, no
   other format accepted.
6. Account is created `pending`. The user lands on `/dashboard/overview`
   immediately, but the layout renders nothing but a centered "Your request
   has been sent. Please wait for approval." — no nav, no mention of who
   approves it or what role they'll get.

**Approval** is split into two routes:
- `/dashboard/approvals` — Admin, **view-only** (name, contact, submitted
  time; no decision controls).
- `/dashboard/approvals/review` — **Head Admin exclusive**, undiscoverable
  (no nav link renders for anyone else, and the route guard requires
  `approvals.decide`, which only `head_admin` has). Approving picks a role
  (Admin / Manager / Product Supervisor / Maker — never Head Admin) in the
  same action that activates the account.

**Login** (`/signin`) accepts an email or phone identifier + password.
- If the identifier matches `HEAD_ADMIN_EMAIL`, the OTP second factor is
  silently skipped — same form, no visible difference, the branch is
  entirely server-side.
- Everyone else keeps the existing password + email-OTP second factor,
  **except** a forced-expiry re-login (see below), which skips the OTP once.

**Session expiry**: `profiles.last_active_at` is stamped on every dashboard
load. A non-Head-Admin session idle for 7+ days is signed out and must log in
again (password only — no OTP re-send on that one re-login). Head Admin is
exempt.

Sessions: Supabase JWT, silent refresh. Head Admin / Admin have "sign out of
all devices" in Settings.

---

## 6. Direct messages

A separate **Messages** tab (`/dashboard/messages`, everyone except Head
Admin) — WhatsApp-style, any-to-any, no hierarchy: text + voice notes,
realtime via Supabase Realtime, sender name + role badge per message. This is
in addition to the existing per-project chat, not a replacement.

Entire conversations (rows + voice-note files) are **hard-deleted** 60 hours
after the last message — an hourly `pg_cron`/`pg_net` job
(`supabase/migrations/0007_cron_cleanup.sql`) calls the
`cleanup-direct-messages` Edge Function, which purges both the DB rows and
the Storage objects (Postgres alone can't clean up Storage's backing files).
Voice notes live in a private `voice-notes` bucket, played back via
short-lived signed URLs.

**One manual step**, once per environment, after applying migrations —
Postgres can't be handed a secret safely from a committed file:

```sql
select vault.create_secret('<service_role key>', 'cleanup_fn_service_key');
```

then `npx supabase functions deploy cleanup-direct-messages`.

---

## 7. Deliberate scope notes

- **Google OAuth** — skipped (no credentials yet), per spec.
- **SMS OTP** — genuinely stubbed: no SMS provider is ever called. The code
  is generated, hashed into `phone_otp_codes`, logged server-side, and
  returned to the sign-up wizard so it's visible during development.
- **Permission-matrix editor** — the matrix is rendered read-only on `/dashboard/users`. Making it a runtime toggle would let the UI and the database RLS drift apart; changing it is intentionally a migration (`supabase/migrations/`) so the two move together. Flagged here rather than silently built the other way.
- `types/database.types.ts` is hand-maintained until `npm run types` is run against the live project.

---

## 8. Project layout

```
app/(public)/      marketing site + glass nav
app/(auth)/        signin · signup (wizard) · verify-otp · pending-approval (pre-session only)
app/dashboard/     Vercel-style shell: overview · projects · messages · approvals(+review) · users · audit-log · settings
lib/permissions.ts single source of truth for the role matrix + isRoleVisible/visibleRoles/ASSIGNABLE_ROLES
lib/supabase/      client · server (incl. service-role) · middleware(proxy) helpers
lib/actions/       server actions (projects, admin, chat, messages, account)
lib/auth/          sign-up wizard actions, login, session (7-day expiry)
lib/pdf-generator.tsx  spec-sheet PDF, pricing gated by requester role
supabase/          migrations (RLS from 0001) + seed.sql (one real Head Admin)
supabase/functions/cleanup-direct-messages  60h hard-delete Edge Function
proxy.ts           route protection by role (Next 16 "middleware")
```
