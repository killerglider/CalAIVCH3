import Link from "next/link";

const views = [
  {
    href: "/intake",
    step: "01",
    title: "Requirement intake",
    description: "Form, WhatsApp, and voice requirement capture.",
  },
  {
    href: "/match",
    step: "02",
    title: "Item-code match",
    description: "Review likely catalogue matches and duplicate codes.",
  },
  {
    href: "/quotes",
    step: "03",
    title: "Quote normalization",
    description: "Inspect uploaded quotes converted to a common basis.",
  },
  {
    href: "/comparative",
    step: "04",
    title: "Comparative statement",
    description: "Compare rates, performance, and the mock recommendation.",
  },
];

export default function DashboardPage() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Procure-to-recommend workflow</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
        A typed, mock-first procurement agent skeleton.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
        Every view calls a Node.js API route and renders deterministic data. No
        database connection or API key is required for this demo.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {views.map((view) => (
          <Link
            key={view.href}
            href={view.href}
            className="card group transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
          >
            <span className="text-sm font-semibold text-emerald-700">
              {view.step}
            </span>
            <h2 className="mt-5 text-xl font-semibold text-slate-950 group-hover:text-emerald-800">
              {view.title} →
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {view.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
