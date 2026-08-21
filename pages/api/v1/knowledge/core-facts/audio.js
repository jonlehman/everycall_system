import {
  handleKnowledgeHeartError,
  prepareKnowledgeHeartRequest
} from "../../../_lib/knowledgeHeartApi.js";
import {
  loadKnowledgeHeartAudio,
  verifyKnowledgeHeartAudioSignature
} from "../../../_lib/knowledgeHeartAudio.js";

export default async function handler(req, res) {
  try {
    const context = await prepareKnowledgeHeartRequest(req, res, { allowedMethods: ["GET"] });
    if (!context) return;
    const cacheKey = String(req.query?.cache_key || "").trim();
    const expiresAt = String(req.query?.expires || "").trim();
    const signature = String(req.query?.signature || "").trim();
    if (!verifyKnowledgeHeartAudioSignature({
      tenantKey: context.tenantKey,
      cacheKey,
      expiresAt,
      signature
    })) {
      return res.status(403).json({ ok: false, error: "kb_audio_signature_invalid" });
    }
    const audio = await loadKnowledgeHeartAudio(context.pool, context.tenantKey, cacheKey);
    if (!audio?.audio_bytes) return res.status(404).json({ ok: false, error: "kb_audio_not_found" });
    res.setHeader("Content-Type", audio.mime_type || "audio/wav");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("ETag", `\"${audio.checksum}\"`);
    return res.status(200).send(audio.audio_bytes);
  } catch (error) {
    return handleKnowledgeHeartError(res, error);
  }
}
