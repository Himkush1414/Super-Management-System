import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Profile, Project, Task } from "@/types/database.types";
import { TRANSFORMER_LABEL } from "@/lib/constants";
import { ROLE_LABEL, can, type Role } from "@/lib/permissions";

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 10, color: "#1a1a1a", fontFamily: "Helvetica" },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: "#0a0a0a",
    paddingBottom: 10,
  },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  tagline: { fontSize: 9, color: "#6f6f6f", marginTop: 2 },
  docType: { fontSize: 9, color: "#6f6f6f", textAlign: "right" },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 22 },
  sub: { fontSize: 9, color: "#6f6f6f", marginTop: 2 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 20,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#0a0a0a",
  },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 4 },
  cellK: { width: "35%", color: "#6f6f6f" },
  cellV: { width: "65%", fontFamily: "Helvetica-Bold" },
  notes: { marginTop: 4, lineHeight: 1.5, color: "#333333" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 44,
    right: 44,
    fontSize: 8,
    color: "#9ca3af",
    borderTopWidth: 0.5,
    borderTopColor: "#dddddd",
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  priceNote: { fontSize: 8, color: "#9ca3af", marginTop: 4 },
});

function Field({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <View style={s.row}>
      <Text style={s.cellK}>{k}</Text>
      <Text style={s.cellV}>{v === null || v === undefined || v === "" ? "—" : String(v)}</Text>
    </View>
  );
}

const inr = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(n);

export interface SpecSheetData {
  project: Project;
  tasks: Task[];
  managerName: string | null;
  requestedBy: Pick<Profile, "full_name" | "role">;
}

function SpecSheet({ project, tasks, managerName, requestedBy }: SpecSheetData) {
  const role = requestedBy.role as Role;
  const includePricing = can(role, "pricing.view");
  const now = new Date().toLocaleString("en-IN");

  return (
    <Document title={`NR Industries — ${project.name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.brandRow}>
          <View>
            <Text style={s.brand}>NR INDUSTRIES</Text>
            <Text style={s.tagline}>Power at the Best — Transformer Manufacturing</Text>
          </View>
          <View>
            <Text style={s.docType}>PROJECT SPECIFICATION SHEET</Text>
            <Text style={s.docType}>{now}</Text>
          </View>
        </View>

        <Text style={s.h1}>{project.name}</Text>
        <Text style={s.sub}>
          {project.client_name || "No client"} · Status: {project.status.replace(/_/g, " ")}
        </Text>

        <Text style={s.sectionTitle}>Order</Text>
        <Field k="Client" v={project.client_name} />
        <Field k="Client contact" v={project.client_contact} />
        <Field k="Assigned manager" v={managerName} />
        <Field k="Quantity" v={project.quantity} />

        <Text style={s.sectionTitle}>Transformer specification</Text>
        <Field k="Type" v={TRANSFORMER_LABEL[project.transformer_kind]} />
        <Field k="Rated capacity" v={project.capacity_kva ? `${project.capacity_kva} kVA` : null} />
        <Field k="Primary voltage" v={project.primary_voltage} />
        <Field k="Secondary voltage" v={project.secondary_voltage} />
        <Field k="Phase" v={project.phase ? `${project.phase}-phase` : null} />
        <Field k="Frequency" v={project.frequency_hz ? `${project.frequency_hz} Hz` : null} />
        <Field k="Cooling" v={project.cooling_type} />
        <Field k="Impedance" v={project.impedance_pct ? `${project.impedance_pct} %` : null} />

        <Text style={s.sectionTitle}>Requirements &amp; quality notes</Text>
        <Text style={s.notes}>{project.requirements_notes || "—"}</Text>

        {tasks.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Production tasks</Text>
            {tasks.map((t) => (
              <View style={s.row} key={t.id}>
                <Text style={s.cellK}>{t.status.replace(/_/g, " ")}</Text>
                <Text style={s.cellV}>{t.title}</Text>
              </View>
            ))}
          </>
        )}

        {includePricing ? (
          <>
            <Text style={s.sectionTitle}>Pricing (internal)</Text>
            <Field k="Unit price" v={inr(project.unit_price)} />
            <Field k="Material cost" v={inr(project.material_cost)} />
            <Field k="Labour cost" v={inr(project.labour_cost)} />
            <Field k="Margin" v={inr(project.margin)} />
            <Field k="Order total" v={inr(project.total_price)} />
            <Text style={s.priceNote}>
              Pricing section included because this sheet was generated by{" "}
              {ROLE_LABEL[role]}. Do not distribute externally.
            </Text>
          </>
        ) : (
          <Text style={s.priceNote}>
            Pricing is omitted from this document ({ROLE_LABEL[role]} does not have
            pricing visibility).
          </Text>
        )}

        <View style={s.footer} fixed>
          <Text>
            NR Industries · Generated for {requestedBy.full_name} ({ROLE_LABEL[role]})
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderSpecSheet(data: SpecSheetData): Promise<Buffer> {
  return renderToBuffer(<SpecSheet {...data} />);
}
