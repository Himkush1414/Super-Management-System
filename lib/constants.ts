import type { TransformerType } from "@/types/database.types";

export const TransformerKinds: { value: TransformerType; label: string }[] = [
  { value: "distribution", label: "Distribution" },
  { value: "power", label: "Power" },
  { value: "dry_type", label: "Dry-type" },
  { value: "furnace", label: "Furnace" },
  { value: "rectifier", label: "Rectifier" },
  { value: "isolation", label: "Isolation" },
];

export const TRANSFORMER_LABEL: Record<TransformerType, string> =
  Object.fromEntries(TransformerKinds.map((t) => [t.value, t.label])) as Record<
    TransformerType,
    string
  >;
