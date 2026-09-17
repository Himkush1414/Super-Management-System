"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUnreadCount } from "@/lib/realtime";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { NotificationRow } from "@/types/database.types";

export function NotificationsBell({
  userId,
  initialUnread,
}: {
  userId: string;
  initialUnread: number;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useUnreadCount(userId, initialUnread);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data ?? []);
  }

  async function markAllRead() {
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    setUnread(0);
    load();
  }

  async function markOneRead(n: NotificationRow) {
    if (n.read_at) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: now } : i)));
    setUnread((c) => Math.max(0, c - 1));
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: now }).eq("id", n.id);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        className="nr-interactive relative inline-flex size-8 items-center justify-center rounded-lg text-text-secondary hover:bg-white/[0.06] hover:text-text"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg tnum">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[3.75rem] z-50 w-auto overflow-hidden rounded-xl border border-border bg-panel shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-[13px] font-semibold">Notifications</span>
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text"
            >
              <Check size={12} /> Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-text-tertiary">
                Nothing yet.
              </p>
            ) : (
              items.map((n) => {
                const href =
                  n.entity_type === "order" && n.entity_id
                    ? `/dashboard/orders/${n.entity_id}`
                    : null;
                const content = (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium">
                        {!n.read_at && (
                          <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                        )}
                        {n.title}
                      </p>
                      <span className="shrink-0 text-[11px] text-text-tertiary">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-[12px] text-text-secondary">
                        {n.body}
                      </p>
                    )}
                  </>
                );
                const className = cn(
                  "block border-b border-border px-4 py-3 text-left last:border-0",
                  !n.read_at && "bg-accent/[0.04]",
                  href && "nr-interactive hover:bg-white/[0.03]",
                );
                return href ? (
                  <Link
                    key={n.id}
                    href={href}
                    onClick={() => {
                      markOneRead(n);
                      setOpen(false);
                    }}
                    className={className}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => markOneRead(n)}
                    className={cn(className, "w-full")}
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
