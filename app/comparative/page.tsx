"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComparativeStatement, Recommendation } from "@/lib/types";
import { postJson } from "@/lib/api";
import { getActiveRequirementId } from "@/lib/client-session";
import { ErrorState, LoadingState } from "@/components/LoadingState";
import { WorkflowHeader } from "@/components/WorkflowHeader";

const money = (value: number | null) => value == null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const isManualReview = (notes: string, rateIndex: number) => rateIndex === 0 || /manual review/i.test(notes);

export default function ComparativePage() {
  const [statement, setStatement] = useState<ComparativeStatement | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requirement_id = getActiveRequirementId();
    const body = requirement_id ? { requirement_id } : undefined;
    Promise.all([
      postJson<ComparativeStatement>("/api/comparative", body, controller.signal),
      postJson<Recommendation>("/api/recommend", body, controller.signal),
    ]).then(([nextStatement, nextRecommendation]) => {
      setStatement(nextStatement);
      setRecommendation(nextRecommendation);
    }).catch((requestError: unknown) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Unable to load the comparative statement");
    });
    return () => controller.abort();
  }, []);

  const vendors = useMemo(() => statement?.vendor_summary.slice().sort((a, b) => {
    const manualOrder = Number(isManualReview(a.notes, a.rate_index)) - Number(isManualReview(b.notes, b.rate_index));
    return manualOrder || a.rank - b.rank;
  }) ?? [], [statement]);

  return <main className="page-shell"><WorkflowHeader step="04" eyebrow="Decision office / Compare" title="Comparative statement" description="A common SQM basis across every quote layout, with scope differences surfaced before the HOD decision." meta="Amara Tower-2 / HOD review" />
    {error ? <ErrorState message={error} /> : !statement ? <LoadingState label="Building normalized comparison" /> : <div className="space-y-8">
      {recommendation && <section className="relative overflow-hidden bg-[#31525e] p-6 text-white sm:p-8"><div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-[#a7823a]/25 to-transparent" /><div className="relative grid gap-8 lg:grid-cols-[1fr_330px]"><div><div className="flex items-center gap-3"><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d0b355]">Recommendation</span><span className="h-px w-10 bg-[#a7823a]" /></div><h2 className="mt-5 text-3xl text-white sm:text-4xl">Recommended: {recommendation.recommended_vendor}</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-[#d8e0e2]">{recommendation.reasoning}</p></div><div className="border-l border-[#6d8993] pl-5"><p className="muted-label text-[#d0b355]">Watch-outs</p><ul className="mt-4 space-y-3 text-xs leading-5 text-[#d8e0e2]">{recommendation.caveats.map((caveat) => <li key={caveat} className="flex gap-2"><span className="text-[#d0b355]">!</span>{caveat}</li>)}</ul></div></div></section>}
      <section><div className="mb-4 flex items-end justify-between"><div><p className="eyebrow">Vendor ranking</p><h2 className="mt-2 text-2xl text-[#31525e]">Commercial fit and delivery signal</h2></div><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8d9a9f]">Score out of 100</span></div><div className="grid gap-px border border-[#cbd4d6] bg-[#cbd4d6] sm:grid-cols-2 xl:grid-cols-4">{vendors.map((vendor) => { const manual = isManualReview(vendor.notes, vendor.rate_index); return <div key={vendor.vendor} className={`bg-[#fdfdfc] p-5 ${vendor.rank === 1 && !manual ? "border-t-2 border-[#a7823a]" : ""} ${manual ? "opacity-60" : ""}`}><div className="flex items-start justify-between gap-3"><div><span className="font-mono text-xs text-[#a7823a]">{manual ? "—" : `0${vendor.rank}`}</span><p className="mt-3 font-serif text-xl text-[#31525e]">{vendor.vendor}</p></div><span className="font-serif text-3xl text-[#31525e]">{vendor.score}</span></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#e5e8e8] pt-4"><div><p className="muted-label">Rate index</p><p className="mt-2 text-sm font-bold text-[#31525e]">{vendor.rate_index || "—"}</p></div><div><p className="muted-label">Performance</p><p className="mt-2 text-sm font-bold text-[#31525e]">{vendor.performance_score}</p></div></div><p className="mt-4 text-xs leading-5 text-[#728188]">{vendor.notes}</p>{manual && <p className="mt-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[#8e5148]">Excluded pending manual review</p>}</div>; })}</div></section>
      <section className="luxury-panel overflow-hidden"><div className="flex flex-col gap-4 border-b border-[#cbd4d6] px-5 py-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Normalized rate matrix</p><h2 className="mt-2 text-2xl text-[#31525e]">Matched items by vendor</h2></div><div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-[0.12em] text-[#728188]"><span className="flex items-center gap-2"><span className="h-2 w-2 bg-[#6c9687]" /> Lowest usable</span><span className="flex items-center gap-2"><span className="h-2 w-2 bg-[#d0b355]" /> Scope differs</span><span>Rates per SQM</span></div></div><div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-left text-sm"><thead className="bg-[#f7f8f7] text-[10px] uppercase tracking-[0.14em] text-[#77868b]"><tr><th className="w-64 px-5 py-4 font-bold">Requirement item</th><th className="w-24 px-4 py-4 font-bold">Reference qty</th>{vendors.map((vendor) => <th key={vendor.vendor} className={`min-w-44 px-4 py-4 align-top font-bold ${isManualReview(vendor.notes, vendor.rate_index) ? "opacity-50" : ""}`}><span className="block text-[#31525e]">{vendor.vendor}</span><span className="mt-2 block text-[9px] font-normal normal-case leading-4 tracking-normal text-[#728188]">{vendor.notes}</span></th>)}</tr></thead><tbody>{statement.items.map((item) => {
        const usableRates = item.vendor_rates.filter((rate) => rate.unit_rate_norm != null && !rate.flags.includes("uom_unsupported") && !rate.flags.includes("needs_manual_review") && !rate.flags.includes("missing_rate"));
        const lowest = usableRates.length ? Math.min(...usableRates.map((rate) => rate.unit_rate_norm as number)) : null;
        const loneRate = usableRates.length === 1 && item.vendor_rates.some((rate) => rate.flags.includes("uom_unsupported"));
        return <tr key={item.item_code} className="border-t border-[#e5e8e8] align-top"><td className="px-5 py-5"><span className="font-mono text-xs font-bold text-[#a7823a]">{item.item_code}</span><p className="mt-2 font-medium leading-5 text-[#31525e]">{item.description}</p></td><td className="whitespace-nowrap px-4 py-5 text-[#61747c]">{item.qty?.toLocaleString("en-IN") ?? "—"}<span className="ml-1 text-xs text-[#8d9a9f]">{item.uom}</span></td>{vendors.map((vendor) => { const rate = item.vendor_rates.find((entry) => entry.vendor === vendor.vendor); const flags = rate?.flags ?? []; const unsupported = flags.includes("uom_unsupported"); const manual = flags.includes("needs_manual_review"); const missing = flags.includes("missing_rate"); const isLowest = !loneRate && !unsupported && rate?.unit_rate_norm != null && rate.unit_rate_norm === lowest; return <td key={vendor.vendor} className={`px-4 py-5 ${isLowest ? "bg-[#eef5f1]" : ""} ${isManualReview(vendor.notes, vendor.rate_index) ? "opacity-55" : ""}`}><span className={`font-serif text-xl ${isLowest ? "text-[#587b70]" : "text-[#31525e]"}`}>{unsupported ? "n/c (units differ)" : manual || missing || rate?.unit_rate_norm == null ? "—" : money(rate.unit_rate_norm)}</span>{loneRate && !unsupported && rate?.unit_rate_norm != null && <p className="mt-2 text-[10px] font-bold leading-4 text-[#a7823a]">Only quote in this unit, not scored</p>}{flags.includes("scope_mismatch") && <span className="mt-2 inline-block border border-[#d9cba9] bg-[#fbf7ed] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#a7823a]">Scope differs</span>}{flags.includes("unit_converted") && <p className="mt-2 text-[10px] text-[#8d9a9f]">Converted from SQFT</p>}{manual && <p className="mt-2 text-[10px] font-bold text-[#8e5148]">Scanned, manual review</p>}</td>; })}</tr>;
      })}</tbody></table></div></section>
    </div>}
  </main>;
}
