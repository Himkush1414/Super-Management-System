import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

const TIMELINE = [
  ["1990", "NR Industries founded — a single winding shop building distribution units."],
  ["2001", "In-house testing lab commissioned. First 33 kV class transformer shipped."],
  ["2012", "Power transformer line added, up to 10 MVA."],
  ["2020", "Capacity expanded to 20 MVA. Digital QA traceability introduced on every build."],
];

const VALUES = [
  ["Design to the grid", "We size for the fault levels, harmonics and ambient conditions of the actual installation — not a datasheet ideal."],
  ["Documented QA", "Every core stack, every winding, every test recorded against the job. Disputes get answered with records."],
  ["Long service life", "Materials and construction chosen for decades of duty, not the lowest bill of materials."],
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">About NR Industries</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
          We are a transformer manufacturer. That is the whole business — no
          distribution side-lines, no trading. Everything we ship, we designed
          and built.
        </p>
      </header>

      <section className="mt-14">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">
          How we work
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {VALUES.map(([t, b]) => (
            <div key={t} className="rounded-xl border border-border bg-panel/60 p-5">
              <h3 className="text-[15px] font-semibold">{t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-secondary">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">
          Timeline
        </h2>
        <ul className="mt-6 space-y-0">
          {TIMELINE.map(([year, text], i) => (
            <li key={year} className="flex gap-5">
              <div className="flex flex-col items-center">
                <span className="tnum text-[13px] font-medium text-accent">{year}</span>
                {i < TIMELINE.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-border" />
                )}
              </div>
              <p className="pb-8 text-[14px] leading-relaxed text-text-secondary">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
