"use client";

import { useEffect, useState } from "react";

import type {
  ComparativeStatement,
  Recommendation,
} from "@/lib/types";

export default function ComparativePage() {
  const [statement, setStatement] = useState<ComparativeStatement | null>(null);
  const [recommendation, setRecommendation] =
    useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [statementResponse, recommendationResponse] = await Promise.all([
          fetch("/api/comparative", {
            method: "POST",
            signal: controller.signal,
          }),
          fetch("/api/recommend", {
            method: "POST",
            signal: controller.signal,
          }),
        ]);

        if (!statementResponse.ok || !recommendationResponse.ok) {
          throw new Error("Unable to load the comparative statement");
        }

        setStatement(
          (await statementResponse.json()) as ComparativeStatement,
        );
        setRecommendation(
          (await recommendationResponse.json()) as Recommendation,
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load mock data",
        );
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  return (
    <main className="page-shell">
      <p className="eyebrow">Step 04 · Hero view</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">
        Comparative statement
      </h1>
      <p className="mb-8 mt-3 max-w-2xl leading-7">
        A common commercial view across normalized vendor quotes, with a
        separate typed recommendation response.
      </p>

      {error ? (
        <div className="card text-red-700">{error}</div>
      ) : !statement ? (
        <div className="card">Loading typed mocks…</div>
      ) : (
        <div className="space-y-6">
          <section className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950 text-slate-100">
                  <tr>
                    <th className="px-5 py-4 font-medium">Item</th>
                    <th className="px-5 py-4 font-medium">Qty</th>
                    {statement.items[0]?.vendor_rates.map((rate) => (
                      <th
                        key={rate.vendor}
                        className="px-5 py-4 font-medium"
                      >
                        {rate.vendor}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statement.items.map((item) => (
                    <tr key={item.item_code} className="border-t border-slate-200">
                      <td className="px-5 py-5">
                        <strong className="block text-slate-950">
                          {item.item_code}
                        </strong>
                        <span>{item.description}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-5">
                        {item.qty ?? "—"} {item.uom}
                      </td>
                      {item.vendor_rates.map((rate) => (
                        <td key={rate.vendor} className="px-5 py-5">
                          <strong className="text-slate-950">
                            ₹
                            {rate.unit_rate_norm?.toLocaleString("en-IN", {
                              maximumFractionDigits: 2,
                            }) ?? "—"}
                          </strong>
                          <span className="mt-1 block text-xs text-amber-700">
                            {rate.flags.join(", ") || "No flags"}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {recommendation && (
            <section className="rounded-2xl bg-emerald-950 p-6 text-emerald-50 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
                Mock recommendation
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                {recommendation.recommended_vendor}
              </h2>
              <p className="mt-3 max-w-3xl leading-7 text-emerald-100">
                {recommendation.reasoning}
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
