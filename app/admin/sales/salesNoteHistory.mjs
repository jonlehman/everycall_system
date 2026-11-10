function timestamp(...values) {
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function savedNoteHistory(prospect = {}) {
  const calls = prospect.savedCallNotes || prospect.history || [];
  const notes = calls.filter(call => String(call.outcomeNotes || "").trim()).map((call, index) => ({
    id: `call:${call.id || call.salesCallId || index}`,
    callId: call.id || call.salesCallId,
    body: call.outcomeNotes,
    enteredAt: timestamp(call.outcomeRecordedAt, call.startedAt, call.createdAt),
  }));
  for (const [index, note] of (prospect.savedNotes || []).entries()) {
    if (!String(note.body || "").trim()) continue;
    if (note.salesCallId && notes.some(item => item.callId === note.salesCallId && item.body.trim() === note.body.trim())) continue;
    notes.push({ id: `note:${note.noteId || index}`, body: note.body, enteredAt: timestamp(note.createdAt) });
  }
  const legacy = typeof prospect.note === "string" ? prospect.note : "";
  if (legacy.trim() && !notes.some(note => note.body.trim() === legacy.trim())) {
    notes.push({ id: "legacy", body: legacy, enteredAt: null });
  }
  return notes.sort((a, b) => (a.enteredAt ?? Infinity) - (b.enteredAt ?? Infinity));
}
