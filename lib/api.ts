export async function postJson<T>(
  endpoint: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string; name?: string };
      if (payload.error) detail = payload.name ? `${payload.name}: ${payload.error}` : payload.error;
    } catch {
      // Keep the HTTP status when an endpoint returns a non-JSON error.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}
