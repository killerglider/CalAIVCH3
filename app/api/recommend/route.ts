import { NextResponse } from "next/server";

import { mockRecommendation } from "@/lib/mocks";
import type { Recommendation } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<Recommendation>> {
  return NextResponse.json(mockRecommendation);
}
