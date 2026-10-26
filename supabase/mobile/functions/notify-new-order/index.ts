// NR Management — Supabase Edge Function `notify-new-order`.
//
// Called by the AFTER INSERT trigger on public.orders (002_new_order_push.sql)
// with { record: { id } }. Sends one Expo push notification per registered
// phone of the staff who handle the order:
//   • the production members the order was sent to (order_assignees)
//   • admin and head_admin
// never the marketing account that punched it. No price, GST or amount is
// ever put in a notification (production must not see prices).
//
// Exactly once per order: the first call claims the order in
// order_push_log (primary key); any repeat call for the same order stops.
//
// Deliberately dependency-free (fetch + PostgREST only, no imports), so it
// deploys as a single file and type-checks anywhere.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   NR_WEBHOOK_SECRET   required; same value as the Vault secret
//   EXPO_ACCESS_TOKEN   optional; only if "Enhanced push security" is on in Expo
// Provided by Supabase automatically: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with JWT verification off (the trigger sends the secret header instead).

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Order = {
  id: string;
  created_by: string;
  client_name: string | null;
  product_name: string | null;
  quantity: number | null;
  expected_delivery: string | null;
  status: string | null;
};
type Ticket = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("NR_WEBHOOK_SECRET") ?? "";
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Constant-time string comparison for the webhook secret. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PostgREST call as the service role. */
async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SERVICE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_KEY}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function restJson<T>(path: string): Promise<T> {
  const res = await rest(path);
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** "2026-10-31" -> "31/10/2026" (the website's date format). */
function ddmmyyyy(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Title and body from the real order fields; never any money. */
export function messageFor(order: Order, productCount: number): { title: string; body: string } {
  const client = clip((order.client_name ?? "").trim() || "New order", 60);
  const product = clip((order.product_name ?? "").trim() || "Order", 60);
  const parts = [productCount > 1 ? `${product} +${productCount - 1} more` : product];
  if (productCount <= 1 && order.quantity) parts.push(`Qty ${order.quantity}`);
  const due = ddmmyyyy(order.expected_delivery);
  if (due) parts.push(`Delivery ${due}`);
  if (order.status === "waiting_on_production_phone") parts.push("Waiting on production phone");
  return { title: `New order · ${client}`, body: parts.join(" · ") };
}

async function sendToExpo(messages: unknown[]): Promise<Ticket[]> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(EXPO_SEND_URL, { method: "POST", headers, body: JSON.stringify(messages) });
      if (res.ok) {
        const out = (await res.json()) as { data?: Ticket[] };
        return out.data ?? [];
      }
      if (attempt >= 3 || (res.status < 500 && res.status !== 429)) {
        throw new Error(`Expo push ${res.status}: ${await res.text()}`);
      }
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
}

async function finish(orderId: string, fields: Record<string, unknown>) {
  await rest(`order_push_log?order_id=eq.${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...fields, finished_at: new Date().toISOString() }),
  }).catch(() => undefined);
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "function is missing SUPABASE_URL / SERVICE_ROLE_KEY" });
  if (!sameSecret(req.headers.get("x-nr-webhook-secret") ?? "", WEBHOOK_SECRET)) {
    return json(401, { error: "unauthorized" });
  }

  let orderId = "";
  try {
    const payload = (await req.json()) as { type?: string; table?: string; record?: { id?: string } };
    if (payload.type !== "INSERT" || payload.table !== "orders") return json(200, { skipped: "not an order insert" });
    orderId = String(payload.record?.id ?? "");
  } catch {
    return json(400, { error: "bad payload" });
  }
  if (!UUID.test(orderId)) return json(400, { error: "bad order id" });

  // claim the order: the second claim of the same id inserts nothing
  const claim = await rest("order_push_log", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!claim.ok) return json(500, { error: `claim failed: ${claim.status} ${await claim.text()}` });
  if (((await claim.json()) as unknown[]).length === 0) return json(200, { skipped: "already notified" });

  try {
    const [orders, items, assignees, admins] = await Promise.all([
      restJson<Order[]>(
        `orders?id=eq.${orderId}&select=id,created_by,client_name,product_name,quantity,expected_delivery,status`,
      ),
      restJson<{ position: number }[]>(`order_items?order_id=eq.${orderId}&select=position`),
      restJson<{ profile_id: string }[]>(`order_assignees?order_id=eq.${orderId}&select=profile_id`),
      restJson<{ id: string }[]>("profiles?role=in.(admin,head_admin)&select=id"),
    ]);
    const order = orders[0];
    if (!order) {
      await finish(orderId, { recipients: 0, devices: 0, sent: 0, failed: 0, error: "order not found" });
      return json(200, { skipped: "order not found" });
    }

    const recipients = [...new Set([...assignees.map((a) => a.profile_id), ...admins.map((a) => a.id)])].filter(
      (id) => id !== order.created_by,
    );
    const tokens = recipients.length
      ? await restJson<{ expo_push_token: string }[]>(
          `device_tokens?user_id=in.(${recipients.join(",")})&invalidated_at=is.null&select=expo_push_token`,
        )
      : [];
    const unique = [...new Set(tokens.map((t) => t.expo_push_token))];

    const { title, body } = messageFor(order, Math.max(items.length, 1));
    const messages = unique.map((to) => ({
      to,
      title,
      body,
      sound: "default",
      priority: "high",
      channelId: "new_orders",
      data: { type: "new_order", orderId, url: `/dashboard/orders/${orderId}` },
    }));

    let sent = 0;
    let failed = 0;
    const dead: string[] = [];
    const errors: string[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const tickets = await sendToExpo(batch);
        tickets.forEach((t, j) => {
          if (t.status === "ok") sent++;
          else {
            failed++;
            if (t.details?.error === "DeviceNotRegistered") dead.push(batch[j].to);
            else if (t.message) errors.push(t.message);
          }
        });
      } catch (e) {
        failed += batch.length;
        errors.push(String((e as Error).message ?? e));
      }
    }

    if (dead.length) {
      const list = encodeURIComponent(`(${dead.map((t) => `"${t}"`).join(",")})`);
      await rest(`device_tokens?expo_push_token=in.${list}`, {
        method: "PATCH",
        body: JSON.stringify({ invalidated_at: new Date().toISOString() }),
      }).catch(() => undefined);
    }

    const error = errors.length ? clip(errors.join(" | "), 1000) : null;
    await finish(orderId, { recipients: recipients.length, devices: unique.length, sent, failed, error });
    return json(200, { orderId, recipients: recipients.length, devices: unique.length, sent, failed });
  } catch (e) {
    const error = clip(String((e as Error).message ?? e), 1000);
    await finish(orderId, { error });
    return json(500, { error });
  }
}

Deno.serve(handle);
