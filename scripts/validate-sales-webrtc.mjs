import assert from "node:assert/strict";
import {
  buildSalesWebrtcCallOptions,
  createSalesWebrtcToken,
  resolveSalesOperatorTelephonyCredential
} from "../pages/api/_lib/salesWebrtc.js";
import { setTelnyxCallMuted } from "../app/admin/sales/telnyxBrowserClient.js";

assert.equal(
  resolveSalesOperatorTelephonyCredential({
    adminUserId: 12,
    operatorSettings: { telnyx_telephony_credential_id: "stored-credential" },
    env: {}
  }),
  "stored-credential"
);
assert.equal(
  resolveSalesOperatorTelephonyCredential({
    adminUserId: 12,
    env: {
      SALES_TELNYX_TELEPHONY_CREDENTIALS_JSON: JSON.stringify({
        12: "mapped-credential"
      }),
      SALES_TELNYX_TELEPHONY_CREDENTIAL_ID: "fallback-credential"
    }
  }),
  "mapped-credential"
);

const requests = [];
const token = await createSalesWebrtcToken({
  credentialId: "credential-1",
  env: { SALES_TELNYX_API_KEY: "test-key" },
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify("jwt-value");
      }
    };
  }
});
assert.equal(token.token, "jwt-value");
assert.equal(
  requests[0].url,
  "https://api.telnyx.com/v2/telephony_credentials/credential-1/token"
);
assert.equal(requests[0].options.method, "POST");

const options = buildSalesWebrtcCallOptions({
  salesCallId: "call-1",
  prospectPhone: "+14155550100",
  callerIdNumber: "+14155550999",
  callerName: "EveryCall Sales"
});
assert.equal(options.audio, true);
assert.equal(options.video, false);
assert.equal(options.customHeaders[0].value, "call-1");
assert.equal(options.customHeaders[1].value, "operator");

const muteEvents = [];
const fakeCall = {
  muteAudio() {
    muteEvents.push("muted");
  },
  unmuteAudio() {
    muteEvents.push("unmuted");
  }
};
assert.equal(setTelnyxCallMuted(fakeCall, true), true);
assert.equal(setTelnyxCallMuted(fakeCall, false), false);
assert.deepEqual(muteEvents, ["muted", "unmuted"]);
assert.throws(
  () => setTelnyxCallMuted(null, true),
  /no active browser call/i
);

console.log("sales WebRTC validation passed");
