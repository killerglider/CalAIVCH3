"use client";

import { useEffect, useRef, useState } from "react";
import type { ComparativeStatement, ItemMatch, Recommendation, Requirement } from "@/lib/types";
import { postJson } from "@/lib/api";
import { getActiveRequirementId } from "@/lib/client-session";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";

type StageName = "load" | "match" | "comparative" | "recommend";
type StageState = "pending" | "running" | "done" | "error";
interface StreamEvent { type: "stage" | "done" | "error"; stage?: StageName; status?: "running" | "done"; ms?: number; data?: ItemMatch[] | ComparativeStatement | Recommendation; result?: { requirement: Requirement; matches: ItemMatch[]; comparative: ComparativeStatement; recommendation: Recommendation }; timings_ms?: Record<string, number>; error?: string; name?: string }
interface PipelineResult { requirement: Requirement; matches: ItemMatch[]; comparative: ComparativeStatement | null; recommendation: Recommendation | null; notes?: string[]; timings_ms?: Record<string, number> }

const stageOrder: StageName[] = ["load", "match", "comparative", "recommend"];
const stageMeta: Record<StageName, { label: string; weight: number; typicalMs: number }> = { load: { label: "Load requirement and quotes", weight: 5, typicalMs: 400 }, match: { label: "Match ERP codes", weight: 45, typicalMs: 7600 }, comparative: { label: "Build comparative statement", weight: 10, typicalMs: 1600 }, recommend: { label: "Write recommendation", weight: 40, typicalMs: 6700 } };
const money = (value: number | null) => value == null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function PipelinePage() {
  const [requirementId, setRequirementId] = useState("");
  const [states, setStates] = useState<Record<StageName, StageState>>({ load: "pending", match: "pending", comparative: "pending", recommend: "pending" });
  const [timings, setTimings] = useState<Partial<Record<StageName, number>>>({});
  const [active, setActive] = useState<StageName | null>(null);
  const [progress, setProgress] = useState(0);
  const [streamStarted, setStreamStarted] = useState(false);
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [matches, setMatches] = useState<ItemMatch[] | null>(null);
  const [comparative, setComparative] = useState<ComparativeStatement | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [error, setError] = useState<{ stage?: string; error: string; name?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"stream" | "atomic">("stream");
  const startedAt = useRef<number | null>(null);

  useEffect(() => { setRequirementId(getActiveRequirementId() ?? ""); }, []);
  useEffect(() => {
    let frame = 0;
    const animate = (now: number) => {
      if (active && startedAt.current != null) {
        const elapsed = Math.max(0, now - startedAt.current);
        const fraction = Math.min(0.9, 0.9 * (1 - Math.exp(-3 * elapsed / stageMeta[active].typicalMs)));
        const completed = stageOrder.slice(0, stageOrder.indexOf(active)).reduce((sum, stage) => sum + stageMeta[stage].weight, 0);
        setProgress(Math.min(99, completed + stageMeta[active].weight * fraction));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  function resetRun() {
    setStates({ load: "pending", match: "pending", comparative: "pending", recommend: "pending" });
    setTimings({}); setActive(null); setProgress(0); setRequirement(null); setMatches(null); setComparative(null); setRecommendation(null); setError(null); startedAt.current = null;
  }

  function applyEvent(event: StreamEvent) {
    setStreamStarted(true);
    if (event.type === "stage" && event.stage) {
      const stage = event.stage;
      if (event.status === "running") {
        setActive(stage); startedAt.current = performance.now();
        setStates((current) => ({ ...current, [stage]: "running" }));
        return;
      }
      if (event.status === "done") {
        setStates((current) => ({ ...current, [stage]: "done" }));
        if (event.ms != null) setTimings((current) => ({ ...current, [stage]: event.ms }));
        setProgress((current) => Math.max(current, stageOrder.slice(0, stageOrder.indexOf(stage) + 1).reduce((sum, key) => sum + stageMeta[key].weight, 0)));
        if (stage === "match" && Array.isArray(event.data)) setMatches(event.data as ItemMatch[]);
        if (stage === "comparative" && event.data && !Array.isArray(event.data)) setComparative(event.data as ComparativeStatement);
        if (stage === "recommend" && event.data && !Array.isArray(event.data)) setRecommendation(event.data as Recommendation);
        setActive(null); startedAt.current = null;
      }
    }
    if (event.type === "done" && event.result) {
      setRequirement(event.result.requirement); setMatches(event.result.matches); setComparative(event.result.comparative); setRecommendation(event.result.recommendation); setProgress(100); setActive(null); startedAt.current = null;
      if (event.timings_ms) setTimings(event.timings_ms as Partial<Record<StageName, number>>);
    }
    if (event.type === "error") {
      const failedStage = event.stage;
      if (failedStage) setStates((current) => ({ ...current, [failedStage]: "error" }));
      setError({ stage: failedStage, error: event.error ?? "Pipeline failed", name: event.name }); setActive(null); startedAt.current = null;
    }
  }

  async function runStream() {
    resetRun(); setStreamStarted(false); setMode("stream"); setRunning(true);
    try {
      const response = await fetch("/api/pipeline/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirement_id: requirementId.trim() }) });
      if (!response.ok) {
        const payload = await response.json() as { error?: string; name?: string };
        setError({ error: payload.error ?? `Request failed (${response.status})`, name: payload.name });
        return;
      }
      if (!response.body) throw new Error("The server did not return a stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n"); buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) continue;
          try { applyEvent(JSON.parse(dataLine.slice(6)) as StreamEvent); }
          catch { setError({ error: "The pipeline returned a malformed event.", name: "StreamParseError" }); }
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const dataLine = buffer.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) applyEvent(JSON.parse(dataLine.slice(6)) as StreamEvent);
      }
    } catch (e) { setError({ error: e instanceof Error ? e.message : "Unable to run pipeline", name: e instanceof Error ? e.name : "Error" }); }
    finally { setRunning(false); }
  }

  async function runAtomic(cached = false) {
    resetRun(); setMode("atomic"); setRunning(true);
    try {
      const result = await postJson<PipelineResult>("/api/pipeline", cached ? undefined : { requirement_id: requirementId.trim() });
      setRequirement(result.requirement); setMatches(result.matches); setComparative(result.comparative); setRecommendation(result.recommendation);
      setStates({ load: "done", match: "done", comparative: result.comparative ? "done" : "pending", recommend: result.recommendation ? "done" : "pending" }); setProgress(result.recommendation ? 100 : result.comparative ? 60 : 50); setTimings(result.timings_ms as Partial<Record<StageName, number>> ?? {});
      if (result.notes?.length) setError({ error: result.notes.join(" "), name: "PipelineNote" });
    } catch (e) { setError({ error: e instanceof Error ? e.message : "Unable to run pipeline", name: e instanceof Error ? e.name : "Error" }); }
    finally { setRunning(false); }
  }

  return <main className="page-shell"><WorkflowHeader step="06" eyebrow="Demo orchestration / Pipeline" title="Run the procurement chain" description="Watch the real agent stages complete and inspect each result as it arrives." meta="Streaming / stage events" />
    <section className="luxury-panel mb-8 p-5 sm:p-6"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="min-w-0 flex-1"><label className="muted-label" htmlFor="requirement-id">Persisted requirement ID</label><input id="requirement-id" className="field mt-2 font-mono" value={requirementId} onChange={(event) => setRequirementId(event.target.value)} placeholder="UUID from captured requirement" /><p className="mt-2 text-xs leading-5 text-[#728188]">Capture a requirement first or paste the preloaded requirement UUID. The cached demo uses the atomic endpoint.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={running || !requirementId.trim()} onClick={() => void runStream()} className="gold-button">{running && mode === "stream" ? "Running stages..." : "Run demo"}</button><button type="button" disabled={running || !requirementId.trim()} onClick={() => { setMode("atomic"); void runAtomic(false); }} className="border border-[#a7823a] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#31525e]">Run atomically</button><button type="button" disabled={running} onClick={() => { setMode("atomic"); void runAtomic(true); }} className="border border-[#cbd4d6] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.15em] text-[#728188]">Cached demo</button></div></div></section>
    {(mode === "atomic" ? running || progress > 0 || error : streamStarted) && <section className="luxury-panel mb-8 p-5 sm:p-6"><div className="flex items-center justify-between gap-4"><p className="eyebrow">Agent progress</p><span className="font-mono text-xs text-[#728188]">{Math.round(progress)}%</span></div><div className="mt-4 flex h-2 gap-1 bg-[#e5e8e8]">{stageOrder.map((stage) => { const completedBefore = stageOrder.slice(0, stageOrder.indexOf(stage)).reduce((sum, key) => sum + stageMeta[key].weight, 0); const fill = states[stage] === "done" ? 100 : states[stage] === "error" ? 100 : states[stage] === "running" ? Math.max(0, Math.min(100, ((progress - completedBefore) / stageMeta[stage].weight) * 100)) : mode === "atomic" && progress >= completedBefore + stageMeta[stage].weight ? 100 : 0; return <div key={stage} className="h-full bg-[#d7dcdd]" style={{ flex: `${stageMeta[stage].weight} 1 0%` }}><div className={`h-full transition-[width] duration-200 ease-out ${states[stage] === "error" ? "bg-[#a8584d]" : "bg-[#a7823a]"}`} style={{ width: `${fill}%` }} /></div>; })}</div><div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stageOrder.map((stage) => <div key={stage} className={`border-t-2 p-3 ${states[stage] === "done" ? "border-[#6c9687] bg-[#f4f8f5]" : states[stage] === "running" ? "border-[#a7823a] bg-[#fbf7ed]" : states[stage] === "error" ? "border-[#a8584d] bg-[#fff7f5]" : "border-[#d7dcdd] bg-[#f7f8f7]"}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-[#31525e]">{stageMeta[stage].label}</p><span className="font-mono text-[10px] text-[#a7823a]">{stageMeta[stage].weight}%</span></div><p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#728188]">{states[stage] === "done" ? `Complete · ${timings[stage] ?? 0} ms` : states[stage] === "running" ? "Processing" : states[stage] === "error" ? "Failed" : "Pending"}</p></div>)}</div>{error && <div className="mt-5 border border-[#d9a8a3] bg-[#fff7f5] p-4 text-sm text-[#8e4138]"><strong>{error.stage ?? "Request"} · {error.name ?? "Error"}</strong><p className="mt-1">{error.error}</p></div>}</section>}
    {mode === "stream" && error && !streamStarted && <div className="luxury-panel mb-8 border border-[#d9a8a3] bg-[#fff7f5] p-4 text-sm text-[#8e4138]"><strong>{error.name ?? "RequestError"}</strong><p className="mt-1">{error.error}</p></div>}
    {requirement && <section className="luxury-panel mb-6 p-5"><p className="eyebrow">01 / Requirement captured</p><h2 className="mt-2 text-2xl text-[#31525e]">{requirement.project}</h2><p className="mt-2 text-xs text-[#728188]">{requirement.lines.length} requirement line(s) · {requirement.id}</p><div className="mt-4 space-y-2">{requirement.lines.map((line) => <p key={line.id} className="text-sm text-[#31525e]">{line.wo_code && <span className="mr-2 font-mono text-[#a7823a]">{line.wo_code}</span>}{line.description} <span className="text-[#728188]">{line.qty ?? "—"} {line.uom}</span></p>)}</div></section>}
    {matches && <section className="luxury-panel mb-6 p-5"><p className="eyebrow">02 / Item-code matches</p><div className="mt-4 space-y-4">{matches.map((match) => <div key={match.requirement_line_id} className="border-t border-[#e5e8e8] pt-3"><p className="text-sm text-[#31525e]">{match.query_text}</p><p className="mt-1 font-mono text-xs font-bold text-[#a7823a]">{match.best.item_code} · {Math.round(match.best.score * 100)}%</p>{match.duplicate_cluster.length > 1 && <p className="mt-2 text-xs font-semibold text-[#a7823a]">Likely duplicates: {match.duplicate_cluster.map((candidate) => candidate.item_code).join(" / ")}</p>}</div>)}</div></section>}
    {comparative && <section className="luxury-panel mb-6 overflow-hidden"><div className="border-b border-[#cbd4d6] p-5"><p className="eyebrow">03 / Comparative statement</p><h2 className="mt-2 text-2xl text-[#31525e]">Normalized rates / ₹ per SQM</h2></div><div className="overflow-x-auto"><table className="min-w-[700px] w-full text-left text-xs"><thead className="bg-[#f7f8f7] text-[9px] uppercase tracking-[0.12em] text-[#77868b]"><tr><th className="p-4">Item</th>{comparative.vendor_summary.map((vendor) => <th key={vendor.vendor} className="p-4">{vendor.vendor}</th>)}</tr></thead><tbody>{comparative.items.map((item) => <tr key={item.item_code} className="border-t border-[#e5e8e8]"><td className="p-4"><span className="font-mono text-[#a7823a]">{item.item_code}</span><span className="ml-2 text-[#31525e]">{item.description}</span></td>{comparative.vendor_summary.map((vendor) => { const rate = item.vendor_rates.find((entry) => entry.vendor === vendor.vendor); const unsupported = rate?.flags.includes("uom_unsupported"); return <td key={vendor.vendor} className="p-4 font-semibold text-[#31525e]">{unsupported ? "n/c (units differ)" : money(rate?.unit_rate_norm ?? null)}{rate?.flags.includes("scope_mismatch") && <span className="ml-2 text-[#a7823a]">Scope differs</span>}</td>; })}</tr>)}</tbody></table></div></section>}
    {recommendation && <section className="mb-6 bg-[#31525e] p-6 text-white"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d0b355]">04 / Recommendation</p><h2 className="mt-3 text-3xl text-white">Recommended: {recommendation.recommended_vendor}</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-[#d8e0e2]">{recommendation.reasoning}</p><ul className="mt-4 space-y-2 text-xs leading-5 text-[#d8e0e2]">{recommendation.caveats.map((caveat) => <li key={caveat}>! {caveat}</li>)}</ul></section>}
  </main>;
}
