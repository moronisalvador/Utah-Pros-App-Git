/**
 * ════════════════════════════════════════════════
 * FILE: [public_id].js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Serves the actual lead-capture form as its own little web page (not part of
 *   the main app). When someone embeds a form on their website, the embed
 *   snippet drops an <iframe> that points here. This page reads the form's
 *   published design from the database and draws the fields, then — when the
 *   visitor submits — sends the answers to /api/form-submit. It also copies the
 *   ad-tracking tags (utm_source, gclid, …) that the embed snippet forwarded
 *   from the host page so the lead keeps its attribution.
 *
 * WHERE IT LIVES:
 *   Route:        GET /f/:public_id  (Cloudflare Pages Function)
 *   Rendered by:  embedded via public/embed.js as an <iframe>, or opened直接.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/supabase.js (service-role client),
 *              functions/lib/forms.js (escapeHtml, sanitizeLinkMarkup)
 *   Data:      reads  → form_definitions, form_definition_versions
 *              writes → none (the POST to /api/form-submit does the writing)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md).
 *   - EVERY piece of schema/visitor text is escaped; labels/descriptions/the
 *     thank-you note additionally run through sanitizeLinkMarkup, which only
 *     ever emits an <a> for an http(s)/mailto url — never a script. This is a
 *     public page, so that is the whole XSS story.
 *   - Sets `Content-Security-Policy: frame-ancestors *` and never sets
 *     X-Frame-Options, so the form can be iframed on any customer site.
 *   - Turnstile widget renders only when the form has it enabled AND a
 *     TURNSTILE_SITE_KEY is configured — forms work before the key exists.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import { escapeHtml, sanitizeLinkMarkup } from '../lib/forms.js';

function page(bodyHtml, status = 200) {
  return new Response(`<!doctype html>${bodyHtml}`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': 'frame-ancestors *',
      'Cache-Control': 'no-store',
    },
  });
}

function notFound() {
  return page(
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Form unavailable</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:60px auto;text-align:center;color:#444;padding:0 16px;">
<p>This form isn't available right now.</p></body></html>`,
    404,
  );
}

// ─── SECTION: Field rendering (server-side, everything escaped) ───
function renderField(field) {
  const key = escapeHtml(field.key);
  const id = `f_${key}`;
  const req = field.required ? 'required' : '';
  const reqMark = field.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const label = sanitizeLinkMarkup(field.label || field.key);
  const ph = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
  const options = Array.isArray(field.options) ? field.options : [];

  const labelHtml = (forId) => `<label class="upr-label" for="${forId}">${label}${reqMark}</label>`;

  switch (field.type) {
    case 'textarea':
      return `<div class="upr-row">${labelHtml(id)}<textarea id="${id}" name="${key}" ${ph} ${req} rows="4"></textarea></div>`;
    case 'select':
      return `<div class="upr-row">${labelHtml(id)}<select id="${id}" name="${key}" ${req}>
        <option value="">Choose…</option>
        ${options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
      </select></div>`;
    case 'radio':
      return `<fieldset class="upr-row upr-fieldset"><legend class="upr-label">${label}${reqMark}</legend>
        ${options
          .map(
            (o, i) =>
              `<label class="upr-choice"><input type="radio" name="${key}" value="${escapeHtml(o)}" ${i === 0 && field.required ? req : ''}> <span>${escapeHtml(o)}</span></label>`,
          )
          .join('')}
      </fieldset>`;
    case 'checkbox':
      return `<div class="upr-row upr-check"><label class="upr-choice"><input type="checkbox" id="${id}" name="${key}" value="true" ${req}> <span>${label}${reqMark}</span></label></div>`;
    case 'consent':
      return `<div class="upr-row upr-consent"><label class="upr-choice"><input type="checkbox" id="${id}" name="${key}" value="true" ${req}> <span>${label}${reqMark}</span></label></div>`;
    case 'date':
      return `<div class="upr-row">${labelHtml(id)}<input type="date" id="${id}" name="${key}" ${req}></div>`;
    case 'email':
      return `<div class="upr-row">${labelHtml(id)}<input type="email" id="${id}" name="${key}" ${ph} ${req}></div>`;
    case 'phone':
      return `<div class="upr-row">${labelHtml(id)}<input type="tel" id="${id}" name="${key}" ${ph} ${req}></div>`;
    default:
      return `<div class="upr-row">${labelHtml(id)}<input type="text" id="${id}" name="${key}" ${ph} ${req}></div>`;
  }
}

function renderForm(form, schema, env) {
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const theme = form.theme || {};
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(theme.primary || '') ? theme.primary : '#6366f1';
  const bg = /^#[0-9a-fA-F]{3,8}$/.test(theme.background || '') ? theme.background : '#ffffff';
  const text = /^#[0-9a-fA-F]{3,8}$/.test(theme.text || '') ? theme.text : '#111827';

  const title = escapeHtml(form.name || 'Contact us');
  const description = schema.description ? `<p class="upr-desc">${sanitizeLinkMarkup(schema.description)}</p>` : '';
  const submitText = escapeHtml(schema.submitText || 'Submit');
  const thankYou = sanitizeLinkMarkup(schema.thankYou || 'Thank you — we\'ll be in touch shortly.');

  const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '';
  const useTurnstile = !!form.turnstile_enabled && !!turnstileSiteKey;
  const turnstileScript = useTurnstile
    ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
    : '';
  const turnstileWidget = useTurnstile
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(turnstileSiteKey)}"></div>`
    : '';

  // Field metadata for the client submit handler (types drive how values are read).
  const fieldMeta = JSON.stringify(
    fields.map((f) => ({ key: f.key, type: f.type })),
  ).replace(/</g, '\\u003c');

  const fieldsHtml = fields.map(renderField).join('\n');

  return `<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
${turnstileScript}
<style>
  :root { --upr-primary:${primary}; --upr-bg:${bg}; --upr-text:${text}; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:transparent; color:var(--upr-text); }
  .upr-card { background:var(--upr-bg); max-width:520px; margin:0 auto; padding:20px; border-radius:12px; }
  .upr-title { font-size:20px; font-weight:700; margin:0 0 6px; }
  .upr-desc { font-size:14px; color:#4b5563; margin:0 0 16px; }
  .upr-row { margin-bottom:14px; display:flex; flex-direction:column; gap:6px; }
  .upr-label { font-size:13px; font-weight:600; }
  .req { color:#dc2626; }
  input, select, textarea { font:inherit; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; width:100%; background:#fff; color:#111827; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--upr-primary); outline-offset:0; border-color:var(--upr-primary); }
  .upr-fieldset { border:0; padding:0; margin:0 0 14px; }
  .upr-choice { display:flex; align-items:flex-start; gap:8px; font-size:14px; font-weight:400; cursor:pointer; }
  .upr-choice input { width:auto; margin-top:2px; }
  .upr-consent { background:#f9fafb; border:1px solid #eef0f3; border-radius:8px; padding:12px; }
  .upr-consent .upr-choice span { font-size:12px; color:#4b5563; line-height:1.4; }
  a { color:var(--upr-primary); }
  button { font:inherit; font-weight:700; color:#fff; background:var(--upr-primary); border:0; border-radius:8px; padding:12px 16px; width:100%; cursor:pointer; margin-top:4px; }
  button:disabled { opacity:.6; cursor:default; }
  .upr-error { color:#dc2626; font-size:12px; margin-top:4px; }
  .upr-form-error { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:10px 12px; border-radius:8px; font-size:13px; margin-bottom:12px; display:none; }
  .upr-thanks { text-align:center; padding:24px 12px; font-size:15px; }
  .upr-hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
</style>
</head>
<body>
  <div class="upr-card">
    <div id="upr-thanks" class="upr-thanks" style="display:none;"></div>
    <form id="upr-form" novalidate>
      <div class="upr-title">${title}</div>
      ${description}
      <div id="upr-form-error" class="upr-form-error"></div>
      ${fieldsHtml}
      <!-- honeypot: real users never fill this -->
      <div class="upr-hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></div>
      ${turnstileWidget}
      <button type="submit">${submitText}</button>
    </form>
  </div>
<script>
(function(){
  var PUBLIC_ID = ${JSON.stringify(form.public_id)};
  var FIELDS = ${fieldMeta};
  var THANKS = ${JSON.stringify(thankYou)};
  var form = document.getElementById('upr-form');
  var thanksEl = document.getElementById('upr-thanks');
  var errEl = document.getElementById('upr-form-error');
  var t0 = Date.now();
  var token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(16).slice(2));

  // Forward the ad-tracking tags the embed snippet put on our URL.
  var qs = new URLSearchParams(location.search);
  var UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','referrer','landing'];
  var utm = {};
  UTM_KEYS.forEach(function(k){ var v = qs.get(k); if (v) utm[k] = v; });

  function resize(){
    try { parent.postMessage({ type:'upr-form-height', publicId: PUBLIC_ID, height: document.documentElement.scrollHeight }, '*'); } catch(e){}
  }
  window.addEventListener('load', resize);
  if (window.ResizeObserver) { new ResizeObserver(resize).observe(document.body); }

  function readValue(f){
    if (f.type === 'consent' || f.type === 'checkbox') {
      var box = form.querySelector('[name="'+f.key+'"]');
      return box ? box.checked : false;
    }
    if (f.type === 'radio') {
      var sel = form.querySelector('[name="'+f.key+'"]:checked');
      return sel ? sel.value : '';
    }
    var el = form.querySelector('[name="'+f.key+'"]');
    return el ? el.value : '';
  }

  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    errEl.style.display = 'none';
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;

    var data = {};
    FIELDS.forEach(function(f){ data[f.key] = readValue(f); });

    var body = { public_id: PUBLIC_ID, submission_token: token, data: data, utm: utm, hp: (form.querySelector('[name="_hp"]')||{}).value || '', t0: t0 };
    var ts = form.querySelector('[name="cf-turnstile-response"]');
    if (ts) body.turnstile_token = ts.value;

    fetch('/api/form-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(res){
        if (res.ok && res.j && res.j.ok) {
          form.style.display = 'none';
          thanksEl.innerHTML = res.j.thankYou || THANKS;
          thanksEl.style.display = 'block';
          resize();
        } else {
          btn.disabled = false;
          errEl.textContent = (res.j && res.j.error) || 'Something went wrong. Please try again.';
          errEl.style.display = 'block';
          resize();
        }
      })
      .catch(function(){
        btn.disabled = false;
        errEl.textContent = 'Network error. Please try again.';
        errEl.style.display = 'block';
      });
  });
})();
</script>
</body></html>`;
}

export async function onRequestGet(context) {
  const { params, env } = context;
  const publicId = params.public_id;
  if (!publicId) return notFound();

  try {
    const db = supabase(env);
    const rows = await db.select(
      'form_definitions',
      `public_id=eq.${encodeURIComponent(publicId)}&select=id,public_id,name,status,theme,turnstile_enabled,published_version_id&limit=1`,
    );
    const form = rows[0];
    if (!form || form.status !== 'published' || !form.published_version_id) return notFound();

    const vers = await db.select(
      'form_definition_versions',
      `id=eq.${form.published_version_id}&select=schema`,
    );
    const schema = (vers[0] && vers[0].schema) || { fields: [] };
    return page(renderForm(form, schema, env));
  } catch (e) {
    console.error('hosted form error:', e);
    return notFound();
  }
}
