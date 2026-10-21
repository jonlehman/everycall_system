import { assertSalesProspectOwner } from "../../../../_lib/salesDialer.js";
import crypto from "node:crypto";
import { buildOutboundSalesDemoRealtimeInstructions } from "../../../../_lib/demoRealtimeSession.js";
import {
  createSalesCallSession,
  getReadySalesDemoProfile,
  getSalesOperatorSettings,
  getSalesProspect,
  salesError
} from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  runSalesAdminMutation,
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
    const request = { prospectId: String(body.prospectId || "").trim(), phoneE164: String(body.phoneE164 || "").trim() };
    const result = await runSalesAdminMutation(req, context, {
      scope: "sales.call.create",
      request,
      action: "sales.call.created",
      auditDetails: (response) => ({
        prospectId: request.prospectId,
        salesCallId: response.body?.call?.salesCallId || null
      })
    }, async () => {
      const [prospect, demoProfile, operatorSettings] = await Promise.all([
        getSalesProspect(context.pool, request.prospectId),
        getReadySalesDemoProfile(context.pool, request.prospectId),
        getSalesOperatorSettings(context.pool, context.admin.id)
      ]);
      if (!prospect) {
        throw salesError("prospect_not_found", "Prospect not found.", 404);
      }
      await assertSalesProspectOwner(context.pool,request.prospectId,context.admin.id,{allowUnassigned:context.session.role==='admin'});
      const dialedNumber = request.phoneE164 || prospect.phoneE164;
      if (!prospect.numbers.some(n=>n.phoneE164===dialedNumber)) throw salesError('invalid_dialed_number','Choose a number on this prospect.',400);
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
      // Validate browser startup options before taking the durable reservation.
      buildSalesWebrtcCallOptions({
        salesCallId: id, prospectPhone: dialedNumber, callerIdNumber,
        callerName: operatorSettings?.displayName || "EveryCall"
      });
      const call = await createSalesCallSession(context.pool, {
        salesCallId: id,
        prospectId: prospect.prospectId,
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
        prospectPhone: dialedNumber,
        callerIdNumber,
        callerName: operatorSettings?.displayName || "EveryCall"
      });
      const view = await buildSalesCallView(context.pool, call, {
        webrtc: { callOptions },
        operatorUserId: context.session.role === "sales" ? context.admin.id : null
      });
      return {
        status: 201,
        body: { ok: true, call: view }
      };
    });
    return res.status(result.replayed ? 200 : result.status).json(result.body);
  } catch (error) {
    return sendSalesApiError(res, error, "sales_call_create_failed");
  }
}
