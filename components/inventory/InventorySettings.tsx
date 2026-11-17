"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ArrowUp, ArrowDown, Eye, EyeOff, Archive, ArchiveRestore, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { addColumn, reorderColumns, saveInventorySettings, setColumnArchived, updateColumn } from "@/lib/inventory/actions";
import type { ColumnType, InvColumn, InvSettings } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";
import { Field, FieldLabel } from "./bits";
import { Sheet } from "./Sheet";
import { ToastProvider, useToast } from "./Toast";

const TYPE_LABEL: Record<ColumnType, string> = { text: "Text", number: "Number", date: "Date" };

export function InventorySettings(props: { settings: InvSettings; columns: InvColumn[] }) {
  return (
    <ToastProvider>
      <div className="mb-6">
        <p className="nr-section-label">Store</p>
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.025em]">Inventory settings</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
          Who runs the store, and which columns every product has. Nothing here deletes data: an archived column keeps its values.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-start">
        <PersonCard settings={props.settings} />
        <ColumnsCard columns={props.columns} />
      </div>
    </ToastProvider>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel/60">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.014em]">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-text-secondary">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function PersonCard({ settings }: { settings: InvSettings }) {
  const uid = useId();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(settings.person_name);
  const [phone, setPhone] = useState(settings.phone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== settings.person_name || phone !== settings.phone;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await saveInventorySettings({ personName: name, phone });
    setSaving(false);
    if (res.ok) {
      toast("success", "Saved. The name and phone show on the Inventory page.");
      router.refresh();
    } else setError(res.error);
  }

  return (
    <Card title="Inventory person" description="Shown at the top of the Inventory page for everyone who opens it.">
      <form onSubmit={save} className="space-y-3">
        <div>
          <FieldLabel htmlFor={`${uid}-n`}>Name</FieldLabel>
          <Field id={`${uid}-n`} value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor={`${uid}-p`} hint="Digits, spaces, + and -">
            Phone
          </FieldLabel>
          <Field id={`${uid}-p`} value={phone} maxLength={20} type="tel" inputMode="tel" autoComplete="tel" className="tnum" onChange={(e) => setPhone(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="h-11" loading={saving} disabled={!dirty}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}

function ColumnsCard({ columns }: { columns: InvColumn[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<InvColumn | null>(null);
  const [archiving, setArchiving] = useState<InvColumn | null>(null);
  const defaults = columns.filter((c) => c.is_default);
  const custom = columns.filter((c) => !c.is_default && !c.archived).sort((a, b) => a.position - b.position);
  const archived = columns.filter((c) => !c.is_default && c.archived);

  async function run(id: string, p: Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(id);
    const res = await p;
    setBusy(null);
    if (res.ok) router.refresh();
    else toast("error", res.error ?? "Could not save.");
  }
  const move = (i: number, d: -1 | 1) => {
    const ids = custom.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    return run(custom[i].id, reorderColumns(ids));
  };

  return (
    <Card title="Product design / specification" description="The 8 default columns are locked. Your own columns appear in the table, the forms and the exports.">
      <h3 className="nr-section-label">Default columns</h3>
      <ul className="mb-5 mt-2 flex flex-wrap gap-1.5">
        {defaults.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2.5 py-1 text-[12px] text-text-secondary">
            <Lock size={11} className="text-text-tertiary" aria-hidden /> {c.label}
            <span className="sr-only">(locked)</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between">
        <h3 className="nr-section-label">Your columns</h3>
        <Button type="button" variant="secondary" className="h-11 md:h-9" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add column
        </Button>
      </div>
      {custom.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border-strong px-4 py-6 text-center text-[13px] text-text-secondary">
          No custom columns yet. Add one for anything the defaults don&apos;t cover, like make, unit or bin location.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {custom.map((c, i) => (
            <li key={c.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", busy === c.id && "opacity-60")}>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[13.5px] font-medium", !c.visible && "text-text-tertiary")}>{c.label}</span>
                <span className="text-[11.5px] text-text-tertiary">
                  {TYPE_LABEL[c.data_type]}
                  {c.visible ? "" : " · hidden"}
                </span>
              </span>
              <span className="flex items-center gap-0.5">
                <IconBtn label={`Move ${c.label} up`} disabled={i === 0 || busy !== null} onClick={() => move(i, -1)}>
                  <ArrowUp size={15} />
                </IconBtn>
                <IconBtn label={`Move ${c.label} down`} disabled={i === custom.length - 1 || busy !== null} onClick={() => move(i, 1)}>
                  <ArrowDown size={15} />
                </IconBtn>
                <IconBtn
                  label={c.visible ? `Hide ${c.label}` : `Show ${c.label}`}
                  pressed={!c.visible}
                  disabled={busy !== null}
                  onClick={() => run(c.id, updateColumn({ columnId: c.id, visible: !c.visible }))}
                >
                  {c.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </IconBtn>
                <button
                  type="button"
                  onClick={() => setRenaming(c)}
                  disabled={busy !== null}
                  className="nr-interactive inline-flex h-11 items-center rounded-lg px-2.5 text-[12.5px] font-medium text-text-secondary hover:bg-overlay/[0.06] hover:text-text disabled:opacity-40 md:h-9"
                >
                  Rename
                </button>
                <IconBtn label={`Archive ${c.label}`} disabled={busy !== null} onClick={() => setArchiving(c)}>
                  <Archive size={15} />
                </IconBtn>
              </span>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 && (
        <details className="mt-4 rounded-lg border border-border">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[13px] font-medium text-text-secondary hover:text-text md:min-h-9">
            Archived columns ({archived.length})
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span className="flex-1 text-text-secondary">
                  {c.label} <span className="text-[11.5px] text-text-tertiary">· {TYPE_LABEL[c.data_type]} · values kept</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 md:h-8"
                  disabled={busy !== null}
                  onClick={() => run(c.id, setColumnArchived(c.id, false))}
                >
                  <ArchiveRestore size={14} /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {adding && <AddColumnSheet onClose={() => setAdding(false)} />}
      {renaming && <RenameSheet column={renaming} onClose={() => setRenaming(null)} />}
      {archiving && (
        <Sheet open onClose={() => setArchiving(null)} busy={busy === archiving.id} title={`Archive “${archiving.label}”?`}>
          <p className="text-[13px] text-text-secondary">
            The column leaves the table, the forms and the exports. Its values stay with every product, and you can restore it any time.
          </p>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" className="h-11" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="h-11"
              loading={busy === archiving.id}
              onClick={async () => {
                await run(archiving.id, setColumnArchived(archiving.id, true));
                setArchiving(null);
              }}
            >
              Archive column
            </Button>
          </div>
        </Sheet>
      )}
    </Card>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="nr-interactive inline-flex size-11 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay/[0.06] hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-30 md:size-9"
    >
      {children}
    </button>
  );
}

function AddColumnSheet({ onClose }: { onClose: () => void }) {
  const uid = useId();
  const toast = useToast();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !label.trim()) return;
    setSaving(true);
    setError(null);
    const res = await addColumn({ label, dataType: type });
    setSaving(false);
    if (res.ok) {
      toast("success", `Column “${label.trim()}” added.`);
      router.refresh();
      onClose();
    } else setError(res.error);
  }
  return (
    <Sheet open onClose={onClose} busy={saving} title="Add column">
      <form onSubmit={save} className="space-y-4">
        <div>
          <FieldLabel htmlFor={`${uid}-l`}>Column name</FieldLabel>
          <Field id={`${uid}-l`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder="Make, Unit, Bin…" data-autofocus />
        </div>
        <fieldset>
          <legend className="nr-section-label">Type</legend>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5">
            {(Object.keys(TYPE_LABEL) as ColumnType[]).map((t) => (
              <label
                key={t}
                className={cn(
                  "nr-interactive flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border text-[13px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 md:h-10",
                  type === t ? "border-accent/50 bg-accent/10 text-text" : "border-border text-text-secondary hover:border-border-strong",
                )}
              >
                <input type="radio" name={`${uid}-t`} checked={type === t} onChange={() => setType(t)} className="sr-only" />
                {type === t && <Check size={13} />} {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="h-11" loading={saving} disabled={!label.trim()}>
            Add column
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function RenameSheet({ column, onClose }: { column: InvColumn; onClose: () => void }) {
  const uid = useId();
  const router = useRouter();
  const [label, setLabel] = useState(column.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !label.trim()) return;
    setSaving(true);
    setError(null);
    const res = await updateColumn({ columnId: column.id, label });
    setSaving(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else setError(res.error);
  }
  return (
    <Sheet open onClose={onClose} busy={saving} title={`Rename “${column.label}”`}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <FieldLabel htmlFor={`${uid}-l`}>New name</FieldLabel>
          <Field id={`${uid}-l`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} data-autofocus />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-[13px] text-status-danger">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="lg" className="h-11" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="lg" className="h-11" loading={saving} disabled={!label.trim() || label.trim() === column.label}>
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
