import "server-only";

import Anthropic from "@anthropic-ai/sdk";

export const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export interface CallModelOptions<TInput> {
  input: TInput;
  model?: string;
}

/**
 * Future typed boundary for procurement model calls.
 * Intentionally unimplemented: API routes currently return deterministic mocks.
 */
export async function callModel<TInput, TOutput>(
  options: CallModelOptions<TInput>,
): Promise<TOutput> {
  void options;
  throw new Error("AI model calls are not implemented in this demo.");
}
