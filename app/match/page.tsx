import { ApiPreview } from "@/components/ApiPreview";

export default function MatchPage() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Step 02</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">
        Item-code match review
      </h1>
      <p className="mb-8 mt-3 max-w-2xl leading-7">
        Placeholder for accepting a match, reviewing duplicate catalogue
        entries, or suggesting a new code.
      </p>
      <div className="space-y-6">
        <ApiPreview endpoint="/api/match" title="Candidate matches" />
        <ApiPreview endpoint="/api/rfq" title="Draft RFQ" />
      </div>
    </main>
  );
}
