import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  DEFAULT_KNOWLEDGE_BUILD_STEP_TOTAL,
  resolveKnowledgeBuildHeaderStatus
} from '../app/client/receptionist/knowledge/buildHeaderStatus.mjs';

assert.equal(DEFAULT_KNOWLEDGE_BUILD_STEP_TOTAL, 7);

assert.deepEqual(
  resolveKnowledgeBuildHeaderStatus({
    status: 'running',
    progress: { step: 4, stepTotal: 7, label: 'Topics', summary: 'Organizing facts.' }
  }),
  {
    active: true,
    detail: 'Topics: Organizing facts.',
    label: 'Step 4 of 7',
    tone: 'warn'
  }
);

assert.equal(
  resolveKnowledgeBuildHeaderStatus({ status: 'queued' }).label,
  'Step 1 of 7'
);
assert.equal(
  resolveKnowledgeBuildHeaderStatus({ status: 'published' }, { published: true }).label,
  'Build completed and published'
);
assert.equal(
  resolveKnowledgeBuildHeaderStatus({ status: 'failed' }).label,
  'Build failed'
);
assert.equal(
  resolveKnowledgeBuildHeaderStatus({ status: 'qa_blocked' }).label,
  'Build needs review'
);
assert.equal(resolveKnowledgeBuildHeaderStatus(null).label, 'No build yet');

const pageSource = await fs.readFile(
  new URL('../app/client/receptionist/knowledge/page.jsx', import.meta.url),
  'utf8'
);
assert.match(
  pageSource,
  /<InlineInfoButton message=\{WEBSITE_TOOLTIP\} \/>\s*<BuildHeaderStatus/
);
assert.match(
  pageSource,
  /<InlineInfoButton message=\{DOCUMENTS_TOOLTIP\} \/>\s*<BuildHeaderStatus/
);
assert.match(pageSource, /build=\{activeWebsiteBuild \|\| latestWebsiteBuild\}/);
assert.match(pageSource, /build=\{activeDocumentBuild \|\| latestDocumentBuild\}/);

console.log('knowledge build header status validation passed');
