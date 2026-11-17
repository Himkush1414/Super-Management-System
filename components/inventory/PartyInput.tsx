"use client";

import { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { suggestParties } from "@/lib/inventory/party";
import { cn } from "@/lib/utils";

/**
 * A text field with suggestions from the known party names, so the same
 * party isn't typed in different spellings. ARIA combobox: arrows move,
 * Enter picks, Escape closes; a tap picks. Free text is still allowed (a
 * new party).
 */
export function PartyInput({
  id,
  value,
  onChange,
  names,
  placeholder,
  label,
  clearable,
  className,
  inputClassName,
  maxLength = 120,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  names: string[];
  placeholder?: string;
  /** accessible name when there is no visible <label> */
  label?: string;
  clearable?: boolean;
  className?: string;
  inputClassName?: string;
  maxLength?: number;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => (open ? suggestParties(names, value) : []), [open, names, value]);
  const show = open && items.length > 0 && !(items.length === 1 && items[0] === value);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          "h-11 w-full rounded-lg border border-border-strong bg-bg-subtle px-3 text-[16px] text-text placeholder:text-text-tertiary md:h-10 md:text-sm",
          "focus-visible:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          clearable && value && "pr-10",
          inputClassName,
        )}
      />
      {clearable && value && (
        <button
          type="button"
          aria-label="Clear party"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="nr-interactive absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-text-tertiary hover:bg-overlay/[0.06] hover:text-text"
        >
          <X size={15} />
        </button>
      )}
      {show && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border-strong bg-elevated p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]"
        >
          {items.map((n, i) => (
            <li
              key={n}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(n)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-[14px] md:min-h-9 md:text-[13px]",
                i === active ? "bg-accent/15 text-text" : "text-text-secondary hover:bg-overlay/[0.06] hover:text-text",
              )}
            >
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
