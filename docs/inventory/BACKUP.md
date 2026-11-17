# Inventory backup and restore

`scripts/inventory/backup.mjs` copies every Inventory table to files on
your computer. It **only reads**: it never changes, adds or deletes anything
in the database. The script holds no data and no keys.

| | |
|---|---|
| **What** | all 7 `inv_` tables: products, ledger entries, month snapshots, closed months, settings, columns, product change log |
| **Where** | `D:\NR-Backups\inventory` by default, always **outside** the repository (it refuses a folder inside it) |
| **Files** | `inventory-backup-<date>_<time>-IST.json` (every row), `.restore.sql` (the same rows as additive inserts) and `.sha256` (checksums) |
| **Prints** | table names and row counts only, never a row or a key |
| **Whole database** | for orders, accounts and everything else, use `scripts/db-backup.sh` ([DATA-SAFETY.md](../DATA-SAFETY.md)) |

> The backup files hold the real store data. Keep them on drive D or another
> private disk. Never commit them, never put them in the repository folder,
> and never share them publicly.

## Take a backup

From the repository folder (WSL or Git Bash), with a Supabase personal
access token set **in the shell only** for this one command:

```sh
SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<project ref> node scripts/inventory/backup.mjs
```

Other folder: add `--out "E:\Backups\inventory"`, or set `INVENTORY_BACKUP_DIR`.

<details>
<summary>Without an access token</summary>

With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` of the live
project (in the shell, or an env file named by `INVENTORY_ENV_FILE`), the
script reads the same tables with plain GET requests instead.
The repository's own `.env.local` normally points at the local development
database, not live.
</details>

How it stays read-only:
- With a token, every read runs inside `begin read only … rollback`, so Postgres itself refuses any write.
- Without one, only `GET` requests are sent.
- Tables are read in pages of 1,000 rows. Each table's row count is checked against the rows read; if someone saved an entry during the backup, the script stops and asks you to run it again.

Check a backup at any time:

```sh
cd /mnt/d/NR-Backups/inventory && sha256sum -c inventory-backup-<date>_<time>-IST.sha256
```

**Suggested routine:** once a week, plus before any change to the database.
Keep at least the last 8.

## Restore (only if inventory data was lost)

> **Never restore over a working live database.** First restore into a new or
> test Supabase project and check it. Only restore into live if the inventory
> tables there are gone or empty, and with the owner's go-ahead.

The `.restore.sql` file:
- only **adds rows that are missing** (`on conflict do nothing`); it never deletes and never changes a ledger entry;
- is safe to run twice;
- keeps the original entry ids, then moves the id counters past them, so new entries keep working;
- skips the 8 default columns, which the migration already created; your own columns keep their ids, which the products' custom values point at;
- also restores the inventory person's name and phone.

Steps:
1. **Check the files:** `sha256sum -c …sha256` must print `OK` for both.
2. **Prepare the target:** a Supabase project with all migrations applied up to `0030`, including the user accounts if you want "saved by" names to show.
3. **Run the SQL:** open Supabase → SQL Editor, paste the whole `.restore.sql` and run it.
   Or use `psql "$SUPABASE_DB_URL" -f inventory-backup-….restore.sql`.
4. **Compare:** the last query prints each table's count next to the backup's count (in a comment).
   Each must be at least the backup's number.
5. **Open Inventory** and spot-check a few balances against the last export.

What "restored" means here was tested: a fake store backed up and restored
into an empty database gives exactly the same entries, balances, closed months,
minimums and party data, and new receipts and issues still work
(`tests/sql/inventory-backup.sql.test.mjs`).
