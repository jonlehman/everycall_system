import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest
} from "../../../../_lib/knowledgeHeartApi.js";
import { updateKnowledgeHeartWording } from "../../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: true, allowedMethods: ["PUT"] });
    if (!context) return;
    const result = await updateKnowledgeHeartWording(context.pool, {
      tenantKey: context.tenantKey,
      slotIndex: req.query?.slot,
      selectionVersion: context.body.selection_version ?? context.body.selectionVersion,
      spokenText: context.body.spoken_text ?? context.body.spokenText,
      title: context.body.title,
      actor: context.actor,
      requestId: context.requestId
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
