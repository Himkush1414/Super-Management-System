#!/usr/bin/env bash
# ============================================================================
# scripts/db-backup.sh: a full, read-only backup of the Supabase database
# (roles, schema and data), written OUTSIDE the repository.
#
#   SUPABASE_DB_URL='postgresql://...' scripts/db-backup.sh [out-dir]
#   scripts/db-backup.sh --local [out-dir]        # the local dev stack (testing)
#
# - Only reads: it runs pg_dump (through `supabase db dump`) and nothing else.
#   It never uses --linked, so it can't pick a project by accident.
# - The connection string comes from the environment only (never an
#   argument), so it doesn't land in the shell history or `ps`.
# - out-dir defaults to /mnt/d/_private-backup/db-backups. It refuses any
#   folder inside the repository: the repository is public and the backup
#   holds customer data and PIN hashes.
# - Writes <out-dir>/<UTC time>/{roles,schema,data}.sql and SHA256SUMS. With
#   NR_BACKUP_PASSPHRASE_FILE set it encrypts each file with gpg (AES-256)
#   and deletes the plain copies.
# - NR_PG_VERSION: the Supabase Postgres image tag for pg_dump (default
#   17.6.1.166, the live server's version; see Dashboard -> Settings -> Infrastructure).
# Restore and the weekly routine: docs/DATA-SAFETY.md.
# ============================================================================
set -euo pipefail
umask 077

mode=remote
if [ "${1:-}" = "--local" ]; then mode=local; shift; fi
out_root=${1:-/mnt/d/_private-backup/db-backups}

repo=$(cd "$(dirname "$0")/.." && pwd -P)
mkdir -p "$out_root"
out_root=$(cd "$out_root" && pwd -P)
case "$out_root/" in
  "$repo"/*) echo "refusing to write a backup inside the repository ($out_root)" >&2; exit 2 ;;
esac

if [ "$mode" = remote ]; then
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo "set SUPABASE_DB_URL (Supabase dashboard -> Connect -> Session pooler URI) or use --local" >&2
    exit 2
  fi
  src=(--db-url "$SUPABASE_DB_URL")
else
  src=(--local)
fi

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
out="$out_root/$stamp${NR_BACKUP_TAG:+-$NR_BACKUP_TAG}"
mkdir "$out"

# pg_dump must match the server's Postgres version (the live project runs
# 17.6). The CLI picks its pg_dump image from supabase/.temp/postgres-version,
# so give it a scratch workdir with the project's config and that version.
pg_image=${NR_PG_VERSION:-17.6.1.166}
wd=$(mktemp -d); trap 'rm -rf "$wd"' EXIT
mkdir -p "$wd/supabase/.temp"
for f in "$repo"/supabase/*; do ln -s "$f" "$wd/supabase/"; done   # config.toml, templates, ...
echo "$pg_image" > "$wd/supabase/.temp/postgres-version"
dump() { supabase --workdir "$wd" db dump "${src[@]}" "$@"; }

echo "backing up ($mode) into $out"
dump --role-only -f "$out/roles.sql"
dump -f "$out/schema.sql"
# storage.buckets_vectors / vector_indexes belong to the platform (not
# writable on restore) and this project doesn't use them.
dump --data-only --use-copy -x storage.buckets_vectors -x storage.vector_indexes -f "$out/data.sql"

for f in roles schema data; do
  [ -s "$out/$f.sql" ] || { echo "empty $f.sql: the backup failed" >&2; exit 1; }
done
grep -q '^COPY "public"."orders" ' "$out/data.sql" || { echo "data.sql has no public.orders: the backup failed" >&2; exit 1; }

rows=$(awk '/^COPY "public"\."orders" /{on=1;next} on&&/^\\\.$/{exit} on{n++} END{print n+0}' "$out/data.sql")
(cd "$out" && sha256sum roles.sql schema.sql data.sql > SHA256SUMS)

if [ -n "${NR_BACKUP_PASSPHRASE_FILE:-}" ]; then
  for f in roles schema data; do
    gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$NR_BACKUP_PASSPHRASE_FILE" \
        --symmetric --cipher-algo AES256 -o "$out/$f.sql.gpg" "$out/$f.sql"
    rm -f "$out/$f.sql"
  done
  echo "encrypted with gpg (AES-256); SHA256SUMS lists the plain files"
fi

echo "done: $out ($rows orders)"
