import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import {
  cleanString,
  coerceFormLines,
  describeLines,
  EXTRACTION_SYSTEM,
  EXTRACTION_TOOL,
  MAX_TEXT_CHARS,
  parseExtraction,
  UNSPECIFIED_PROJECT,
  type DraftLine,
} from "@/lib/intake";
import { extractJSON } from "@/lib/llm/anthropic";
import { mockRequirement } from "@/lib/mocks";
import { hasSttKey, transcribeAudio, TranscriptionError } from "@/lib/stt";
import { persistRequirement, type NewRequirement } from "@/lib/server/intake";
import type { Requirement } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** What the caller sent, after parsing either JSON or multipart. */
interface RawInput {
  source?: unknown;
  project?: unknown;
  raw_text?: unknown;
  lines?: unknown;
  transcript?: unknown;
  audio?: File;
}

/** Returns null when the request carries no input at all (mock path). */
async function readInput(req: Request): Promise<RawInput | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new InputError("Body is not valid multipart form data.");
    }
    if (Array.from(form.keys()).length === 0) return null;

    const input: RawInput = {
      source: form.get("source") ?? undefined,
      project: form.get("project") ?? undefined,
      transcript: form.get("transcript") ?? undefined,
    };
    const file = form.get("audio") ?? form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_AUDIO_BYTES) throw new InputError("Audio file is larger than 25 MB.");
      input.audio = file;
    }
    return input;
  }

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
  // A bare {} is treated like an empty ping.
  if (Object.keys(o).length === 0) return null;
  return o as RawInput;
}

interface Resolved extends NewRequirement {
  /** Set for voice, for debugging which path produced the transcript. */
  transcriptSource?: "elevenlabs" | "supplied";
}

function boundedText(v: unknown, what: string): string {
  const text = cleanString(v);
  if (!text) throw new InputError(`${what} must be a non-empty string.`);
  if (text.length > MAX_TEXT_CHARS) throw new InputError(`${what} is longer than ${MAX_TEXT_CHARS} characters.`);
  return text;
}

/** One LLM call (temperature 0 inside extractJSON) that turns free text into lines. */
async function extractFromText(
  text: string,
  suppliedProject: string | undefined,
): Promise<{ project: string; lines: DraftLine[] }> {
  const raw = await extractJSON<unknown>({
    system: EXTRACTION_SYSTEM,
    userText: text,
    tool: EXTRACTION_TOOL,
  });
  const extraction = parseExtraction(raw);
  if (extraction.lines.length === 0) {
    throw new InputError("No requirement lines could be found in that message.");
  }
  return {
    project: suppliedProject ?? extraction.project ?? UNSPECIFIED_PROJECT,
    lines: extraction.lines,
  };
}

/** Audio goes through ElevenLabs; without a key or audio, a `transcript` string still works. */
async function resolveTranscript(input: RawInput): Promise<{ text: string; via: "elevenlabs" | "supplied" }> {
  const supplied = cleanString(input.transcript);

  if (input.audio && hasSttKey()) {
    try {
      return { text: await transcribeAudio(input.audio), via: "elevenlabs" };
    } catch (err) {
      if (!supplied) throw err; // nothing to fall back on
      console.error("[intake] transcription failed, using supplied transcript:", err);
    }
  }
  if (supplied) return { text: boundedText(supplied, "`transcript`"), via: "supplied" };

  throw new InputError(
    input.audio
      ? "ELEVENLABS_API_KEY is not set, so the audio cannot be transcribed. Send a `transcript` string instead."
      : "Voice intake needs an audio file (field `audio`) or a `transcript` string.",
  );
}

async function resolve(input: RawInput): Promise<Resolved> {
  // Multipart with audio and no explicit source is a voice submission.
  const source: unknown = input.source ?? (input.audio ? "voice" : undefined);
  const suppliedProject = cleanString(input.project);

  switch (source) {
    case "form": {
      if (!suppliedProject) throw new InputError("`project` is required for source \"form\".");
      const lines = coerceFormLines(input.lines);
      const raw_text = cleanString(input.raw_text) ?? describeLines(lines);
      return { source: "form", project: suppliedProject, raw_text, lines };
    }
    case "whatsapp": {
      const raw_text = boundedText(input.raw_text, "`raw_text`");
      const { project, lines } = await extractFromText(raw_text, suppliedProject);
      return { source: "whatsapp", project, raw_text, lines };
    }
    case "voice": {
      const { text, via } = await resolveTranscript(input);
      const { project, lines } = await extractFromText(text, suppliedProject);
      return { source: "voice", project, raw_text: text, lines, transcriptSource: via };
    }
    default:
      throw new InputError('`source` must be "form", "whatsapp" or "voice".');
  }
}

type IntakeResponse = Requirement | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<IntakeResponse>> {
  try {
    const input = await readInput(req);

    // No input: serve the mock so pages that ping this route keep working with no body and no keys.
    if (!input) return NextResponse.json(mockRequirement, { headers: { "X-Mock": "true" } });

    const resolved = await resolve(input);
    const requirement = await persistRequirement(resolved);

    const headers: Record<string, string> = {};
    if (resolved.transcriptSource) headers["X-Transcript-Source"] = resolved.transcriptSource;
    return NextResponse.json(requirement, { headers });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const clientFault =
      error instanceof InputError || (error instanceof TranscriptionError && error.badAudio);
    const status = clientFault ? 400 : 500;
    if (status === 500) console.error("[intake]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
