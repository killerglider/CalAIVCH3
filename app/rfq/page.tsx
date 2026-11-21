"use client";

import { useEffect, useState } from "react";
import type { RfqDraft } from "@/lib/types";
import { postJson } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";

export default function RfqPage() {
  const [draft, setDraft] = useState<RfqDraft | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { postJson<RfqDraft>("/api/rfq").then(setDraft).catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to load RFQ draft")); }, []);
  return <main className="page-shell"><WorkflowHeader step="05" eyebrow="Vendor outreach / Draft" title="RFQ draft" description="Review the generated request and standard commercial terms before it goes to the vendor list." meta="Mock send / Draft only" />{error ? <ErrorState message={error} /> : !draft ? <LoadingState label="Drafting vendor request" /> : <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]"><section className="luxury-panel overflow-hidden"><div className="flex items-center justify-between border-b border-[#cbd4d6] bg-[#f7f8f7] px-6 py-4"><div><p className="muted-label">Item code</p><p className="mt-2 font-mono text-sm font-bold text-[#a7823a]">{draft.item_code}</p></div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7823a]">Draft / not sent</span></div><div className="space-y-6 p-6 sm:p-8"><div><label className="muted-label" htmlFor="subject">Subject</label><input id="subject" className="field mt-2" defaultValue={draft.subject} readOnly /></div><div><label className="muted-label" htmlFor="body">Email body</label><textarea id="body" className="field mt-2 min-h-72 resize-y leading-7" defaultValue={draft.body} readOnly /></div><button disabled className="gold-button opacity-50">Send RFQ <span className="text-base text-[#d0b355]">-&gt;</span></button></div></section><aside className="luxury-panel h-fit p-6"><p className="eyebrow">Standard terms</p><h2 className="mt-3 text-2xl text-[#31525e]">Vinayak commercial terms</h2><ol className="mt-6 divide-y divide-[#e5e8e8]">{draft.standard_terms.map((term, index) => <li key={term} className="flex gap-4 py-4 text-sm leading-6 text-[#61747c]"><span className="font-mono text-xs text-[#a7823a]">0{index + 1}</span><span>{term}</span></li>)}</ol></aside></div>}</main>;
}
