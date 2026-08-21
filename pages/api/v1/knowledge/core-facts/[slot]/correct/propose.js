import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest,
  requirePostIdempotency
} from "../../../../../_lib/knowledgeHeartApi.js";
import { proposeKnowledgeHeartCorrection } from "../../../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: true, allowedMethods: ["POST"] });
    if (!context || !requirePostIdempotency(context, res)) return;
    const result = await proposeKnowledgeHeartCorrection(context.pool, {
      tenantKey: context.tenantKey,
      slotIndex: req.query?.slot,
      selectionVersion: context.body.selection_version ?? context.body.selectionVersion,
      statement: context.body.statement,
      flagId: context.body.flag_id ?? context.body.flagId,
      actor: context.actor,
      requestId: context.requestId,
      idempotencyKey: context.idempotencyKey
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
