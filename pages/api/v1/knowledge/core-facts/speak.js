import { enforceRateLimit } from "../../../_lib/rateLimit.js";
import { writeAuditLog } from "../../../_lib/auditLog.js";
import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest,
  requirePostIdempotency
} from "../../../_lib/knowledgeHeartApi.js";
import { synthesizeKnowledgeHeartItem } from "../../../_lib/knowledgeHeartAudio.js";

function fail(res, status, error, message) {
  return res.status(status).json({ ok: false, error, message });
}

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { mutation: false, allowedMethods: ["POST"] });
    if (!context || !requirePostIdempotency(context, res)) return;
    const body = context.body;
    let rows = [];
    let mode = "text";
    if (body.all_selected === true || body.allSelected === true) {
      mode = "set";
      const result = await context.pool.query(
        `SELECT slot_index, approved_spoken_text
         FROM kb_selection WHERE tenant_key = $1 ORDER BY slot_index ASC`,
        [context.tenantKey]
      );
      rows = result.rows.map((row) => ({ slotIndex: Number(row.slot_index), text: row.approved_spoken_text }));
    } else if (body.slot_index != null || body.slotIndex != null) {
      mode = "selected";
      const slotIndex = Number(body.slot_index ?? body.slotIndex);
      const result = await context.pool.query(
        `SELECT slot_index, approved_spoken_text
         FROM kb_selection WHERE tenant_key = $1 AND slot_index = $2 LIMIT 1`,
        [context.tenantKey, slotIndex]
      );
      if (!result.rowCount) return fail(res, 404, "kb_selection_slot_not_found", "That selected fact no longer exists.");
      rows = [{ slotIndex, text: result.rows[0].approved_spoken_text }];
    } else {
      rows = [{ slotIndex: null, text: body.text }];
    }
    if (!rows.length) return res.status(200).json({ ok: true, manifest: [], cacheMisses: 0 });

    let cacheMisses = 0;
    const manifest = [];
    for (const row of rows) {
      const item = await synthesizeKnowledgeHeartItem(context.pool, {
        tenantKey: context.tenantKey,
        text: row.text,
        onCacheMiss: async () => {
          cacheMisses += 1;
          const allowance = mode === "text"
            ? { scope: "kb.speak.arbitrary_miss", maxHits: 20 }
            : { scope: "kb.speak.selected_miss", maxHits: 80 };
          const limit = await enforceRateLimit(res, context.pool, {
            scope: allowance.scope,
            key: `${context.tenantKey}:${context.session.user_id || "unknown"}`,
            maxHits: allowance.maxHits,
            windowMs: 10 * 60 * 1000,
            blockDurationMs: 30 * 60 * 1000,
            message: "Too many new voice previews. Saved previews remain available."
          });
          if (limit?.limited) {
            const error = new Error("kb_speak_rate_limited");
            error.statusCode = 429;
            throw error;
          }
        }
      });
      manifest.push({ slotIndex: row.slotIndex, ...item });
    }
    const requestedContext = String(body.playback_context || body.playbackContext || "").trim();
    const playbackContext = ["onboarding", "section_02", "row", "edit"].includes(requestedContext)
      ? requestedContext
      : mode;
    await writeAuditLog(context.pool, {
      tenantKey: context.tenantKey,
      actor: context.actor,
      action: "knowledge.core_facts.played",
      details: { playbackContext, itemCount: manifest.length, cacheMisses }
    });
    return res.status(200).json({ ok: true, manifest, cacheMisses });
  } catch (error) {
    if (res.headersSent) return;
    return handleKnowledgeHeartError(res, error);
  }
}
