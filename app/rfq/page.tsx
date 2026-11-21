"use client";

import { useEffect, useState } from "react";
import type { RfqDraft } from "@/lib/types";
import { postJson } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/LoadingState";

export default function RfqPage() {
  const [draft, setDraft] = useState<RfqDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { postJson<RfqDraft>("/api/rfq").then(setDraft).catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to load RFQ draft")); }, []);
  return <main className="page-shell"><div className="mb-8"><p className="eyebrow">Vendor outreach / Step 03</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">RFQ draft</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Review the generated request before it goes to the vendor list. Sending stays mocked for the demo.</p></div>{error ? <ErrorState message={error} /> : !draft ? <LoadingState label="Drafting vendor request" /> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="card"><div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5"><div><p className="muted-label">Item code</p><p className="mt-1 font-mono text-sm font-bold text-amber-700">{draft.item_code}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Draft</span></div><label className="muted-label mt-6 block" htmlFor="subject">Subject</label><input id="subject" className="field mt-2" defaultValue={draft.subject} readOnly /><label className="muted-label mt-6 block" htmlFor="body">Email body</label><textarea id="body" className="field mt-2 min-h-64 resize-y leading-6" defaultValue={draft.body} readOnly /><button disabled className="mt-6 rounded-lg bg-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600">Send RFQ (mocked)</button></section><aside className="card h-fit"><p className="eyebrow">Standard terms</p><h2 className="section-title mt-2">Vinayak commercial terms</h2><ol className="mt-5 space-y-4">{draft.standard_terms.map((term, index) => <li key={term} className="flex gap-3 text-sm leading-5 text-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">{index + 1}</span><span>{term}</span></li>)}</ol></aside></div>}</main>;
}
