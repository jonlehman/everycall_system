import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest,
  requirePostIdempotency
} from "../../../../../_lib/knowledgeHeartApi.js";
import { resolveKnowledgeHeartFlag } from "../../../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: true, allowedMethods: ["POST"] });
    if (!context || !requirePostIdempotency(context, res)) return;
    const result = await resolveKnowledgeHeartFlag(context.pool, {
      tenantKey: context.tenantKey,
      flagId: req.query?.flagId,
      selectionVersion: context.body.selection_version ?? context.body.selectionVersion,
      action: context.body.action,
      correctedRemovalMode: context.body.corrected_removal_mode ?? context.body.correctedRemovalMode,
      actor: context.actor,
      requestId: context.requestId,
      idempotencyKey: context.idempotencyKey
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
