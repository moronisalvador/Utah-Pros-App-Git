/**
 * ════════════════════════════════════════════════
 * FILE: useSignedUrls.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a list of stored file paths into web links the signed-in employee's
 *   browser can actually open. The links are made on demand, last a short
 *   while, and are never saved anywhere. Screens that show photos or documents
 *   use this instead of building a permanent public link.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/lib/storageUrl
 *   Data:      reads  → Supabase Storage (sign endpoint) as the current user
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - `paths` is joined into a string key for the effect dependency. Passing a
 *     fresh array literal every render is therefore SAFE — the effect re-runs
 *     only when the actual paths change, not when the array identity does.
 *     Without that, every render would re-sign the whole grid.
 *   - A path that fails to sign is simply absent from the map. Callers render
 *     the same broken-image fallback they already had; one deleted object must
 *     never empty a whole grid.
 *   - Links EXPIRE. A screen left open past the TTL shows broken images until
 *     it re-mounts, so `refreshKey` exists for surfaces that stay open a long
 *     time. Do not "solve" expiry by raising the TTL to a day — the point of a
 *     signed link is that a leaked one stops working.
 *   - Nothing here spinner-gates a refetch: `urls` keeps its previous value
 *     while a new batch is in flight, so a resume never blanks the grid
 *     (page-lifecycle.md).
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { signedDocUrls, LEGACY_JOB_FILES_BUCKET } from '@/lib/storageUrl';

const EMPTY = new Map();

/**
 * @param {Array<string>} paths storage paths, with or without a bucket prefix
 * @param {{ bucket?: string, expiresIn?: number, refreshKey?: any }} opts
 * @returns {{ urls: Map<string,string>, loading: boolean, error: Error|null }}
 */
export function useSignedUrls(
  paths,
  { bucket = LEGACY_JOB_FILES_BUCKET, expiresIn = 1800, refreshKey } = {},
) {
  const { db } = useAuth();
  const list = useMemo(() => (Array.isArray(paths) ? paths.filter(Boolean) : []), [paths]);
  // The dependency is the CONTENT of the list, never its identity.
  const key = list.join(' ');

  const [urls, setUrls] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  useEffect(() => {
    if (!db || list.length === 0) {
      setUrls(EMPTY);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const run = ++latest.current;
    let cancelled = false;
    setLoading(true);
    signedDocUrls(db, list, { bucket, expiresIn })
      .then((map) => {
        // A stale response must never overwrite a newer one — a grid whose
        // filter changes twice quickly would otherwise settle on the first.
        if (cancelled || run !== latest.current) return;
        setUrls(map);
        setError(null);
      })
      .catch((e) => { if (!cancelled && run === latest.current) setError(e); })
      .finally(() => { if (!cancelled && run === latest.current) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key, bucket, expiresIn, refreshKey]);

  return { urls, loading, error };
}

/** Single-path convenience. `url` is null until the link exists. */
export function useSignedUrl(path, opts) {
  const list = useMemo(() => (path ? [path] : []), [path]);
  const { urls, loading, error } = useSignedUrls(list, opts);
  return { url: path ? urls.get(path) || null : null, loading, error };
}
