"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { RfqDraft } from "@/lib/types";
import { postJson } from "@/lib/api";
import { getActiveRequirementId } from "@/lib/client-session";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { ContinueLink } from "@/components/ContinueLink";
import { WorkflowHeader } from "@/components/WorkflowHeader";

export default function RfqPage() {
  const [draft, setDraft] = useState<RfqDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itemCode, setItemCode] = useState("WP.01");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const request = { item_code: itemCode, qty: qty === "" ? null : Number(qty), requirement_id: getActiveRequirementId() };
      setDraft(await postJson<RfqDraft>("/api/rfq", request));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create RFQ draft"); }
    finally { setBusy(false); }
  }

  const recipients = draft?.body.split("This request is addressed to:")[1]?.split("Please quote")[0].split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean) ?? [];

  return <main className="page-shell"><WorkflowHeader step="03" eyebrow="Vendor outreach / Draft" title="RFQ draft" description="Create a reviewable request with category-filtered recipients and Vinayak’s standard terms." meta="Draft only / No email sent" />
    <form onSubmit={createDraft} className="luxury-panel mb-8 grid gap-5 p-5 sm:grid-cols-[1fr_180px_auto] sm:items-end"><div><label className="muted-label" htmlFor="item-code">ERP item code</label><input id="item-code" className="field mt-2 font-mono" value={itemCode} onChange={(event) => setItemCode(event.target.value)} required /></div><div><label className="muted-label" htmlFor="rfq-qty">Quantity</label><input placeholder="From requirement" id="rfq-qty" className="field mt-2" type="number" min="0" value={qty} onChange={(event) => setQty(event.target.value)} /></div><button className="gold-button" disabled={busy}>{busy ? "Drafting..." : "Generate draft"}<span className="text-base text-[#d0b355]">-&gt;</span></button></form>
    {error && <div className="mb-6"><ErrorState message={error} /></div>}
    {!draft ? !error && <LoadingState label="Enter an item code and generate an RFQ draft" /> : <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]"><section className="luxury-panel overflow-hidden"><div className="flex items-center justify-between border-b border-[#cbd4d6] bg-[#f7f8f7] px-6 py-4"><div><p className="muted-label">Item code</p><p className="mt-2 font-mono text-sm font-bold text-[#a7823a]">{draft.item_code}</p></div><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a7823a]">Draft / not sent</span></div><div className="space-y-6 p-6 sm:p-8"><div><label className="muted-label" htmlFor="subject">Subject</label><input id="subject" className="field mt-2" value={draft.subject} readOnly /></div><div><label className="muted-label" htmlFor="body">Email body and recipients</label><textarea id="body" className="field mt-2 min-h-72 resize-y leading-7" value={draft.body} readOnly /></div><div className="flex flex-wrap gap-2">{recipients.map((recipient) => <span key={recipient} className="border border-[#cbd4d6] px-2.5 py-1.5 text-[10px] font-semibold text-[#31525e]">{recipient}</span>)}</div><button type="button" disabled className="gold-button opacity-50">Send (test inbox only)</button><p className="text-xs text-[#728188]">The agent drafts the RFQ but never emails a real vendor.</p></div></section><aside className="luxury-panel h-fit p-6"><p className="eyebrow">Standard terms</p><h2 className="mt-3 text-2xl text-[#31525e]">Vinayak commercial terms</h2><ol className="mt-6 divide-y divide-[#e5e8e8]">{draft.standard_terms.map((term, index) => <li key={term} className="flex gap-4 py-4 text-sm leading-6 text-[#61747c]"><span className="font-mono text-xs text-[#a7823a]">0{index + 1}</span><span className="flex gap-3"><input type="checkbox" checked readOnly className="mt-1 accent-[#a7823a]" /><span>{term}</span></span></li>)}</ol></aside></div>}
    {draft && !busy && <ContinueLink href="/quotes" label="Quotes" />}
  </main>;
}
