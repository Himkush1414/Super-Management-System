"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { OrderRow } from "@/lib/data/orders";
import { Table, THead, TR, TH, TD } from "@/components/ui/Table";
import { Input } from "@/components/ui/Field";
import { StageBadge, OrderStatusBadge } from "@/components/shared/Badge";
import { formatCurrency, formatDate } from "@/lib/utils";

export function OrdersTable({
  orders,
  showDispatcher,
}: {
  orders: OrderRow[];
  showDispatcher: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [
        o.product_name,
        o.quality,
        o.power_type,
        o.dispatcher?.full_name,
        o.assignee?.full_name,
        o.status,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q)),
    );
  }, [orders, query]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, production, status…"
          className="pl-8"
          aria-label="Search orders"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-[13px] text-text-secondary">
          No orders match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              {showDispatcher && <TH>Dispatched by</TH>}
              <TH>Production</TH>
              <TH numeric>Qty</TH>
              <TH>Stage</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
              <TH numeric>Date</TH>
            </TR>
          </THead>
          <tbody>
            {filtered.map((o) => (
              <TR key={o.id} className="cursor-pointer">
                <TD>
                  <Link
                    href={`/dashboard/orders/${o.id}`}
                    className="font-medium text-text hover:text-accent"
                  >
                    {o.product_name}
                  </Link>
                  {o.power_type && (
                    <span className="block text-[12px] text-text-tertiary">
                      {o.power_type}
                    </span>
                  )}
                </TD>
                {showDispatcher && (
                  <TD className="text-text-secondary">
                    {o.dispatcher?.full_name ?? "—"}
                  </TD>
                )}
                <TD className="text-text-secondary">
                  {o.assignee?.full_name ?? "—"}
                </TD>
                <TD numeric>{o.quantity}</TD>
                <TD>
                  <StageBadge stage={o.stage} />
                </TD>
                <TD numeric>{formatCurrency(o.price)}</TD>
                <TD>
                  <OrderStatusBadge status={o.status} />
                </TD>
                <TD numeric className="text-text-tertiary">
                  {formatDate(o.created_at)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
