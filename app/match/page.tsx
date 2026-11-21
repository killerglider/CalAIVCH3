"use client";

import { useEffect, useState } from "react";
import { ContinueLink } from "@/components/ContinueLink";
import type { ItemMatch } from "@/lib/types";
import { postJson } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";
import { getActiveRequirementId } from "@/lib/client-session";

export default function MatchPage() {
  const [matches, setMatches] = useState<ItemMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    postJson<ItemMatch[]>("/api/match", { requirement_id: getActiveRequirementId() }, controller.signal)
      .then(setMatches)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load item matches");
      });
    return () => controller.abort();
  }, []);
  return <main className="page-shell"><WorkflowHeader step="02" eyebrow="Catalogue intelligence / Resolve" title="Item-code match review" description="The agent finds the closest ERP code, keeps the alternatives visible, and calls out duplicate clusters for review." meta="ERP / Waterproofing catalogue" />{error ? <ErrorState message={error} /> : !matches ? <LoadingState label="Matching site requirements to ERP" /> : <div className="space-y-8">{matches.map((match) => <article key={match.requirement_line_id} className="luxury-panel overflow-hidden"><div className="grid gap-6 border-b border-[#cbd4d6] p-6 lg:grid-cols-[1fr_300px] lg:p-8"><div><p className="eyebrow">Site requirement</p><p className="mt-4 max-w-2xl font-serif text-2xl leading-tight text-[#31525e]">{match.query_text}</p><div className="mt-5 flex flex-wrap items-center gap-3"><span className={`border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${match.decision === "matched" ? "border-[#bdd0c8] bg-[#eef5f1] text-[#587b70]" : "border-[#d9cba9] bg-[#fbf7ed] text-[#a7823a]"}`}>{match.decision === "matched" ? "Matched" : "New code suggested"}</span>{match.decision === "new_code_suggested" && <span className="font-mono text-xs font-bold text-[#a7823a]">{match.suggested_new_code}</span>}</div></div><div className="border-l-2 border-[#a7823a] bg-[#f7f8f7] p-5"><p className="muted-label">Best match</p><p className="mt-3 font-mono text-lg font-bold text-[#31525e]">{match.best.item_code}</p><p className="mt-2 text-xs leading-5 text-[#61747c]">{match.best.description}</p><div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 bg-[#d7dcdd]"><div className="h-full bg-[#a7823a]" style={{ width: `${match.best.score * 100}%` }} /></div><span className="text-xs font-bold text-[#a7823a]">{Math.round(match.best.score * 100)}%</span></div></div></div><div className="grid gap-8 p-6 lg:grid-cols-[1fr_0.9fr] lg:p-8"><div><div className="mb-4 flex items-end justify-between"><div><p className="eyebrow">Similarity set</p><h2 className="mt-2 text-2xl text-[#31525e]">Candidate codes</h2></div><span className="text-[10px] uppercase tracking-[0.16em] text-[#8d9a9f]">Similarity score</span></div><details open className="group border-y border-[#d7dcdd]"><summary className="cursor-pointer list-none py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#a7823a]">{match.candidates.length} candidates</summary><ol className="divide-y divide-[#e5e8e8]">{[...match.candidates].sort((a, b) => b.score - a.score).map((candidate, index) => <li key={`${candidate.item_code}-${index}`} className="flex items-center justify-between gap-4 py-4"><div><p className="font-mono text-xs font-bold text-[#31525e]">{candidate.item_code}</p><p className="mt-1 text-sm text-[#61747c]">{candidate.description}</p></div><span className={`shrink-0 text-sm font-bold ${candidate.item_code === match.best.item_code ? "text-[#a7823a]" : "text-[#728188]"}`}>{Math.round(candidate.score * 100)}%</span></li>)}</ol></details></div><div className="border border-[#d9cba9] bg-[#fbf7ed] p-5"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Duplicate cluster</p><h2 className="mt-2 text-2xl text-[#31525e]">{match.duplicate_cluster.length} likely duplicate ERP codes</h2></div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a7823a]">Review</span></div><div className="mt-4 divide-y divide-[#e8ddc2]">{match.duplicate_cluster.map((candidate) => <div key={`${candidate.item_code}-${candidate.description}`} className="py-3"><p className="font-mono text-xs font-bold text-[#31525e]">{candidate.item_code}</p><p className="mt-1 text-xs leading-5 text-[#61747c]">{candidate.description}</p></div>)}</div></div></div></article>)}<ContinueLink href="/rfq" label="RFQ Draft" /></div>}</main>;
}
