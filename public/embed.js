/*
 * ════════════════════════════════════════════════
 * FILE: embed.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one-line snippet a website owner pastes onto their page to show a Utah
 *   Pros lead form. It drops an <iframe> that loads the hosted form (/f/<id>),
 *   and — importantly — copies the ad-tracking tags from the HOST page (the
 *   utm_source/gclid/fbclid in its URL, the page someone came from, and the
 *   page they landed on) into the iframe's URL, so a lead captured through an
 *   embedded form keeps the same attribution a phone call would. It also
 *   auto-sizes the iframe so there's never an inner scrollbar.
 *
 * WHERE IT LIVES:
 *   Served at:   /embed.js  (static asset in public/)
 *   Used by:     external customer sites via
 *                <script src="https://utahpros.app/embed.js" data-upr-form="PUBLIC_ID" async></script>
 *
 * DEPENDS ON:
 *   Packages:  none — plain browser JS, no build step, runs on the customer site
 *   Data:      none (all writes happen server-side after the form posts)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md).
 *   - The form origin is derived from THIS script's own src, so the same file
 *     works from dev.utahpros.app and utahpros.app without editing.
 *   - Height messages are trusted only when they come from the form's origin
 *     AND from the exact iframe window that sent them (event.source match).
 * ════════════════════════════════════════════════
 */
(function () {
  'use strict';

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

  function scriptOrigin(scriptEl) {
    try {
      return new URL(scriptEl.src).origin;
    } catch {
      return '';
    }
  }

  // Collect the host page's attribution signals to forward into the form URL.
  function parentParams() {
    var params = new URLSearchParams();
    try {
      var host = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function (k) {
        var v = host.get(k);
        if (v) params.set(k, v);
      });
      if (document.referrer) params.set('referrer', document.referrer);
      params.set('landing', window.location.href);
    } catch { /* best-effort */ }
    return params.toString();
  }

  function mount(scriptEl) {
    if (scriptEl.getAttribute('data-upr-done')) return;
    var publicId = scriptEl.getAttribute('data-upr-form');
    if (!publicId) return;
    scriptEl.setAttribute('data-upr-done', '1');

    var origin = scriptOrigin(scriptEl);
    var qs = parentParams();
    var src = origin + '/f/' + encodeURIComponent(publicId) + (qs ? '?' + qs : '');

    var iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = 'Contact form';
    iframe.setAttribute('loading', 'lazy');
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.overflow = 'hidden';
    iframe.style.minHeight = '320px';
    iframe.setAttribute('data-upr-form-frame', publicId);

    // Mount into an explicit target if given, else right where the script sits.
    var targetSel = scriptEl.getAttribute('data-upr-target');
    var target = targetSel ? document.querySelector(targetSel) : null;
    if (target) {
      target.appendChild(iframe);
    } else if (scriptEl.parentNode) {
      scriptEl.parentNode.insertBefore(iframe, scriptEl.nextSibling);
    } else {
      document.body.appendChild(iframe);
    }

    // Resize only in response to a trusted message from THIS iframe's window.
    window.addEventListener('message', function (ev) {
      if (ev.origin !== origin) return;
      if (!ev.data || ev.data.type !== 'upr-form-height') return;
      if (iframe.contentWindow && ev.source === iframe.contentWindow) {
        var h = parseInt(ev.data.height, 10);
        if (h > 0) iframe.style.height = h + 'px';
      }
    });
  }

  function init() {
    var scripts = document.querySelectorAll('script[data-upr-form]');
    for (var i = 0; i < scripts.length; i++) mount(scripts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
