import { assertSalesProspectOwner } from "../../../../_lib/salesDialer.js";
import crypto from "node:crypto";
import { buildOutboundSalesDemoRealtimeInstructions } from "../../../../_lib/demoRealtimeSession.js";
import {
  createSalesCallSession,
  getReadySalesDemoProfile,
  getSalesOperatorSettings,
  getSalesProspect,
  getSalesCallSession,
  salesError
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesOwnedProspectMutation,
  salesIdempotencyKey,
  salesRequestBody,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";
import { buildSalesWebrtcCallOptions } from "../../../../_lib/salesWebrtc.js";
import { buildSalesCallView } from "../../../../_lib/salesCallView.js";

function salesCallId() {
  return `sales_call_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const body = salesRequestBody(req);
    const request = { prospectId: String(body.prospectId || "").trim(), phoneE164: String(body.phoneE164 || "").trim(), contactId: body.contactId, numberId: body.numberId, expectedRowVersion: body.expectedRowVersion };
    const result = await runSalesOwnedProspectMutation(req, context, request.prospectId, {
      callReservation: true,
      scope: "sales.call.create",
      request,
      action: "sales.call.created",
      auditDetails: (response) => ({
        prospectId: request.prospectId,
        salesCallId: response.body?.call?.salesCallId || null
      })
    }, async (db) => {
      const [prospect, demoProfile, operatorSettings] = await Promise.all([
        getSalesProspect(db, request.prospectId),
        getReadySalesDemoProfile(db, request.prospectId),
        getSalesOperatorSettings(db, context.admin.id)
      ]);
      if (!prospect) {
        throw salesError("prospect_not_found", "Prospect not found.", 404);
      }
      await assertSalesProspectOwner(db,request.prospectId,context.admin.id,{allowUnassigned:context.session.role==='admin'});
      const dialedNumber = request.phoneE164;
      if (!demoProfile) {
        throw salesError("sales_demo_not_ready", "The prospect demo must be ready before calling.", 409);
      }
      if (operatorSettings && !operatorSettings.active) {
        throw salesError("sales_operator_inactive", "Browser calling is disabled for this operator.", 403);
      }

      const id = salesCallId();
      const businessName = demoProfile.businessName || prospect.businessName;
      const callerIdNumber = operatorSettings?.callerIdNumber
        || process.env.SALES_TELNYX_CALLER_ID;
      // This owned transaction commits only after startup options are valid.
      // The reservation resolves legacy requests under the company lock too.
      if (!String(callerIdNumber || "").trim()) throw new Error("telnyx_sales_caller_id_missing");
      const call = await createSalesCallSession(db, {
        salesCallId: id,
        prospectId: prospect.prospectId,
        contactId: request.contactId, numberId: request.numberId, expectedRowVersion: request.expectedRowVersion,
        adminUserId: context.admin.id,
        state: "connecting_browser",
        aiState: "not_started",
        idempotencyKey: salesIdempotencyKey(req),
        metadata: {
          correlation_id: id,
          source: "outbound_sales",
          business_name: businessName,
          prospect_number: dialedNumber,
          demo_profile_id: demoProfile.demoProfileId,
          realtime_instructions: buildOutboundSalesDemoRealtimeInstructions({
            ...demoProfile.demoBundle,
            businessName
          })
        }
      });

      const callOptions = buildSalesWebrtcCallOptions({
        salesCallId: call.salesCallId,
        prospectPhone: call.metadata?.prospect_number,
        callerIdNumber,
        callerName: operatorSettings?.displayName || "EveryCall"
      });
      const view = await buildSalesCallView(db, call, {
        webrtc: { callOptions },
        operatorUserId: context.session.role === "sales" ? context.admin.id : null
      });
      return {
        status: 201,
        body: { ok: true, call: view }
      };
    });
    if (result.replayed && result.body?.call?.salesCallId) {
      const latest = await getSalesCallSession(context.pool, result.body.call.salesCallId);
      await assertSalesProspectOwner(context.pool, request.prospectId, context.admin.id, {allowUnassigned: context.session.role === 'admin'});
      const canStart = latest?.state === 'connecting_browser' && !latest.operatorCallControlId && !latest.prospectCallControlId;
      result.body.call = await buildSalesCallView(context.pool, latest, {operatorUserId: context.session.role === 'sales' ? context.admin.id : null, ...(canStart ? {webrtc: result.body.call.webrtc} : {})});
    }
    return res.status(result.replayed ? 200 : result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_create_failed");
  }
}
