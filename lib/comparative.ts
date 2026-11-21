import { vendorsNeedingReview } from "@/lib/normalize";
import type { ComparativeStatement, NormalizedQuoteLine, Vendor } from "@/lib/types";

/** Deterministic comparative statement. No LLM and no I/O in this module. */

// ---- Tunable weights ------------------------------------------------------
/** score = RATE_WEIGHT * rate_index + PERFORMANCE_WEIGHT * performance_score */
export const RATE_WEIGHT = 0.7;
export const PERFORMANCE_WEIGHT = 0.3;

/** performance_score = sum of these (each term is 0..100) */
export const PERF_WEIGHT_ON_TIME = 0.4;
export const PERF_WEIGHT_QUALITY = 0.3;
export const PERF_WEIGHT_RATE_VARIANCE = 0.2;
export const PERF_WEIGHT_REWORK = 0.1;

/** Points lost per 1% rate variance / per rework job. */
export const RATE_VARIANCE_PENALTY_PER_PCT = 5;
export const REWORK_PENALTY_PER_JOB = 10;

/** Used when a vendor has no row in vinayak.vendors. */
export const DEFAULT_PERFORMANCE_SCORE = 50;

/**
 * Coverage gate for rate ranking. A vendor gets a real rate_index only if it has
 * usable rates on at least this share of the contested items AND on at least
 * MIN_CONTESTED_ITEMS of them. Below that its rates are too thin to rank on
 * (e.g. a mostly unreadable scan with one fluke rate).
 */
export const MIN_CONTESTED_COVERAGE = 0.5;
export const MIN_CONTESTED_ITEMS = 2;
// ---------------------------------------------------------------------------

/** Does a vendor that priced `priced` of `contested` contested items pass the gate? */
export function meetsCoverage(priced: number, contested: number): boolean {
  return priced >= MIN_CONTESTED_ITEMS && contested > 0 && priced / contested >= MIN_CONTESTED_COVERAGE;
}

type VendorSummary = ComparativeStatement["vendor_summary"][number];
type StatementItem = ComparativeStatement["items"][number];

export class InputError extends Error {}

export function performanceScore(p: Vendor["performance"]): number {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  return clamp(
    PERF_WEIGHT_ON_TIME * clamp(p.on_time_pct) +
      PERF_WEIGHT_QUALITY * clamp((p.quality_1_5 / 5) * 100) +
      PERF_WEIGHT_RATE_VARIANCE * clamp(100 - p.rate_variance_pct * RATE_VARIANCE_PENALTY_PER_PCT) +
      PERF_WEIGHT_REWORK * clamp(100 - p.rework_count * REWORK_PENALTY_PER_JOB),
  );
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Validates inline quotes (demo input) into full NormalizedQuoteLines. */
export function coerceQuotes(input: unknown): NormalizedQuoteLine[] {
  if (!Array.isArray(input)) throw new InputError("`quotes` must be an array.");
  return input.map((raw: unknown, i: number): NormalizedQuoteLine => {
    const q = raw as Record<string, unknown> | null;
    if (!q || typeof q.vendor !== "string" || !q.vendor.trim()) {
      throw new InputError(`quotes[${i}].vendor must be a non-empty string.`);
    }
    const line: NormalizedQuoteLine = {
      vendor: q.vendor.trim(),
      source_file: typeof q.source_file === "string" ? q.source_file : "inline",
      item_label: typeof q.item_label === "string" ? q.item_label : "",
      uom_original: typeof q.uom_original === "string" ? q.uom_original : "SQM",
      qty_original: num(q.qty_original),
      rate_original: num(q.rate_original),
      uom_norm: "SQM",
      qty_norm: num(q.qty_norm),
      unit_rate_norm: num(q.unit_rate_norm),
      gst_pct: num(q.gst_pct),
      freight: num(q.freight),
      payment_terms: typeof q.payment_terms === "string" ? q.payment_terms : null,
      delivery_days: num(q.delivery_days),
      confidence: num(q.confidence) ?? 1,
      flags: Array.isArray(q.flags) ? q.flags.filter((f): f is string => typeof f === "string") : [],
    };
    if (typeof q.matched_item_code === "string" && q.matched_item_code) {
      line.matched_item_code = q.matched_item_code;
    }
    return line;
  });
}

interface VendorStats {
  vendor: string;
  lines: NormalizedQuoteLine[];
  /** Mean of the vendor's per-item indices over CONTESTED items; null when it has none. */
  rateIndex: number | null;
  /** The vendor has a usable rate on at least one coded item (contested or not). */
  hasUsableRate: boolean;
  scopeItems: number;
  needsReview: boolean;
  /** Priced some contested items but failed the coverage gate (see MIN_CONTESTED_COVERAGE). */
  insufficient: boolean;
}

/**
 * A line whose per-SQM rate can be compared: it has a positive unit_rate_norm and
 * was not flagged unreadable or non-area. scope_mismatch lines ARE usable: the
 * rate is per SQM, so a smaller scope does not distort it.
 */
export function isUsableLine(l: NormalizedQuoteLine): boolean {
  return (
    l.unit_rate_norm !== null &&
    l.unit_rate_norm > 0 &&
    !l.flags.includes("needs_manual_review") &&
    !l.flags.includes("uom_unsupported")
  );
}

function vendorNotes(s: VendorStats, record: Vendor | undefined): string {
  if (s.needsReview) return "scanned quote, flagged for manual review, not rate-ranked";
  if (s.insufficient) return "insufficient priced items, flagged for manual review";

  if (s.rateIndex === null && s.hasUsableRate) {
    // Priced something, but nobody else priced it: nothing to compare against.
    const lead = "no overlapping priced items, not rate-ranked";
    return s.scopeItems > 0 ? `${lead}. Scope differs on ${s.scopeItems} item(s).` : lead;
  }

  const parts: string[] = [];
  if (s.rateIndex === null) parts.push("No usable rates; not rate-ranked.");
  if (s.scopeItems > 0) parts.push(`Scope differs on ${s.scopeItems} item(s).`);
  parts.push(
    record
      ? `On-time ${record.performance.on_time_pct}%, quality ${record.performance.quality_1_5}/5.`
      : "No performance record.",
  );
  return parts.join(" ");
}

/**
 * Builds the statement.
 *
 * rate_index is computed per item, then averaged, so item mix cannot distort it.
 * Only CONTESTED items count (usable rate from 2+ vendors): for each such
 * item_code the cheapest usable vendor rate scores 100 and the others
 * round(minRate / theirRate * 100); a vendor's rate_index is the mean of its
 * per-item indices over the contested items it priced usably.
 *
 * Coverage gate: a vendor is rate-ranked only if it priced at least
 * MIN_CONTESTED_ITEMS contested items AND at least MIN_CONTESTED_COVERAGE of them.
 * A vendor that fails is dropped from the benchmark too, so a few fluke rates
 * cannot set the cheapest rate for others.
 *
 * A vendor that is not rate-ranked (an unreadable scan, no overlap with the
 * others, or failing the coverage gate) gets rate_index 0 and
 * score = PERFORMANCE_WEIGHT * performance_score, and is sorted after every
 * rate-ranked vendor. All summary fields stay numbers.
 */
export function buildComparativeStatement(params: {
  requirementId: string;
  quotes: NormalizedQuoteLine[];
  vendors: Vendor[];
  /** item_code -> description from vinayak.item_codes. */
  itemDescriptions: Map<string, string>;
}): ComparativeStatement {
  const { requirementId, quotes, vendors, itemDescriptions } = params;
  const records = new Map(vendors.map((v) => [v.name, v]));
  const reviewVendors = vendorsNeedingReview(quotes);

  // ---- per-item rate index ----
  // code -> vendor -> mean usable rate for that code
  const rateByCode = new Map<string, Map<string, number>>();
  {
    const acc = new Map<string, Map<string, number[]>>();
    for (const q of quotes) {
      if (!q.matched_item_code || !isUsableLine(q)) continue;
      const byV = acc.get(q.matched_item_code) ?? new Map<string, number[]>();
      const list = byV.get(q.vendor) ?? [];
      list.push(q.unit_rate_norm as number);
      byV.set(q.vendor, list);
      acc.set(q.matched_item_code, byV);
    }
    acc.forEach((byV, code) => {
      const rates = new Map<string, number>();
      byV.forEach((list, vendor) => rates.set(vendor, mean(list) as number));
      rateByCode.set(code, rates);
    });
  }

  /**
   * Per-vendor item indices over CONTESTED items, ignoring `excluded` vendors.
   * Only contested items count: a sole quoter has nobody to be cheaper than, so
   * it must not collect a free 100.
   */
  const computeIndices = (excluded: Set<string>) => {
    const indices = new Map<string, number[]>();
    let contested = 0;
    rateByCode.forEach((rates) => {
      const active = Array.from(rates.entries()).filter(([vendor]) => !excluded.has(vendor));
      if (active.length < 2) return;
      contested++;
      const minRate = Math.min(...active.map(([, rate]) => rate));
      for (const [vendor, rate] of active) {
        const list = indices.get(vendor) ?? [];
        list.push(Math.round((minRate / rate) * 100));
        indices.set(vendor, list);
      }
    });
    return { indices, contested };
  };

  // Coverage gate: a vendor is rate-ranked only if it priced enough of the contested
  // items. A failing vendor is also removed from the benchmark (it must not set the
  // cheapest rate on an item through a fluke), which can change what is contested,
  // so repeat until nobody new fails. The excluded set only grows, so this ends.
  const insufficient = new Set<string>();
  let indicesByVendor = new Map<string, number[]>();
  for (;;) {
    const current = computeIndices(insufficient);
    indicesByVendor = current.indices;
    const failing = Array.from(current.indices.entries())
      .filter(([, idx]) => !meetsCoverage(idx.length, current.contested))
      .map(([vendor]) => vendor);
    if (failing.length === 0) break;
    failing.forEach((v) => insufficient.add(v));
  }

  // ---- vendor stats ----
  const byVendor = new Map<string, NormalizedQuoteLine[]>();
  for (const q of quotes) {
    const list = byVendor.get(q.vendor) ?? [];
    list.push(q);
    byVendor.set(q.vendor, list);
  }

  const stats: VendorStats[] = Array.from(byVendor.entries()).map(([vendor, lines]) => {
    const scopeKeys = new Set(
      lines
        .filter((l) => l.flags.includes("scope_mismatch"))
        .map((l) => l.matched_item_code ?? l.item_label),
    );
    const idx = indicesByVendor.get(vendor);
    const idxMean = idx ? mean(idx) : null;
    return {
      vendor,
      lines,
      rateIndex: idxMean === null ? null : Math.round(idxMean),
      hasUsableRate: Array.from(rateByCode.values()).some((rates) => rates.has(vendor)),
      scopeItems: scopeKeys.size,
      needsReview: reviewVendors.has(vendor),
      insufficient: insufficient.has(vendor),
    };
  });

  const scored = stats.map((s) => {
    const record = records.get(s.vendor);
    const perf = Math.round(record ? performanceScore(record.performance) : DEFAULT_PERFORMANCE_SCORE);
    const rateIndex = s.rateIndex ?? 0;
    const score =
      s.rateIndex === null
        ? Math.round(PERFORMANCE_WEIGHT * perf)
        : Math.round(RATE_WEIGHT * rateIndex + PERFORMANCE_WEIGHT * perf);
    return { s, record, perf, rateIndex, score };
  });

  // Rate-ranked vendors first (score desc), then vendors without a usable rate.
  scored.sort((a, b) => {
    const aRanked = a.s.rateIndex !== null;
    const bRanked = b.s.rateIndex !== null;
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return a.s.vendor.localeCompare(b.s.vendor);
  });

  const vendor_summary: VendorSummary[] = scored.map(({ s, record, perf, rateIndex, score }, i) => ({
    vendor: s.vendor,
    score,
    rank: i + 1,
    rate_index: rateIndex,
    performance_score: perf,
    notes: vendorNotes(s, record),
  }));

  const vendorOrder = vendor_summary.map((v) => v.vendor);

  // ---- items ----
  const groups = new Map<string, NormalizedQuoteLine[]>();
  for (const q of quotes) {
    if (!q.matched_item_code) continue;
    const list = groups.get(q.matched_item_code) ?? [];
    list.push(q);
    groups.set(q.matched_item_code, list);
  }

  const items: StatementItem[] = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([code, lines]) => {
      // Reference scope: median across vendors of each vendor's total qty_norm.
      const totals: number[] = [];
      for (const vendor of vendorOrder) {
        const qtys = lines
          .filter((l) => l.vendor === vendor && l.qty_norm !== null)
          .map((l) => l.qty_norm as number);
        if (qtys.length > 0) totals.push(qtys.reduce((a, b) => a + b, 0));
      }
      const qty = median(totals);

      // Every item lists every vendor, in ranking order, so the table columns line up.
      const vendor_rates = vendorOrder.map((vendor) => {
        const vLines = lines.filter((l) => l.vendor === vendor);
        const rate = mean(vLines.filter((l) => l.unit_rate_norm !== null).map((l) => l.unit_rate_norm as number));
        const flags: string[] = [];
        for (const l of vLines) for (const f of l.flags) if (!flags.includes(f)) flags.push(f);
        return { vendor, unit_rate_norm: rate === null ? null : round2(rate), flags };
      });

      return {
        item_code: code,
        description: itemDescriptions.get(code) ?? lines[0].item_label,
        uom: "SQM" as const,
        qty: qty === null ? null : Math.round(qty * 1000) / 1000,
        vendor_rates,
      };
    });

  return { requirement_id: requirementId, items, vendor_summary };
}
