import { NextResponse } from "next/server";

import { mockRequirement } from "@/lib/mocks";
import type { Requirement } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<Requirement>> {
  return NextResponse.json(mockRequirement);
}
