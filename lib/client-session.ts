const REQUIREMENT_KEY = "vinayak.activeRequirementId";
export const DEMO_REQUIREMENT_ID = "43726557-62f9-4f21-8bbb-70cd12226df8";

export function getActiveRequirementId(): string {
  if (typeof window === "undefined") return DEMO_REQUIREMENT_ID;
  return window.localStorage.getItem(REQUIREMENT_KEY) || DEMO_REQUIREMENT_ID;
}

export function setActiveRequirementId(id: string): void {
  if (typeof window !== "undefined") window.localStorage.setItem(REQUIREMENT_KEY, id);
}
