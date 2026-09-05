// supabase/functions/cleanup-direct-messages/index.ts
//
// Hourly job (scheduled by supabase/migrations/0007_cron_cleanup.sql via
// pg_cron + pg_net). Hard-deletes direct-message conversations — and their
// voice-note files in Storage — 60 hours after the last message (spec §4).
//
// Postgres alone can delete the `direct_messages`/`direct_conversations`
// rows, but the Storage bucket's backing files are only reachable through
// the Storage API, so this function does both: list + remove the files,
// then purge the DB rows via the SECURITY DEFINER RPCs in 0006.
//
// Runs with the service-role key (injected automatically for Edge
// Functions), which is the only credential allowed to call
// expired_direct_conversations() / purge_direct_conversation() — both are
// revoked from `authenticated`/`anon` in the migration.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: expired, error } = await supabase.rpc(
    "expired_direct_conversations",
  );
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  let purged = 0;
  const failures: string[] = [];

  for (const conv of expired ?? []) {
    try {
      const { data: files } = await supabase.storage
        .from("voice-notes")
        .list(conv.id);

      if (files && files.length > 0) {
        const paths = files.map((f) => `${conv.id}/${f.name}`);
        const { error: removeErr } = await supabase.storage
          .from("voice-notes")
          .remove(paths);
        if (removeErr) throw removeErr;
      }

      const { error: purgeErr } = await supabase.rpc(
        "purge_direct_conversation",
        { target: conv.id },
      );
      if (purgeErr) throw purgeErr;

      purged++;
    } catch (e) {
      failures.push(`${conv.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return new Response(
    JSON.stringify({ checked: expired?.length ?? 0, purged, failures }),
    { headers: { "Content-Type": "application/json" } },
  );
});
