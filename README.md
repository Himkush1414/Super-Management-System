# NR Industries — internal order system

Marketing punches production orders straight to the assigned production
team, which advances them through five stages; administrators oversee
everything. Next.js 16 (App Router, Turbopack) +
Supabase (Postgres + Auth + RLS).

---

## 1. Accounts — fixed, no self-registration

There is **no sign-up, no OTP, no password recovery, no landing page.** The app
opens directly on a **username + 6-digit PIN** screen. Twelve accounts exist,
seeded by `supabase/seed.sql` (gitignored; template `seed.sql.example`) and
nothing else — Supabase Auth sign-ups are refused in the database
(`handle_new_user()`, migration 0014), whatever the project's sign-up setting:

| Username | Role | Sees |
|---|---|---|
| `head_admin` | head_admin | everything, incl. which marketing account punched each order |
| `admin` | admin | every order + all production activity, incl. price. Believes it is the top level. |
| `marketing1`…`marketing4` | marketing | **only their own** punched orders (incl. price) |
| `production1`…`production4` | production | **only orders assigned to them**. Never price. |
| `dispatcher1`, `dispatcher2` | dispatcher (retired) | nothing — the dispatcher feature was removed in 0024 |

The two dispatcher accounts (added by the gitignored
`supabase/hosted-dispatchers.sql`) are **kept, not deleted**, with their
PINs, but can no longer sign in: the login refuses them ("This account is no
longer in use.") and an already-open session is signed out of that browser
on its next request (`app/(auth)/login/retired`).

Login field is the **username**. Supabase Auth needs an email internally, so
each account is stored as `<username>@nr.local` in `auth.users` — that address is
never shown or typed.

### PINs and lockout (migration 0014)

A 6-digit PIN has only a million values, so it is deliberately **not** the
Supabase Auth password (GoTrue's password endpoint is public via the anon key
and would bypass any app-side limit). Instead:

- PINs are bcrypt-hashed in `account_pins`, readable by no API role, and
  checked only by `pin_login_attempt()` (service role) inside Postgres.
- **Lockout:** 5 wrong PINs for a username within 15 min locks that username
  for 15 min (even the right PIN is refused); 30 failures from one IP within
  15 min locks the IP. Unknown usernames are tracked identically. Attempts
  are serialised with row locks, so parallel guessing can't exceed the cap.
- Each account's GoTrue password is 64 random hex chars nobody knows. After a
  successful PIN check the server mints the session with a single-use token
  (`auth.admin.generateLink` → `verifyOtp`).
- `set_account_pin(username, pin)` (service role / SQL editor) sets a PIN,
  re-randomises the GoTrue password and signs the account out everywhere.

Real PINs live only in gitignored files: `supabase/seed.sql` (local) and
`supabase/hosted-pins.sql` (live rollout).

### Real names (migration 0016)

Marketing and production accounts must give their real name; production also
its WhatsApp number. Until they have, every page, export and action sends
them to **Settings** (enforced in `requireSession()`, not just the UI), and
login takes them straight there. Wherever such an account appears as an actor
— pages, PDFs, CSV, the activity log — it is shown as
**"Real Name (Production 1)"**; admin / head_admin keep their labels.

Hard gates in the database: `create_order()` refuses a marketing account with
no real name, and an order only becomes `active` once every assigned
production member has both a real name and a confirmed phone (it waits
otherwise and can't advance).

### Head-admin invisibility (non-negotiable)

No label, badge, nav item, dropdown, or query result anywhere reveals that a
`head_admin` role exists. Enforced in Postgres RLS: `profiles_admin_visible`
returns every row *except* `head_admin` to admin; only `head_admin` sees
`head_admin`. `admin`'s "everything" genuinely stops at `admin`.

---

## 2. The order pipeline

**Punch Order** (`/dashboard/orders/new`, marketing only) — client name,
**Ship To** (free text, any number of lines) and expected delivery date once
per order, then **one or more products** (up to 20; *+ Add product* /
*Remove*), each with product name, transformer rating, quantity, price and
description; then one **Additional Amount** for the whole order; and **Send
to production**: one or more *specific* production members (never a
broadcast).

**Money** (0021): every product gets **18% GST on its price** (never on the
Additional Amount); product total = price + GST. The **order subtotal** =
Σ(price + GST) over all products, **then** the Additional Amount added at the
end. The form, the order page and both order PDFs show it step by step —
"Products, including 18% GST", "Additional Amount added", "Order subtotal" —
so the sum can be checked by hand. Amounts show paise only when there are
any (₹7,500 · ₹1,25,000.50). GST is computed by the database (`gst_of()`,
rounded to the paisa) when the order is read, so it applies to every order,
including those punched before 0021. Orders punched before 0021 had a
per-product **FEAT** amount instead of an Additional Amount; their FEAT
amounts (kept untouched in `order_items.feat`) are read as their Additional
Amount. Button:
*Proceed with product* / *Proceed with N products*. The order, its products,
its assignees and its first stage event are written in one transaction
(`create_order()`, which re-validates every product). The whole order moves
through the stages together and goes to one production team. Wherever one
line is needed the order is named after its first product: "TRANSFORMER +2
more".

- If **every** selected member has a **saved + confirmed phone number**, the
  order is `active` and the WhatsApp group-creation stub fires with all their
  numbers.
- If not, the order is created with status `waiting_on_production_phone`. It
  becomes `active` automatically the moment the last of them saves a number.

**Production settings** (`/dashboard/settings`, production only) — register the
phone number for WhatsApp order groups. Saving sets `confirmed_at` (there is no
way to actually verify a number without the WhatsApp API) and activates any
parked orders.

**Stages** (`orders.stage`, 1–5):

- **Production:** a punched order lands at **Stage 1 — Start** with the
  assigned production members, who can start it straight away (1 → 2). Any
  assigned member advances it one step at a time; each advance starts the
  3-minute timer for the next one (a conditional update stops two members
  double-advancing).
- **Admin and head_admin** have no restrictions: next stage, or any other
  stage forward or back, on any order (waiting ones too), no timer, after
  confirming "Are you sure you want to advance this order to the next
  stage?" / "…move this order to Stage N?" (`admin_set_order_stage`, 0023).
  The 3-minute timer is production's only: an admin move never starts one
  (and clears a running one).

| # | Name |
|---|---|
| 1 | Start |
| 2 | Mid |
| 3 | Testing |
| 4 | End of Production |
| 5 | Dispatch and Deliver |

Names are display labels (`lib/orders.ts`); the database tracks and enforces
only the stage number.

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

`profiles` (id, username, full_name, role) · `orders` · `order_items` ·
`order_assignees` · `order_stage_events` · `production_settings` ·
`notifications`. Reads go through the `order_feed` view, which nulls `price`
(the order subtotal = Σ(price + GST) + Additional Amount) and
`additional_amount` for anyone who isn't admin-tier or the marketing account
that created the order, lists `assignee_ids`, carries `items` (the products,
each price and GST nulled by the same rule) and `ship_to` (visible to all).
`orders.price`, `orders.additional_amount`, `order_items.price` and
`order_items.feat` are not selectable by API roles at all (0010, 0019–0021), and
Realtime payloads omit them for the same reason. Since 0019,
`orders.product_name / transformer_rating / quantity / description` mirror the
first product (DB functions use product_name as the order's title) and
`orders.price` holds the total; the app reads products only from `items`.

Production never sees a price, GST, Additional Amount or subtotal anywhere —
page, CSV, list PDF or spec sheet PDF all drop those columns for that role,
not just blank them.

Writes to orders / assignees / stage history go only through the server
actions (service role, session-checked) — there are no direct-write RLS
policies for those tables (0012).

Migrations 0001–0005 build the original schema; **0008 is a hard reset** that
drops the old auth/messaging/projects system and rebuilds around orders.
0012 adds the current order fields and multi-member assignment. 0019 adds
products per order (`order_items`, every existing order backfilled as a
one-product order) and keeps the pre-0019 `create_order` signature as a
one-product wrapper for the deploy window. 0020 adds `order_items.feat`.
0021 is **additive only** (no existing row is updated): `orders.ship_to`,
`orders.additional_amount`, GST computed on read, a 7-arg `create_order`
(the 0020 5-arg and 0019 9-arg versions stay for the deploy window) and the
admin stage override. 0022 adds the `dispatcher` role; 0023 (additive) adds
the dispatch step: `orders.review_started_at/_by`, dispatcher read policies,
`start_order_review()`, `dispatch_order()`, `admin_set_order_stage()`, and
production locked out of Stage 1. Orders already at Stage 1 when it went live
were moved to Stage 2 by the one-off `scripts/0023_move_stage1_orders.sql`
(except those whose production member had no phone linked). **0024 removes
the dispatcher feature** — no row changes (`scripts/0024_snapshot.sql`
before == after): the dispatch functions and policies are dropped and
production may start Stage 1 again. Kept, so nothing is deleted: the
dispatcher accounts and PINs (they can't sign in), the enum value and the
(all-null on live) review columns. `scripts/0024_rollback.sql` re-runs 0023.

`supabase/scripts/` holds one-off data scripts (not migrations): per-migration
`*_verify.sql` / `*_rollback.sql`, `0021_snapshot.sql` (a read-only
fingerprint of every existing order and product — run before and after a
migration; the output must match), `clear_test_orders.sql`.

---

## 4a. Data management & activity log (admin tier)

`/dashboard/data` lets admin and head_admin remove data that marketing and
production accounts build up:

- delete an individual order punched by a marketing account (also from the
  order page), with its stage history and notifications;
- delete an individual stage update made by a production account (history
  only — the order keeps its stage);
- **reset** an account in one step: choose what to delete (orders / stage
  updates / notifications) and type the username. Only once it matches are
  two choices offered — **Download this data** (a PDF archive of exactly what
  will be deleted, `/dashboard/data/export`; deletion starts only after the
  file is in hand, and a failed download deletes nothing) or **Delete this
  data completely**. The audit row records whether a copy was downloaded.
  For production, "orders assigned to this account" is opt-in, because it
  deletes those orders for everyone involved.

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

## 5a. Performance notes

Measured with a headless browser against a local stack with a 200 ms delay
injected on every server→Supabase call (the old Vercel iad1 → Supabase
ap-south-1 hop):

| Action | Before | After | DB calls |
|---|---|---|---|
| Advance stage (click → UI updated) | 4.2 s | 1.1 s | 85 → 26 |
| Punch order | 2.6 s | 0.8 s | 51 → 13 |
| Open an order from the list | 1.0 s | 0.4 s | 7 → 6 (parallel) |

What was causing the lag, and the fix:

- **Region.** Functions ran in Vercel `iad1` (Washington) while the
  database is in Mumbai — every query crossed the globe. `vercel.json` pins
  functions to `bom1`.
- **Duplicate auth round trips.** The proxy verified the user and loaded the
  profile on every request, then every page did both again. The proxy now
  only refreshes the cookie; `requireSession()` does one parallel check.
- **Sequential reads.** Layout, list and detail reads now run in one
  parallel round.
- **Refresh storm after an action.** `StageControl` called `router.refresh()`
  even though the action response already carries the new page, and each of
  the two realtime events then refreshed again (and re-ran every prefetch) —
  the UI waited for all of it. Now: no manual refresh, realtime events are
  coalesced into one debounced refresh, hidden tabs defer it.
- **Stage advance** is one atomic RPC (`advance_order_stage`, 0015) instead
  of read + update + background insert.
- **Realtime auth race.** On a fresh page load the browser subscribed before
  its session loaded, joining as anon — the notification bell and production
  list never updated live after a hard reload. Channels now join only after
  the session token is set (`lib/realtime.ts`).

## 6. PDF and CSV export

Every PDF prints dark: all text is Helvetica-Bold in black (navy for
headings, white on the navy group bands), for the office printer. Cell
overflow is guarded with bold glyph widths (`lib/pdf/fit.ts`).

- Order detail page → **Download PDF**: an order specification — a ruled
  Field | Value table, one field per row (client, ship to, products, order
  subtotal, expected delivery date, current stage "Stage 2 of 5", status,
  production, punched by/on, Additional Amount), then a ruled **Products**
  table (#, product name, rating, qty, price, GST 18%, total incl. GST) with
  the three-line breakdown (products incl. GST, Additional Amount added,
  order subtotal). No descriptions in any
  order PDF — they stay on the order page. Current stage only, no
  history.
- Orders list → **Download All Orders** (admin and marketing): one PDF with
  a ruled table of every order the viewer can see, for **this / an earlier
  week, month or year** (by punch date, IST, Monday–Sunday weeks) or all
  time. Rows are grouped — year → months, month → weeks, week → days, all
  time → months — each heading with its count (and value subtotal where the
  viewer may see prices). One row per order; its products sit in a block of
  ruled lines inside the row (name, rating, qty, price, total incl. 18% GST);
  then the order subtotal, …, punched on, and the Additional Amount. With the
  money columns the table has 16 columns, so it uses 7pt text, amounts as
  bare numbers under "(INR)" headers, and `lib/pdf/fit.ts` hyphenates a word
  too wide for its cell instead of letting it cross the rule.
  `/dashboard/orders/pdf?period=month&at=YYYY-MM-DD`; period logic in
  `lib/periods.ts`.
- Every PDF: a letterhead on each page — the NR Industries logo
  (`lib/pdf/logo.ts`, embedded) and company address on the left, the
  document title and "Generated: <date> <time>" (IST) on the right — and a
  footer of only "NR Industries", no names. Company details live in one
  place: `COMPANY` in `lib/pdf/Chrome.tsx`.
- Both order PDFs end with a signature block (a line, "(Head)", "NR
  Industries"); the spec sheet puts it at the foot of its last page. The
  account archive has none.
- Orders list → **Export CSV**: **one row per product** ("Product no." 1 of
  3…, order fields repeated; Price, GST and Total incl. GST per product; the
  Additional Amount and Order subtotal only on each order's first product row,
  so summing a column never double-counts); one field per column with the form's labels;
  stage number and stage name in separate columns; dates `DD/MM/YYYY`,
  timestamps IST `DD/MM/YYYY HH:MM`; formula-injection safe.

**Dates** are DD/MM/YYYY everywhere (pages, PDFs, CSV, activity log), times
in IST — all through `lib/utils.ts`. The Punch Order form's date field is our
own (`components/ui/DateField.tsx`): the browser's date input follows the
device locale (often MM/DD/YYYY) and can't be forced to DD/MM/YYYY.
- Production never gets a price, GST, Additional Amount or subtotal
  row/column in any of them. Names are
  "Real Name (Production 1)".

Both are plain GET routes (`/dashboard/orders/[id]/pdf`,
`/dashboard/orders/pdf`) rendered server-side with `@react-pdf/renderer`, so
they require no client JS and respect the same session/RLS scoping as the
pages they sit on.

## 7. Layout

```
app/(auth)/login/        username + password, the only way in
app/dashboard/orders/     list · new (punch order) · [id] (detail + stage control)
app/dashboard/orders/*/pdf/  PDF export route handlers
app/dashboard/settings/   production phone registration
lib/auth/                 PIN login/logout actions · requireSession/requireRole
lib/actions/orders.ts     punchOrder · advanceStage · setStage  (service-role, session-checked)
lib/actions/production.ts saveProductionPhone
lib/actions/admin.ts      deleteOrder · deleteStageEvent · resetAccount  (admin's own session, RLS-gated)
app/dashboard/data/       data management (admin tier)
app/dashboard/activity/   audit log viewer (admin tier)
lib/whatsapp.ts           the stub
lib/permissions.ts        role → capability matrix
lib/pdf/                  react-pdf document components for the exports above
lib/realtime.ts           realtime hooks (join as the signed-in user; debounced live refresh)
vercel.json               functions pinned to bom1 (next to the Mumbai database)
lib/env.ts                requireEnv() — fail fast on missing config instead
                           of a cryptic error deep inside supabase-js
```
