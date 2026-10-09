import { useEffect, useState } from "react";
import { activeSyncClient } from "../sync/useSync";
import { PhotoCache, photoAccount, photoUrl, type PhotoSize } from "./cache";

/** This account's photos on this device (phase D2), or null before syncing has started. */
export function currentPhotoCache(): PhotoCache | null {
  const client = activeSyncClient();
  return client ? new PhotoCache(photoAccount(client.userId, client.acting)) : null;
}

/**
 * A photo's address for an <img>: from this device when it's kept here, otherwise fetched (and
 * kept). Null while loading; "failed" when it can't be had (offline and not kept, for one).
 */
export function usePhotoUrl(hash: string | null, size: PhotoSize): string | "failed" | null {
  const [state, setState] = useState<{ key: string; url: string } | null>(null);
  const key = `${hash ?? ""}|${size}`;
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const cache = currentPhotoCache();
    const blob = cache
      ? cache.get(hash, size)
      : fetch(photoUrl(hash, size)).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.blob();
        });
    blob
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setState({ key, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: "failed" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hash, size, key]);
  return state?.key === key ? state.url : null;
}
