import type { NormalizationEvent } from "./normalization-events";
import type { NormalizedQuoteLine } from "./types";

export async function normalizeQuotes(
  input: FormData | { requirement_id: string; sampleFiles: string[] },
  onProgress: (event: Extract<NormalizationEvent, { type: "progress" }>) => void,
  signal: AbortSignal,
): Promise<NormalizedQuoteLine[]> {
  const headers = new Headers({ Accept: "application/x-ndjson" });
  if (!(input instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch("/api/normalize", {
    method: "POST", headers, signal, body: input instanceof FormData ? input : JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Unable to normalize quotes (${response.status})`);
  }
  if (!response.body) throw new Error("The server returned no normalization results.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const records = buffer.split("\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        if (!record.trim()) continue;
        const event: NormalizationEvent = JSON.parse(record);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "done") return event.lines;
        onProgress(event);
      }
      if (done) throw new Error("Normalization ended before the server confirmed the results.");
    }
  } finally {
    reader.releaseLock();
  }
}
