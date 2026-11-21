import { ApiPreview } from "@/components/ApiPreview";

export default function IntakePage() {
  return (
    <main className="page-shell">
      <p className="eyebrow">Step 01</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">
        Requirement intake
      </h1>
      <p className="mb-8 mt-3 max-w-2xl leading-7">
        Placeholder for form entry, WhatsApp ingestion, and voice
        transcription. The response below is the shared Requirement contract.
      </p>
      <ApiPreview endpoint="/api/intake" title="Captured requirement" />
    </main>
  );
}
