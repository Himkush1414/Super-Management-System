<div align="center">

# Inventory module

**Store stock on an append-only ledger: receive, issue, month-start balance, minimum-stock alerts, Party search and exports.**

Part of [NR Management](../../README.md) · Next.js 16 · Supabase Postgres with row-level security · works inside the Android app

</div>

<p align="center">
  <img src="screens/desktop-overview.png" alt="The Inventory page on a desktop: alert box, summary cards, search and Party fields, the product table (fake sample data)" width="860">
</p>

<sub>Every screenshot on this page was taken from a local copy with **fake sample data** (serials like ZZ-001, made-up party names). No real product, party or quantity appears anywhere in this repository.</sub>

---

> **Guides:** [Quick guide for the store person](USER-GUIDE.md) · [How it works, in plain words](HOW-IT-WORKS.md) (ledger, rollover, low-stock alert) · [Backup and restore](BACKUP.md)

## Contents

- [What it does](#what-it-does)
- [Roles and access](#roles-and-access)
- [How the numbers work](#how-the-numbers-work)
- [Month-start balance](#month-start-balance)
- [Receive and issue](#receive-and-issue)
- [Minimum stock alert](#minimum-stock-alert)
- [Party search](#party-search)
- [Exports](#exports)
- [Speed](#speed)
- [Data model](#data-model)
- [Setup](#setup)
- [Backup](#backup)
- [Security](#security)
- [Testing](#testing)

## What it does

| | |
|---|---|
| **Stock table** | Serial No, Material Description, Specification, Rate, Opening Balance, Receiving, Issue, Balance, plus the store's own columns. Cards on phones, an expandable table from 768 px. |
| **Instant search** | Every product, case-insensitive, extra spaces ignored, matches highlighted, under 100 ms per keystroke. |
| **Receive / Issue** | Quantity, date and the entry's details, then a confirm step showing the balance before and after. One tap saves once, even on a double tap or a retried request. |
| **Month-start balance** | From 1 December 2026, every product starts the month **Pending**; the store enters the counted balance (fast screen: Enter saves and moves on, *Same as opening*). Saved as an append-only *Stock count* with its adjustment. |
| **History** | Each product's recent entries with their details; a mistake is fixed with **Reverse**, never by editing or deleting. |
| **Minimum stock** | An optional minimum per product; an alert box and a Low Stock list when the balance drops below it. |
| **Party search** | A second search field: the products received from a party (all months), with the quantity and the last challan, bill and date. |
| **Exports** | PDF, Word and Excel for this week, this month, the previous month, all time or any dates. |
| **Settings** | The inventory person, custom columns (add, rename, reorder, show / hide, archive) and minimum stock in bulk. |
| **Admin view** | head_admin and admin see everything read-only, plus a 6-month trend, the month's top 10 issued and a month selector. |

<table>
  <tr>
    <td align="center" width="25%"><img src="screens/phone-list.png" alt="Phone: stock cards" width="200"><br><sub>Phone: the stock list</sub></td>
    <td align="center" width="25%"><img src="screens/phone-receive-details.png" alt="Phone: receive form with challan, bill no and bill date" width="200"><br><sub>Receive with its details</sub></td>
    <td align="center" width="25%"><img src="screens/phone-history-details.png" alt="Phone: history showing an entry's party, challan and bill" width="200"><br><sub>History with the details</sub></td>
    <td align="center" width="25%"><img src="screens/phone-low-stock.png" alt="Phone: Low Stock list with balance, minimum and shortfall" width="200"><br><sub>The Low Stock list</sub></td>
  </tr>
</table>

## Roles and access

| | inventory | head_admin, admin | marketing, production |
|---|:---:|:---:|:---:|
| Open the Inventory module | ✅ (only this module) | ✅ read-only | — |
| Receive, issue, reverse | ✅ | — | — |
| Enter month-start balances (stock counts) | ✅ | sees the Pending state and count, read-only | — |
| Add, edit, archive products; minimums | ✅ | — | — |
| Inventory settings | ✅ | — | — |
| Alert box, Low Stock list, Party search, history | ✅ | ✅ | — |
| Trend, top 10, month selector | — | ✅ | — |
| Exports (PDF, Word, Excel) | ✅ | ✅ | — |

The same rule is enforced three times: the screen, every server action and route (`requireSession` + the permission matrix in `lib/permissions.ts`), and **Postgres row-level security** with role-checked functions. The UI is never the gate. The inventory account signs in on the normal page with username + 6-digit PIN, through the same `pin_login_attempt()` lockout as everyone else; it cannot open any other page.

## How the numbers work

```mermaid
flowchart LR
  P["Product<br/>opening_qty<br/>opening_month"] --> B
  L["Ledger<br/>(append-only)"] --> B
  C["Stock counts<br/>(append-only, 0031)"] -->|adjustment| A[Adjustment]
  B["Balance = Opening + Adjustment + Receiving − Issue"]
  L -->|receipts this month| R[Receiving]
  L -->|issues this month| I[Issue]
  A --> B
  R --> B
  I --> B
  S["Month snapshots<br/>opening · (adjustment) · received · issued · closing"] -.->|closed months| H[History / month selector]
```

- **Append-only ledger.** Every receipt or issue is a new row in `inv_transactions`; database triggers refuse UPDATE, DELETE and TRUNCATE, even for the database owner. A mistake is corrected with a **reversal**: a new entry of the same kind that cancels it (it copies the original's details). Products and columns are archived, never deleted.
- **Exact numbers.** Quantities are `numeric(14,3)`, rates `numeric(14,2)`; the app computes in integer thousandths and paise (`bigint`), never floating point. Money is shown en-IN: ₹1,23,456.00.
- **Opening = last month's closing.** The opening of a month is the balance before its first day, so it always equals the previous month's closing. It is never typed.
- **Dates are IST.** An entry's date must be in the current month and not in the future, so a closed month never changes.
- **Over-issue is refused** in the database, under a row lock: an issue larger than the balance never saves. From 0031 the balance includes stock count adjustments, and a trigger on the ledger refuses any entry (from any function, old or new) that would take a balance below zero.
- **The one calculation change (0031):** Balance = Opening + Adjustment + Receiving − Issue. Adjustment = the month's stock counts (counted − balance before). Months before December 2026 have no adjustment and calculate exactly as before.

### Month rollover

```mermaid
sequenceDiagram
  participant U as Anyone opens Inventory
  participant DB as Postgres
  U->>DB: inv_page3()
  DB->>DB: inv_rollover2(): any ended month not closed yet?
  alt one or more months ended
    DB->>DB: months before counts_from: snapshot exactly like inv_rollover<br/>(opening, received, issued, closing)
    DB->>DB: months from counts_from: snapshot with the adjustment<br/>(inv_month_snapshots2, confirmed flag)
    DB->>DB: mark the month closed
  end
  DB-->>U: this month's figures, each row pending or confirmed
```

The rollover is idempotent and fills gaps: if nobody opened the module for three months, all three are closed in order, each month's opening equal to the one before's closing. Before 0031 the page called `inv_page2()` / `inv_rollover()`; both still exist and work, and `inv_rollover2()` closes November 2026 with the very same SQL, into the same table.

## Month-start balance

| | |
|---|---|
| **When** | Every month from `inv_count_settings.counts_from` (set by migration 0031 to the month after it was applied: **1 December 2026** on live). |
| **Pending** | An active product that existed before the month and has no stock count in it yet. Derived, not stored: the rollover writes nothing for it. |
| **Counting** | `inv_record_stock_count`: one append-only `inv_stock_counts` row, `adjustment = counted − balance before` (generated column), user and time. The first count of a pending product is dated the 1st (it *is* the month-start balance). |
| **Again later** | A new count adds a new adjustment; nothing is overwritten. |
| **Receive / Issue on a pending product** | `inv_record_entry2(…, p_count, p_count_key)`: the count and the entry in one transaction; an issue larger than the counted balance writes nothing. |
| **Totals and alerts** | Pending products are left out of the stock value, the out-of-stock count and the low-stock alert; *"N of M confirmed"* sits beside the totals. |
| **Who** | inventory enters counts; head_admin / admin see the Pending banner, chip and count, read-only. |
| **Added mid-month** | Confirmed when added (as before). |

```mermaid
stateDiagram-v2
  [*] --> Pending: 1st of the month (product existed before)
  [*] --> Confirmed: product added this month
  Pending --> Confirmed: stock count saved (Enter / Same as opening / Receive-Issue sheet)
  Confirmed --> Confirmed: count again later (new adjustment)
  Confirmed --> Pending: next 1st of the month
```

The fast screen (**Enter balances**) lists the products that were pending when it opened, with the opening, an input, **Same as opening** and the result; **Enter** saves the row (one small request, under 400 ms) and moves the cursor to the next product. Rows stay in place after saving, so focus never jumps.

<table>
  <tr>
    <td align="center" width="30%"><img src="screens/phone-pending.png" alt="Phone: the blue box says 360 products need balance, 0 of 360 confirmed; stock value is 0 because nothing is counted yet (fake data)" width="200"><br><sub>Phone: products need balance</sub></td>
    <td align="center" width="70%"><img src="screens/desktop-month-balance.png" alt="Desktop: the fast balance screen with an input and Same as opening on every row, 8 of 360 confirmed (fake data)" width="560"><br><sub>The fast balance screen</sub></td>
  </tr>
</table>

**Dry run before the 1st** (read-only, prints counts only): `node scripts/inventory/rollover-dry-run.mjs --as-of 2026-12-01` shows which months the rollover would close, into which table, and how many products would start the month pending.

## Receive and issue

| Receive | Issue |
|---|---|
| Quantity, Date | Quantity, Date |
| **Party** (suggestions from known names) | **Job No** |
| Challan No | Rating |
| Bill No | No. of Jobs |
| Bill Date (not in the future) | |
| Remark | Remark |

- Every detail is optional, plain text, trimmed and length-limited, and always shown escaped.
- The database refuses receive-only details on an issue and issue-only details on a receipt.
- Details are stored on the ledger entry and never edited.
- **Party names** are matched without regard to case or extra spaces ("  Shree  Traders " = "shree traders"); the field suggests existing names so the same party isn't typed in different spellings.
- The confirm step lists every field next to the balance before and after. On a phone it is a bottom sheet that stays above the keyboard.

```mermaid
sequenceDiagram
  participant S as Screen
  participant A as Server action
  participant DB as Postgres
  S->>S: check quantity, date, details
  S->>S: confirm sheet: balance before → after
  S->>A: recordEntry(…, idempotency key)
  par one round trip
    A->>A: session check
    A->>DB: inv_record_entry()
  end
  DB->>DB: role check · row lock · same key? → "already saved"
  DB->>DB: issue > balance? → refused
  DB-->>A: id, balance after, below minimum?
  A-->>S: the confirmed figures (no page reload)
```

## Minimum stock alert

- Each product can have a **Minimum Stock**: set in *Add product*, *Edit details*, or in *Inventory settings*, which has a searchable list (type a number, it saves when you leave the field) and **Set for all filtered**, with a confirmation.
- **Low** = a minimum is set and the balance is **below** it. No minimum, no alert; a balance equal to the minimum is not low. A zero balance shows as **Out of stock**.
- An alert box at the top of the page says *"N items below minimum, order advised"*; tapping it opens the **Low Stock** list (serial, description, balance, minimum, shortfall, last party, last received date). Rows carry a badge, and a **Low** chip filters the list.
- An issue that would take a product below its minimum is **warned about** at confirm, never blocked. After saving, the alert shows for that product.
- The alert follows the live balance: it disappears by itself when stock is received. head_admin and admin see the same alert box, list and a *Low stock* summary card, read-only.

<p align="center"><img src="screens/desktop-minimum-stock.png" alt="Inventory settings: setting one minimum for all filtered products, with a confirmation" width="760"></p>

## Party search

Beside the main search there is a **Party** field with the same suggestions. Typing a party shows only the products received from it, in **all months**, each with the quantity received from that party and its last challan no, bill no and date. It combines with the main search (both must match) and with the Low Stock filter, shows a result count and an empty state, and works in the admin view too.

Party search's data is computed in SQL (`inv_party_index`) and loaded in the background once the page is on screen; typing then filters in the browser, under 100 ms per keystroke even on 3,500 products. Entries recorded before parties were captured have no party, so they don't match; that is expected.

<p align="center"><img src="screens/desktop-party-search.png" alt="Party search in the admin view: products received from one fake party with quantity, challan and bill" width="760"></p>

## Exports

| | PDF | Word (.docx) | Excel (.xlsx) |
|---|---|---|---|
| Layout | A4 landscape, letterhead with the NR Industries logo, repeating header, page numbers | Same letterhead in the page header, repeating table header, page numbers | Frozen, filterable header, numbers you can sum, Indian digit grouping |
| Ranges | This week · This month · Previous month · All · Custom (IST) | same | same |

- **Figures:** Opening is the balance before the start date. Received and Issued are the sums inside the range. Closing is the balance at the end date.
- **Adjustment (0031):** when any row has a stock count adjustment in the range, an **Adjustment** column appears, so Opening + Adjustment + Received − Issued = Closing on every row. A product still pending in the current month prints **Pending** (no closing value) and the summary says *"Confirmed: N of M"*.
- **Text stays text:** every text cell is written as a string (Excel inline strings, never a formula), so a value starting with = + − @ can never run.
- **Totals:** they come from the same summary function as the screen, so they always agree.
- **File name:** `NR Industries Product Specification DD-MM-YYYY to DD-MM-YYYY`.
- **Server-side:** the files are made on the server (no package was added for Word or Excel).
- **One tap:** the button shows *Preparing…* at once and ignores double taps. In the Android app the existing download bridge saves and opens the file.

## Speed

Measured on a local production build with fake data and 40 ms of added database latency, on a phone profile (4× slower CPU, 4G), on 2026-11-17 (PR #59). The live store has under 350 products.

| | Target | 350 products | 3,500 products |
|---|---|---:|---:|
| Skeleton on navigation | ≤ 300 ms | 35 ms | 35 ms |
| Data visible (opened from the menu) | ≤ 1000 ms | 369 ms | 401 ms |
| Tab switch back to Inventory | ≤ 100 ms | 63 ms | 87 ms |
| Search per keystroke (median) | ≤ 100 ms | 50 ms | 34 ms |
| Party search per keystroke (median / slowest) | ≤ 100 ms | 34 / 54 ms | 34 / 51 ms |
| Row expand starts | ≤ 50 ms | 21 ms | 22 ms |
| Save round trip | ≤ 400 ms | 158 ms | 156 ms |
| Export, one month: PDF / Word / Excel | ≤ 2000 ms | 751 / 77 / 74 ms | **6958** / 221 / 199 ms |
| Export, All: PDF / Word / Excel | ≤ 4000 ms | 731 / 76 / 73 ms | **6638** / 217 / 203 ms |

Every target is met at 350 products. At 3,500 products a PDF of every product takes about 7 s (it is 167 A4 pages); Word and Excel stay well under 1 s.

**How the speed targets are met:**
- The main page is **one** SQL call that returns compact rows, with the session check running in parallel.
- Each product is rendered once (a card on phones, a table row on wider screens), 40 at a time.
- History and Party search load from GET routes and are cached for the tab.
- A save returns only its new figures.
- Charts and sheets load lazily and are warmed in the background while the browser is idle.

## Data model

```mermaid
erDiagram
  inv_products ||--o{ inv_transactions : "ledger"
  inv_products ||--o{ inv_stock_counts : "month-start counts (0031)"
  inv_products ||--o{ inv_month_snapshots : "closed months"
  inv_products ||--o{ inv_month_snapshots2 : "closed months from Dec 2026"
  inv_products ||--o{ inv_product_log : "detail changes"
  inv_columns ||..o{ inv_products : "custom values (jsonb)"
  inv_products {
    uuid id
    text serial_no "unique, case-insensitive"
    numeric opening_qty "fixed"
    date opening_month
    numeric rate
    numeric min_stock "nullable"
    jsonb custom
    boolean is_active "archive, never delete"
  }
  inv_transactions {
    bigint id
    text kind "receive | issue"
    numeric qty "> 0"
    date entry_date "IST"
    bigint reverses_id "a reversal"
    text idempotency_key "unique"
    text party
    text party_key "normalised"
    text challan_no
    text bill_no
    date bill_date
    text job_no
    text rating
    text no_of_jobs
  }
  inv_stock_counts {
    bigint id
    date month
    date entry_date "IST"
    numeric counted ">= 0"
    numeric balance_before
    numeric adjustment "generated: counted - balance_before"
    text source "app | import"
    text idempotency_key "unique"
  }
```

Migrations: `0027` (the `inventory` role), `0028` (the module), `0029` (compact page read, indexes), `0030` (details, minimum stock, Party search), `0031` (month-start balance: stock counts, `inv_rollover2`, `inv_page3`, `inv_range_report2`). Every one is additive and idempotent; the functions a migration replaced stay in place and keep working (new behaviour gets a new function name). `supabase/scripts/0031_verify.sql` is a read-only check to run after 0031.

## Setup

Environment variable **names** (values live in `.env.local`, which is gitignored, or in Vercel):

| Name | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the website |
| `SUPABASE_SERVICE_ROLE_KEY` | the website's login step only (never sent to the browser) |
| `INVENTORY_DOCX_PATH` | the product import script (a Word or PDF list) |
| `INVENTORY_USERNAME`, `INVENTORY_PIN` | the account script (generated into `.env.local` if missing) |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | the scripts, for the live project (set in the shell for one run) |
| `INVENTORY_ENV_FILE` | the scripts, to use another env file |
| `INVENTORY_BACKUP_DIR` | the backup script's folder (default `D:\NR-Backups\inventory`) |

1. Apply the migrations in order (`0027` → `0031`) to the database, after checking them. They only add objects.
2. Create the inventory account: `node scripts/inventory/create-account.mjs`.
3. Import the product list: run `node scripts/inventory/import-docx.mjs` (a dry run that prints counts and issues only), then add `--apply`.

More in [`scripts/inventory/README.md`](../../scripts/inventory/README.md).

## Backup

`node scripts/inventory/backup.mjs` copies all 7 `inv_` tables (plus the 4 tables of 0031 once they exist) to `D:\NR-Backups\inventory` (JSON + an additive restore `.sql` + checksums). It only reads, prints only counts, and refuses a folder inside the repository. How to run it and how to restore: [BACKUP.md](BACKUP.md).

## Security

- Row-level security on every `inv_` table; tables are read-only to signed-in accounts, and every write goes through a `SECURITY DEFINER` function that checks the role first.
- Reads run with the caller's own session, so the database decides what each role sees. The service-role key never reaches the browser.
- No hard deletes anywhere in the module; history is append-only and archive replaces delete.
- All text is escaped on display and in every export (XML-escaped in Word and Excel).
- The repository holds only the mechanism: code, schema-only migrations, scripts without values, and fake sample data (`scripts/inventory/inventory-sample.dummy.json`).
- Backups are written only outside the repository; the script refuses a folder inside it.

## Testing

| Suite | What it proves |
|---|---|
| `tests/inventory.test.mjs` (`npm test`) | exact quantities and money, ledger rules, month rollover and gaps, reversal, double submit, search, ranges, low-stock boundaries, party matching (fast on 3,500 products) |
| `tests/permissions.test.mjs` | the role matrix in code |
| `tests/sql/*.test.mjs` | every migration on a real Postgres 17 (PGlite): the role matrix in RLS and functions, append-only guards, the ledger rules, field validation, the old functions still working, reversal copying details, the party index, the compact page equal to the full one, and a backup restored into an empty database giving the same ledger and balances |
| `tests/sql/inventory-month.sql.test.mjs` | 0031 with a fake clock: the 1 December rollover equal to the old one, double run, a gap of several months, pending → confirmed, count + entry atomic, the adjustment identity in every range, the old functions still working (and still unable to over-issue), the role matrix, backup + restore of the new tables, the dry run against the real rollover |
| `tests/inventory-exports.test.mjs` | the export rows and the Excel / Word files: the identity, the Adjustment column only when needed, Pending, text never a formula |

```sh
npm test        # all of the above: 74 tests, about 15 s; CI runs it on every pull request
```

Browser checks (role matrix on every page, the flows, layout at 360 / 390 / 768 / 1024 / 1440 px, exports through the Android app's bridge) run locally against a fake Supabase that applies every migration, so RLS is the real thing.
