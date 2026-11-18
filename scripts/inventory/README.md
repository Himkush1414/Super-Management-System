# Inventory scripts

Local tools for the Inventory module (migrations `0027`–`0031`): import,
account, backup and the rollover dry run. They contain no data, no account values and no keys.
Everything they need comes from `.env.local` (gitignored) or from the shell,
and they never print a secret. None of them deletes anything.

| Variable | Used by | What it is |
| --- | --- | --- |
| `INVENTORY_DOCX_PATH` | import | the product list: a `.docx`, a PDF of the same sheet, or a `.json` in the format of `inventory-sample.dummy.json` |
| `INVENTORY_USERNAME`, `INVENTORY_PIN` | account | the inventory login; generated into `.env.local` if missing |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | all (live) | a personal access token, set in the shell only for the run |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | import, backup (other databases) | used when no access token is set |
| `INVENTORY_ENV_FILE` | all | another env file instead of `./.env.local` |
| `INVENTORY_BACKUP_DIR` | backup | where backups go (default `D:\NR-Backups\inventory`; never inside the repo) |

## Import the product list

```sh
node scripts/inventory/import-docx.mjs          # dry run: counts and issues only, writes nothing
node scripts/inventory/import-docx.mjs --all    # dry run, listing every warning
node scripts/inventory/import-docx.mjs --apply  # import (refused while any blocking issue remains)
```

- **Columns:** Serial No, Material Description, Specification, Rate, UOM
  (imported as a custom column "UOM") and Opening Balance. When the sheet
  also has this month's receipt and issue cells and a closing balance, each
  filled cell becomes one ledger entry dated on the import day.
- **Checks:** the sheet's closing balance is checked against opening +
  receipts − issues. Up to 0.5 of difference is rounding on the printed sheet:
  the opening (or one cell) is adjusted so the balance matches the sheet, and
  every such row is listed. A larger difference is a blocking issue.
- **Cleaning:** serials are kept exactly as written and only trimmed.
  Duplicates are listed as blocking issues and never merged.
- **Re-running:** the import upserts on `serial_no` and is atomic. A re-run adds
  nothing: existing products only get their text, rate and UOM refreshed,
  and their opening balance and ledger are never touched.
- **PDFs:** reading a PDF needs `python3` with PyMuPDF (`pip install pymupdf`).

## Create the inventory account

```sh
node scripts/inventory/create-account.mjs              # create it if it doesn't exist
node scripts/inventory/create-account.mjs --reset-pin  # (re)set its PIN from INVENTORY_PIN
```

The account is created the way every fixed account was: by the database
owner, with an unknowable Auth password and a bcrypt PIN set through
`set_account_pin()`. It signs in on the normal login page with username +
6-digit PIN, through `pin_login_attempt()` and its lockout. It has no
sign-up and no recovery.

## Back up the inventory tables

```sh
SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<ref> node scripts/inventory/backup.mjs
node scripts/inventory/backup.mjs --out "E:\Backups\inventory"   # another folder
```

Read-only (a `begin read only` transaction, or GET requests only). It writes
JSON, an additive `.restore.sql` and checksums to a folder outside the
repository, and prints only row counts. Restore steps:
[docs/inventory/BACKUP.md](../../docs/inventory/BACKUP.md).

## Month rollover: dry run

```sh
SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<ref> node scripts/inventory/rollover-dry-run.mjs --as-of 2026-12-01
```

Read-only (one SELECT in a `begin read only` transaction). It prints **counts
only**: which months the rollover would close and into which table, how many
snapshot rows each would get, and how many products would start the month
pending (balance to be counted, migration 0031). It works before and after
0031. Without `--as-of` it looks at the 1st of next month (IST).

## Tests

`tests/sql/*.test.mjs` run every migration on an in-process Postgres
(PGlite) and check the role matrix, the ledger rules and the backup's
restore. They are part of `npm test`, which CI runs on every pull request:

```sh
npm test
```
