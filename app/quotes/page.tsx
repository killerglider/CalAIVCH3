"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ContinueLink } from "@/components/ContinueLink";
import { normalizeQuotes } from "@/lib/normalize-client";
import type { NormalizationEvent } from "@/lib/normalization-events";
import type { NormalizedQuoteLine } from "@/lib/types";
import { postJson } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";
import { getActiveRequirementId } from "@/lib/client-session";

const samples = ["Quotation_Bajrang_Construction.pdf", "Quotation_Purvyakruti.pdf", "Quotation_Shyama.pdf", "Quotation_SK_Construction.pdf"];
const money = (value: number | null) => value == null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<NormalizedQuoteLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Extract<NormalizationEvent, { type: "progress" }> | null>(null);
  const [sample, setSample] = useState(samples[0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    postJson<NormalizedQuoteLine[]>("/api/normalize", { requirement_id: getActiveRequirementId() }, controller.signal)
      .then(setQuotes)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load quotes");
      });
    return () => { controller.abort(); operation.current?.abort(); };
  }, []);

  async function runNormalization(input: File[] | string[]) {
    if (!input.length || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setBusy(true);
    setProgress(null);
    try {
      const requirement_id = getActiveRequirementId();
      let body: FormData | { requirement_id: string; sampleFiles: string[] };
      if (typeof input[0] === "string") {
        body = { requirement_id, sampleFiles: input as string[] };
      } else {
        body = new FormData();
        body.set("requirement_id", requirement_id);
        for (const file of input as File[]) body.append("file", file);
      }
      await normalizeQuotes(body, setProgress, controller.signal);
      // Reload the full register, including vendors from earlier uploads.
      setQuotes(await postJson<NormalizedQuoteLine[]>("/api/normalize", { requirement_id }, controller.signal));
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to normalize quotes");
    } finally {
      operation.current = null;
      setBusy(false);
    }
  }

  const groups = useMemo(() => (quotes ?? []).reduce<Record<string, NormalizedQuoteLine[]>>((all, quote) => { (all[quote.vendor] ??= []).push(quote); return all; }, {}), [quotes]);

  return <main className="page-shell"><WorkflowHeader step="03" eyebrow="Commercial review / Normalize" title="Quote normalization" description="Four vendor layouts, one SQM basis. Review what was extracted before it enters the comparative statement." meta="Vendor replies / SQM basis" /><div className="mb-8 flex flex-wrap items-center gap-2"><select aria-label="Sample quotation" className="field w-auto min-w-56" value={sample} onChange={(event) => setSample(event.target.value)}><option value={samples[0]}>Bajrang Construction</option><option value={samples[1]}>Purvyakruti</option><option value={samples[2]}>Shyama</option><option value={samples[3]}>SK Construction</option></select><button type="button" onClick={() => void runNormalization([sample])} disabled={busy || (quotes === null && !error)} className="border border-[#a7823a] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#31525e]">Load sample</button><button type="button" onClick={() => void runNormalization(samples)} disabled={busy || (quotes === null && !error)} className="gold-button">{busy ? "Normalizing..." : "Normalize all four"}</button><button type="button" onClick={() => fileRef.current?.click()} disabled={busy || (quotes === null && !error)} className="border border-[#a7823a] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[#31525e]">Upload PDFs</button><input ref={fileRef} className="hidden" type="file" multiple accept="application/pdf,.pdf" onChange={(event) => { const files = Array.from(event.target.files ?? []); void runNormalization(files); event.currentTarget.value = ""; }} /></div>
    {busy && <section className="luxury-panel mb-6 p-5" role="status">
      <p className="eyebrow">Normalizing quotations</p>
      <div className="mt-2 flex justify-between gap-3 text-sm text-[#31525e]">
        <span>{progress?.label ?? "Submitting quotations"}</span>
        {progress && <span className="font-mono text-xs">{progress.completed} / {progress.total}</span>}
      </div>
      <progress aria-label="Normalization milestones completed" className="mt-4 block h-1.5 w-full accent-[#a7823a]" max={progress?.total ?? 1} value={progress?.completed} />
    </section>}
    {error && <ErrorState message={error} />}
    {quotes === null ? !error && <LoadingState label="Loading vendor quotations" /> : quotes.length === 0 ? (
      <section className="luxury-panel p-6">
        <h2 className="text-2xl text-[#31525e]">Load a vendor quote</h2>
        <p className="mt-2 text-sm text-[#61747c]">Choose a sample quotation or upload a PDF for this requirement.</p>
      </section>
    ) : <div className="space-y-8">{Object.entries(groups).map(([vendor, lines]) => <section key={vendor}><div className="mb-3 flex items-end justify-between border-b border-[#cbd4d6] pb-3"><div><p className="eyebrow">Vendor quotation</p><h2 className="mt-1 text-2xl text-[#31525e]">{vendor}</h2></div><span className="text-[10px] uppercase tracking-[0.16em] text-[#8d9a9f]">{lines.length} line{lines.length === 1 ? "" : "s"}</span></div><div className="grid gap-5 xl:grid-cols-2">{lines.map((quote, index) => <article key={`${quote.source_file}-${index}`} className="luxury-panel overflow-hidden"><div className="border-b border-[#cbd4d6] p-5"><div className="flex items-start justify-between gap-4"><div><p className="muted-label">{quote.source_file}</p><h3 className="mt-2 text-xl text-[#31525e]">{quote.item_label} {quote.matched_item_code && <span className="font-mono text-xs text-[#a7823a]">· {quote.matched_item_code}</span>}</h3></div><div className="text-right"><p className="muted-label">Confidence</p><p className="mt-1 font-serif text-2xl text-[#31525e]">{Math.round(quote.confidence * 100)}%</p>{quote.flags.includes("ocr_low_confidence") && <span title="Scanned quote needs a human check" className="text-xs font-bold text-[#a7823a]">! OCR check</span>}</div></div><div className="mt-4 h-1 bg-[#e5e8e8]"><div className={`h-full ${quote.confidence >= .85 ? "bg-[#6c9687]" : "bg-[#a7823a]"}`} style={{ width: `${quote.confidence * 100}%` }} /></div></div><div className="grid gap-px bg-[#d7dcdd] sm:grid-cols-2"><div className="bg-[#f7f8f7] p-5"><p className="muted-label">Original</p><p className="mt-3 font-serif text-xl text-[#31525e]">{quote.qty_original?.toLocaleString("en-IN") ?? "—"} {quote.uom_original}</p><p className="mt-1 text-xs text-[#728188]">{money(quote.rate_original)} / {quote.uom_original}</p></div><div className="bg-[#eef5f1] p-5"><p className="muted-label text-[#587b70]">Normalized</p><p className="mt-3 font-serif text-xl text-[#31525e]">{quote.qty_norm?.toLocaleString("en-IN") ?? "—"} {quote.uom_norm}</p><p className="mt-1 text-xs font-bold text-[#587b70]">{money(quote.unit_rate_norm)} / {quote.uom_norm}</p></div></div><dl className="grid grid-cols-2 gap-x-5 gap-y-4 p-5 text-sm"><div><dt className="muted-label">GST</dt><dd className="mt-1 text-[#31525e]">{quote.gst_pct == null ? "—" : `${quote.gst_pct}%`}</dd></div><div><dt className="muted-label">Freight</dt><dd className="mt-1 text-[#31525e]">{money(quote.freight)}</dd></div><div><dt className="muted-label">Payment terms</dt><dd className="mt-1 leading-5 text-[#61747c]">{quote.payment_terms ?? "—"}</dd></div><div><dt className="muted-label">Delivery</dt><dd className="mt-1 text-[#31525e]">{quote.delivery_days == null ? "—" : `${quote.delivery_days} days`}</dd></div></dl><div className="data-rule flex flex-wrap gap-2 px-5 py-4">{quote.flags.length ? quote.flags.map((flag) => <span key={flag} className={`border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${flag === "scope_mismatch" ? "border-[#d9cba9] bg-[#fbf7ed] text-[#a7823a]" : flag === "needs_manual_review" ? "border-[#c9b7b3] bg-[#f7efed] text-[#8e5148]" : "border-[#d7dcdd] text-[#728188]"}`}>{flag === "scope_mismatch" ? "Scope differs" : flag === "unit_converted" ? `Converted from ${quote.uom_original}` : flag === "needs_manual_review" ? "Scanned, manual review" : flag.replaceAll("_", " ")}</span>) : <span className="text-xs text-[#8d9a9f]">No review flags</span>}</div></article>)}</div></section>)}{!busy && <ContinueLink href="/rfq" label="RFQ Draft" />}</div>}
  </main>;
}
