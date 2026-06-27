/**
 * ════════════════════════════════════════════════
 * FILE: src/lib/googleDrivePicker.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens Google's own "pick a file from your Drive" window inside the app and
 *   tells you which files the person chose. It loads Google's picker code the
 *   first time it's needed, then reuses it.
 *
 * WHERE IT LIVES:
 *   Helper module — imported by src/components/GoogleDriveButton.jsx. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none — loads Google's hosted https://apis.google.com/js/api.js
 *   Internal:  none
 *   External:  Google Picker API (needs an access token + a Picker developer key)
 *
 * NOTES / GOTCHAS:
 *   - The access token must come from the server (/api/google-drive-token); the
 *     same token is later used server-side to download the file, so the drive.file
 *     grant lines up (same OAuth client).
 *   - openPicker resolves with [] when the user cancels, or an array of
 *     { id, name, mimeType, sizeBytes } for the files they picked.
 *   - The gapi script is injected once and cached on window.
 * ════════════════════════════════════════════════
 */

const GAPI_SRC = 'https://apis.google.com/js/api.js';

let gapiScriptPromise = null;
let pickerLoadedPromise = null;

// ─── SECTION: Loaders ──────────────
function loadGapiScript() {
  if (gapiScriptPromise) return gapiScriptPromise;
  gapiScriptPromise = new Promise((resolve, reject) => {
    if (window.gapi) { resolve(window.gapi); return; }
    const s = document.createElement('script');
    s.src = GAPI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.gapi);
    s.onerror = () => reject(new Error('Failed to load Google API script'));
    document.body.appendChild(s);
  });
  return gapiScriptPromise;
}

function loadPicker() {
  if (pickerLoadedPromise) return pickerLoadedPromise;
  pickerLoadedPromise = loadGapiScript().then(
    (gapi) => new Promise((resolve) => gapi.load('picker', { callback: resolve })),
  );
  return pickerLoadedPromise;
}

// ─── SECTION: Picker ──────────────
/**
 * Open the Google Picker. Resolves with the selected docs (or [] if cancelled).
 * @param {{ accessToken: string, apiKey: string }} opts
 * @returns {Promise<Array<{id,name,mimeType,sizeBytes}>>}
 */
export async function openPicker({ accessToken, apiKey }) {
  if (!accessToken) throw new Error('Missing Google access token');
  if (!apiKey) throw new Error('Missing Google Picker API key (VITE_GOOGLE_API_KEY)');

  await loadPicker();
  const { google } = window;

  return new Promise((resolve, reject) => {
    try {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .addView(view)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .setCallback((data) => {
          const action = data[google.picker.Response.ACTION];
          if (action === google.picker.Action.PICKED) {
            const docs = (data[google.picker.Response.DOCUMENTS] || []).map((d) => ({
              id:        d[google.picker.Document.ID],
              name:      d[google.picker.Document.NAME],
              mimeType:  d[google.picker.Document.MIME_TYPE],
              sizeBytes: d[google.picker.Document.SIZE_BYTES] || null,
            }));
            resolve(docs);
          } else if (action === google.picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
