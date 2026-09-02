import type { Metadata } from "next";

export const metadata: Metadata = { title: "Products" };

const RANGE = [
  {
    name: "Distribution transformers",
    specs: [
      ["Rating", "10 – 2500 kVA"],
      ["Voltage class", "up to 33 kV"],
      ["Type", "Oil-immersed, ONAN"],
      ["Standard", "IS 1180, IS 2026"],
    ],
    notes:
      "Hermetically sealed or conservator type. Copper or aluminium windings. CRGO core with mitred joints.",
  },
  {
    name: "Power transformers",
    specs: [
      ["Rating", "up to 20 MVA"],
      ["Voltage class", "up to 66 kV"],
      ["Cooling", "ONAN / ONAF"],
      ["Tap changer", "OLTC or off-circuit"],
    ],
    notes:
      "Complete protection marshalling — Buchholz, PRV, WTI/OTI, MOG. AVR panel and RTCC on request.",
  },
  {
    name: "Dry-type transformers",
    specs: [
      ["Rating", "100 – 2500 kVA"],
      ["Voltage class", "up to 11 kV"],
      ["Insulation", "Cast resin / VPI"],
      ["Enclosure", "IP00 – IP44"],
    ],
    notes:
      "For indoor installations, commercial buildings and locations with fire-safety constraints.",
  },
  {
    name: "Special-application units",
    specs: [
      ["Types", "Furnace, rectifier, isolation"],
      ["Rating", "project-specific"],
      ["Voltage class", "design to suit"],
      ["Testing", "type + routine"],
    ],
    notes:
      "Engineered against the load profile — high-current secondaries, harmonic duty, converter service.",
  },
];

export default function ProductsPage() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Products</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
          Four product families, each built to order against a verified design.
          Ratings below are indicative — final specification follows your site
          data and applicable standards.
        </p>
      </header>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {RANGE.map((p) => (
          <div key={p.name} className="rounded-xl border border-border bg-panel/60 p-6">
            <h2 className="text-lg font-semibold tracking-tight">{p.name}</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {p.specs.map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-text-tertiary">{k}</dt>
                  <dd className="text-text tnum">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-border pt-4 text-[13px] leading-relaxed text-text-secondary">
              {p.notes}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
