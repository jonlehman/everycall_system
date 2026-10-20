import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const bundle = new URL('../docs/architecture/knowledge-receptionist-subsystem/v1.0/', import.meta.url);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  assert.equal(quoted, false, 'CSV must have balanced quotes');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.some(Boolean)).map((r) => {
    assert.equal(r.length, headers.length, 'CSV column count must match its header');
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}

const markdown = await fs.readFile(new URL('14-requirements-traceability-matrix.md', bundle), 'utf8');
const mdRows = markdown.split('\n').filter((line) => line.startsWith('| REQ-')).map((line) => {
  const fields = line.slice(1, -1).split('|').map((field) => field.trim());
  assert.equal(fields.length, 8, 'Each Markdown requirement must retain all eight fields');
  return { id: fields[0], text: fields[1] };
});
const csvRows = parseCsv(await fs.readFile(new URL('requirements-traceability.csv', bundle), 'utf8'));
const md = new Map(mdRows.map((r) => [r.id, r.text]));
const csv = new Map(csvRows.map((r) => [r['Requirement ID'], r.Requirement]));
assert.equal(md.size, mdRows.length, 'Markdown IDs must be unique');
assert.equal(csv.size, csvRows.length, 'CSV IDs must be unique');
assert.deepEqual([...md.keys()].sort(), [...csv.keys()].sort(), 'Markdown and CSV must retain identical IDs');
for (const [id, text] of md) assert.equal(csv.get(id), text, `${id}: requirement text differs between inventories`);

const baselineRows = parseCsv(await fs.readFile(new URL('../conformance-matrix-2026-10-20.csv', bundle), 'utf8'));
for (const row of baselineRows) {
  assert.equal(md.get(row.requirement_id), row.baseline_requirement,
    `${row.requirement_id}: preserve the frozen requirement; record an approved supersession explicitly`);
}
const manifest = JSON.parse(await fs.readFile(new URL('spec-bundle-manifest.json', bundle), 'utf8'));
assert.equal(manifest.counts.requirements, md.size, 'Manifest requirement count must match both inventories');
assert.equal(manifest.counts.documents, manifest.files.length, 'Manifest document count must match its file list');
for (const file of manifest.files) await fs.access(new URL(file, bundle));
console.log(`Knowledge design inventory passed: ${md.size} synchronized requirements, ${baselineRows.length} original requirements preserved.`);
