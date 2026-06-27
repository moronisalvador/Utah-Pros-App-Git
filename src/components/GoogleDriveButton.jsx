/**
 * ════════════════════════════════════════════════
 * FILE: src/components/GoogleDriveButton.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A single reusable button that lets a staff member attach files to a job
 *   straight from their own Google Drive. Tapping it opens Google's file picker;
 *   once they choose files, the app copies those files into the job and tells the
 *   page to show them. If the person hasn't linked their Google account yet, it
 *   points them to Settings.
 *
 * WHERE IT LIVES:
 *   Reusable component. v1 is used in the JobPage Files tab; built to drop into
 *   other upload surfaces later (compact variant for the tech mobile app).
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ../lib/realtime.js (getAuthHeader), ../lib/googleDrivePicker.js (openPicker)
 *   Data:      reads  → /api/google-drive-token (mint picker token)
 *              writes → /api/google-drive-import (download from Drive → job-files → job_documents)
 *
 * NOTES / GOTCHAS:
 *   - Worker calls authenticate with getAuthHeader() (Supabase session Bearer),
 *     matching the existing QuickBooks connect button.
 *   - On a 409 from /api/google-drive-token the user hasn't connected — we toast a
 *     prompt to connect in Settings (no alert/confirm, per CLAUDE.md Rule 3).
 *   - onImported receives the array of created job_documents rows so the host can
 *     prepend them to its list.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
import { getAuthHeader } from '../lib/realtime.js';
import { openPicker } from '../lib/googleDrivePicker.js';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));
const okToast  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

function IconDrive(p) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" {...p}>
      <path d="M7.71 3.5 1.15 15l3.43 5.94 6.56-11.37L7.71 3.5zM22.85 15 16.29 3.5H9.43l6.56 11.5h6.86zM4.93 16.06 8.36 22h11.49l-3.43-5.94H4.93z" />
    </svg>
  );
}

// ─── SECTION: Render ──────────────
export default function GoogleDriveButton({ jobId, appointmentId = null, category = 'document', onImported, label = 'Google Drive', compact = false }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || !jobId) return;
    setBusy(true);
    try {
      const auth = await getAuthHeader();

      // 1. Mint a short-lived access token for the Picker.
      const tokRes = await fetch('/api/google-drive-token', { method: 'GET', headers: auth });
      if (tokRes.status === 409 || tokRes.status === 404) {
        errToast('Connect Google Drive in Settings first');
        return;
      }
      const tok = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok || !tok.access_token) throw new Error(tok.error || 'Could not start Google Drive');

      // 2. Let the user pick files.
      const files = await openPicker({ accessToken: tok.access_token, apiKey: import.meta.env.VITE_GOOGLE_API_KEY });
      if (!files.length) return;

      // 3. Import them server-side.
      const impRes = await fetch('/api/google-drive-import', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, appointment_id: appointmentId, category, files }),
      });
      const data = await impRes.json().catch(() => ({}));
      if (!impRes.ok) throw new Error(data.error || 'Import failed');

      const created = data.created || [];
      if (created.length && onImported) onImported(created);

      if (created.length) okToast(`Imported ${created.length} file${created.length === 1 ? '' : 's'} from Google Drive`);
      if (data.errors?.length) errToast(`${data.errors.length} file${data.errors.length === 1 ? '' : 's'} failed to import`);
    } catch (e) {
      errToast('Google Drive: ' + (e.message || 'failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`btn btn-secondary${compact ? '' : ' btn-sm'}`}
      onClick={handleClick}
      disabled={busy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <IconDrive />
      {busy ? 'Opening…' : label}
    </button>
  );
}
