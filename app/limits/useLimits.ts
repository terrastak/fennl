import { addBlockedBy, type AddLimit, type Usage } from "../../shared/limits";
import { useSyncStatus } from "../sync/useSync";

/** The household's usage and limits, as last heard from the server; null until then. */
export function useUsage(): Usage | null {
  return useSyncStatus().usage;
}

/**
 * What stops adding a recipe (or, `restoring`, putting one back from Trash), or null. Unknown
 * usage blocks nothing: the server decides in the end.
 */
export function useAddBlocked(restoring = false): AddLimit | null {
  const usage = useUsage();
  return usage ? addBlockedBy(usage, restoring) : null;
}
