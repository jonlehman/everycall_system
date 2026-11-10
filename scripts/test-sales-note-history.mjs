import assert from "node:assert/strict";
import { getSalesProspectDetail } from "../pages/api/_lib/salesRepository.js";
import { normalizeProspect } from "../app/admin/sales/salesApi.js";
import { savedNoteHistory } from "../app/admin/sales/salesNoteHistory.mjs";

const archived = Array.from({ length: 105 }, (_, index) => ({
  sales_call_id: `call-${index}`, outcome_notes: `Saved ${index}\nSecond line`,
  outcome_recorded_at: '2026-11-09T12:00:00Z', started_at: '2026-10-01T12:00:00Z',
}));
for (const operatorUserId of [null, 7]) {
  const pool = { async query(sql, values) {
    if (sql.includes('WHERE p.prospect_id = $1')) return { rows: [{ prospect_id: 'company', assigned_rep_user_id: 7 }], rowCount: 1 };
    if (sql.includes('SELECT sales_call_id, outcome_notes')) {
      assert.equal(sql.includes('LIMIT'), false);
      assert.equal(sql.includes('transcript'), false);
      assert.equal(sql.includes('AND admin_user_id = $2'), operatorUserId !== null);
      assert.deepEqual(values, operatorUserId === null ? ['company'] : ['company', 7]);
      return { rows: archived };
    }
    if (sql.includes('FROM sales_call_sessions')) assert.match(sql, /LIMIT 100/);
    if (sql.includes('FROM sales_prospect_notes')) assert.equal(sql.includes('LIMIT'), false);
    return { rows: [], rowCount: 0 };
  }};
  const detail = await getSalesProspectDetail(pool, 'company', { operatorUserId });
  const prospect = normalizeProspect(detail);
  assert.equal(savedNoteHistory(prospect).length, 105);
  assert.equal(savedNoteHistory(prospect)[104].body, 'Saved 104\nSecond line');
  assert.equal(savedNoteHistory(prospect)[0].enteredAt, Date.parse('2026-11-09T12:00:00Z'));
  assert.equal(prospect.note, '');
  assert.equal(savedNoteHistory(normalizeProspect(prospect)).length, 105);
}
const notes = savedNoteHistory({ history: [
  { id: 'blank', outcomeNotes: ' \n ' },
  { id: 'new', outcomeNotes: 'New', outcomeRecordedAt: '2026-11-09', startedAt: '2026-10-01' },
  { id: 'old', outcomeNotes: 'Old', outcomeRecordedAt: '2026-11-02', startedAt: '2026-11-08' },
  { id: 'legacy', outcomeNotes: 'Fallback', outcomeRecordedAt: 'invalid', createdAt: '2026-11-01' },
], savedNotes: [
  { noteId: 'mirror', salesCallId: 'new', body: 'New', createdAt: '2026-11-09' },
  { noteId: 'company', body: 'Company', createdAt: '2026-11-05' },
], note: 'New' });
assert.deepEqual(notes.map(note => note.body), ['New', 'Company', 'Old', 'Fallback']);
assert.deepEqual(savedNoteHistory({ note: 'Undated legacy' }), [{ id: 'legacy', body: 'Undated legacy', enteredAt: null }]);
assert.deepEqual(savedNoteHistory({}), []);
assert.equal(normalizeProspect({ calls: [{ sales_call_id: 'call', outcome_notes: 'Contact selected note' }] }).history[0].outcomeNotes, 'Contact selected note');
console.log('Sales note history: complete lightweight loading, unchanged actor scope, ordering, dates, blank/mirrored notes, legacy and Contacts normalization passed.');
