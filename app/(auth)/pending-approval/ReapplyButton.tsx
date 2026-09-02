"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { reapplyAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/shared/AuthCard";

export function ReapplyButton() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; ok?: string } | null>(null);

  return (
    <div className="space-y-2">
      <FormAlert state={state} />
      <Button
        className="w-full"
        loading={pending}
        onClick={() => start(async () => setState(await reapplyAction()))}
        disabled={Boolean(state?.ok)}
      >
        <RefreshCw size={15} />
        {state?.ok ? "Request resubmitted" : "Submit a new request"}
      </Button>
    </div>
  );
}
