import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  SOURCE_PAGE_TRUNCATION_MARKER,
  buildBudgetedSourcePage,
  buildSourceChunksForSourceItem,
  splitChunkTextToSentences
} from "../pages/api/_lib/knowledgeReceptionistCompiler.js";
import {
  buildWebsiteSourceItems,
  extractStructuredPageContent as extractBuildPageContent,
  splitPlainTextToLines
} from "../pages/api/_lib/knowledgeReceptionistBuilds.js";
import {
  extractStructuredPageContent as extractDemoPageContent
} from "../pages/api/_lib/demoWebsiteScraper.js";
import { extractTextFromDocumentBuffer } from "../pages/api/_lib/knowledgeReceptionistFiles.js";

const addressHtml = `
  <html>
    <head><title>About Wenatchee Valley Glass</title></head>
    <body>
      <header><div>WA</div></header>
      <main>
        <h1>About Us</h1>
        <p>5970 Sunburst Lane, Unit A</p>
      </main>
      <footer><div>Cashmere, WA 98815</div></footer>
    </body>
  </html>
`;

for (const extract of [extractBuildPageContent, extractDemoPageContent]) {
  const extracted = extract(addressHtml);
  assert.ok(extracted.lines.includes("WA"), "short visible lines must not be discarded");
  assert.ok(extracted.lines.includes("5970 Sunburst Lane, Unit A"), "street line must survive extraction");
  assert.ok(extracted.lines.includes("Cashmere, WA 98815"), "footer city/state/ZIP line must survive extraction");
  assert.match(extracted.text, /5970 Sunburst Lane, Unit A\nCashmere, WA 98815/);
}

const plainLines = Array.from({ length: 4005 }, (_, index) => index === 4004 ? "Z" : `L${index}`);
assert.deepEqual(
  splitPlainTextToLines(plainLines.join("\n")),
  plainLines,
  "plain-text sources must retain every nonempty line without a 4,000-line or minimum-length cutoff"
);

assert.equal(
  extractTextFromDocumentBuffer({
    buffer: Buffer.from("(WA) Tj\n(Cashmere, WA 98815) Tj", "latin1"),
    mimeType: "application/pdf",
    filename: "address.pdf"
  }).bodyText,
  "WA\nCashmere, WA 98815",
  "PDF extraction must not discard a short one-word or one-token line"
);

const pageLines = [
  "Wenatchee Valley Glass",
  "Custom showers",
  "Doors",
  "Skylights",
  "Sunrooms",
  "Railings",
  "Residential",
  "Commercial",
  "Chelan County",
  "Douglas County",
  "5970 Sunburst Lane, Unit A",
  "Cashmere, WA 98815"
];
const [sourceItem] = buildWebsiteSourceItems({
  pages: [{
    sourceUrl: "https://example.test/about",
    title: "About Wenatchee Valley Glass",
    headings: ["About Us"],
    lines: pageLines,
    text: pageLines.join("\n"),
    pageType: "unknown_mixed"
  }],
  files: []
});
assert.deepEqual(sourceItem.lines, pageLines, "normal pages must remain lossless after normalization");
assert.equal(sourceItem.text, pageLines.join("\n"), "page line breaks must remain intact");
assert.equal(sourceItem.metadata.page_document.truncated, false);

const chunks = buildSourceChunksForSourceItem(sourceItem, "source_about", {
  tenant_key: "tenant_test",
  build_id: "build_test"
});
assert.equal(chunks.length, 1, "each page must produce exactly one AI evidence document");
assert.equal(chunks[0].chunk_index, 0);
assert.equal(chunks[0].chunk_kind, "page_document");
assert.equal(chunks[0].section_title, "About Wenatchee Valley Glass");
assert.equal(chunks[0].text_span, pageLines.join("\n"));

const oversizedLines = [
  `BEGIN_IDENTITY ${"A".repeat(300)}`,
  ...Array.from({ length: 20 }, (_, index) => `MIDDLE_${index} ${"B".repeat(90)}`),
  "END_CONTACT 5970 Sunburst Lane, Unit A, Cashmere, WA 98815"
];
const budgeted = buildBudgetedSourcePage({ lines: oversizedLines }, { tokenBudget: 100 });
assert.equal(budgeted.metadata.truncated, true);
assert.ok(budgeted.metadata.stored_token_estimate <= 100, "stored page must honor its page token budget");
assert.ok(budgeted.text.startsWith("BEGIN_IDENTITY"), "oversized page must retain its beginning");
assert.ok(budgeted.text.includes(SOURCE_PAGE_TRUNCATION_MARKER));
assert.ok(budgeted.text.endsWith("END_CONTACT 5970 Sunburst Lane, Unit A, Cashmere, WA 98815"), "oversized page must retain its end");

const [normalizedOversized] = buildWebsiteSourceItems({
  pages: [{
    sourceUrl: "https://example.test/very-long",
    title: "Very Long Page",
    headings: [],
    lines: Array.from({ length: 800 }, (_, index) => `PAGE_LINE_${index} ${"C".repeat(80)}`),
    text: "",
    pageType: "unknown_mixed"
  }],
  files: []
});
assert.equal(normalizedOversized.metadata.page_document.truncated, true, "source normalization must apply the production page cap before persistence");
assert.ok(normalizedOversized.metadata.page_document.stored_token_estimate <= 12000);
assert.ok(normalizedOversized.text.endsWith(`PAGE_LINE_799 ${"C".repeat(80)}`));

const budgetedAgain = buildBudgetedSourcePage({
  lines: budgeted.lines,
  text: budgeted.text,
  metadata: { page_document: budgeted.metadata }
}, { tokenBudget: 100 });
assert.equal(budgetedAgain.text, budgeted.text, "page budgeting must be idempotent across normalization passes");
assert.equal(budgetedAgain.metadata.original_token_estimate, budgeted.metadata.original_token_estimate);

const oneLongLine = `START ${"é".repeat(800)} THE_END`;
const oneLineBudgeted = buildBudgetedSourcePage({ lines: [oneLongLine] }, { tokenBudget: 100 });
assert.ok(oneLineBudgeted.text.startsWith("START"));
assert.ok(oneLineBudgeted.text.includes(SOURCE_PAGE_TRUNCATION_MARKER));
assert.ok(oneLineBudgeted.text.endsWith("THE_END"), "a one-line oversized document must retain both ends");
assert.ok(oneLineBudgeted.metadata.stored_token_estimate <= 100);

assert.deepEqual(
  splitChunkTextToSentences(`Open.\nCashmere, WA 98815\n${SOURCE_PAGE_TRUNCATION_MARKER}`),
  ["Open.", "Cashmere, WA 98815"],
  "fallback extraction must retain short facts but ignore the internal truncation marker"
);

const compilerSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeReceptionistCompiler.js", import.meta.url), "utf8");
const buildsSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeReceptionistBuilds.js", import.meta.url), "utf8");
const demoSource = await fs.readFile(new URL("../pages/api/_lib/demoWebsiteScraper.js", import.meta.url), "utf8");
const filesSource = await fs.readFile(new URL("../pages/api/_lib/knowledgeReceptionistFiles.js", import.meta.url), "utf8");
for (const source of [compilerSource, buildsSource, demoSource, filesSource]) {
  assert.doesNotMatch(source, /line\.length\s*>=\s*24/);
  assert.doesNotMatch(source, /currentLines\.length\s*>=\s*5/);
  assert.doesNotMatch(source, /line\.split\(\/\\s\+\/\)\.length\s*>=/);
}
assert.doesNotMatch(compilerSource, /CHUNK_(?:SOFT|HARD)_CHAR_LIMIT/);
assert.match(compilerSource, /SOURCE_SUMMARY_BATCH_TOKENS", 18000/);
assert.match(compilerSource, /TOPIC_WINDOW_TOKENS", 18000/);
assert.match(compilerSource, /SOURCE_ARTIFACT_BATCH_TOKENS", 22000/);

console.log("knowledge source page validation passed");
