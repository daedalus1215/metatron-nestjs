/**
 * Renders every template in ./templates against a scanned model.
 *
 * A template is a self-contained HTML fragment containing exactly one __DATA__
 * token inside a JSON script tag. Three things happen at build time:
 *
 *   1. an adapter (optional, adapters/<name>.js) reshapes the model
 *   2. the payload is injected at __DATA__
 *   3. generated prose is injected into every [data-narr] slot
 *
 * Templates never hardcode a project's findings, so a lens cannot describe the
 * codebase it was first written against.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const narrate = require('./narrate');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(ROOT, 'templates');
const ADAPTERS = path.join(ROOT, 'adapters');

/** Slots whose text comes from the narrator, plus title/date tokens. */
function personalise(html, model, jsonId) {
  const N = narrate(model);
  const when = new Date(model.generatedAt).toISOString().slice(0, 10);
  const pretty = model.project.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  html = html
    .replace(/\{\{project\}\}/g, pretty)
    .replace(/\{\{projectId\}\}/g, model.project)
    .replace(/\{\{date\}\}/g, when)
    .replace(/\{\{files\}\}/g, String(model.stats.files))
    .replace(/\{\{imports\}\}/g, String(model.stats.edges))
    .replace(/\{\{endpoints\}\}/g, String(model.stats.endpoints))
    .replace(/\{\{modules\}\}/g, String(model.modules.length))
    .replace(/\{\{root\}\}/g, model.root || 'src');

  // Every lens is a viewport-bound plate, and every one of them benefits from
  // filling the screen. Injected here rather than written into each template so
  // a new lens gets it for free: mark the plate `data-fullscreen` and the row
  // container `data-fs-grow`.
  const fullscreen = `
<style>
.metatron-full { position:fixed !important; inset:0 !important; z-index:9999;
  margin:0 !important; border-radius:0 !important; display:flex; flex-direction:column;
  background:var(--paper, var(--surface, #111)); }
.metatron-full [data-fs-grow] { flex:1; min-height:0; }
.metatron-full [data-fs-grow] > * { max-height:none !important; height:100% !important; }
body.metatron-locked { overflow:hidden; }
.metatron-fsbtn { position:absolute; top:8px; right:10px; z-index:3;
  font-family:'IBM Plex Mono', ui-monospace, monospace; font-size:11px; letter-spacing:.04em;
  padding:5px 10px; cursor:pointer; color:var(--ink2, #889); background:var(--surface, #1a222c);
  border:1px solid var(--rule2, #445); opacity:.72; }
.metatron-fsbtn:hover { opacity:1; color:var(--ink, #eee); }
.metatron-fsbtn:focus-visible { outline:2px solid var(--blue, #79a4e6); outline-offset:2px; }
</style>
<script>
(function(){
  var plate = document.querySelector('[data-fullscreen]');
  if (!plate) return;
  if (getComputedStyle(plate).position === 'static') plate.style.position = 'relative';
  var btn = document.createElement('button');
  btn.className = 'metatron-fsbtn';
  btn.type = 'button';
  btn.textContent = '⤢ full screen';
  btn.title = 'Fill the screen (Esc to leave)';
  plate.appendChild(btn);
  function on(){ return plate.classList.contains('metatron-full'); }
  function set(v){
    plate.classList.toggle('metatron-full', v);
    document.body.classList.toggle('metatron-locked', v);
    btn.textContent = v ? '✕ exit' : '⤢ full screen';
    try {
      if (v && plate.requestFullscreen) plate.requestFullscreen().catch(function(){});
      else if (!v && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){});
    } catch (e) {}
    // canvas lenses watch their own container, but nudge anything that does not
    window.dispatchEvent(new Event('resize'));
  }
  btn.addEventListener('click', function(){ set(!on()); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && on()) { e.preventDefault(); set(false); } });
  document.addEventListener('fullscreenchange', function(){ if (!document.fullscreenElement && on()) set(false); });
})();
</script>`;

  const filler = fullscreen + `
<script id="__narr" type="application/json">${JSON.stringify(N)}</script>
<script>
(function(){
  var N;
  try { N = JSON.parse(document.getElementById('__narr').textContent); } catch (e) { return; }
  var slots = document.querySelectorAll('[data-narr]');
  for (var i = 0; i < slots.length; i++) {
    var el = slots[i], key = el.getAttribute('data-narr');
    if (N[key]) el.innerHTML = N[key];
    else if (el.parentNode) el.parentNode.removeChild(el);   // nothing to say, so say nothing
  }
})();
</script>`;
  return html + filler;
}

/**
 * `findings[].instances` exists so violations can be fingerprinted for the
 * baseline. No lens reads it, so it does not belong in a browser payload.
 */
function forLens(model) {
  return Object.assign({}, model, {
    findings: (model.findings || []).map((f) => {
      const g = Object.assign({}, f);
      delete g.instances;
      return g;
    }),
  });
}

function buildOne(model, name, tpl) {
  const hits = tpl.split('__DATA__').length - 1;
  if (hits !== 1) throw new Error(`expected exactly one __DATA__ token, found ${hits}`);

  const lensModel = forLens(model);
  let payload = lensModel;
  let via = 'full model';
  const adapter = path.join(ADAPTERS, name + '.js');
  if (fs.existsSync(adapter)) {
    delete require.cache[require.resolve(adapter)];
    payload = require(adapter)(lensModel);
    via = 'adapters/' + name + '.js';
  }

  const json = JSON.stringify(payload);
  if (json.includes('</script')) throw new Error('payload contains a literal </script>');

  const idMatch = tpl.match(/<script id="([\w-]+)" type="application\/json">/);
  const html = personalise(tpl.replace('__DATA__', json), model, idMatch && idMatch[1]);
  return { html, json, via };
}

function listTemplates(filter) {
  return fs.readdirSync(TEMPLATES)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !filter || !filter.length || filter.some((q) => f.toLowerCase().includes(q.toLowerCase())))
    .sort();
}

/** Writes an index so the views are reachable without remembering filenames. */
function writeIndex(outDir, model, built) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const when = new Date(model.generatedAt).toISOString().replace('T', ' ').slice(0, 16);
  const cov = (100 - model.coverage.unclassifiedPct).toFixed(1);
  const rows = built.map((b) => `    <a class="v" href="./${b.name}.html">
      <h2>${esc(b.title)}</h2>
      <p>${esc(b.blurb || 'No description — add an <!-- metatron: ... --> comment to the template.')}</p>
      <span>${b.name}.html · ${(b.bytes / 1024).toFixed(0)} KB</span>
    </a>`).join('\n');
  fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.project)} · Architecture</title>
<style>
  :root { color-scheme: light dark;
    --bg:#f2f4f7; --fg:#141d28; --dim:#5a6b7e; --line:#ccd5df; --card:#fff; }
  @media (prefers-color-scheme: dark) { :root {
    --bg:#0e141b; --fg:#e3eaf2; --dim:#8fa1b3; --line:#28343f; --card:#151d26; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); padding:48px 24px 80px;
    font:16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width:820px; margin:0 auto; }
  h1 { font-size:34px; letter-spacing:-.025em; margin:0 0 6px; }
  .meta { color:var(--dim); font:13px ui-monospace, monospace; margin:0 0 32px; }
  .v { display:block; border:1px solid var(--line); background:var(--card);
    padding:16px 18px; margin-bottom:10px; text-decoration:none; color:inherit; }
  .v:hover { border-color:var(--dim); }
  .v h2 { margin:0 0 4px; font-size:17px; letter-spacing:-.01em; }
  .v p { margin:0 0 6px; color:var(--dim); font-size:14.5px; }
  .v span { font:11.5px ui-monospace, monospace; color:var(--dim); opacity:.8; }
  footer { margin-top:28px; color:var(--dim); font-size:13.5px; }
  code { font:13px ui-monospace, monospace; background:var(--bg); padding:1px 5px; border:1px solid var(--line); }
</style></head><body><main>
  <h1>${esc(model.project)}</h1>
  <p class="meta">scanned ${when} · ${model.stats.files} files · ${model.stats.edges} imports · ${model.stats.endpoints} endpoints · ${cov}% classified</p>
${rows}
  <footer>Regenerate with <code>npx metatron</code>. Self-contained — no server needed, just open them.</footer>
</main></body></html>`);
}

function build(model, outDir, filter) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const file of listTemplates(filter)) {
    const name = path.basename(file, '.html');
    const tpl = fs.readFileSync(path.join(TEMPLATES, file), 'utf8');
    try {
      const { html, json, via } = buildOne(model, name, tpl);
      fs.writeFileSync(path.join(outDir, name + '.html'), html);
      const title = (tpl.match(/<title>([^<]*)<\/title>/) || [])[1] || name;
      const blurb = (tpl.match(/<!--\s*metatron:\s*([\s\S]*?)-->/) || [])[1] || '';
      results.push({
        name, ok: true, bytes: html.length, dataBytes: json.length, via,
        title: title.replace(/\{\{project\}\}/g, model.project).trim(),
        blurb: blurb.trim(),
      });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  }
  const good = results.filter((r) => r.ok);
  if (good.length) writeIndex(outDir, model, good);
  return results;
}

module.exports = { build, listTemplates };
