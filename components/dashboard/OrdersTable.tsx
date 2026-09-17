"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { OrderRow } from "@/lib/data/orders";
import { Table, THead, TR, TH, TD } from "@/components/ui/Table";
import { Input, Select } from "@/components/ui/Field";
import { StageBadge, OrderStatusBadge } from "@/components/shared/Badge";
import { STAGES } from "@/lib/orders";
import { formatCurrency, formatDate } from "@/lib/utils";

const STAGE_FILTER_ALL = "all";

export function OrdersTable({
  orders,
  showDispatcher,
}: {
  orders: OrderRow[];
  showDispatcher: boolean;
}) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState(STAGE_FILTER_ALL);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (stageFilter !== STAGE_FILTER_ALL && String(o.stage) !== stageFilter) {
        return false;
      }
      if (!q) return true;
      return [
        o.product_name,
        o.quality,
        o.power_type,
        o.dispatcher?.full_name,
        o.assignee?.full_name,
        o.status,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [orders, query, stageFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
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
        <Select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="w-auto max-w-[220px]"
          aria-label="Filter by stage"
        >
          <option value={STAGE_FILTER_ALL}>All stages</option>
          {STAGES.map((s) => (
            <option key={s.n} value={String(s.n)}>
              Stage {s.n} — {s.name}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-[13px] text-text-secondary">
          No orders match the current search/filter.
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
