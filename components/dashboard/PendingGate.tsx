import { Clock, ShieldX } from "lucide-react";
import { ReapplyButton } from "@/app/(auth)/pending-approval/ReapplyButton";
import type { UserStatus } from "@/types/database.types";

/**
 * Rendered by the dashboard layout in place of the real page content when a
 * profile isn't active yet. No admin/role terminology anywhere here — spec
 * §2 step 6: the user should not learn who approves requests or what role
 * they'll get.
 */
export function PendingGate({ status }: { status: UserStatus }) {
  const rejected = status === "rejected";

  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <div className="flex max-w-sm flex-col items-center text-center">
        <span
          className={`inline-flex size-12 items-center justify-center rounded-full ${
            rejected
              ? "bg-status-danger/10 text-status-danger"
              : "bg-status-warning/10 text-status-warning"
          }`}
        >
          {rejected ? <ShieldX size={22} /> : <Clock size={22} />}
        </span>
        <p className="mt-4 text-[14px] leading-relaxed text-text">
          {rejected
            ? "Your request was not approved."
            : "Welcome to NR Industries. Your account is pending approval — you'll get access soon."}
        </p>
        {rejected && (
          <div className="mt-4 w-full">
            <ReapplyButton />
          </div>
        )}
      </div>
    </div>
  );
}
