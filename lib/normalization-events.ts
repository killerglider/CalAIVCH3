import type { NormalizedQuoteLine } from "./types";

export type NormalizationEvent =
  | { type: "progress"; completed: number; total: number; label: string }
  | { type: "done"; lines: NormalizedQuoteLine[] }
  | { type: "error"; error: string };
