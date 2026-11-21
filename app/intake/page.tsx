"use client";

import { useState } from "react";
import { ContinueLink } from "@/components/ContinueLink";
import type { FormEvent } from "react";
import type { Requirement } from "@/lib/types";
import { postJson } from "@/lib/api";
import { setActiveRequirementId } from "@/lib/client-session";
import { ErrorState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";

type Tab = "form" | "whatsapp" | "voice";
const sampleTranscript = "Amara Tower-2 waterproofing. Toilet floor, WP.01, quantity 1247 square metres. Please invite vendors and begin in November.";

export default function IntakePage() {
  const [tab, setTab] = useState<Tab>("form");
  const [project, setProject] = useState("Amara Tower-2");
  const [description, setDescription] = useState("Waterproofing at toilet floor");
  const [qty, setQty] = useState("1247");
  const [uom, setUom] = useState("SQM");
  const [rawText, setRawText] = useState("Need waterproofing at toilet floor for Amara Tower-2. Quantity 1247 SQM. Please initiate RFQ.");
  const [transcript, setTranscript] = useState("");
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(body: BodyInit | object) {
    setRequirement(null);
    setLoading(true);
    setError(null);
    try {
      const result = await postJson<Requirement>("/api/intake", body);
      setRequirement(result);
      setActiveRequirementId(result.id);
      if (result.source === "voice") setTranscript(result.raw_text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to capture requirement");
    } finally {
      setLoading(false);
    }
  }

  function onVoiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("source", "voice");
    form.set("project", project);
    form.set("transcript", transcript);
    void submit(form);
  }

  return <main className="page-shell"><WorkflowHeader step="01" eyebrow="Site request / Capture" title="Requirement intake" description="Bring the request into a structured record before catalogue and commercial review begin." meta="Amara Tower-2 / New request" />
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="luxury-panel overflow-hidden">
        <div className="border-b border-[#cbd4d6] px-5 py-4"><p className="eyebrow">Choose a source</p><div className="tab-rail -mx-5 mt-3">{([ ["form", "Structured form"], ["whatsapp", "WhatsApp text"], ["voice", "Voice note"] ] as [Tab, string][]).map(([value, label]) => <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}</div></div>
        {tab === "form" && <form className="space-y-6 p-6 sm:p-8" onSubmit={(event) => { event.preventDefault(); void submit({ source: "form", project, lines: [{ id: crypto.randomUUID(), description, qty: Number(qty), uom, wo_code: "WP.01" }] }); }}><div><label className="muted-label" htmlFor="project">Project / site</label><input id="project" className="field mt-2" value={project} onChange={(event) => setProject(event.target.value)} required /></div><div><label className="muted-label" htmlFor="description">Work requirement</label><textarea id="description" className="field mt-2 min-h-32 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} required /></div><div className="grid gap-5 sm:grid-cols-2"><div><label className="muted-label" htmlFor="qty">Quantity</label><input id="qty" className="field mt-2" type="number" min="0" value={qty} onChange={(event) => setQty(event.target.value)} /></div><div><label className="muted-label" htmlFor="uom">Unit of measure</label><select id="uom" className="field mt-2" value={uom} onChange={(event) => setUom(event.target.value)}><option>SQM</option><option>RMT</option><option>Nos</option></select></div></div><button disabled={loading} className="gold-button">{loading ? "Saving requirement..." : "Capture requirement"}<span className="text-base text-[#d0b355]">-&gt;</span></button></form>}
        {tab === "whatsapp" && <form className="space-y-6 p-6 sm:p-8" onSubmit={(event) => { event.preventDefault(); void submit({ source: "whatsapp", project, raw_text: rawText }); }}><div><label className="muted-label" htmlFor="whatsapp">WhatsApp message</label><textarea id="whatsapp" className="field mt-2 min-h-56 resize-y leading-6" value={rawText} onChange={(event) => setRawText(event.target.value)} required /></div><button disabled={loading} className="gold-button">{loading ? "Parsing message..." : "Parse WhatsApp message"}<span className="text-base text-[#d0b355]">-&gt;</span></button></form>}
        {tab === "voice" && <form className="space-y-6 p-6 sm:p-8" onSubmit={onVoiceSubmit}><div className="border border-dashed border-[#aebdc1] bg-[#f7f8f7] p-8"><p className="font-serif text-xl text-[#31525e]">Voice note</p><p className="mt-2 text-xs text-[#77868b]">Upload audio or use the transcript field below.</p><input name="audio" className="mt-5 block w-full text-sm text-[#728188] file:mr-3 file:border-0 file:bg-[#31525e] file:px-3 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-[0.12em] file:text-white" type="file" accept="audio/*" /></div><div><div className="flex items-center justify-between gap-3"><label className="muted-label" htmlFor="transcript">Transcript fallback</label><button type="button" className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#a7823a]" onClick={() => setTranscript(sampleTranscript)}>Use sample</button></div><textarea id="transcript" className="field mt-2 min-h-32 resize-y leading-6" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Paste or enter the voice note transcript" /></div><button disabled={loading} className="gold-button">{loading ? "Transcribing and parsing..." : "Transcribe and capture"}<span className="text-base text-[#d0b355]">-&gt;</span></button></form>}
      </section>
      <aside className="space-y-5">{error && <ErrorState message={error} />}{requirement ? <section className="luxury-panel p-6"><div className="flex items-center justify-between"><p className="eyebrow">Requirement captured</p><span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#a7823a]">{requirement.source}</span></div><h2 className="mt-4 text-2xl text-[#31525e]">{requirement.project}</h2><p className="mt-2 text-xs text-[#8d9a9f]">Reference {requirement.id}</p>{requirement.source === "voice" && <div className="mt-5 border-l-2 border-[#a7823a] bg-[#f7f8f7] p-3"><p className="muted-label">Transcript</p><p className="mt-2 text-xs leading-5 text-[#61747c]">{requirement.raw_text}</p></div>}<div className="mt-5 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-y border-[#d7dcdd] text-[9px] uppercase tracking-[0.13em] text-[#77868b]"><tr><th className="py-3 pr-3">Description</th><th className="py-3 pr-3">Unit</th><th className="py-3 pr-3">Qty</th><th className="py-3">WO code</th></tr></thead><tbody>{requirement.lines.map((line) => <tr key={line.id} className="border-b border-[#e5e8e8] align-top"><td className="py-3 pr-3 text-[#31525e]">{line.description}</td><td className="py-3 pr-3">{line.uom}</td><td className="py-3 pr-3">{line.qty ?? "—"}</td><td className="py-3 font-mono text-[#a7823a]">{line.wo_code ?? "—"}</td></tr>)}</tbody></table></div><ContinueLink href="/match" label="Match" /></section> : <section className="luxury-panel p-6"><p className="eyebrow">Next in workflow</p><p className="mt-4 text-xl text-[#31525e]">Match each parsed line to the ERP catalogue.</p><p className="mt-3 text-sm leading-6 text-[#728188]">The captured requirement ID will carry through to matching, quote normalization, and the demo pipeline.</p></section>}</aside>
    </div>
  </main>;
}
