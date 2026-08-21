import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest
} from "../../../../_lib/knowledgeHeartApi.js";
import { commitKnowledgeHeartCreation } from "../../../../_lib/knowledgeHeartCatalog.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: true, allowedMethods: ["PUT"] });
    if (!context) return;
    const result = await commitKnowledgeHeartCreation(context.pool, {
      tenantKey: context.tenantKey,
      selectionVersion: context.body.selection_version ?? context.body.selectionVersion,
      proposalToken: context.body.proposal_token ?? context.body.proposalToken,
      slotIndex: context.body.slot_index ?? context.body.slotIndex,
      slotConflictResolutions: context.body.slot_conflict_resolutions ?? context.body.slotConflictResolutions,
      actor: context.actor,
      requestId: context.requestId
    });
    return res.status(200).json(result);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
