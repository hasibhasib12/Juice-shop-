/**
 * Reject browser mutations initiated by a different origin.
 * SameSite cookies remain an additional layer; this check is not a replacement
 * for authentication, authorization, or input validation.
 */
export function isAllowedMutationOrigin(origin: string | null, requestOrigin: string, fetchSite: string | null): boolean {
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (!origin) return true;
  try {
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}
