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

// Premium letterhead: a full-bleed dark header band (echoing the site's
// dark/technical brand), a real type scale, and a consistent grid rhythm
// instead of ad-hoc spacing — this is a real company document, not a
// default react-pdf template. Page.padding stays 0 so the header band can
// run edge-to-edge; everything else lives inside `s.body`'s own padding.
const INK = "#0a0a0a";
const RULE = "#e2e2e2";
const MUTED = "#6f6f6f";

const s = StyleSheet.create({
  page: { fontSize: 9.5, color: "#1a1a1a", fontFamily: "Helvetica" },

  headerBand: {
    backgroundColor: INK,
    paddingHorizontal: 48,
    paddingVertical: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  brand: {
    fontSize: 19,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 2.2,
  },
  tagline: { fontSize: 8, color: "#9a9a9a", marginTop: 4, letterSpacing: 0.3 },
  docType: { fontSize: 8.5, color: "#ffffff", textAlign: "right", letterSpacing: 1.2 },
  docDate: { fontSize: 8, color: "#9a9a9a", textAlign: "right", marginTop: 4 },

  body: { padding: 48, paddingTop: 32 },

  titleBlock: { marginBottom: 22, borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 14 },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 0.2 },
  sub: { fontSize: 9.5, color: MUTED, marginTop: 4 },

  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginTop: 24,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    color: INK,
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 5,
  },

  row: { flexDirection: "row", paddingVertical: 5.5, paddingHorizontal: 6 },
  rowAlt: { backgroundColor: "#f7f7f7" },
  cellK: { width: "36%", color: MUTED, fontSize: 9 },
  cellV: { width: "64%", fontFamily: "Helvetica-Bold", fontSize: 9.5 },

  notes: { marginTop: 2, lineHeight: 1.6, color: "#2a2a2a", fontSize: 9.5 },

  footer: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: "#9ca3af",
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 7,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  priceNote: { fontSize: 8, color: MUTED, marginTop: 6, lineHeight: 1.5 },
});

function Field({ k, v, index }: { k: string; v: string | number | null | undefined; index: number }) {
  return (
    <View style={[s.row, ...(index % 2 === 1 ? [s.rowAlt] : [])]}>
      <Text style={s.cellK}>{k}</Text>
      <Text style={s.cellV}>{v === null || v === undefined || v === "" ? "—" : String(v)}</Text>
    </View>
  );
}

/** A section renders its own Field rows so zebra striping resets per section. */
function Section({
  title,
  fields,
}: {
  title: string;
  fields: { k: string; v: string | number | null | undefined }[];
}) {
  return (
    <>
      <Text style={s.sectionTitle}>{title}</Text>
      {fields.map((f, i) => (
        <Field key={f.k} k={f.k} v={f.v} index={i} />
      ))}
    </>
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
        <View style={s.headerBand} fixed>
          <View>
            <Text style={s.brand}>NR INDUSTRIES</Text>
            <Text style={s.tagline}>POWER AT THE BEST — TRANSFORMER MANUFACTURING</Text>
          </View>
          <View>
            <Text style={s.docType}>PROJECT SPECIFICATION SHEET</Text>
            <Text style={s.docDate}>{now}</Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.titleBlock}>
            <Text style={s.h1}>{project.name}</Text>
            <Text style={s.sub}>
              {project.client_name || "No client"} · Status: {project.status.replace(/_/g, " ")}
            </Text>
          </View>

          <Section
            title="Order"
            fields={[
              { k: "Client", v: project.client_name },
              { k: "Client contact", v: project.client_contact },
              { k: "Assigned manager", v: managerName },
              { k: "Quantity", v: project.quantity },
            ]}
          />

          <Section
            title="Transformer specification"
            fields={[
              { k: "Type", v: TRANSFORMER_LABEL[project.transformer_kind] },
              { k: "Rated capacity", v: project.capacity_kva ? `${project.capacity_kva} kVA` : null },
              { k: "Primary voltage", v: project.primary_voltage },
              { k: "Secondary voltage", v: project.secondary_voltage },
              { k: "Phase", v: project.phase ? `${project.phase}-phase` : null },
              { k: "Frequency", v: project.frequency_hz ? `${project.frequency_hz} Hz` : null },
              { k: "Cooling", v: project.cooling_type },
              { k: "Impedance", v: project.impedance_pct ? `${project.impedance_pct} %` : null },
            ]}
          />

          <Text style={s.sectionTitle}>Requirements &amp; quality notes</Text>
          <Text style={s.notes}>{project.requirements_notes || "—"}</Text>

          {tasks.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Production tasks</Text>
              {tasks.map((t, i) => (
                <View style={[s.row, ...(i % 2 === 1 ? [s.rowAlt] : [])]} key={t.id}>
                  <Text style={s.cellK}>{t.status.replace(/_/g, " ")}</Text>
                  <Text style={s.cellV}>{t.title}</Text>
                </View>
              ))}
            </>
          )}

          {includePricing ? (
            <>
              <Section
                title="Pricing (internal)"
                fields={[
                  { k: "Unit price", v: inr(project.unit_price) },
                  { k: "Material cost", v: inr(project.material_cost) },
                  { k: "Labour cost", v: inr(project.labour_cost) },
                  { k: "Margin", v: inr(project.margin) },
                  { k: "Order total", v: inr(project.total_price) },
                ]}
              />
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
        </View>

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
