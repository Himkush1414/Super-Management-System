"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOutEverywhere } from "@/lib/actions/account";
import { Button } from "@/components/ui/Button";

export function SignOutEverywhere() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <p className="mb-2 text-[12px] text-text-secondary">
        End every active session for this account, on all devices.
      </p>
      <Button
        variant="outline"
        size="sm"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await signOutEverywhere();
            if (r.error) setErr(r.error);
            else router.push("/signin");
          })
        }
      >
        <LogOut size={14} /> Sign out of all devices
      </Button>
      {err && <p className="mt-1 text-[12px] text-status-danger">{err}</p>}
    </div>
  );
}
