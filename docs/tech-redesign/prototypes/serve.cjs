/**
 * ════════════════════════════════════════════════
 * FILE: serve.cjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A tiny web server for looking at the design prototypes on a real phone or
 *   the iOS Simulator. The prototype files are HTML *fragments* (no <!doctype>,
 *   no viewport tag) because the claude.ai artifact system added that shell at
 *   publish time. Opened raw on an iPhone they render blank (quirks mode +
 *   980px legacy viewport). This server adds the same shell on the fly, so the
 *   committed files stay artifact-compatible AND work served locally.
 *
 * WHERE IT LIVES:
 *   Run:  node docs/tech-redesign/prototypes/serve.cjs   (port 8899)
 *   Then: simulator → xcrun simctl openurl booted "http://localhost:8899/full-app.html#s-working"
 *         iPhone (same Wi-Fi) → http://<mac-ip>:8899/full-app.html
 *
 * DEPENDS ON:
 *   Packages:  none (node built-ins: http, fs, path)
 *   Internal:  serves every file in this directory (and ../mockups via /mockups/)
 *
 * NOTES / GOTCHAS:
 *   - #s-<screen> deep-links open a specific screen (harness goHash support).
 *   - If a prototype ever ships its own <!doctype>, it is served untouched.
 * ════════════════════════════════════════════════
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8899;
const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };

function wrap(name, body) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<meta name="apple-mobile-web-app-capable" content="yes">'
    + '<title>' + name + '</title><style>html,body{margin:0;padding:0}</style></head><body>'
    + body + '</body></html>';
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  let rel = urlPath === '/' ? '/full-app.html' : urlPath;
  // allow ../mockups via /mockups/ prefix; everything else stays inside this dir
  const base = rel.startsWith('/mockups/') ? path.join(ROOT, '..') : ROOT;
  const file = path.normalize(path.join(base, rel.replace(/^\/mockups\//, '/mockups/')));
  if (!file.startsWith(path.normalize(path.join(ROOT, '..')))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + rel); return; }
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') {
      let s = buf.toString('utf8');
      if (!/^\s*(<!--[\s\S]*?-->\s*)*<!doctype/i.test(s)) s = wrap(path.basename(file), s);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(s);
    } else {
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    }
    console.log(new Date().toTimeString().slice(0, 8), req.url);
  });
}).listen(PORT, '0.0.0.0', () => console.log('prototype server → http://localhost:' + PORT + '/  (serves ' + ROOT + ')'));
