import Link from "next/link";
import { ArrowRight, Gauge, ShieldCheck, Factory, Zap } from "lucide-react";
import { CircuitGraphic } from "@/components/public/CircuitGraphic";

const CAPABILITIES = [
  {
    icon: Zap,
    title: "Distribution transformers",
    body: "10 kVA to 2500 kVA, up to 33 kV class. IS 1180 / IS 2026 compliant, copper or aluminium.",
  },
  {
    icon: Factory,
    title: "Power transformers",
    body: "Up to 20 MVA, 66 kV class, with on-load tap changers, AVR and full protection marshalling.",
  },
  {
    icon: Gauge,
    title: "Type & routine testing",
    body: "In-house impulse, temperature-rise and short-circuit withstand testing. FAT witnessed on request.",
  },
  {
    icon: ShieldCheck,
    title: "Built to last",
    body: "CRGO cores, vacuum-treated windings, and a QA process documented at every checkpoint.",
  },
];

const STATS = [
  { value: "3,200+", label: "units delivered" },
  { value: "20 MVA", label: "largest build" },
  { value: "35 yrs", label: "in manufacturing" },
  { value: "99.4%", label: "field reliability" },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      {/* hero */}
      <section className="grid items-center gap-10 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:py-16">
        <div className="nr-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1 text-[12px] text-text-secondary">
            <span className="size-1.5 rounded-full bg-status-success" />
            Transformer manufacturing since 1990
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Power at the Best.
          </h1>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-text-secondary sm:text-base">
            NR Industries designs and builds power and distribution transformers
            for utilities, industrial plants and infrastructure projects —
            engineered for the grid conditions they actually run in.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 nr-interactive nr-press rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover hover:shadow-[0_8px_24px_-6px_rgba(59,130,246,0.5)]"
            >
              Explore products <ArrowRight size={16} />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 nr-interactive nr-press rounded-lg border border-border-strong px-5 py-2.5 text-sm font-medium text-text hover:bg-white/[0.06] hover:border-white/25"
            >
              Request a quote
            </Link>
          </div>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 blur-2xl"
            style={{ background: "radial-gradient(circle at 50% 50%, rgba(59,130,246,0.18), transparent 65%)" }}
          />
          <CircuitGraphic className="w-full" />
        </div>
      </section>

      {/* stats strip */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="bg-panel px-5 py-5">
            <div className="text-2xl font-semibold tracking-tight tnum">{s.value}</div>
            <div className="mt-1 text-[12px] text-text-tertiary">{s.label}</div>
          </div>
        ))}
      </section>

      {/* capabilities */}
      <section className="py-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          What we manufacture
        </h2>
        <p className="mt-2 max-w-xl text-[15px] text-text-secondary">
          A focused range, made properly. Every unit is designed to spec and
          tested before it leaves the floor.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div
              key={c.title}
              className="nr-interactive rounded-xl border border-border bg-panel/60 p-5 hover:border-border-strong hover:bg-panel/80"
            >
              <c.icon size={20} className="text-accent" strokeWidth={1.75} />
              <h3 className="mt-4 text-[15px] font-semibold">{c.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* closing CTA */}
      <section className="rounded-2xl border border-border bg-gradient-to-b from-panel to-bg px-6 py-14 text-center">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Have a specification in hand?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-text-secondary">
          Send us the ratings and site conditions. We&apos;ll come back with a
          design proposal and a delivery schedule.
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-flex items-center gap-2 nr-interactive nr-press rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover hover:shadow-[0_8px_24px_-6px_rgba(59,130,246,0.5)]"
        >
          Talk to engineering <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  );
}
