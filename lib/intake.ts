// Pure helpers for /api/intake: input validation and assembly. No I/O.

import { InputError } from "@/lib/comparative";
import type { ExtractionTool } from "@/lib/llm/anthropic";

/** A line before it has an id. */
export interface DraftLine {
  description: string;
  uom: string;
  qty: number | null;
  wo_code?: string;
}

export const MAX_LINES = 200;
export const MAX_TEXT_CHARS = 20_000;
export const UNSPECIFIED_UOM = "unspecified";
export const UNSPECIFIED_PROJECT = "Unspecified project";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Trimmed non-empty string, or undefined. */
export const cleanString = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/** Finite non-negative number from a number or numeric string; null otherwise. */
export function toQty(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Validates caller-supplied (form) lines strictly: a bad line is a 400, not
 * something to silently repair. qty may be null/absent; a present but invalid
 * qty is rejected. Any supplied `id` is ignored (ids are generated on save).
 */
export function coerceFormLines(input: unknown): DraftLine[] {
  if (!Array.isArray(input)) throw new InputError("`lines` must be an array.");
  if (input.length === 0) throw new InputError("`lines` is empty.");
  if (input.length > MAX_LINES) throw new InputError(`At most ${MAX_LINES} lines per requirement.`);
  return input.map((raw: unknown, i: number): DraftLine => {
    if (!isObj(raw)) throw new InputError(`lines[${i}] must be an object.`);
    const description = cleanString(raw.description);
    if (!description) throw new InputError(`lines[${i}].description must be a non-empty string.`);
    const uom = cleanString(raw.uom);
    if (!uom) throw new InputError(`lines[${i}].uom must be a non-empty string.`);

    let qty: number | null = null;
    if (raw.qty !== undefined && raw.qty !== null) {
      qty = toQty(raw.qty);
      if (qty === null) throw new InputError(`lines[${i}].qty must be a non-negative number or null.`);
    }
    const line: DraftLine = { description, uom, qty };
    const wo = cleanString(raw.wo_code);
    if (wo) line.wo_code = wo;
    return line;
  });
}

/** raw_text for a form submission that did not supply one. */
export function describeLines(lines: DraftLine[]): string {
  return lines
    .map((l) => `${l.description}${l.qty === null ? "" : ` - ${l.qty} ${l.uom}`}${l.wo_code ? ` [${l.wo_code}]` : ""}`)
    .join("\n");
}

export const EXTRACTION_SYSTEM = `You extract a construction/procurement requirement from an informal message (WhatsApp text or a voice transcript, possibly mixing English, Hindi and Marathi).

Rules:
- One entry in "lines" per distinct item or work item requested. Do not merge different items; do not invent items.
- description: the item/work as stated, in clear English. Keep specifications (grade, thickness, brand) that were stated.
- uom: the unit exactly as the speaker gave it (e.g. "sqft", "sqm", "rmt", "nos", "bags", "kg"). If no unit was given, use "".
- qty: the number as a plain number (no commas, no units). If it was not given or is unclear, use null. Never guess a quantity. Convert spoken or written number words ("two hundred") to digits.
- wo_code: ONLY if a work-order / item code (like "WP.01") is explicitly stated for that line; otherwise omit it.
- project: the project or site name if one is mentioned (e.g. "Riverside Phase 2"); otherwise "".
- If the message contains no requirement at all, return an empty "lines" array.
- Always answer by calling record_requirement, never with plain text, even when there is nothing to extract.`;

export const EXTRACTION_TOOL: ExtractionTool = {
  name: "record_requirement",
  description: "Record the project and requirement lines extracted from the message.",
  input_schema: {
    type: "object",
    properties: {
      project: { type: "string", description: 'Project/site name, or "" if not mentioned.' },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            uom: { type: "string", description: 'Unit as stated, or "".' },
            qty: { type: ["number", "null"], description: "Quantity, or null if not stated." },
            wo_code: { type: "string", description: "Only if explicitly stated." },
          },
          required: ["description", "uom", "qty"],
        },
      },
    },
    required: ["project", "lines"],
  },
};

export interface Extraction {
  project: string | undefined;
  lines: DraftLine[];
}

/**
 * Parses the model's tool output. Structure problems throw (surfaced as a 500,
 * the model misbehaved); individual values are cleaned: an unusable qty becomes
 * null and a missing unit becomes "unspecified", never a guess.
 */
export function parseExtraction(raw: unknown): Extraction {
  if (!isObj(raw) || !Array.isArray(raw.lines)) {
    throw new Error("Model output is missing a `lines` array.");
  }
  const lines: DraftLine[] = [];
  raw.lines.forEach((r: unknown, i: number) => {
    if (!isObj(r)) throw new Error(`Model output lines[${i}] is not an object.`);
    const description = cleanString(r.description);
    if (!description) throw new Error(`Model output lines[${i}] has no description.`);
    const line: DraftLine = {
      description,
      uom: cleanString(r.uom) ?? UNSPECIFIED_UOM,
      qty: toQty(r.qty),
    };
    const wo = cleanString(r.wo_code);
    if (wo) line.wo_code = wo;
    lines.push(line);
  });
  return { project: cleanString(raw.project), lines };
}
