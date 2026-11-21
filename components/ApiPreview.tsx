"use client";

import { useEffect, useState } from "react";

interface ApiPreviewProps {
  endpoint: string;
  title: string;
}

export function ApiPreview({ endpoint, title }: ApiPreviewProps) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMock() {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        setData((await response.json()) as unknown);
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

    void loadMock();
    return () => controller.abort();
  }, [endpoint]);

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <code className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
          POST {endpoint}
        </code>
      </div>
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-emerald-200">
          {data ? JSON.stringify(data, null, 2) : "Loading typed mock…"}
        </pre>
      )}
    </section>
  );
}
