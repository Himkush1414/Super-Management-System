"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./Field";

/**
 * Text input for passwords with a show/hide toggle. Behaves like <Input>;
 * `type` is managed internally, so don't pass it. The eye button sits inside
 * the field on the right — pass `centered` for centred-text fields (e.g. the
 * 6-digit set-password step) so the padding stays symmetric.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { centered?: boolean }
>(({ className, centered, ...props }, ref) => {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={show ? "text" : "password"}
        className={cn("pr-10", centered && "pl-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="nr-interactive absolute inset-y-0 right-0 flex items-center px-3 text-text-tertiary hover:text-text-secondary focus-visible:outline-none focus-visible:text-text"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
