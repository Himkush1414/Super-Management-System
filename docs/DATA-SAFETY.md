# Data safety: backups, restore, and changing data safely

The orders, their stage history and the staff accounts live in one
Supabase Postgres database. This page says what protects that data, how to
back it up, how to get it back, and the rules for anyone who touches it.
No secret values are kept here.

## The rules

1. **Never run SQL that changes or deletes data on the live database
   without a fresh backup.** The Supabase SQL editor runs as `postgres`:
   row-level security doesn't apply there, and there is no undo.
2. **Never restore over the live database.** Restore into a new project
   (or the local stack), check it, and only then decide what to do.
3. One-off SQL that changes data (moves, clean-ups, rollbacks) is kept
   privately, never in this public repository (`.gitignore` keeps
   `supabase/scripts/*` out except read-only `*_verify.sql` and
   `*_snapshot.sql`). Treat any such file as dangerous: read it in full
   before running it, and never paste a script you didn't write.
4. Database changes go in additive migrations (new things only), applied by
   the owner, with `*_snapshot.sql` run before and after: the two outputs
   must be identical.
5. Backups contain customer data and PIN hashes. They never go into this
   repository, a GitHub Actions artifact (anyone can download those from a
   public repo), a chat or an email.

## What protects the data today

- **Who can delete:** only admin-tier accounts, one order or one stage
  update at a time (row-level security). Production and marketing can't
  delete anything.
- **Every delete is recorded:** `audit_log` is append-only (no update,
  delete or truncate, enforced by triggers). Each deleted order is
  recorded with a full JSON snapshot of the order, its products and its
  history, plus who deleted it and when. Account resets record a summary
  and an export.
- **Prices stay hidden** from production at the database level (column
  grants and viewer-aware functions), not only in the app.
- **Waiting to be applied** (open PRs labelled *do NOT merge before
  applied*; they protect nothing until the owner applies them):
  - **0025, bulk-delete guard (#36):** one `DELETE` statement may remove
    at most one row from the order, account and notification tables, and
    `TRUNCATE` of them is refused. A pasted `delete from orders;` then
    fails with nothing removed. The app's single delete, its cascades and
    the audited account reset still work.
  - **0026, API write lockdown (#37):** signed-in sessions can no longer
    change orders, settings or notifications by calling the REST API
    directly. Only the app's own paths can write.

## Backups

### Supabase's own backups (check this first)

Dashboard → **Database → Backups**. What you get depends on the plan:
- Free: no downloadable daily backups and no point-in-time recovery.
- Pro: daily backups kept 7 days.
- The Point-in-Time Recovery add-on: restore to any second.

Check which applies today. For a business system, **Pro with daily backups
is the minimum**; add PITR if losing a day of orders would hurt.

### Our own backup: `scripts/db-backup.sh`

Supabase's backups live inside Supabase. Keep a copy outside it as well.

```bash
# once: the connection string, kept private (never in the repo)
mkdir -p ~/.config/nr-backup && chmod 700 ~/.config/nr-backup
cat > ~/.config/nr-backup/env <<'X'
export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<db password>@<pooler host>:5432/postgres'
export NR_BACKUP_PASSPHRASE_FILE="$HOME/.config/nr-backup/passphrase"
X
chmod 600 ~/.config/nr-backup/env
# a long random passphrase; ALSO store it in the password manager, or the backups are unreadable
head -c 48 /dev/urandom | base64 > ~/.config/nr-backup/passphrase && chmod 600 ~/.config/nr-backup/passphrase

# every backup
source ~/.config/nr-backup/env && scripts/db-backup.sh
# -> /mnt/d/_private-backup/db-backups/<UTC time>/{roles,schema,data}.sql.gpg + SHA256SUMS
```

- The URL is in Dashboard → **Connect** → *Session pooler* (port 5432),
  with the database password (`docs/SECURITY.md` says where it is kept).
- The script only reads (pg_dump). It refuses to write inside the
  repository, and it fails loudly if a file is empty or has no orders.
- pg_dump must match the server's Postgres version, 17.6 today. If
  Supabase upgrades the project, set `NR_PG_VERSION` to the new image tag
  (Dashboard → Settings → Infrastructure).

**Routine:**
- **Weekly,** and **always before** applying a migration or running any
  SQL that changes data.
- Keep **two copies**: the D: drive, plus an offline USB drive or a private
  cloud folder.
- Delete copies older than about 3 months, but keep one from each month.

To run it weekly by itself, add a Windows Task Scheduler task (weekly) that
runs:

```
wsl.exe -e bash -lc "source ~/.config/nr-backup/env && /home/manik/work/nr-web/scripts/db-backup.sh >> ~/.config/nr-backup/backup.log 2>&1"
```

## Restore

### A whole database, into a new project (never over live)

1. Create a new Supabase project in the same region as the old one and
   with the same Postgres major version (17).
2. Decrypt the backup, if it's encrypted, and check it:
   ```bash
   cd /mnt/d/_private-backup/db-backups/<time>
   for f in roles schema data; do gpg --batch --pinentry-mode loopback \
     --passphrase-file ~/.config/nr-backup/passphrase -d -o $f.sql $f.sql.gpg; done
   sha256sum -c SHA256SUMS
   ```
3. Load it. `NEW_DB_URL` is the **new** project's session pooler URL.
   `roles.sql` only re-applies role settings: one *permission denied for
   parameter* error there is expected and harmless. Schema and data load
   in **one transaction**, so it is all or nothing.
   ```bash
   PSQL="docker run --rm -i public.ecr.aws/supabase/postgres:17.6.1.166 psql"
   $PSQL "$NEW_DB_URL" -f - < roles.sql
   ( cat schema.sql; echo 'SET session_replication_role = replica;'; cat data.sql ) \
     | $PSQL "$NEW_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -q -f -
   ```
4. Check it:
   - Compare the counts with the old project, if it's reachable: orders,
     order_items, order_stage_events, profiles, audit_log.
   - Run the latest `supabase/scripts/*_verify.sql`.
   - Sign in on a Vercel **preview** pointed at the new project.
5. Only then switch the Vercel production variables
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`) to the new project and redeploy.
6. The staff PIN hashes and the sign-in accounts come back with the data,
   so everyone signs in as before. Signed-in sessions don't carry over:
   people sign in again.

**Tested:** on 2026-11-03 a backup of the local stack was restored this
way into a fresh database on the local server. The restored copy's
fingerprint (row count and md5 of every row in 14 tables, `auth.users`
included) was identical to the source.

### One deleted order

Every deleted order is in `audit_log` (`action = 'order.delete'`). Its
`details` hold the full order row, its products (`items`) and its stage
history (`stage_events`). Ask for
help before re-inserting one by hand: it has to go through the service role
in one transaction, keep its original id, and not start a new stage timer.

### Practise

Once a quarter, restore the newest backup into the local stack or a
throwaway project, and compare the counts. A backup that has never been
restored isn't known to work.

## Changing many rows on purpose

After 0025, a bulk delete needs an explicit switch that only lasts for one
transaction:

```sql
-- 1. backup first (scripts/db-backup.sh), 2. run *_snapshot.sql
begin;
set local nr.allow_bulk_delete = 'on';
delete from ... where ...;      -- read the row count it prints
-- check the result here; if anything looks wrong:  rollback;
commit;
```

`set local` ends with the transaction, so the guard is back on afterwards
by itself.
