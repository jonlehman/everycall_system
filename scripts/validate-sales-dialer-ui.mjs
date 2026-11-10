import assert from "node:assert/strict";
import {
  dialerPhase,
  orderNumbers,
  renderScript,
  elapsed,
  mayQuickAdvance,
  callbackTime,
  suggestedAsks,
  safeExternalUrl,
  HANDOFF,
} from "../app/admin/sales/dialerState.mjs";
const { SALES_DISPOSITIONS, canonicalSalesOutcome, callDispositions } = await import('../lib/salesDispositions.js');
const { parseSalesSignupDollars } = await import('../lib/salesSignupAmount.js');
assert.equal(SALES_DISPOSITIONS.length,8);
assert.equal(canonicalSalesOutcome(['customer','callback_requested','do_not_call']),'do_not_call');
assert.equal(canonicalSalesOutcome(['callback_requested','wrong_number']),'wrong_number');
assert.equal(canonicalSalesOutcome(['customer','prospect']),'connected_no_demo');
assert.deepEqual(callDispositions({outcome:'voicemail'}),['voicemail']);
assert.deepEqual(callDispositions({outcome:'paid',metadata:{dispositions:['customer','prospect']}}),['customer','prospect']);
assert.equal(parseSalesSignupDollars('1'),100);assert.equal(parseSalesSignupDollars('12.34'),1234);
assert.equal(parseSalesSignupDollars('999999.99'),99999999);
for(const value of ['','0.99','1.001','1e2','-1','Infinity','1000000'])assert.equal(parseSalesSignupDollars(value),null);
assert.equal(dialerPhase(null), "READY");
assert.equal(dialerPhase({ id: "1" }), "DIALING");
assert.equal(dialerPhase({ id: "1", prospectConnected: true }), "TALK");
assert.equal(dialerPhase({ id: "1", aiLive: true }), "DEMO");
assert.equal(dialerPhase({ id: "1", terminal: true, aiLive: true }), "WRAPUP");
const numbers = [
  { phoneE164: "shop", type: "shop", lastConnectedAt: "2026-10-20" },
  { phoneE164: "cell", type: "cell" },
  { phoneE164: "other", type: "other" },
];
assert.deepEqual(
  orderNumbers(numbers).map((n) => n.phoneE164),
  ["shop", "cell", "other"],
);
assert.equal(numbers[0].phoneE164, "shop");
assert.equal(
  renderScript("Hi {first_name}, {rep_name} at {business_name}.", {
    first_name: "Mira",
    rep_name: "Jon",
    business_name: "Test Co",
  }),
  "Hi Mira, Jon at Test Co.",
);
assert.match(HANDOFF, /she already knows everything from the main pages/);
assert.equal(elapsed("2026-10-20T12:00:00Z", "2026-10-20T12:01:12Z"), "1:12");
assert.equal(elapsed(null), "0:00");
assert.equal(elapsed("invalid"), "0:00");
assert.equal(
  mayQuickAdvance({ call: { terminal: true }, outcome: "no_answer", note: "" }),
  false,
);
assert.equal(
  mayQuickAdvance({
    call: { terminal: false },
    outcome: "no_answer",
    note: "",
  }),
  false,
);
assert.equal(
  mayQuickAdvance({
    call: { terminal: true },
    outcome: "no_answer",
    note: "Useful note",
  }),
  false,
);
assert.equal(
  mayQuickAdvance({
    call: { terminal: true },
    outcome: "do_not_call",
    note: "",
  }),
  false,
);
assert.ok(new Date(callbackTime("tomorrow_am", new Date())) > new Date());
assert.equal(safeExternalUrl("javascript:alert(1)"), "");
assert.equal(safeExternalUrl("https://example.com"), "https://example.com/");
assert.equal(
  suggestedAsks({
    coreFacts: [{ category: "hours" }],
    pitchFlags: ["No after-hours coverage listed"],
  }).length,
  2,
);
assert.deepEqual(suggestedAsks({ coreFacts: [] }), []);
console.log("Sales dialer state validation passed");
const { parseCsv, guessMappings, validateMappedRows } = await import(
  "../app/admin/sales/csvImport.js"
);
const csv = parseCsv(
  "Business,Phone,Cell phone,Shop phone,Other phone,Contact role,Metro,Pitch flags,Permission,Timezone\nCedar,5035550121,5035550122,5035550121,5035550123,Owner,Portland,No after-hours coverage listed;Owner operated,yes,America/Los_Angeles",
);
const mapped = validateMappedRows(csv.rows, guessMappings(csv.headers));
assert.equal(mapped.errors.length, 0);
assert.equal(mapped.validRecords[0].cell_phone, "5035550122");
assert.equal(mapped.validRecords[0].shop_phone, "5035550121");
assert.equal(mapped.validRecords[0].other_phone, "5035550123");
assert.equal(mapped.validRecords[0].contact_role, "Owner");
assert.deepEqual(mapped.validRecords[0].pitch_flags, [
  "No after-hours coverage listed",
  "Owner operated",
]);
console.log("Sales dialer CSV field preservation passed");
