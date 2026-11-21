// Pure helpers for /api/rfq. Drafting only: nothing here (or in the route) sends anything.

import { InputError } from "@/lib/comparative";
import type { RfqDraft } from "@/lib/types";

export const DEFAULT_PROJECT = "Amara Tower-2";

/** Vinayak's standard terms. Verbatim; do not reword. */
export const STANDARD_TERMS: readonly string[] = [
  "PF & ESI registration required.",
  "TDS will be deducted as per Govt. norms.",
  "5% Security deposit will be released after 12 months of total completion of work.",
  "GST will be paid extra.",
  "Water & Electricity at a point and Labour hutment will be provided.",
  "Safety PPE cost will be under Contractor's scope.",
];

/**
 * item_code prefix -> vendors.category. First match wins; add new prefixes here.
 * WP.* and W.P* (ERP codes use both spellings) are waterproofing.
 */
const CATEGORY_BY_CODE: readonly { pattern: RegExp; category: string }[] = [
  { pattern: /^(WP|W\.P)/i, category: "waterproofing" },
];

export function categoryForItemCode(itemCode: string): string | null {
  return CATEGORY_BY_CODE.find((m) => m.pattern.test(itemCode.trim()))?.category ?? null;
}

const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "or", "the", "to", "with", "upto"]);
const MAX_SHORT = 60;

/**
 * A readable one-line version of an ERP description: whitespace collapsed,
 * ALL-CAPS text title-cased (short words like UGR/STP/MM stay upper), and cut
 * at a word boundary with "..." past 60 chars.
 */
export function shortDescription(description: string): string {
  let text = description.replace(/\s+/g, " ").trim();
  let truncated = false;
  if (text.length > MAX_SHORT) {
    const cut = text.slice(0, MAX_SHORT - 3);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd();
    truncated = true;
  }
  // Decide on casing from the part we keep, not the whole ERP text.
  if (!/[a-z]/.test(text)) {
    text = text.replace(/[A-Za-z]+/g, (w) => {
      const lower = w.toLowerCase();
      if (SMALL_WORDS.has(lower)) return lower;
      if (w.length <= 3) return w;
      return lower[0].toUpperCase() + lower.slice(1);
    });
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return truncated ? `${text}...` : text;
}

/** Accepts a non-negative finite number or numeric string; anything else is a 400. */
export function parseQty(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new InputError("`qty` must be a non-negative number.");
  return n;
}

export interface RfqInputs {
  itemCode: string;
  description: string;
  project: string;
  /** Quantity text, e.g. "1500 SQM" or "1500"; null means "as per BOQ". */
  qtyText: string | null;
  vendorNames: string[];
}

export const formatQty = (qty: number, uom?: string | null): string => {
  const n = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 1000) / 1000);
  return uom ? `${n} ${uom}` : n;
};

export function buildRfq(i: RfqInputs): RfqDraft {
  if (i.vendorNames.length === 0) throw new InputError("No vendors to address the RFQ to.");

  const description = i.description.replace(/\s+/g, " ").trim();
  const qtyPhrase = i.qtyText ?? "As per BOQ";

  const body = [
    "Dear Sir/Madam,",
    "",
    `Vinayak requests your best quotation for the following item for the project ${i.project}:`,
    "",
    `Item: ${description} (item code ${i.itemCode})`,
    `Quantity: ${qtyPhrase}`,
    "",
    "This request is addressed to:",
    ...i.vendorNames.map((n) => `- ${n}`),
    "",
    "Please quote your rate per unit of measurement, inclusive of all items of work described, and state your payment terms and the time you need to complete the work. The standard terms below apply to all quotations.",
    "",
    "Regards,",
    "Vinayak Procurement",
  ].join("\n");

  return {
    item_code: i.itemCode,
    subject: `RFQ: ${shortDescription(description)} - Vinayak ${i.project}`,
    body,
    standard_terms: [...STANDARD_TERMS],
  };
}
