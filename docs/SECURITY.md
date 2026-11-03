# Security

How the system's secrets are kept, and how to replace (rotate) each one.
No secret value belongs in this repository: not in code, docs, issues, pull
requests or commit messages.

## Reporting a problem

Found a security problem? Don't open a public issue. Tell the owner
directly.

## What protects the repository

- **Secret scan in CI.** `.github/workflows/secret-scan.yml` runs gitleaks
  on every push and pull request, with the rules in `.github/gitleaks.toml`.
  A finding fails the check.
- **GitHub secret scanning** and **push protection** are on. A push that
  contains a known token format is refused before it lands.
- **Dependabot alerts** and **Dependabot security updates** are on.
- **Website checks.** `.github/workflows/website-checks.yml` runs lint,
  typecheck, unit tests and a production build on every pull request.
- **`.gitignore`** keeps out:
  - env files, signing keys and keystores;
  - Firebase and service-account files;
  - database dumps and backups;
  - APK and AAB builds;
  - the private seed and PIN files;
  - one-off SQL that changes data.

## Where each secret lives

| Secret | Lives in | Used by |
|---|---|---|
| Supabase **service-role key** | Vercel project environment variables | the website's server code only |
| Supabase **anon / publishable key** | Vercel environment variables (public by design) | the browser and the server |
| Supabase **database password** | Supabase dashboard | `scripts/backup-db.sh` (via the `DATABASE_URL` environment variable, never stored) |
| Supabase **personal access token** (Management API) | created when needed, then revoked | applying migrations |
| **Vercel** token | created when needed, then revoked | deploy tooling |
| **GitHub** tokens | the build machine's private environment file, outside the repo | pushes, releases, the `gh` tool |
| **Expo** token | the build machine's private environment file; a GitHub Actions secret if the manual build workflow is used | EAS builds |
| Android **signing key** | EAS (credentials "Build Credentials 8u9t_o15zu"); backup copy offline | every APK |
| Staff **PINs** | bcrypt hashes in the database; the plain PINs only in the owner's private seed files | sign-in |
| Push webhook secret (push is off) | Supabase Vault + the Edge Function's secrets | new-order notifications |

## Rotation steps

Rotate **at once** if a secret was pasted into a chat, an email, an issue or
a commit, or if a laptop with access is lost. Otherwise rotate tokens every
6–12 months.

### Supabase service-role key (and anon key)
1. Supabase dashboard → Project Settings → API Keys. Create a new
   **secret** key (or roll the JWT secret on the legacy keys; that also
   changes the anon key).
2. Vercel → the project → Settings → Environment Variables. Replace
   `SUPABASE_SERVICE_ROLE_KEY` (and `NEXT_PUBLIC_SUPABASE_ANON_KEY` if it
   changed) for Production and Preview.
3. Redeploy the latest production deployment (Vercel → Deployments →
   ⋯ → Redeploy).
4. Check: `/login` loads, a sign-in works, an order page opens.
5. Delete or disable the old key in Supabase.

Note: rolling the legacy JWT secret signs everybody out, so staff must sign
in again. The Android app needs no rebuild; it reads keys from the website.

### Supabase database password
1. Supabase dashboard → Project Settings → Database → Reset database
   password.
2. Update the `DATABASE_URL` you use for backups (in your password manager,
   not in a file in the repo).
3. Run `scripts/backup-db.sh` once to confirm it connects.

The website doesn't use the database password (it uses the API keys), so no
redeploy is needed.

### Supabase personal access token (Management API)
1. Supabase dashboard → Account → Access Tokens. Revoke the token.
2. Create a new one only when a migration has to be applied, and revoke it
   right after.

### Vercel token
1. Vercel → Account Settings → Tokens. Delete the token.
2. Create a new, scoped, expiring token only when needed.

### GitHub tokens
1. GitHub → Settings → Developer settings → Personal access tokens. Revoke
   the old token.
2. Create a **fine-grained** token: only this repository, Contents
   read/write, Pull requests read/write, Workflows if needed, with an expiry
   date.
3. Put it in the build machine's private environment file (outside the
   repo). Never commit it.

### Expo token
1. expo.dev → Account → Access tokens. Revoke the old token, then create a
   new (preferably robot) token.
2. Update the build machine's private environment file and, if the manual
   build workflow is used, the `EXPO_TOKEN` GitHub Actions secret.

### Android signing key
It can't simply be rotated. Phones only accept an update signed with the
same key.
- Keep the key in EAS and a backup offline: `npx eas-cli credentials -p
  android` → Download existing keystore. Store the `.jks` and its three
  passwords together in a password manager or encrypted drive. Never
  commit them.
- If the key itself leaked, the only clean fix is a new package name: a new
  app that staff install fresh, after uninstalling the old one.

### Staff PINs
- One PIN: the owner runs `select public.set_account_pin('<username>',
  '<new 6-digit PIN>');` in the Supabase SQL editor. It also signs that
  account out everywhere.
- Never write PINs in the repo, a chat or an issue.

### Push webhook secret (only once push is on)
1. Create a new random value.
2. Update the Vault secret `nr_push_webhook_secret` and the Edge Function
   secret `NR_WEBHOOK_SECRET` together.

## Website hardening in place

- Security headers on every response: Content-Security-Policy (no external
  scripts, no framing), HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict
  referrer policy and a permissions policy.
- No `x-powered-by` header, and no browser source maps in production.
- Next.js is kept on a patched 16.x release.
- Row-level security on every table. The service-role key is used only on
  the server, after the signed-in session is checked.
