import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import { mockRfqDraft } from "@/lib/mocks";
import { buildRfq, categoryForItemCode, DEFAULT_PROJECT, formatQty, parseQty } from "@/lib/rfq";
import { supabaseServer } from "@/lib/supabase/server";
import type { RfqDraft } from "@/lib/types";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedRequest {
  itemCode: string;
  project?: string;
  qty: number | null;
  requirementId?: string;
}

/** Returns null when the request carries no input at all (mock path). */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  const text = await req.text();
  if (!text.trim()) return null;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InputError("Body is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Body must be a JSON object.");
  }
  const o = body as Record<string, unknown>;
  if (Object.keys(o).length === 0) return null;

  if (typeof o.item_code !== "string" || !o.item_code.trim()) {
    throw new InputError("`item_code` is required.");
  }

  let requirementId: string | undefined;
  if (o.requirement_id !== undefined && o.requirement_id !== null && o.requirement_id !== "") {
    if (typeof o.requirement_id !== "string" || !UUID_RE.test(o.requirement_id)) {
      throw new InputError("requirement_id must be a UUID.");
    }
    requirementId = o.requirement_id;
  }

  const project = typeof o.project === "string" && o.project.trim() ? o.project.trim() : undefined;
  return { itemCode: o.item_code.trim(), project, qty: parseQty(o.qty), requirementId };
}

/** ERP description for the code. Codes repeat in the ERP export; the first row wins. */
async function loadDescription(itemCode: string): Promise<string> {
  const { data, error } = await supabaseServer
    .from("item_codes")
    .select("description")
    .eq("item_code", itemCode)
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { description: string } | undefined;
  if (!row) throw new InputError(`Unknown item_code: ${itemCode}`);
  return row.description;
}

async function loadVendorNames(category: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("vendors")
    .select("name")
    .eq("category", category)
    .order("name", { ascending: true });
  if (error) throw error;
  const names = ((data ?? []) as { name: string }[]).map((v) => v.name);
  if (names.length === 0) throw new InputError(`No vendors in category "${category}".`);
  return names;
}

/** Project name plus the quantity (and unit, when unambiguous) the requirement asks for this code. */
async function loadFromRequirement(
  requirementId: string,
  itemCode: string,
): Promise<{ project: string; qty: number | null; uom: string | null }> {
  const req = await supabaseServer.from("requirements").select("project").eq("id", requirementId).limit(1);
  if (req.error) throw req.error;
  const reqRow = (req.data ?? [])[0] as { project: string } | undefined;
  if (!reqRow) throw new InputError("No requirement found for that requirement_id.");

  const lines = await supabaseServer
    .from("requirement_lines")
    .select("qty, uom")
    .eq("requirement_id", requirementId)
    .eq("matched_item_code", itemCode);
  if (lines.error) throw lines.error;

  const rows = (lines.data ?? []) as { qty: number | string | null; uom: string }[];
  const withQty = rows.filter((r) => r.qty !== null);
  if (withQty.length === 0) return { project: reqRow.project, qty: null, uom: null };

  const uoms = new Set(withQty.map((r) => r.uom.trim().toLowerCase()));
  const qty = withQty.reduce((sum, r) => sum + Number(r.qty), 0);
  // Mixed units cannot be added up; fall back to "as per BOQ".
  if (uoms.size > 1) return { project: reqRow.project, qty: null, uom: null };
  return { project: reqRow.project, qty, uom: withQty[0].uom };
}

type RfqResponse = RfqDraft | { error: string; name: string };

/** Draft only. Nothing in this route sends email or contacts a vendor. */
export async function POST(req: Request): Promise<NextResponse<RfqResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so pages that ping this route keep working.
    if (!parsed) return NextResponse.json(mockRfqDraft, { headers: { "X-Mock": "true" } });

    const category = categoryForItemCode(parsed.itemCode);
    if (!category) {
      throw new InputError(`No vendor category is mapped for item_code ${parsed.itemCode}.`);
    }

    const [description, vendorNames, fromReq] = await Promise.all([
      loadDescription(parsed.itemCode),
      loadVendorNames(category),
      parsed.requirementId
        ? loadFromRequirement(parsed.requirementId, parsed.itemCode)
        : Promise.resolve(null),
    ]);

    // Explicit input wins over the requirement's values.
    const project = parsed.project ?? fromReq?.project ?? DEFAULT_PROJECT;
    let qtyText: string | null = null;
    if (parsed.qty !== null) qtyText = formatQty(parsed.qty, fromReq?.uom);
    else if (fromReq?.qty != null) qtyText = formatQty(fromReq.qty, fromReq.uom);

    const draft = buildRfq({ itemCode: parsed.itemCode, description, project, qtyText, vendorNames });
    return NextResponse.json(draft);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof InputError ? 400 : 500;
    if (status === 500) console.error("[rfq]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
