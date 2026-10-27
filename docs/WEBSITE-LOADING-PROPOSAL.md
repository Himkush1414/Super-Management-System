# Website loading: proposal (needs the owner's review)

**Status: proposal only. Nothing here is applied.** The website source, the
database and the sign-in are unchanged. This file is the only change in its
pull request, and that pull request stays unmerged until the owner decides.

The app's part of the fix (the loading watchdog, the load-timing fix, the
warm-up and the Diagnostics screen) is in the app shell, in `mobile/`. See
"What the app does now" below. This document covers what is left on the
website side.

## The problem

Switching tabs sometimes takes very long, and sometimes the loading
skeleton never goes away.

## Root cause, in short

The skeleton that never goes away is the website's router waiting, **with
no time limit**, for a server answer that doesn't come (verified, Next.js
source). On the server, the database reads that build each tab have **no
time limit** either (verified, code), so one stalled read holds the tab
until Vercel's own function limit. That reads actually stall is
**assumed**: proving it needs the server logs of a signed-in session. The
public routes are fast and in the same region as the database (verified,
measured). The app shell is **not** the cause (verified on the emulator,
finding 1).

## What was found, and how sure it is

"Verified" means seen in code, measured, or reproduced. "Assumed" means
likely but not proven, because proving it needs a signed-in session or
server logs, which were off limits.

| # | Finding | Status |
|---|---|---|
| 1 | **The app shell is not the cause.** react-native-webview 14 on Android sends `onLoadStart` for every address change inside the website (from `doUpdateVisitedHistory`), and the app up to versionCode 4 armed a 20 s "taking too long" timer on it. An earlier draft of this document said no `onLoadEnd` follows, so every tab switch would end in that error. **That was wrong:** the WebView also calls `onPageFinished` for in-site address changes, which ends the load and clears the timer. On the emulator (WebView 113, versionCode 4 built with debugging on), `history.pushState`, several quick pushes, `replaceState` and back left no progress bar and no error screen after 25 s. The app now times full loads where they start instead (PR #14), which is cleaner but was not the fix for this. | Library source: verified. Not a cause: **verified** (reproduced on the emulator, 2026-10-27). |
| 2 | Next.js 16.3.4 shows the tab's `loading.tsx` skeleton at once and then waits for the server's answer **with no time limit**. In production, `fetchServerResponse` passes no timeout and no abort signal; the signal is only wired for development hot reload. A request that **fails** falls back to a full page load (so the user sees something), but one that **never answers** leaves the skeleton up for good. That matches the symptom exactly. | Verified: `node_modules/next/dist/client/components/router-reducer/fetch-server-response.js`. |
| 3 | On the server, only the Auth check has a time limit (`getUser`, 5 s, in `requireSession` and the proxy). The database reads during a page render (`profiles`, `production_settings`, `notifications` count, `order_feed`, `audit_log`, `admin_account_overview`) have **no time limit**. A read that stalls holds the render until the Vercel function's own limit (no `maxDuration` is set, so Vercel's default applies). When the *Auth* check runs out of time the user is sent to `/login` instead, so a slow Auth server shows up as a sign-out, not as a stuck skeleton; that points the stuck skeleton at the database reads. | Verified: code. That such stalls happen: **assumed**. The deployed `perf` log lines would show it (see "How to confirm"). |
| 4 | There is no `error.tsx` anywhere in `app/`. A render that fails shows Next's generic error page, and one that hangs shows nothing new at all. | Verified: file list. |
| 5 | Three tabs wait for the session check before they **start** their own read: Activity (`requireSession` → `audit_log`), Settings (`requireSession` → `production_settings`) and Data (`requireSession` → `admin_account_overview` → more). That makes two or more database round trips back to back. Orders and the order page already run everything in parallel. | Verified: code. |
| 6 | The proxy (`proxy.ts` → `lib/supabase/middleware.ts`) runs on every request except static files, images and `/api/health`. That includes every link prefetch and every in-site page request. On dashboard pages it calls `getSession()`. That is a local cookie read, except when the access token has expired (about hourly), when it refreshes over the network (capped at 5 s). | Verified: code and matcher. |
| 7 | Refresh-token race. After the phone was away for over an hour, the first burst of requests (the page plus a prefetch per visible order card, plus the browser client's own refresh) all refresh with the same refresh token. Supabase accepts a reused refresh token within its reuse interval (10 s by default), so these normally all succeed. If one lost, the user would be **signed out** (sent to `/login`), not left on a skeleton. Each refresh does add one Auth round trip to its request. | Proxy behaviour: verified (code). Outcome: **assumed**. The project's Auth settings could not be read without calling Supabase. |
| 8 | Realtime channels are created when a page mounts and removed when it unmounts (`removeChannel` in the effect cleanup). They are not re-created and left open on every tab switch. | Verified: `lib/realtime.ts`. |
| 9 | Region: the functions run in **bom1** (Mumbai): every response's `x-vercel-id` reads `bom1::bom1::…`. The Supabase project is in **ap-south-1** (Mumbai) per the project records, so it is the same region and not a cross-region delay. | bom1: verified (headers). Supabase region: from records, not re-checked (calling Supabase was off limits). |
| 10 | Cold start: about **0.9 s**. The first `/api/health` call answered in 1.15 s; warm calls in about 0.20–0.25 s. `/login` and a signed-out `/dashboard/orders` (a proxy redirect) answer in about 0.2 s warm. | Verified: measured from India, 2026-10-27; table below. |
| 11 | A connection that went dead while the phone slept. The WebView reuses its HTTP/2 connection, and the first request after a long sleep can hang until Chromium notices (seconds) before it retries on a new connection. | **Assumed** (known Chromium behaviour). The app now wakes the connection on resume and retries a stuck page itself. |

### Measurements (public routes only, no cookies, no Supabase)

Two separate runs on 2026-10-27, from India, new connection per request:

| Route | First request (run 1 / run 2) | Warm, run 2 (6 requests) | Function region |
|---|---|---|---|
| `/api/health` | 1.157 s / 0.903 s (cold function) | 0.202–0.287 s | bom1 |
| `/login` | 1.105 s / 0.915 s | 0.234–0.254 s | bom1 (edge cache HIT) |
| `/dashboard/orders` (signed out → 307 `/login`) | 0.235 s / 0.225 s | 0.221–0.247 s | bom1 |

About 0.13–0.19 s of each warm request is DNS, TCP and TLS on a new
connection; the server's own part is well under 0.1 s.

Headers: static files are `public,max-age=31536000,immutable`, and `/login`
is `public, max-age=0, must-revalidate`. Signed-in pages could not be
measured without signing in.

## What the app does now (no website change needed)

- A stuck page switch is noticed: still a skeleton, or nothing changed for
  8 s. The app loads that page once more, and if it sticks again, shows its
  error screen with **Retry**. It never loops.
- A skeleton on screen for 8 s counts as stuck even when something else
  on the page (a live counter, a running timer) keeps changing.
- Full page loads are timed where they start, not from `onLoadStart`
  (finding 1: not a cause, but cleaner).
- On launch and on resume the app wakes the server (`/api/health`), and on
  resume it checks the connection again. A page switch that was waiting
  when the phone slept is retried at once.
- **Checked on the emulator** (2026-10-27, a build of PR #14 with
  debugging on, a simulated stuck tab: the address moves, the skeleton
  stays): reported as stuck after 8 s; the automatic reload worked in 4
  of 5 runs. In the 5th the reload never started, and the app showed the
  error screen 8 s later as designed. A second stuck on the same page
  goes straight to the error screen, and **Retry** loads the page. The
  first version retried with page script (`location.assign`), and most of
  those retries were silently dropped by the WebView; the retry is now
  the WebView's own reload. Why a load is sometimes dropped is not known
  (**assumed**: a WebView quirk; it was never seen on a real phone).
- Hidden **Diagnostics** screen: tap the version at the bottom of the
  offline screen five times. It shows the last 50 navigations with their
  time and result, the WebView settings and the version, and **Share**
  sends them as text.

## Proposed website changes (for review, in order of value)

### P1. A time limit on every database read, and an error screen with "Try again"

Why: findings 2 to 4. A stalled read should end in seconds with a retry,
not hold the skeleton until the function's limit.

New file `lib/supabase/fetch.ts`:

```ts
/**
 * fetch for the Supabase clients with a time limit: a read that stalls
 * fails after SUPABASE_TIMEOUT_MS instead of holding the page render
 * until the function's own limit. Realtime (websocket) is not affected.
 */
export const SUPABASE_TIMEOUT_MS = 8000;

export function timedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const limit = AbortSignal.timeout(SUPABASE_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
  return fetch(input, { ...init, signal });
}
```

`lib/supabase/server.ts`, in `createClient()` (the service client can
stay as it is):

```diff
+import { timedFetch } from "@/lib/supabase/fetch";
 ...
   return createServerClient(
     requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
     requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
     {
+      global: { fetch: timedFetch },
       cookies: {
```

`lib/supabase/middleware.ts`, the same option in `createServerClient(url, key, { … })`:

```diff
+import { timedFetch } from "@/lib/supabase/fetch";
 ...
   const supabase = createServerClient(url, key, {
+    global: { fetch: timedFetch },
     cookies: {
```

New file `app/dashboard/error.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";

/** A dashboard page that failed to load (a read timed out, the server failed). */
export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" className="rounded-xl border border-border bg-panel/60 p-6 text-center">
      <p className="font-medium">This page didn&apos;t load.</p>
      <p className="mt-1 text-[13px] text-text-secondary">The connection or the server was too slow. Your data is safe.</p>
      <button
        type="button"
        onClick={() => startTransition(() => { router.refresh(); reset(); })}
        className="nr-interactive nr-press mt-4 inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
      >
        Try again
      </button>
    </div>
  );
}
```

Risk: low. Only reads that take over 8 s change behaviour: they now show
"Try again" instead of hanging. Writes (server actions) use the same
client, so a write that takes over 8 s would now report an error. It
might still have been applied on the database side, as with any network
error today. If that's a concern, use the timed client for page renders
only.

### P2. Start each tab's read together with the session check

Why: finding 5. This removes one database round trip from Activity,
Settings and Data. RLS already decides what each read returns, and the
page still renders, or redirects, only after `requireSession()` passes.

`app/dashboard/activity/page.tsx`:

```diff
-  const ctx = await requireSession();
-  if (!ctx.can("audit.view")) redirect("/dashboard/orders");
   const supabase = await createClient();
   const { account } = await searchParams;
 
   // RLS (audit_log_select) decides which rows come back.
   let q = supabase
     .from("audit_log")
     ...
   if (account && /^[0-9a-f-]{36}$/i.test(account)) q = q.eq("target_profile_id", account);
-  const { data } = await q;
+  // in parallel with the session check; RLS returns nothing to anyone not allowed
+  const [ctx, { data }] = await Promise.all([requireSession(), q]);
+  if (!ctx.can("audit.view")) redirect("/dashboard/orders");
```

`app/dashboard/settings/page.tsx` already gets `phone` and `confirmed_at`
in `requireSession()`. The page's own `production_settings` read can run
alongside it:

```diff
-  const ctx = await requireSession({ allowIncompleteSetup: true });
+  const supabase = await createClient();
+  const [ctx, own] = await Promise.all([
+    requireSession({ allowIncompleteSetup: true }),
+    // RLS: production reads its own row; everyone else gets nothing
+    supabase.from("production_settings").select("*").maybeSingle<ProductionSettings>(),
+  ]);
   if (ctx.role !== "marketing" && ctx.role !== "production") redirect("/dashboard/orders");
   const isProduction = ctx.role === "production";
-
-  const { data } = isProduction
-    ? await (await createClient())
-        .from("production_settings")
-        .select("*")
-        .eq("profile_id", ctx.userId)
-        .maybeSingle<ProductionSettings>()
-    : { data: null };
+  const data = isProduction ? own.data : null;
```

(Before applying this, check the `production_settings` RLS policy limits a
production account to its own row. The `.eq("profile_id", …)` filter is
dropped because the user id isn't known until the session resolves.)

`app/dashboard/data/page.tsx`: `admin_account_overview()` re-checks the
admin tier in the database, so it can also start with the session check:

```diff
-  const ctx = await requireSession();
-  if (!ctx.can("data.delete")) redirect("/dashboard/orders");
   const supabase = await createClient();
   const { account: selectedId } = await searchParams;
-
-  // admin_account_overview() re-checks admin tier in the database.
-  const { data: overview } = await supabase.rpc("admin_account_overview");
+  // admin_account_overview() re-checks admin tier in the database: safe to start now
+  const [ctx, { data: overview }] = await Promise.all([
+    requireSession(),
+    supabase.rpc("admin_account_overview"),
+  ]);
+  if (!ctx.can("data.delete")) redirect("/dashboard/orders");
```

Risk: low. One extra read is sent for an account that gets redirected
anyway, and RLS or the function's own check returns nothing to it.

### P3. Optional, after measuring: fewer prefetch requests on the orders list

Why: findings 6 and 7. On a phone, every order card on the orders list
is a `<Link>` that prefetches its page when it scrolls into view. Each
prefetch is a function call that runs the proxy, and after a live update
`router.refresh()` re-runs every prefetch on the page (as the comment in
`lib/realtime.ts` says). On a long list that's many requests per minute,
and many token refreshes at once in the first minute after an hour away.

```diff
 // components/dashboard/OrdersTable.tsx (both the phone cards and the table rows)
-                <Link
-                  href={`/dashboard/orders/${o.id}`}
+                <Link
+                  href={`/dashboard/orders/${o.id}`}
+                  prefetch={false}
```

The same applies to the production view's cards in `app/dashboard/orders/page.tsx`.
The sidebar tabs keep their prefetch (there are only a few).

Trade-off: opening an order no longer has its skeleton ready in advance.
The tap waits for the server's first bytes (about 0.2 s warm) before
anything moves. Measure first (below). Apply only if the logs show
bursts of prefetch requests or token refreshes.

### P4. When the cause is confirmed: remove the temporary measuring code

`lib/perf.ts`, its calls in the pages, the `perf` log lines in
`lib/supabase/middleware.ts` and `/api/health?probe=1` were added for the
earlier performance investigation (2026-10-07) and are still deployed.
Keep them until the measurements below are done.

## How to confirm, without touching data

1. On the phone, with the new app: use it normally. When a page is slow,
   open **Diagnostics** (turn on flight mode, tap the version five times
   on the offline screen) and tap **Share**. Each line has the time, the
   kind of navigation, the duration and the result (`ok`, `retried`,
   `stuck`).
2. In Vercel → the project → Logs, at the same minutes, filter for
   `"perf":"page.` and `"perf":"session"`. Each line has `total_ms` and
   the time of each step (`auth.getUser`, `profile`, `order_feed`, …).
   - A step in the thousands of ms means a slow read: P1 and P2.
   - A slow `getSession` in the proxy lines (`"perf":"proxy"`), clustered
     after a long pause, means token refreshes: P3.
   - The app shows `stuck` but the function log shows a fast render: the
     request was lost between the phone and Vercel. The app's retry
     covers it.

## Not proposed

- Changing how the proxy refreshes the session (for example, skipping it
  for prefetch requests). It is the sign-in path, and the evidence (the
  user is not being signed out) doesn't point there.
- Any database or Auth setting change.
