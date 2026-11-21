"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComparativeStatement, Recommendation } from "@/lib/types";
import { postJson } from "@/lib/api";
import { ErrorState, LoadingState } from "@/components/LoadingState";

const money = (value: number | null) => value == null ? "-" : `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function ComparativePage() {
  const [statement, setStatement] = useState<ComparativeStatement | null>(null);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      postJson<ComparativeStatement>("/api/comparative", undefined, controller.signal),
      postJson<Recommendation>("/api/recommend", undefined, controller.signal),
    ]).then(([nextStatement, nextRecommendation]) => {
      setStatement(nextStatement);
      setRecommendation(nextRecommendation);
    }).catch((requestError: unknown) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Unable to load the comparative statement");
    });
    return () => controller.abort();
  }, []);

  const vendors = useMemo(() => statement?.vendor_summary.slice().sort((a, b) => a.rank - b.rank) ?? [], [statement]);

  return (
    <main className="page-shell">
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="eyebrow">Decision view / Step 05</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Comparative statement</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">A common SQM basis across four quote layouts, with scope differences surfaced before the HOD decision.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Last refreshed just now <span className="rounded bg-slate-200 px-2 py-1 font-mono">AMARA / WP.01-WP.08</span></div>
      </div>

      {error ? <ErrorState message={error} /> : !statement ? <LoadingState label="Building normalized comparison" /> : (
        <div className="space-y-6">
          {recommendation && <section className="relative overflow-hidden rounded-xl bg-slate-950 p-6 text-white shadow-lg sm:p-7">
            <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-amber-400/15 to-transparent" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl"><div className="flex items-center gap-2"><span className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-950">Recommendation</span><span className="text-xs text-slate-400">HOD review required</span></div><h2 className="mt-4 text-2xl font-semibold tracking-tight text-white">Recommend {recommendation.recommended_vendor}</h2><p className="mt-3 text-sm leading-6 text-slate-300">{recommendation.reasoning}</p></div>
              <div className="w-full shrink-0 rounded-lg border border-white/10 bg-white/5 p-4 lg:max-w-xs"><p className="muted-label text-slate-400">Decision caveats</p><ul className="mt-3 space-y-2 text-xs leading-5 text-slate-300">{recommendation.caveats.map((caveat) => <li key={caveat} className="flex gap-2"><span className="text-amber-300">!</span>{caveat}</li>)}</ul></div>
            </div>
          </section>}

          <section>
            <div className="mb-3 flex items-end justify-between"><div><p className="eyebrow">Vendor ranking</p><h2 className="section-title mt-1">Commercial fit and delivery signal</h2></div><span className="text-xs text-slate-500">Score out of 100</span></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{vendors.map((vendor) => <div key={vendor.vendor} className={`card p-4 ${vendor.rank === 1 ? "border-amber-300 ring-1 ring-amber-200" : ""}`}><div className="flex items-start justify-between gap-3"><div><span className="font-mono text-xs text-slate-400">0{vendor.rank}</span><p className="mt-1 font-semibold text-slate-950">{vendor.vendor}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-900">{vendor.score}</span></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3"><div><p className="muted-label">Rate index</p><p className="mt-1 text-sm font-semibold text-slate-700">{vendor.rate_index}</p></div><div><p className="muted-label">Performance</p><p className="mt-1 text-sm font-semibold text-slate-700">{vendor.performance_score}</p></div></div><p className="mt-3 text-xs leading-5 text-slate-500">{vendor.notes}</p></div>)}</div>
          </section>

          <section className="card overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Normalized rate matrix</p><h2 className="section-title mt-1">Matched items by vendor</h2></div><div className="flex flex-wrap gap-3 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Lowest compliant</span><span className="flex items-center gap-1.5"><span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">!</span> Scope mismatch</span><span className="flex items-center gap-1.5"><span className="text-slate-400">converted</span> Unit converted</span></div></div>
            <div className="overflow-x-auto"><table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="w-72 px-5 py-3 font-bold">Requirement item</th><th className="w-28 px-5 py-3 font-bold">Quantity</th>{vendors.map((vendor) => <th key={vendor.vendor} className="min-w-40 px-5 py-3 font-bold">{vendor.vendor}</th>)}</tr></thead><tbody>{statement.items.map((item) => { const compliant = item.vendor_rates.filter((rate) => !rate.flags.includes("scope_mismatch") && rate.unit_rate_norm != null).map((rate) => rate.unit_rate_norm as number); const lowest = compliant.length ? Math.min(...compliant) : Math.min(...item.vendor_rates.filter((rate) => rate.unit_rate_norm != null).map((rate) => rate.unit_rate_norm as number)); return <tr key={item.item_code} className="border-t border-slate-200 align-top"><td className="px-5 py-5"><span className="font-mono text-xs font-bold text-amber-700">{item.item_code}</span><p className="mt-1 font-medium leading-5 text-slate-900">{item.description}</p></td><td className="whitespace-nowrap px-5 py-5 text-slate-600">{item.qty?.toLocaleString("en-IN") ?? "-"}<span className="ml-1 text-xs text-slate-400">{item.uom}</span></td>{vendors.map((vendor) => { const rate = item.vendor_rates.find((entry) => entry.vendor === vendor.vendor); const isLowest = rate?.unit_rate_norm != null && rate.unit_rate_norm === lowest && !rate.flags.includes("scope_mismatch"); return <td key={vendor.vendor} className={`px-5 py-5 ${isLowest ? "bg-emerald-50/80" : ""}`}><div className="flex items-start justify-between gap-3"><span className={`text-base font-bold ${isLowest ? "text-emerald-700" : "text-slate-950"}`}>{money(rate?.unit_rate_norm ?? null)}</span>{rate?.flags.includes("scope_mismatch") && <span className="shrink-0 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-950">!</span>}</div>{rate?.flags.includes("scope_mismatch") && <p className="mt-2 text-[11px] font-semibold leading-4 text-amber-800">Scope differs from requirement</p>}{rate?.flags.includes("unit_converted") && <p className="mt-2 text-[11px] text-slate-400">unit converted to SQM</p>}{rate?.unit_rate_norm == null && <p className="mt-2 text-[11px] text-slate-400">No comparable rate</p>}</td>})}</tr>})}</tbody></table></div>
          </section>
        </div>
      )}
    </main>
  );
}
