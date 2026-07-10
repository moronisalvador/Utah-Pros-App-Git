/**
 * ════════════════════════════════════════════════
 * FILE: useTemplates.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads the saved canned-reply templates the office writes ("On my way", "Running
 *   late", etc.) so a tech can tap one to drop it into the reply box instead of typing.
 *   It fetches them once (lazily, the first time the tech opens the template list),
 *   keeps only the active ones, and groups them by category for the picker.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/pages/tech/v2/messages/Composer.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db)
 *   Data:      reads → message_templates (is_active=true)
 *
 * NOTES / GOTCHAS:
 *   - Fetch is lazy + once — `load()` no-ops after the first successful load, so opening
 *     the picker repeatedly never re-hits the DB.
 * ════════════════════════════════════════════════
 */
import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { groupTemplates } from './msgsSelectors';

export function useTemplates() {
  const { db } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedRef.current || !db) return;
    setLoading(true);
    setError(false);
    try {
      const rows = await db.select('message_templates', 'is_active=eq.true&select=id,title,body,category&order=category.asc,title.asc');
      setTemplates(rows || []);
      loadedRef.current = true;
    } catch (err) {
      console.error('Load templates error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [db]);

  return { templates, groups: groupTemplates(templates), loading, error, load };
}

export default useTemplates;
