import { cn } from "@/lib/utils";

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="30" height="30" rx="7" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M9 23V9l7 9 7-9v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="24.5" r="1.6" fill="currentColor" />
      </svg>
      {showText && (
        <span className="font-semibold tracking-tight text-[15px] leading-none">NR Industries</span>
      )}
    </span>
  );
}
