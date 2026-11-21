import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";

const useBearer = process.env.ANTHROPIC_AUTH_SCHEME === "bearer";

/**
 * The SDK appends /v1/messages itself, so a base URL already ending in /v1
 * (common for routers) would become /v1/v1/messages. Accept either form.
 */
const baseURL = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "").replace(/\/v1$/, "") || undefined;

/**
 * Singleton client. The key is validated when a request is made.
 * ANTHROPIC_BASE_URL points it at a router (undefined = SDK default).
 * ANTHROPIC_AUTH_SCHEME=bearer sends the key as `Authorization: Bearer ...`
 * instead of `x-api-key`; apiKey is nulled so only one auth header is sent.
 */
export const anthropic = new Anthropic({
  baseURL,
  ...(useBearer
    ? { apiKey: null, authToken: process.env.ANTHROPIC_API_KEY }
    : { apiKey: process.env.ANTHROPIC_API_KEY }),
});

/** Sonnet-class default; override with ANTHROPIC_MODEL. */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

/** Large quotes (many lines + long spec text) overflow smaller limits. */
const MAX_TOKENS = 8192;

/** Thrown when output hit max_tokens; the tool input would be truncated. */
export class ModelOutputTruncatedError extends Error {
  constructor(toolName: string) {
    super(
      `Model output hit max_tokens (${MAX_TOKENS}) while filling tool "${toolName}"; the result is truncated.`,
    );
    this.name = "ModelOutputTruncatedError";
  }
}

export type ExtractionTool = Pick<Tool, "name" | "description" | "input_schema">;

export interface ExtractJSONParams {
  system: string;
  userText: string;
  /** Optional base64-encoded PDF, sent as a document block before the text. */
  pdfBase64?: string;
  tool: ExtractionTool;
}

/**
 * Forces the model to answer through a single tool and returns that tool's
 * input as T. The input is not runtime-validated against the schema.
 */
export async function extractJSON<T>({
  system,
  userText,
  pdfBase64,
  tool,
}: ExtractJSONParams): Promise<T> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set; cannot call the model.");
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          ...(pdfBase64
            ? [
                {
                  type: "document" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "application/pdf" as const,
                    data: pdfBase64,
                  },
                },
              ]
            : []),
          { type: "text" as const, text: userText },
        ],
      },
    ],
  });

  if (response.stop_reason === "max_tokens") {
    throw new ModelOutputTruncatedError(tool.name);
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === tool.name,
  );

  if (!toolUse) {
    throw new Error(
      `Model returned no tool_use block for "${tool.name}" (stop_reason: ${response.stop_reason}).`,
    );
  }

  return toolUse.input as T;
}

const DATA_DIR = path.resolve(process.cwd(), "data");

/** Reads a file under ./data and returns its contents as base64. */
export async function readSamplePdfBase64(relPath: string): Promise<string> {
  const fullPath = path.resolve(DATA_DIR, relPath);

  if (fullPath !== DATA_DIR && !fullPath.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`Path escapes the data directory: ${relPath}`);
  }

  const buffer = await readFile(fullPath);
  return buffer.toString("base64");
}
