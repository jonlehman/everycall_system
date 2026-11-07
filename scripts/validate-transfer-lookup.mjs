import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { loadTransferTargetsForTenant, lookupTransferTargets } from "../apps/call-gateway/dist/apps/call-gateway/src/transferLookup.js";

const jon = { id: 29, name: "Jon Lehman", transfer_extension: "800", forward_to_number: "+12025550129" };
const lookup = (query, targets = [jon]) => lookupTransferTargets(targets, query);
for (const query of ["Jon Layman", "John Layman", "Jon Lehman", "John Lehman", "Jon", "Lehman", "Lehm", "extension 800", "800"]) {
  const result = lookup(query);
  assert.equal(result.status, "match", query);
  assert.deepEqual(result.target, { target_id: "tenant_user_29", name: "Jon Lehman", extension: "800" });
  assert.equal(result.requires_confirmation, true);
  assert.equal(JSON.stringify(result).includes(jon.forward_to_number), false);
  assert.equal(JSON.stringify(result).includes("forward_to_number"), false);
}
for (const query of ["John Lennon", "Alice Carter", "Layman", "801", "80", "8000", "", "   "]) {
  assert.equal(lookup(query).status, "not_found", query);
}
const other = { ...jon, id: 30, name: "John Leman", transfer_extension: "801" };
assert.equal(lookup("John Layman", [jon, other]).status, "ambiguous", "phonetic candidates cannot be scored away");
assert.equal(lookup("Jon Lehman", [jon, other]).target.target_id, "tenant_user_29", "exact full-name precedence");
assert.equal(lookup("801", [jon, other]).target.target_id, "tenant_user_30", "extension precedence");
assert.equal(lookup("John Layman", [jon, { ...other, name: "John Laymon" }]).status, "ambiguous", "edit-distance and phonetic candidates combine");
assert.equal(lookup("Jon", [jon, { ...other, name: "Jon Carter" }]).status, "ambiguous", "existing partial ambiguity");
assert.equal(lookup("800", [jon, { ...other, transfer_extension: "800" }]).status, "ambiguous", "duplicate extensions");
assert.equal(lookup("Jon", []).status, "unavailable");
assert.equal(lookup("Jane Smyth", [{ ...jon, name: "Jane Smith" }]).status, "match", "general vowel-spelling fallback");
assert.equal(lookup("Jon Lehman", [{ ...jon, name: "Jon Lehman" }, { ...other, name: "Jon Lehman" }]).status, "ambiguous");

// Exercise the production query with disposable SQL, including every eligible
// tenant-user gate. The matcher never receives a disabled or cross-tenant row.
const db = new PGlite();
try {
  await db.exec(`CREATE TABLE tenant_users (id int, tenant_key text, name text, status text,
    transfer_enabled boolean, transfer_extension text, forward_to_number text)`);
  const rows = [
    [29, "tenant-a", "Jon Lehman", "active", true, "800", jon.forward_to_number],
    [30, "tenant-b", "John Leman", "active", true, "800", "+12025550130"],
    [31, "tenant-a", "John Leman", "disabled", true, "800", "+12025550131"],
    [32, "tenant-a", "John Leman", "active", false, "800", "+12025550132"],
    [33, "tenant-a", "John Leman", "active", true, "800", null],
    [34, "tenant-a", "John Leman", "active", true, "800", "  "]
  ];
  for (const row of rows) await db.query("INSERT INTO tenant_users VALUES ($1,$2,$3,$4,$5,$6,$7)", row);
  const targets = await loadTransferTargetsForTenant(db, "tenant-a");
  assert.deepEqual(targets, [jon]);
  assert.equal(lookup("John Layman", targets).target.target_id, "tenant_user_29");
  assert.equal(lookup("800", targets).target.target_id, "tenant_user_29");
  assert.deepEqual(await loadTransferTargetsForTenant(db, "missing-tenant"), []);
  assert.deepEqual(await loadTransferTargetsForTenant(null, "tenant-a"), []);
} finally { await db.close(); }
console.log("Transfer lookup regression passed (phonetic ambiguity, exact/partial/extension matches, privacy and SQL eligibility).");
