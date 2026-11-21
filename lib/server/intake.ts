import "server-only";

import { InputError } from "@/lib/comparative";
import type { DraftLine } from "@/lib/intake";
import { supabaseServer } from "@/lib/supabase/server";
import type { Requirement, RequirementLine, RequirementSource } from "@/lib/types";

export interface NewRequirement {
  source: RequirementSource;
  project: string;
  raw_text: string;
  lines: DraftLine[];
}

/**
 * Saves the requirement, then its lines. If the lines fail to save the
 * requirement row is removed so no empty requirement is left behind.
 * Line ids are generated here so the response order is exactly the input order.
 */
export async function persistRequirement(r: NewRequirement): Promise<Requirement> {
  const inserted = await supabaseServer
    .from("requirements")
    .insert({ source: r.source, project: r.project, raw_text: r.raw_text })
    .select("id, created_at")
    .single();
  if (inserted.error) throw inserted.error;
  const { id, created_at } = inserted.data as { id: string; created_at: string };

  const lines: RequirementLine[] = r.lines.map((l) => {
    const line: RequirementLine = {
      id: crypto.randomUUID(),
      description: l.description,
      uom: l.uom,
      qty: l.qty,
    };
    if (l.wo_code) line.wo_code = l.wo_code;
    return line;
  });

  const linesResult = await supabaseServer.from("requirement_lines").insert(
    lines.map((l) => ({
      id: l.id,
      requirement_id: id,
      description: l.description,
      uom: l.uom,
      qty: l.qty,
      wo_code: l.wo_code ?? null,
    })),
  );
  if (linesResult.error) {
    const cleanup = await supabaseServer.from("requirements").delete().eq("id", id);
    if (cleanup.error) console.error("[intake] cleanup of orphan requirement failed:", cleanup.error);
    throw linesResult.error;
  }

  return { id, source: r.source, project: r.project, raw_text: r.raw_text, lines, created_at };
}

/** A persisted requirement with its lines (oldest first), as the Requirement type. */
export async function loadRequirement(requirementId: string): Promise<Requirement> {
  const [req, lines] = await Promise.all([
    supabaseServer
      .from("requirements")
      .select("id, source, project, raw_text, created_at")
      .eq("id", requirementId)
      .limit(1),
    supabaseServer
      .from("requirement_lines")
      .select("id, description, uom, qty, wo_code")
      .eq("requirement_id", requirementId)
      .order("created_at", { ascending: true }),
  ]);
  if (req.error) throw req.error;
  if (lines.error) throw lines.error;

  const row = (req.data ?? [])[0] as
    | { id: string; source: RequirementSource; project: string; raw_text: string; created_at: string }
    | undefined;
  if (!row) throw new InputError("No requirement found for that requirement_id.");

  return {
    id: row.id,
    source: row.source,
    project: row.project,
    raw_text: row.raw_text,
    created_at: row.created_at,
    lines: (
      (lines.data ?? []) as {
        id: string;
        description: string;
        uom: string;
        qty: number | string | null;
        wo_code: string | null;
      }[]
    ).map((l) => {
      const line: RequirementLine = {
        id: l.id,
        description: l.description,
        uom: l.uom,
        qty: l.qty === null ? null : Number(l.qty),
      };
      if (l.wo_code) line.wo_code = l.wo_code;
      return line;
    }),
  };
}
