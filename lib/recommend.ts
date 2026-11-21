// Pure helpers for /api/recommend. The winner is chosen here, never by the model.

import { InputError } from "@/lib/comparative";
import type { ComparativeStatement, Recommendation } from "@/lib/types";

type Summary = ComparativeStatement["vendor_summary"][number];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validates just enough of a ComparativeStatement for the recommender to be
 * safe: vendor_summary entries with numeric fields, items as an array.
 */
export function coerceStatement(input: unknown): ComparativeStatement {
  if (!isObj(input)) throw new InputError("`statement` must be an object.");
  if (typeof input.requirement_id !== "string" || !input.requirement_id) {
    throw new InputError("statement.requirement_id must be a non-empty string.");
  }
  if (!Array.isArray(input.vendor_summary) || input.vendor_summary.length === 0) {
    throw new InputError("statement.vendor_summary must be a non-empty array.");
  }
  input.vendor_summary.forEach((v: unknown, i: number) => {
    if (
      !isObj(v) ||
      typeof v.vendor !== "string" ||
      !v.vendor ||
      !isNum(v.rank) ||
      !isNum(v.score) ||
      !isNum(v.rate_index) ||
      !isNum(v.performance_score)
    ) {
      throw new InputError(
        `statement.vendor_summary[${i}] needs vendor (string) and numeric rank, score, rate_index, performance_score.`,
      );
    }
  });
  if (!Array.isArray(input.items)) throw new InputError("statement.items must be an array.");
  return input as unknown as ComparativeStatement;
}

/** Highest score first; ties fall back to the lower rank, then input order. */
const byScore = (a: Summary, b: Summary): number => b.score - a.score || a.rank - b.rank;

/** The top vendor by score. No special cases: low scores keep a vendor out naturally. */
export function pickWinner(statement: ComparativeStatement): Summary {
  return [...statement.vendor_summary].sort(byScore)[0];
}

/** Runner-up = the next vendor by score after the winner, if any. */
export function pickRunnerUp(statement: ComparativeStatement, winner: Summary): Summary | null {
  return [...statement.vendor_summary].filter((v) => v !== winner).sort(byScore)[0] ?? null;
}

/** Vendors that have at least one scope_mismatch line in the items table. */
export function scopeMismatchVendors(statement: ComparativeStatement): string[] {
  const out = new Set<string>();
  for (const item of statement.items) {
    for (const r of item.vendor_rates ?? []) {
      if (r.flags?.includes("scope_mismatch")) out.add(r.vendor);
    }
  }
  return Array.from(out);
}

/** Vendors flagged needs_manual_review on any item, or whose notes say so. */
export function manualReviewVendors(statement: ComparativeStatement): string[] {
  const out = new Set<string>();
  for (const item of statement.items) {
    for (const r of item.vendor_rates ?? []) {
      if (r.flags?.includes("needs_manual_review")) out.add(r.vendor);
    }
  }
  for (const v of statement.vendor_summary) {
    if (/manual review/i.test(v.notes ?? "")) out.add(v.vendor);
  }
  return Array.from(out);
}

/**
 * Items where at least one vendor's quote was in a unit that could not be
 * converted to SQM (uom_unsupported), so the rates are not comparable.
 */
export function unitMismatchItems(
  statement: ComparativeStatement,
): { item_code: string; description: string; vendors: string[] }[] {
  const out: { item_code: string; description: string; vendors: string[] }[] = [];
  for (const item of statement.items) {
    const vendors = (item.vendor_rates ?? [])
      .filter((r) => r.flags?.includes("uom_unsupported"))
      .map((r) => r.vendor);
    if (vendors.length > 0) out.push({ item_code: item.item_code, description: item.description, vendors });
  }
  return out;
}

/**
 * Item codes where the given vendor has no rate, or GST is extra. Lines that
 * are unusable because of a unit mismatch or manual review are reported by
 * their own caveats, so they are not repeated here.
 */
export function rateGaps(
  statement: ComparativeStatement,
  vendor: string,
): { missingRate: string[]; gstExtra: string[] } {
  const missingRate: string[] = [];
  const gstExtra: string[] = [];
  for (const item of statement.items) {
    for (const r of item.vendor_rates ?? []) {
      if (r.vendor !== vendor) continue;
      if (r.flags?.includes("uom_unsupported") || r.flags?.includes("needs_manual_review")) continue;
      if (r.unit_rate_norm === null || r.flags?.includes("missing_rate")) missingRate.push(item.item_code);
      if (r.flags?.includes("gst_extra")) gstExtra.push(item.item_code);
    }
  }
  return { missingRate, gstExtra };
}

export interface ModelProse {
  reasoning: string;
  caveats: string[];
}

export function parseProse(raw: unknown): ModelProse {
  if (!isObj(raw)) throw new Error("Model returned no object.");
  const reasoning = typeof raw.reasoning === "string" ? raw.reasoning.trim() : "";
  if (!reasoning) throw new Error("Model returned an empty `reasoning`.");
  if (!Array.isArray(raw.caveats) || raw.caveats.some((c) => typeof c !== "string")) {
    throw new Error("Model returned `caveats` that is not an array of strings.");
  }
  return {
    reasoning,
    caveats: (raw.caveats as string[]).map((c) => c.trim()).filter(Boolean),
  };
}

/** True when some caveat contains `needle` and also matches `topic`. */
const mentions = (caveats: string[], needle: string, topic?: RegExp): boolean => {
  const n = needle.toLowerCase();
  return caveats.some((c) => c.toLowerCase().includes(n) && (!topic || topic.test(c)));
};

const SEEDED_RE = /seeded|demo data/i;

/**
 * Backstops for the caveats the brief requires. The model writes them; if it
 * left one out (or named the vendor/item without the point being made), add a
 * plain deterministic version so it can't be dropped. The seeded-data caveat
 * is always last.
 */
export function ensureRequiredCaveats(
  statement: ComparativeStatement,
  winner: Summary,
  caveats: string[],
): string[] {
  const out = caveats.filter((c) => !SEEDED_RE.test(c));

  for (const v of manualReviewVendors(statement)) {
    if (!mentions(out, v, /manual|scan|not read|unread|exclud/i)) {
      out.push(
        `${v}'s quote is a scanned document whose rates could not be read; it needs manual review and is excluded from rate ranking.`,
      );
    }
  }

  for (const v of scopeMismatchVendors(statement)) {
    if (!mentions(out, v, /scope/i)) {
      out.push(
        `${v}'s quote has a different scope on some items; its lower total reflects a smaller scope, not a better rate.`,
      );
    }
  }

  for (const it of unitMismatchItems(statement)) {
    if (!mentions(out, it.item_code, /unit|uom|rmt|sqm|sqft|compar/i)) {
      out.push(
        `Item ${it.item_code} (${it.description}) was dropped from rate comparison: vendors quoted it in different units (${it.vendors.join(", ")} not in SQM), so the rates are not comparable.`,
      );
    }
  }

  const gaps = rateGaps(statement, winner.vendor);
  const gapCodes = Array.from(new Set([...gaps.missingRate, ...gaps.gstExtra]));
  if (gapCodes.length > 0 && !gapCodes.some((c) => mentions(out, c))) {
    const parts: string[] = [];
    if (gaps.missingRate.length) parts.push(`no usable rate on ${gaps.missingRate.join(", ")}`);
    if (gaps.gstExtra.length) parts.push(`GST quoted as extra on ${gaps.gstExtra.join(", ")}`);
    out.push(`${winner.vendor} has ${parts.join(" and ")}; confirm before ordering.`);
  }

  out.push(
    caveats.find((c) => SEEDED_RE.test(c)) ??
      "Vendor performance scores are seeded demo data, not Vinayak's own records.",
  );
  return out;
}

export function assemble(
  statement: ComparativeStatement,
  winner: Summary,
  prose: ModelProse,
): Recommendation {
  return {
    requirement_id: statement.requirement_id,
    recommended_vendor: winner.vendor,
    reasoning: prose.reasoning,
    caveats: ensureRequiredCaveats(statement, winner, prose.caveats),
  };
}
