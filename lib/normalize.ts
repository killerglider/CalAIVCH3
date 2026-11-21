import type { NormalizedQuoteLine } from "@/lib/types";

/** Deterministic quote normalisation. No LLM and no I/O in this module. */

export const SQFT_TO_SQM = 0.092903;
export const SQFT_RATE_TO_SQM_RATE = 10.76391;
export const SCOPE_TOLERANCE = 0.15;
export const LOW_CONFIDENCE = 0.7;
export const MIN_MATCH_SCORE = 0.3;
export const MIN_RATE_COVERAGE = 0.4;
/** Share of a vendor's lines that must be ocr_low_confidence for the quote to count as such. */
export const OCR_QUOTE_SHARE = 0.5;
export const UNKNOWN_VENDOR = "Unknown vendor";

/** Flag vocabulary. "uom_unsupported" is an addition for non-area units. */
export type QuoteFlag =
  | "unit_converted"
  | "scope_mismatch"
  | "ocr_low_confidence"
  | "missing_rate"
  | "gst_extra"
  | "uom_unsupported"
  | "needs_manual_review";

/** One line exactly as printed on the quotation (model output, unconverted). */
export interface RawQuoteLine {
  vendor: string | null;
  item_label: string;
  /** Short printed heading without the spec paragraph; used only for matching. */
  item_heading: string | null;
  uom_original: string;
  qty_original: number | null;
  rate_original: number | null;
  gst_pct: number | null;
  freight: number | null;
  payment_terms: string | null;
  delivery_days: number | null;
  confidence: number;
}

export interface RawExtraction {
  source_looks_scanned: boolean;
  lines: RawQuoteLine[];
}

function toNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[,\s₹]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function clamp01(n: number | null): number {
  return n === null ? 0 : Math.min(1, Math.max(0, n));
}

/** Guards and coerces the tool output. Throws on a malformed return. */
export function parseRawExtraction(input: unknown): RawExtraction {
  const obj = input as { lines?: unknown; source_looks_scanned?: unknown } | null;

  if (!obj || !Array.isArray(obj.lines)) {
    throw new Error("normalize: model returned malformed output (no `lines` array).");
  }
  if (obj.lines.length === 0) {
    throw new Error("normalize: model extracted no line items from the PDF.");
  }

  const lines = obj.lines.map((item: unknown, i: number): RawQuoteLine => {
    const l = item as Record<string, unknown> | null;
    const label = toStr(l?.item_label);
    if (!l || !label) {
      throw new Error(`normalize: line ${i} has no item_label.`);
    }
    const days = toNum(l.delivery_days);
    return {
      vendor: toStr(l.vendor),
      item_label: label,
      item_heading: toStr(l.item_heading),
      uom_original: toStr(l.uom_original) ?? "",
      qty_original: toNum(l.qty_original),
      rate_original: toNum(l.rate_original),
      gst_pct: toNum(l.gst_pct),
      freight: toNum(l.freight),
      payment_terms: toStr(l.payment_terms),
      delivery_days: days === null ? null : Math.round(days),
      confidence: clamp01(toNum(l.confidence)),
    };
  });

  return { source_looks_scanned: obj.source_looks_scanned === true, lines };
}

type UomKind = "SQFT" | "SQM" | "OTHER";

function classifyUom(uom: string): UomKind {
  const u = uom.trim().toLowerCase().replace(/[\s.]/g, "");
  // "soft" is a common OCR misread of "sqft" on scans.
  if (["sqft", "sft", "soft", "sqfeet", "sqfoot"].includes(u)) return "SQFT";
  if (["sqm", "sqmt", "sqmtr", "sqmtrs", "sqmeter", "sqmetre", "m2", "m²"].includes(u)) {
    return "SQM";
  }
  return "OTHER";
}

/** "Quotation_Shyama.pdf" -> "Shyama". Last-resort hint when no letterhead is printed. */
export function vendorHintFromFile(sourceFile: string): string | null {
  // Separators first: "_" is a word character and would hide the \b below.
  const stem = sourceFile
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\b(quotation|quote|quotations|rfq|offer)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem || null;
}

const vendorKey = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Maps an inferred vendor name onto an existing vendor so quotes join to the
 * seeded performance data ("Purvyakruti Sales & Services Pvt. Ltd." ->
 * "Purvyakruti"). Exact match on letters/digits, else a single unambiguous
 * containment match of at least 5 characters; otherwise the name is kept.
 */
export function canonicalVendor(name: string, known: string[]): string {
  const key = vendorKey(name);
  if (!key || name === UNKNOWN_VENDOR) return name;

  const exact = known.find((k) => vendorKey(k) === key);
  if (exact) return exact;

  const partial = known.filter((k) => {
    const kk = vendorKey(k);
    return Math.min(kk.length, key.length) >= 5 && (kk.includes(key) || key.includes(kk));
  });
  return partial.length === 1 ? partial[0] : name;
}

/** The text to match against the ERP list: the short heading, else a clipped label. */
export function matchQueryFor(raw: RawQuoteLine): string {
  return raw.item_heading ?? raw.item_label.slice(0, 160);
}

/**
 * Picks one vendor name per file: supplied, else the most common printed one,
 * else a hint taken from the file name.
 */
export function resolveVendor(
  lines: RawQuoteLine[],
  supplied?: string,
  fileHint?: string | null,
): string {
  if (supplied?.trim()) return supplied.trim();
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.vendor) counts.set(l.vendor, (counts.get(l.vendor) ?? 0) + 1);
  }
  let best = fileHint?.trim() || UNKNOWN_VENDOR;
  let bestCount = 0;
  counts.forEach((count, name) => {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  });
  return best;
}

export function normalizeLine(
  raw: RawQuoteLine,
  ctx: { vendor: string; sourceFile: string; scanned: boolean },
): NormalizedQuoteLine {
  const flags: QuoteFlag[] = [];
  const kind = classifyUom(raw.uom_original);

  let qty_norm: number | null = null;
  let unit_rate_norm: number | null = null;

  if (kind === "SQFT") {
    qty_norm =
      raw.qty_original === null ? null : round(raw.qty_original * SQFT_TO_SQM, 3);
    unit_rate_norm =
      raw.rate_original === null
        ? null
        : round(raw.rate_original * SQFT_RATE_TO_SQM_RATE, 2);
    flags.push("unit_converted");
  } else if (kind === "SQM") {
    qty_norm = raw.qty_original;
    unit_rate_norm = raw.rate_original;
  } else {
    // Cannot be expressed per SQM; never pass a non-area rate off as one.
    flags.push("uom_unsupported");
  }

  if (ctx.scanned || raw.confidence < LOW_CONFIDENCE) flags.push("ocr_low_confidence");
  if (raw.rate_original === null) flags.push("missing_rate");

  return {
    vendor: ctx.vendor,
    source_file: ctx.sourceFile,
    item_label: raw.item_label,
    uom_original: raw.uom_original,
    qty_original: raw.qty_original,
    rate_original: raw.rate_original,
    uom_norm: "SQM",
    qty_norm,
    unit_rate_norm,
    gst_pct: raw.gst_pct,
    freight: raw.freight,
    payment_terms: raw.payment_terms,
    delivery_days: raw.delivery_days,
    confidence: raw.confidence,
    flags,
  };
}

/**
 * Accepts the top match_item_code result only if it scores at least
 * MIN_MATCH_SCORE. A rejected line has no matched_item_code, so
 * flagScopeMismatch leaves it out of the median groups.
 */
export function acceptMatch(
  top: { item_code?: unknown; score?: unknown } | undefined | null,
): string | undefined {
  if (!top || typeof top.item_code !== "string") return undefined;
  const score = typeof top.score === "number" ? top.score : Number(top.score);
  return Number.isFinite(score) && score >= MIN_MATCH_SCORE ? top.item_code : undefined;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Flags "scope_mismatch" on every line of a vendor whose TOTAL qty_norm for a
 * matched_item_code deviates more than 15% from the median vendor total for
 * that code. Totals (not single lines) are compared because several distinct
 * quote lines can map to one ERP code (e.g. balcony floor and wall); a per-line
 * median would then compare unlike items. A code needs at least two vendors,
 * otherwise there is nothing to compare against.
 */
export function flagScopeMismatch(lines: NormalizedQuoteLine[]): NormalizedQuoteLine[] {
  // code -> vendor -> total qty_norm
  const totals = new Map<string, Map<string, number>>();

  for (const l of lines) {
    if (!l.matched_item_code || l.qty_norm === null || l.qty_norm <= 0) continue;
    const byVendor = totals.get(l.matched_item_code) ?? new Map<string, number>();
    byVendor.set(l.vendor, (byVendor.get(l.vendor) ?? 0) + l.qty_norm);
    totals.set(l.matched_item_code, byVendor);
  }

  const outliers = new Set<string>(); // `${code}\u0000${vendor}`
  totals.forEach((byVendor, code) => {
    if (byVendor.size < 2) return;
    const med = median(Array.from(byVendor.values()));
    if (med <= 0) return;
    byVendor.forEach((total, vendor) => {
      if (Math.abs(total - med) / med > SCOPE_TOLERANCE) outliers.add(`${code}\u0000${vendor}`);
    });
  });

  return lines.map((l) =>
    l.matched_item_code && outliers.has(`${l.matched_item_code}\u0000${l.vendor}`)
      ? { ...l, flags: [...l.flags, "scope_mismatch"] }
      : l,
  );
}

/**
 * Rate-reliability guard. Per vendor: rateCoverage = lines with a printed
 * rate / total lines. If the quote is ocr_low_confidence (at least half of the
 * vendor's lines carry that flag) AND rateCoverage < 0.4, its rates are treated
 * as unreadable: every rate_original and unit_rate_norm is nulled and each line
 * gets "needs_manual_review" (plus "missing_rate", since the rate is now null).
 * Quantities are untouched. Use vendorsNeedingReview() to keep such vendors out
 * of any ranking.
 */
export function applyRateReliabilityGuard(lines: NormalizedQuoteLine[]): NormalizedQuoteLine[] {
  const byVendor = new Map<string, { total: number; withRate: number; lowOcr: number }>();
  for (const l of lines) {
    const s = byVendor.get(l.vendor) ?? { total: 0, withRate: 0, lowOcr: 0 };
    s.total += 1;
    if (l.rate_original !== null) s.withRate += 1;
    if (l.flags.includes("ocr_low_confidence")) s.lowOcr += 1;
    byVendor.set(l.vendor, s);
  }

  const unreadable = new Set<string>();
  byVendor.forEach((s, vendor) => {
    const rateCoverage = s.withRate / s.total;
    const lowOcrQuote = s.lowOcr / s.total >= OCR_QUOTE_SHARE;
    if (lowOcrQuote && rateCoverage < MIN_RATE_COVERAGE) unreadable.add(vendor);
  });

  return lines.map((l) => {
    if (!unreadable.has(l.vendor)) return l;
    const flags = [...l.flags];
    if (!flags.includes("missing_rate")) flags.push("missing_rate");
    if (!flags.includes("needs_manual_review")) flags.push("needs_manual_review");
    return { ...l, rate_original: null, unit_rate_norm: null, flags };
  });
}

/** Vendors with any needs_manual_review line: show them, but do not rank them. */
export function vendorsNeedingReview(lines: NormalizedQuoteLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (l.flags.includes("needs_manual_review")) out.add(l.vendor);
  }
  return out;
}