import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await import(pathToFileURL(
  path.join(process.cwd(), "apps/call-gateway/dist/apps/call-gateway/src/transferDirectory.js")
).href);

const targets = [
  { id: 1, name: "Jane Rivera", transfer_extension: "101" },
  { id: 2, name: "John Smith", transfer_extension: "102" }
];

assert.deepEqual(directory.rankTransferMatches(targets, "101").map((target) => target.id), [1]);
assert.deepEqual(directory.rankTransferMatches(targets, "Jane").map((target) => target.id), [1]);
assert.deepEqual(directory.rankTransferMatches(targets, "Please transfer me to Jane.").map((target) => target.id), [1]);
assert.deepEqual(directory.rankTransferMatches(targets, "Is John available?").map((target) => target.id), [2]);
assert.deepEqual(directory.rankTransferMatches(targets, "Who can you transfer me to?").map((target) => target.id), [1, 2]);
assert.deepEqual(directory.rankTransferMatches([targets[0]], "Who's available?").map((target) => target.id), [1]);
assert.deepEqual(directory.rankTransferMatches(targets, "billing department"), []);
assert.deepEqual(directory.rankTransferMatches([{ id: 3, name: "Will Jackson" }], "Will you transfer me?"), []);
assert.deepEqual(directory.rankTransferMatches([{ id: 3, name: "Will Jackson" }], "Please transfer me to Will.").map((target) => target.id), [3]);

console.log(JSON.stringify({ ok: true, checked: "transfer_directory" }, null, 2));
