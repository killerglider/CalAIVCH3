import { NextResponse } from "next/server";

import { mockItemMatches } from "@/lib/mocks";
import type { ItemMatch } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<ItemMatch[]>> {
  return NextResponse.json(mockItemMatches);
}
