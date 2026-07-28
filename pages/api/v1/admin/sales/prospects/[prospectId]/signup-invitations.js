import { sendTransactionalEmail } from "../../../../../_lib/mail.js";
import {
  claimSalesSignupInvitationDelivery,
  completeSalesSignupInvitationDelivery,
  createSalesSignupInvitation,
  releaseSalesSignupInvitationDelivery,
  salesError
} from "../../../../../_lib/salesRepository.js";
import {
  requireSalesAdmin,
  salesAppBaseUrl,
  salesIdempotencyKey,
  salesRequestBody,
  sendSalesApiError,
  writeSalesAdminAudit
} from "../../../../../_lib/salesApi.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  try {
    const context = await requireSalesAdmin(req, res);
    if (!context) return;
    const prospectId = String(req.query?.prospectId || "").trim();
    const body = salesRequestBody(req);
    const request = {
      salesCallId: body.salesCallId || null,
      contactEmail: body.contactEmail || null,
      leadDeliveryEmail: body.leadDeliveryEmail || null,
      expiresInMinutes: body.expiresInMinutes
    };
    const created = await createSalesSignupInvitation(context.pool, {
      prospectId,
      ...request,
      adminUserId: context.admin.id,
      idempotencyKey: salesIdempotencyKey(req),
      appBaseUrl: salesAppBaseUrl(req)
    });
    let invitation = created.invitation;
    const claimedDelivery = await claimSalesSignupInvitationDelivery(
      context.pool,
      invitation.invitationId
    );
    if (claimedDelivery) {
      try {
        await sendTransactionalEmail({
          to: invitation.deliveryEmail,
          subject: "Finish setting up EveryCall",
          text: [
            "Thanks for taking a look at EveryCall.",
            "",
            "Use this secure link to review the prefilled information, create your password, and finish setup:",
            created.signupUrl,
            "",
            "This link is for you and expires shortly.",
            "",
            "— Jon"
          ].join("\n"),
          category: "Sales Signup"
        });
        invitation = await completeSalesSignupInvitationDelivery(
          context.pool,
          invitation.invitationId
        );
      } catch (error) {
        await releaseSalesSignupInvitationDelivery(
          context.pool,
          invitation.invitationId
        );
        throw salesError(
          "signup_invitation_delivery_failed",
          "The signup link was created, but the email could not be sent.",
          502,
          { cause: String(error?.message || "mail_send_failed").slice(0, 200) }
        );
      }
    }
    if (!created.replayed) {
      await writeSalesAdminAudit(context, "sales.signup_invitation.created", {
        prospectId,
        invitationId: created.invitation?.invitationId || null,
        salesCallId: request.salesCallId
      });
    }
    if (claimedDelivery) {
      await writeSalesAdminAudit(context, "sales.signup_invitation.sent", {
        prospectId,
        invitationId: invitation.invitationId,
        deliveryEmail: invitation.deliveryEmail
      });
    }
    return res.status(created.replayed ? 200 : 201).json({
      ok: true,
      invitation,
      replayed: created.replayed
    });
  } catch (error) {
    return sendSalesApiError(res, error, "sales_signup_invitation_create_failed");
  }
}
