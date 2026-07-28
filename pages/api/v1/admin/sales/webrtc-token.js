import {
  createSalesWebrtcToken,
  resolveSalesOperatorTelephonyCredential
} from "../../../_lib/salesWebrtc.js";
import { getSalesOperatorSettings, salesError } from "../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError
} from "../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const settings = await getSalesOperatorSettings(context.pool, context.admin.id);
    if (settings && !settings.active) {
      throw salesError("sales_operator_inactive", "Browser calling is disabled for this operator.", 403);
    }
    const credentialId = resolveSalesOperatorTelephonyCredential({
      adminUserId: context.admin.id,
      operatorSettings: settings
    });
    const token = await createSalesWebrtcToken({ credentialId });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      token: token.token,
      expiresInSeconds: token.expiresInSeconds
    });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_webrtc_token_failed");
  }
}
