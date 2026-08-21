import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest
} from "../../../_lib/knowledgeHeartApi.js";
import { loadKnowledgeHeartEditor } from "../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { allowedMethods: ["GET"] });
    if (!context) return;
    const state = await loadKnowledgeHeartEditor(context.pool, context.tenantKey, {
      query: req.query?.q,
      category: req.query?.category,
      cursor: req.query?.cursor,
      limit: req.query?.limit
    });
    return res.status(200).json({ ok: true, ...state });
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
