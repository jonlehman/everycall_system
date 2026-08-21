import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest
} from "../../../_lib/knowledgeHeartApi.js";
import { replaceKnowledgeHeartSelection } from "../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: true, allowedMethods: ["PUT"] });
    if (!context) return;
    const result = await replaceKnowledgeHeartSelection(context.pool, {
      tenantKey: context.tenantKey,
      selectionVersion: context.body.selection_version ?? context.body.selectionVersion,
      catalogRevision: context.body.catalog_revision ?? context.body.catalogRevision,
      slots: context.body.slots,
      actor: context.actor,
      requestId: context.requestId
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
