const REQUIREMENT_KEY = "vinayak.activeRequirementId";

export function getActiveRequirementId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(REQUIREMENT_KEY) ?? undefined;
}

export function setActiveRequirementId(id: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(REQUIREMENT_KEY, id);
}
