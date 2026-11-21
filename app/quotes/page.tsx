import { ApiPreview } from "@/components/ApiPreview";

export default function QuotesPage() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Step 03</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">
        Quote upload and normalization
      </h1>
      <p className="mb-8 mt-3 max-w-2xl leading-7">
        Placeholder for PDF, spreadsheet, and image upload. The mock response
        demonstrates unit conversion and scope-mismatch flags.
      </p>
      <ApiPreview endpoint="/api/normalize" title="Normalized quote cards" />
    </main>
  );
}
