import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  hasConfirmedCallbackRole, isConfirmedLivePromptSettings,
  loadTenantLivePromptEditorState, loadTenantLivePromptSettings,
  maybeActivateTenantLivePrompt, saveTenantLivePromptSettings,
  suggestCallbackRole
} from '../pages/api/_lib/tenantLivePromptSettings.js';

const db = new PGlite();
await db.exec(`CREATE TABLE tenants (tenant_key TEXT PRIMARY KEY, industry TEXT, live_prompt_mode TEXT NOT NULL DEFAULT 'legacy');
  CREATE TABLE audit_log (tenant_key TEXT, actor TEXT, action TEXT, details JSONB);
  CREATE TABLE tenant_active_knowledge_builds (tenant_key TEXT PRIMARY KEY, active_build_id TEXT);
  CREATE TABLE live_brief_blocks (tenant_key TEXT PRIMARY KEY, build_id TEXT, block_text TEXT);`);
await db.exec(await readFile(new URL('../migrations/0049_live_prompt_settings.sql', import.meta.url), 'utf8'));
const pool = { query: (sql, args) => db.query(sql, args), connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) };
await db.query("INSERT INTO tenants (tenant_key, industry) VALUES ('legacy-painter', 'Painting'), ('new-painter', 'Painting')");
await db.query("UPDATE tenants SET live_prompt_mode = 'pending_v20' WHERE tenant_key = 'new-painter'");
await db.query("INSERT INTO tenant_live_prompt_settings (tenant_key, mode) VALUES ('new-painter', 'pending_v20')");

assert.deepEqual(suggestCallbackRole('Painting'), {
  callback_role: 'an estimator', callback_role_does: 'walk through the project with you and put together a written estimate'
});
const editor = await loadTenantLivePromptEditorState(pool, 'legacy-painter');
assert.equal(editor.mode, 'legacy');
assert.equal(editor.defaulted, true);
assert.equal(editor.confirmed, false);

const values = { callback_role: 'an estimator', callback_role_does: 'walk through the project with you and put together a written estimate' };
let saved = await saveTenantLivePromptSettings(pool, 'legacy-painter', { ...values, expected_revision: 0, confirm: true }, 'owner-1');
assert.equal(saved.mode, 'legacy', 'role confirmation alone must not switch an existing tenant');
assert.equal(hasConfirmedCallbackRole(saved), true);
assert.equal(isConfirmedLivePromptSettings(saved), false);
await assert.rejects(saveTenantLivePromptSettings(pool, 'legacy-painter', { ...values, expected_revision: 0, confirm: true }, 'owner-1'), /stale_live_prompt_settings/);

await db.query("INSERT INTO tenant_active_knowledge_builds VALUES ('legacy-painter', 'build-a')");
await db.query("INSERT INTO live_brief_blocks VALUES ('legacy-painter', 'build-a', '')");
assert.equal(await maybeActivateTenantLivePrompt(pool, 'legacy-painter'), true);
saved = await loadTenantLivePromptSettings(pool, 'legacy-painter');
assert.equal(isConfirmedLivePromptSettings(saved), true);
assert.equal((await db.query("SELECT live_prompt_mode FROM tenants WHERE tenant_key = 'legacy-painter'")).rows[0].live_prompt_mode, 'v20_1');

saved = await saveTenantLivePromptSettings(pool, 'legacy-painter', {
  ...values, callback_role: 'our painter', expected_revision: Number(saved.revision), confirm: false
}, 'owner-1');
assert.equal(saved.mode, 'pending_v20', 'material edit immediately closes v20 admission');
assert.equal(hasConfirmedCallbackRole(saved), false);
assert.equal(await maybeActivateTenantLivePrompt(pool, 'legacy-painter'), false);

saved = await saveTenantLivePromptSettings(pool, 'new-painter', { ...values, expected_revision: 0, confirm: true }, 'owner-2');
assert.equal(saved.mode, 'pending_v20');
assert.equal(hasConfirmedCallbackRole(saved), true);
console.log('Live prompt settings: role defaults, confirmation, legacy preservation, active-brief gate, edit invalidation and revision checks passed.');
await db.close();
