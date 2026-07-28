import assert from "node:assert/strict";
import {
  buildSmartleadLead,
  resolveSmartleadCampaign,
  routeSalesOutcomeToSmartlead
} from "../pages/api/_lib/salesSmartlead.js";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    async text() {
      return JSON.stringify(body);
    }
  };
}

const env = {
  SMARTLEAD_API_KEY: "test-key",
  SMARTLEAD_SALES_DEMO_CAMPAIGN_ID: "321"
};

assert.deepEqual(resolveSmartleadCampaign("demo completed", env), {
  outcome: "demo_completed",
  campaignId: 321,
  envName: "SMARTLEAD_SALES_DEMO_CAMPAIGN_ID"
});

const lead = buildSmartleadLead({
  id: "prospect-1",
  contactName: "Mike Jones",
  contactEmail: "MIKE@example.com",
  businessName: "Mike's Appliance",
  phone: "+14155550101",
  websiteUrl: "https://example.com"
}, "demo_completed");
assert.equal(lead.email, "mike@example.com");
assert.equal(lead.first_name, "Mike");
assert.equal(lead.last_name, "Jones");
assert.equal(lead.custom_fields.everycall_call_outcome, "demo_completed");

const requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url: String(url), options });
  return response(200, {
    success: true,
    added_count: 1,
    lead_ids: [456]
  });
};

const routed = await routeSalesOutcomeToSmartlead({
  prospect: {
    id: "prospect-1",
    contactEmail: "mike@example.com",
    contactName: "Mike Jones",
    businessName: "Mike's Appliance",
    permissionGranted: true
  },
  outcome: "demo_completed",
  fetchImpl,
  env
});
assert.equal(routed.routed, true);
assert.equal(routed.campaignId, 321);
assert.equal(routed.leadId, 456);
assert.equal(requests.length, 1);
assert.match(requests[0].url, /\/campaigns\/321\/leads\?/);
assert.doesNotMatch(requests[0].options.body, /test-key/);
const addBody = JSON.parse(requests[0].options.body);
assert.equal(addBody.settings.ignore_unsubscribe_list, false);
assert.equal(addBody.settings.ignore_global_block_list, false);

const denied = await routeSalesOutcomeToSmartlead({
  prospect: {
    contactEmail: "mike@example.com",
    permissionGranted: false
  },
  outcome: "demo_completed",
  fetchImpl,
  env
});
assert.equal(denied.routed, false);
assert.equal(denied.reason, "permission_not_granted");
assert.equal(requests.length, 1);

const suppressedRequests = [];
const suppressed = await routeSalesOutcomeToSmartlead({
  prospect: {
    contactEmail: "stop@example.com",
    permissionGranted: true
  },
  outcome: "do_not_call",
  fetchImpl: async (url, options) => {
    suppressedRequests.push({ url: String(url), options });
    return response(200, { success: true });
  },
  env
});
assert.equal(suppressed.suppressed, true);
assert.equal(suppressed.method, "block_list");
assert.match(suppressedRequests[0].url, /\/leads\/block-list\?/);
assert.deepEqual(JSON.parse(suppressedRequests[0].options.body), {
  emails: ["stop@example.com"]
});

const staleCampaignRequests = [];
const staleCampaign = await routeSalesOutcomeToSmartlead({
  prospect: {
    contactEmail: "converted@example.com",
    permissionGranted: true,
    status: "signup_completed"
  },
  outcome: "demo_completed",
  fetchImpl: async (url, options) => {
    staleCampaignRequests.push({ url: String(url), options });
    return response(200, { success: true });
  },
  env
});
assert.equal(staleCampaign.routed, false);
assert.equal(staleCampaign.reason, "prospect_suppressed");
assert.equal(staleCampaignRequests.length, 0);

const pausedRequests = [];
const paused = await routeSalesOutcomeToSmartlead({
  prospect: {
    smartleadCampaignId: 321,
    smartleadLeadId: 456
  },
  outcome: "signup_completed",
  fetchImpl: async (url, options) => {
    pausedRequests.push({ url: String(url), options });
    return response(200, { ok: true });
  },
  env
});
assert.equal(paused.paused, true);
assert.match(pausedRequests[0].url, /\/campaigns\/321\/leads\/456\/pause\?/);

console.log("sales Smartlead validation passed");
