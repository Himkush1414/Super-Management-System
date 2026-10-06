"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, CalendarDays } from "lucide-react";
import type { OrderRow } from "@/lib/data/orders";
import { Table, THead, TR, TH, TD } from "@/components/ui/Table";
import { Input, Select } from "@/components/ui/Field";
import { StageBadge, OrderStatusBadge } from "@/components/shared/Badge";
import { StageTracker } from "@/components/dashboard/StageTracker";
import { STAGES } from "@/lib/orders";
import { formatCurrency, formatDate, formatDay } from "@/lib/utils";

const STAGE_FILTER_ALL = "all";

const names = (o: OrderRow) => o.assignees.map((a) => a.label).join(", ");

export function OrdersTable({
  orders,
  showDispatcher,
  showAssignees = true,
  showPrice,
}: {
  orders: OrderRow[];
  showDispatcher: boolean;
  showAssignees?: boolean;
  showPrice: boolean;
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
        o.client_name,
        o.transformer_rating,
        o.dispatcher?.label,
        names(o),
        o.status,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [orders, query, stageFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-xs sm:flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product, client, rating…"
            className="pl-8"
            aria-label="Search orders"
          />
        </div>
        <Select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="sm:w-auto sm:max-w-[240px]"
          aria-label="Filter by stage"
        >
          <option value={STAGE_FILTER_ALL}>All stages</option>
          {STAGES.map((s) => (
            <option key={s.n} value={String(s.n)}>
              Stage {s.n} — {s.name}
            </option>
          ))}
        </Select>
        <span className="text-[12px] text-text-tertiary sm:ml-auto tnum">
          {filtered.length} of {orders.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-[13px] text-text-secondary">
          No orders match the current search/filter.
        </p>
      ) : (
        <>
          {/* phones: stacked cards */}
          <ul className="space-y-2 md:hidden">
            {filtered.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/dashboard/orders/${o.id}`}
                  className="nr-interactive block rounded-xl border border-border bg-panel/60 p-4 active:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.product_name}</p>
                      <p className="mt-0.5 truncate text-[12px] text-text-secondary">
                        {o.client_name}
                        {o.transformer_rating ? ` · ${o.transformer_rating}` : ""}
                      </p>
                    </div>
                    {showPrice && (
                      <span className="shrink-0 text-[13px] font-medium tnum">
                        {formatCurrency(o.price)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3">
                    <StageTracker stage={o.stage} compact />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-tertiary">
                    <StageBadge stage={o.stage} />
                    {o.status !== "active" && <OrderStatusBadge status={o.status} />}
                    <span className="tnum">Qty {o.quantity}</span>
                    {o.expected_delivery && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays size={12} /> {formatDay(o.expected_delivery)}
                      </span>
                    )}
                    {showAssignees && names(o) && <span>→ {names(o)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* tablet / desktop: table */}
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  {showDispatcher && <TH className="whitespace-nowrap">Punched by</TH>}
                  {showAssignees && <TH>Production</TH>}
                  <TH numeric>Qty</TH>
                  <TH>Stage</TH>
                  {showPrice && <TH numeric>Value</TH>}
                  <TH numeric>Delivery</TH>
                </TR>
              </THead>
              <tbody>
                {filtered.map((o) => (
                  <TR key={o.id} className="group relative cursor-pointer">
                    <TD className="min-w-[220px]">
                      <Link
                        href={`/dashboard/orders/${o.id}`}
                        className="font-medium text-text group-hover:text-accent after:absolute after:inset-0"
                      >
                        {o.product_name}
                      </Link>
                      <span className="block text-[12px] text-text-tertiary">
                        {[o.client_name, o.transformer_rating].filter(Boolean).join(" · ")}
                        {o.status !== "active" && (
                          <span className="ml-1 text-status-warning">· waiting on phone</span>
                        )}
                      </span>
                    </TD>
                    {showDispatcher && (
                      <TD className="whitespace-nowrap text-text-secondary">
                        {o.dispatcher?.label ?? "—"}
                      </TD>
                    )}
                    {showAssignees && (
                      <TD className="max-w-[170px] truncate text-text-secondary" title={names(o)}>
                        {names(o) || "—"}
                      </TD>
                    )}
                    <TD numeric>{o.quantity}</TD>
                    <TD>
                      <StageBadge stage={o.stage} />
                    </TD>
                    {showPrice && <TD numeric className="whitespace-nowrap font-medium">{formatCurrency(o.price)}</TD>}
                    <TD numeric className="whitespace-nowrap text-text-secondary">
                      {formatDay(o.expected_delivery)}
                      <span className="block text-[11px] text-text-tertiary">
                        sent {formatDate(o.created_at)}
                      </span>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
