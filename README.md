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

**Dispatch** (`/dashboard/orders/new`, marketing only) — product name, quality,
quantity, power/type, description, price, and **Send to production** (pick one of
production1–4). Button: *Proceed with product*.

- If the chosen production account has a **saved + confirmed phone number**, the
  order is `active`, assigned to them, and the WhatsApp group-creation stub fires.
- If not, the order is created with status `waiting_on_production_phone`. It
  becomes `active` automatically the moment that account saves its number.

**Production settings** (`/dashboard/settings`, production only) — register the
phone number for WhatsApp order groups. Saving sets `confirmed_at` (there is no
way to actually verify a number without the WhatsApp API) and activates any
parked orders.

**Stages** (`orders.stage`, 1–5) — only the assigned production account can
advance, one step at a time:

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

## 4. Schema (`supabase/migrations/0008_orders_reset.sql`)

`profiles` (id, username, full_name, role) · `orders` · `order_stage_events` ·
`production_settings` · `notifications`. Reads go through the `order_feed` view,
which nulls `price` for anyone who isn't admin-tier or the marketing account that
created the order.

Migrations 0001–0005 build the original schema; **0008 is a hard reset** that
drops the old auth/messaging/projects system and rebuilds around orders.

---

## 5. Run it

```bash
supabase start          # local Postgres + Auth + Studio + Mailpit
supabase db reset        # apply migrations + seed the 10 accounts
npm run dev              # http://localhost:3000
```

Then sign in as any account above.

## 6. Layout

```
app/(auth)/login/        username + password, the only way in
app/dashboard/orders/     list · new (dispatch) · [id] (detail + stage control)
app/dashboard/settings/   production phone registration
lib/auth/                 login/logout actions · requireSession/requireRole
lib/actions/orders.ts     dispatchOrder · advanceStage  (service-role, session-checked)
lib/actions/production.ts saveProductionPhone
lib/whatsapp.ts           the stub
lib/permissions.ts        role → capability matrix
```
