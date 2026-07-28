import { getSalesSignupInvitation } from "../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  sendSalesApiError
} from "../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const invitation = await getSalesSignupInvitation(
      context.pool,
      req.query?.invitationId
    );
    if (!invitation) {
      return res.status(404).json({ ok: false, error: "signup_invitation_not_found" });
    }
    return res.status(200).json({ ok: true, invitation });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_signup_invitation_load_failed");
  }
}
