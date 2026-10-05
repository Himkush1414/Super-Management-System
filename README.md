# NR Industries — internal order system

Marketing dispatches production orders; production advances them through five
stages; administrators oversee everything. Next.js 16 (App Router, Turbopack) +
Supabase (Postgres + Auth + RLS).

---

## 1. Accounts — fixed, no self-registration

There is **no sign-up, no OTP, no password recovery, no landing page.** The app
opens directly on a username + password screen. Ten accounts exist, seeded by
`supabase/seed.sql` and nothing else:

| Username | Role | Sees |
|---|---|---|
| `head_admin` | head_admin | everything, incl. which marketing account dispatched each order |
| `admin` | admin | every order + all production activity, incl. price. Believes it is the top level. |
| `marketing1`…`marketing4` | marketing | **only their own** dispatched orders (incl. price) |
| `production1`…`production4` | production | **only orders assigned to them**. Never price. |

Login field is the **username**. Supabase Auth needs an email internally, so
each account is stored as `<username>@nr.local` in `auth.users` — that address is
never shown or typed. Passwords are bcrypt-hashed the way GoTrue verifies them.

### Head-admin invisibility (non-negotiable)

No label, badge, nav item, dropdown, or query result anywhere reveals that a
`head_admin` role exists. Enforced in Postgres RLS: `profiles_admin_visible`
returns every row *except* `head_admin` to admin; only `head_admin` sees
`head_admin`. `admin`'s "everything" genuinely stops at `admin`.

---

## 2. The order pipeline

**Dispatch** (`/dashboard/orders/new`, marketing only) — product name, client
name, transformer rating, quantity, order value, expected delivery date,
description, and **Send to production**: one or more *specific* production
members (never a broadcast). Button: *Proceed with product*. The order, its
assignees and its first stage event are written in one transaction
(`create_order()`).

- If **every** selected member has a **saved + confirmed phone number**, the
  order is `active` and the WhatsApp group-creation stub fires with all their
  numbers.
- If not, the order is created with status `waiting_on_production_phone`. It
  becomes `active` automatically the moment the last of them saves a number.

**Production settings** (`/dashboard/settings`, production only) — register the
phone number for WhatsApp order groups. Saving sets `confirmed_at` (there is no
way to actually verify a number without the WhatsApp API) and activates any
parked orders.

**Stages** (`orders.stage`, 1–5) — any production member assigned to the
order can advance it, one step at a time (a conditional update stops two
members double-advancing):

| # | Name |
|---|---|
| 1 | Starting |
| 2 | Midway through production |
| 3 | End of production |
| 4 | Dispatched |
| 5 | Delivered |

Every advance writes an `order_stage_events` row and notifies the marketing
creator **and** head_admin. Admin sees the current stage on the list/detail.

---

## 3. WhatsApp — stubbed, not faked

There is no WhatsApp Business API account. `lib/whatsapp.ts` is a **stub**: every
function logs the payload it *would* have sent (`[whatsapp:STUB] …`) and returns
`{ ok: false, reason: "not_configured" }`. Nothing pretends to succeed —
`orders.whatsapp_group_created` stays `false`, `whatsapp_group_id` stays null, and
the order UI shows *"WhatsApp: not configured"*.

The data model is ready for a real integration: `orders` carries
`whatsapp_group_created`, `whatsapp_group_id`, `production_phone`, and `status`.
Replace the bodies marked `// TODO(whatsapp):` and set `WHATSAPP_ENABLED = true`.

---

## 4. Schema (`supabase/migrations/0008_orders_reset.sql` + later)

`profiles` (id, username, full_name, role) · `orders` · `order_assignees` ·
`order_stage_events` · `production_settings` · `notifications`. Reads go
through the `order_feed` view, which nulls `price` (the order value) for
anyone who isn't admin-tier or the marketing account that created the order,
and lists `assignee_ids`. `orders.price` itself is not selectable by API
roles at all (0010), and Realtime payloads omit it for the same reason.

Production never sees the order value anywhere — page, CSV, list PDF or spec
sheet PDF all drop the column for that role, not just blank it.

Writes to orders / assignees / stage history go only through the server
actions (service role, session-checked) — there are no direct-write RLS
policies for those tables (0012).

Migrations 0001–0005 build the original schema; **0008 is a hard reset** that
drops the old auth/messaging/projects system and rebuilds around orders.
0012 adds the current order fields and multi-member assignment.

`supabase/scripts/` holds one-off data scripts (not migrations), e.g.
`clear_test_orders.sql`.

---

## 4a. Data management & activity log (admin tier)

`/dashboard/data` lets admin and head_admin remove data that marketing and
production accounts build up:

- delete an individual order dispatched by a marketing account (also from the
  order page), with its stage history and notifications;
- delete an individual stage update made by a production account (history
  only — the order keeps its stage);
- **reset** an account: choose what to delete (orders / stage updates /
  notifications), then type the username to confirm. For production,
  "orders assigned to this account" is opt-in, because it deletes those
  orders for everyone involved.

Every delete asks for confirmation first, and every delete — from any path,
including the service role and the SQL console — writes an `audit_log` row
with a snapshot of what was removed, who removed it and when (BEFORE DELETE
triggers, migration 0013). `audit_log` is append-only (updates, deletes and
TRUNCATE are rejected by trigger). `/dashboard/activity` shows it; rows made
by head_admin are visible only to head_admin.

Enforcement is in Postgres, mirrored by `data.delete` / `audit.view` in
`lib/permissions.ts`: only admin-tier sessions have DELETE policies on
`orders` / `order_stage_events`; `admin_reset_account()` re-checks the caller
and refuses admin / head_admin targets. The app's delete actions run under
the admin's own session, so RLS is the actual gate.

## 5. Run it

```bash
supabase start          # local Postgres + Auth + Studio + Mailpit
supabase db reset        # apply migrations + seed the 10 accounts
npm run dev              # http://localhost:3000
```

Then sign in as any account above.

`supabase start` requires Docker (Docker Desktop with WSL2 integration
enabled, if you're on Windows/WSL). If it's not running, every Auth call
degrades to "signed out" after a 5s timeout instead of hanging — you'll be
stuck on the login screen with no visible error until Docker is up.

## 6. PDF export

- Order detail page → **Download PDF**: a spec sheet (details, description,
  stage history). Price and dispatcher/production names follow the same
  visibility rule as the page itself.
- Orders list → **Export PDF**: the caller's visible orders as a report.

Both are plain GET routes (`/dashboard/orders/[id]/pdf`,
`/dashboard/orders/pdf`) rendered server-side with `@react-pdf/renderer`, so
they require no client JS and respect the same session/RLS scoping as the
pages they sit on.

## 7. Layout

```
app/(auth)/login/        username + password, the only way in
app/dashboard/orders/     list · new (dispatch) · [id] (detail + stage control)
app/dashboard/orders/*/pdf/  PDF export route handlers
app/dashboard/settings/   production phone registration
lib/auth/                 login/logout actions · requireSession/requireRole
lib/actions/orders.ts     dispatchOrder · advanceStage  (service-role, session-checked)
lib/actions/production.ts saveProductionPhone
lib/actions/admin.ts      deleteOrder · deleteStageEvent · resetAccount  (admin's own session, RLS-gated)
app/dashboard/data/       data management (admin tier)
app/dashboard/activity/   audit log viewer (admin tier)
lib/whatsapp.ts           the stub
lib/permissions.ts        role → capability matrix
lib/pdf/                  react-pdf document components for the exports above
lib/env.ts                requireEnv() — fail fast on missing config instead
                           of a cryptic error deep inside supabase-js
```
