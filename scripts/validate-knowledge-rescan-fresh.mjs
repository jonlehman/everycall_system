import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { normalizeKnowledgeBuildEnqueueInput } from "../pages/api/v1/knowledge/builds/index.js";

const websiteRequest = normalizeKnowledgeBuildEnqueueInput({
  buildKind: "website_base",
  websiteUrl: "https://example.com",
  forceRescrape: false
});
assert.equal(
  websiteRequest.forceRescrape,
  true,
  "every website rescan must force a fresh build even if a caller omits or disables the flag"
);

const snakeCaseWebsiteRequest = normalizeKnowledgeBuildEnqueueInput({
  build_kind: "website_base",
  website_url: "https://example.com"
});
assert.equal(snakeCaseWebsiteRequest.forceRescrape, true);

const overlayRequest = normalizeKnowledgeBuildEnqueueInput({
  buildKind: "document_overlay",
  baseBuildId: "build_live"
});
assert.equal(
  overlayRequest.forceRescrape,
  false,
  "document overlays retain their separate base-build behavior"
);

const pageSource = await fs.readFile(
  new URL("../app/client/receptionist/knowledge/page.jsx", import.meta.url),
  "utf8"
);
assert.match(
  pageSource,
  /forceRescrape:\s*isWebsiteBuild/,
  "the Rescan Website client request must explicitly identify a fresh crawl"
);

const buildSource = await fs.readFile(
  new URL("../pages/api/_lib/knowledgeReceptionistBuilds.js", import.meta.url),
  "utf8"
);
assert.match(
  buildSource,
  /const resumableState = forceRescrape \? null : await findResumableBuildState/,
  "a forced rescan must bypass every resumable build and its persisted analysis state"
);
assert.match(
  buildSource,
  /const buildId = normalizeText\(resumableState\?\.build_id\) \|\| createId\("build"\)/,
  "bypassing resumable state must allocate a new build ID"
);
assert.match(
  buildSource,
  /const intakeSessionId = normalizeText\(resumableState\?\.source_intake_session_id\) \|\| createId\("intake"\)/,
  "bypassing resumable state must allocate a new intake session"
);

console.log("fresh website rescan validation passed");
