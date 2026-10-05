"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "./Field";
import { parseDmy } from "@/lib/utils";

/**
 * Date input that always shows DD/MM/YYYY. The browser's own
 * <input type="date"> displays in the device's locale (often MM/DD/YYYY) and
 * can't be told otherwise, so the visible field is text: type the digits
 * (slashes are added), or open the device's date picker with the calendar
 * button. The form submits the ISO date (YYYY-MM-DD) under `name`; the
 * server validates it again.
 */
export function DateField({
  id,
  name,
  min,
  defaultIso,
}: {
  id: string;
  name: string;
  /** earliest allowed date, ISO (YYYY-MM-DD) */
  min?: string;
  defaultIso?: string;
}) {
  const toDmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
  const [text, setText] = useState(toDmy(defaultIso ?? ""));
  const picker = useRef<HTMLInputElement>(null);
  const iso = text ? parseDmy(text) : "";
  const tooEarly = Boolean(iso && min && iso < min);

  function onType(raw: string) {
    // keep digits, insert the slashes as you type: 15012027 -> 15/01/2027
    const d = raw.replace(/\D/g, "").slice(0, 8);
    setText([d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join("/"));
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={text}
        onChange={(e) => onType(e.target.value)}
        placeholder="DD/MM/YYYY"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        aria-describedby={`${id}-hint`}
        className="pr-10 tnum"
        ref={(el) => {
          // native validation message, so an invalid date blocks submit
          el?.setCustomValidity(
            text && !iso
              ? "Enter a real date as DD/MM/YYYY."
              : tooEarly
                ? "The date can't be in the past."
                : "",
          );
        }}
      />
      <button
        type="button"
        aria-label="Open calendar"
        onClick={() => picker.current?.showPicker?.()}
        className="nr-interactive absolute inset-y-0 right-0 flex items-center px-3 text-text-tertiary hover:text-text-secondary"
      >
        <CalendarDays size={16} />
      </button>
      {/* the device's calendar, used only as a picker; never shown */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        value={iso || ""}
        onChange={(e) => setText(toDmy(e.target.value))}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
      />
      <input type="hidden" name={name} value={iso || (text ? `invalid:${text}` : "")} />
      <p id={`${id}-hint`} className="sr-only">
        Format day, month, year — DD/MM/YYYY
      </p>
    </div>
  );
}
