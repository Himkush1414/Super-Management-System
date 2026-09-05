"use client";

import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { sendDirectMessage } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";

export function VoiceRecorder({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void upload(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setErr("Microphone access denied.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function upload(blob: Blob) {
    setUploading(true);
    const supabase = createClient();
    const path = `${conversationId}/${crypto.randomUUID()}.webm`;
    const { error: uploadErr } = await supabase.storage.from("voice-notes").upload(path, blob, {
      contentType: "audio/webm",
    });
    if (uploadErr) {
      setErr(uploadErr.message);
      setUploading(false);
      return;
    }
    const r = await sendDirectMessage(conversationId, { kind: "voice", voicePath: path });
    setUploading(false);
    if (r.error) setErr(r.error);
    else onSent();
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px] text-status-danger">{err}</span>}
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={uploading}
        className={cn(
          "nr-interactive nr-press inline-flex size-9 items-center justify-center rounded-lg border",
          recording
            ? "border-status-danger/40 bg-status-danger/10 text-status-danger"
            : "border-border-strong text-text-secondary hover:text-text",
        )}
        aria-label={recording ? "Stop recording" : "Record a voice note"}
        title={recording ? "Stop recording" : "Record a voice note"}
      >
        {uploading ? (
          <Loader2 size={15} className="animate-spin" />
        ) : recording ? (
          <Square size={14} />
        ) : (
          <Mic size={15} />
        )}
      </button>
    </div>
  );
}
