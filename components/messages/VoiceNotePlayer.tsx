"use client";

import { useEffect, useState } from "react";
import { Play, Loader2 } from "lucide-react";
import { getVoiceNoteUrl } from "@/lib/actions/messages";

export function VoiceNotePlayer({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVoiceNoteUrl(path).then((r) => {
      if (cancelled) return;
      if (r.url) setUrl(r.url);
      else setErr(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (err) {
    return <p className="text-[12px] text-status-danger">Voice note unavailable.</p>;
  }
  if (!url) {
    return (
      <span className="inline-flex items-center gap-2 text-[12px] text-text-tertiary">
        <Loader2 size={13} className="animate-spin" /> Loading voice note…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Play size={13} className="shrink-0 text-text-tertiary" />
      <audio controls src={url} className="h-8 max-w-[220px]" />
    </span>
  );
}
