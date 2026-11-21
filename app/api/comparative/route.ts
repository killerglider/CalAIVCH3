import { NextResponse } from "next/server";

import { mockComparativeStatement } from "@/lib/mocks";
import type { ComparativeStatement } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<ComparativeStatement>> {
  return NextResponse.json(mockComparativeStatement);
}
