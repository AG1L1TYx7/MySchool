// Extracts an endpoint inventory from the C# controllers and the Python FastAPI main.py.
// Output: markdown to stdout, JSON summary to stderr.
const fs = require('fs');
const path = require('path');

const apiRoot = 'C:/Users/bishw/OneDrive/Desktop/SmartSchool/mainschool/SmartSchool.Api/Controllers';
const pyMain = 'C:/Users/bishw/OneDrive/Desktop/SmartSchool/mainschool/SmartSchool.AI/main.py';

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else if (e.name.endsWith('.cs')) out.push(p);
  }
  return out;
}

function parseAuth(attrs) {
  const a = [];
  for (const t of attrs) {
    if (/AllowAnonymous/.test(t)) a.push('Anonymous');
    const roles = t.match(/Roles\s*=\s*"([^"]+)"/); if (roles) a.push('Roles: ' + roles[1]);
    const pol = t.match(/Policy\s*=\s*(?:"([^"]+)"|Policies\.(\w+))/); if (pol) a.push('Policy: ' + (pol[1] || pol[2]));
    if (/^\[Authorize\]$/.test(t.trim()) || /\[Authorize\]/.test(t)) a.push('Authenticated');
    const fg = t.match(/FeatureGate\("([^"]+)"\)/); if (fg) a.push('Feature: ' + fg[1]);
    const rf = t.match(/RequireFeature\("([^"]+)"\)/); if (rf) a.push('Feature: ' + rf[1]);
  }
  return [...new Set(a)];
}

const controllers = [];
for (const file of walk(apiRoot)) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const rel = path.relative(apiRoot, file).replace(/\\/g, '/');
  let classRoute = null, className = null, apiVersion = null, classAttrs = [];
  let pending = [];
  const actions = [];
  let inClass = false;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    if (!inClass) {
      const r = L.match(/^\[Route\("([^"]+)"\)\]/); if (r) classRoute = r[1];
      const v = L.match(/^\[ApiVersion\("([^"]+)"\)\]/); if (v) apiVersion = v[1];
      if (/^\[(Authorize|AllowAnonymous)/.test(L)) classAttrs.push(L);
      const c = L.match(/^public\s+(?:sealed\s+|abstract\s+)?class\s+(\w+)\s*:\s*(ControllerBase|Controller)\b/);
      if (c) { className = c[1]; inClass = true; }
      continue;
    }
    const http = L.match(/^\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]*)"\))?\]/);
    if (http) { pending.push(L); continue; }
    if (/^\[(Authorize|AllowAnonymous|FeatureGate|RequireFeature|AuditLog|MapToApiVersion)/.test(L)) { pending.push(L); continue; }
    const m = L.match(/^public\s+(?:async\s+)?[\w<>\[\],\s\?\.]+?\s+(\w+)\s*\(/);
    if (m && pending.some(p => /^\[Http/.test(p))) {
      const name = m[1];
      for (const p of pending) {
        const h = p.match(/^\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]*)"\))?\]/);
        if (!h) continue;
        actions.push({ verb: h[1].toUpperCase(), template: h[2] || '', name, auth: parseAuth(pending) });
      }
      pending = [];
    } else if (m) { pending = []; }
  }
  if (!className) continue;
  const short = className.replace(/Controller$/, '');
  const version = apiVersion ? 'v' + apiVersion.split('.')[0] : (rel.startsWith('V2/') ? 'v2' : 'v1');
  let base = (classRoute || 'api/[controller]').replace('[controller]', short).replace('v{version:apiVersion}', version);
  controllers.push({ file: rel, className, base: '/' + base, version, classAuth: parseAuth(classAttrs), actions });
}
controllers.sort((a, b) => a.base.localeCompare(b.base));

// Python
const py = fs.readFileSync(pyMain, 'utf8').split(/\r?\n/);
const pyRoutes = [];
for (let i = 0; i < py.length; i++) {
  const d = py[i].match(/^@app\.(get|post|put|delete|patch)\("([^"]+)"/);
  if (!d) continue;
  let name = '';
  for (let j = i + 1; j < Math.min(i + 6, py.length); j++) { const f = py[j].match(/^(?:async\s+)?def\s+(\w+)\s*\(/); if (f) { name = f[1]; break; } }
  pyRoutes.push({ verb: d[1].toUpperCase(), route: d[2], name });
}

// Markdown
let md = '';
md += '# Endpoint Inventory (generated)\n\n';
md += 'Generated on ' + new Date().toISOString().slice(0, 10) + ' from `SmartSchool.Api/Controllers/**/*.cs` and `SmartSchool.AI/main.py` by `documentation/architecture/tools/extract-routes.cjs`. Regenerate after any route change; do not edit by hand.\n\n';
const total = controllers.reduce((s, c) => s + c.actions.length, 0);
md += `**C# API:** ${controllers.length} controllers, ${total} endpoints. **Python AI:** ${pyRoutes.length} endpoints.\n\n`;
md += '## Contents\n\n';
for (const c of controllers) md += `- [${c.className}](#${c.className.toLowerCase()}) \`${c.base}\` (${c.actions.length})\n`;
md += `- [Python AI service](#python-ai-service) (${pyRoutes.length})\n\n`;
md += '## C# API controllers\n\n';
for (const c of controllers) {
  md += `### ${c.className}\n\n`;
  md += `File: \`Controllers/${c.file}\` · Base route: \`${c.base}\` · Version: ${c.version}` + (c.classAuth.length ? ` · Class auth: ${c.classAuth.join(', ')}` : '') + '\n\n';
  md += '| Verb | Route | Action | Auth |\n|---|---|---|---|\n';
  for (const a of c.actions) {
    const route = (c.base + (a.template ? '/' + a.template.replace(/^\//, '') : '')).replace(/\/+/g, '/');
    const auth = a.auth.length ? a.auth.join(', ') : (c.classAuth.length ? 'inherits' : '');
    md += `| ${a.verb} | \`${route}\` | ${a.name} | ${auth} |\n`;
  }
  md += '\n';
}
md += '## Python AI service\n\n';
md += 'Base URL `http://localhost:8000`. Authentication: optional `X-API-Key` when `ALLOWED_API_KEYS` is set.\n\n';
const groups = {};
for (const r of pyRoutes) { const g = r.route.split('/').slice(0, 4).join('/') || '/'; (groups[g] = groups[g] || []).push(r); }
for (const g of Object.keys(groups).sort()) {
  md += `### ${g}\n\n| Verb | Route | Handler |\n|---|---|---|\n`;
  for (const r of groups[g]) md += `| ${r.verb} | \`${r.route}\` | ${r.name} |\n`;
  md += '\n';
}
process.stdout.write(md);
process.stderr.write(JSON.stringify({ controllers: controllers.length, csEndpoints: total, pyEndpoints: pyRoutes.length, perController: controllers.map(c => [c.className, c.base, c.actions.length]) }, null, 1));
