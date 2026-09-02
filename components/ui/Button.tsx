import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent hover:shadow-[0_6px_20px_-4px_rgba(59,130,246,0.45)]",
  secondary:
    "bg-elevated text-text hover:bg-panel-2 hover:border-border-strong border border-border",
  outline:
    "bg-transparent text-text hover:bg-elevated hover:border-border-strong border border-border-strong",
  ghost:
    "bg-transparent text-text-secondary hover:text-text hover:bg-elevated border border-transparent",
  danger:
    "bg-transparent text-status-danger hover:bg-status-danger/10 border border-status-danger/40",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-md",
  md: "h-9 px-4 text-sm rounded-lg",
  lg: "h-11 px-6 text-[15px] rounded-lg",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "nr-interactive nr-press inline-flex items-center justify-center gap-2 font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
