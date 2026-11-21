import "server-only";

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const STT_MODEL = "scribe_v1";
const TIMEOUT_MS = 45_000;

export const hasSttKey = (): boolean => !!process.env.ELEVENLABS_API_KEY;

/** Thrown when the transcription call fails (network, auth, bad audio). */
export class TranscriptionError extends Error {
  /** True when the provider rejected the audio itself (corrupt/unsupported), i.e. the caller's fault. */
  readonly badAudio: boolean;
  constructor(message: string, badAudio = false) {
    super(message);
    this.name = "TranscriptionError";
    this.badAudio = badAudio;
  }
}

/** Transcribes audio with ElevenLabs Scribe. The key never leaves the server. */
export async function transcribeAudio(audio: File): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TranscriptionError("ELEVENLABS_API_KEY is not set.");

  const body = new FormData();
  body.append("model_id", STT_MODEL);
  body.append("file", audio, audio.name || "audio");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": key },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TranscriptionError(`ElevenLabs request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const badAudio = res.status === 400 || res.status === 415 || res.status === 422;
    throw new TranscriptionError(
      `ElevenLabs returned ${res.status}${detail ? `: ${detail}` : ""}`,
      badAudio,
    );
  }
  const json = (await res.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) throw new TranscriptionError("ElevenLabs returned an empty transcript.");
  return text;
}
