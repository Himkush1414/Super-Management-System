import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full h-9 px-3 rounded-lg bg-bg-subtle border border-border-strong text-sm text-text placeholder:text-text-tertiary " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent/50 nr-interactive " +
  "disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(base, className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(base, "h-auto min-h-[80px] py-2 leading-relaxed resize-y", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(base, "appearance-none pr-8", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="flex items-center justify-between text-[13px] font-medium text-text-secondary mb-1.5"
    >
      <span>{children}</span>
      {hint && <span className="text-text-tertiary font-normal">{hint}</span>}
    </label>
  );
}

export function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}
