import { sendTransactionalEmail } from "./mail.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

export async function processKnowledgeHeartFlagEmails(db, { limit = 50 } = {}) {
  const eligible = await db.query(
    `SELECT flag.id, flag.tenant_key, flag.slot_index, flag.flag_type,
            flag.payload, flag.raised_at,
            ARRAY_AGG(DISTINCT users.email) FILTER (WHERE users.email IS NOT NULL) AS recipients
     FROM kb_selection_flags flag
     INNER JOIN tenant_users users
       ON users.tenant_key = flag.tenant_key
      AND users.status = 'active'
      AND users.role IN ('owner', 'admin')
     LEFT JOIN kb_flag_email_deliveries delivery ON delivery.flag_id = flag.id
     WHERE flag.severity = 'HIGH'
       AND flag.resolved_at IS NULL
       AND flag.raised_at <= NOW() - INTERVAL '14 days'
       AND COALESCE(delivery.status, '') NOT IN ('sending', 'sent')
     GROUP BY flag.id
     ORDER BY flag.raised_at ASC
     LIMIT $1`,
    [Math.max(1, Math.min(200, Number(limit || 50)))]
  );
  const results = [];
  for (const flag of eligible.rows || []) {
    const recipients = Array.isArray(flag.recipients) ? flag.recipients.map(normalizeText).filter(Boolean) : [];
    if (!recipients.length) {
      results.push({ flagId: flag.id, status: "no_recipient" });
      continue;
    }
    const claimed = await db.query(
      `INSERT INTO kb_flag_email_deliveries (
         flag_id, tenant_key, status, attempt_count, created_at, updated_at
       ) VALUES ($1, $2, 'sending', 1, NOW(), NOW())
       ON CONFLICT (flag_id)
       DO UPDATE SET status = 'sending', attempt_count = kb_flag_email_deliveries.attempt_count + 1,
                     updated_at = NOW(), last_error = NULL
       WHERE kb_flag_email_deliveries.status IN ('pending', 'failed')
       RETURNING flag_id`,
      [flag.id, flag.tenant_key]
    );
    if (!claimed.rowCount) continue;
    try {
      const approved = normalizeText(flag.payload?.approved?.approved_spoken_text);
      const website = normalizeText(flag.payload?.website?.spoken_text);
      const response = await sendTransactionalEmail({
        to: recipients,
        category: "knows_by_heart_high_flag",
        subject: "Review what your EveryCall receptionist says",
        text: [
          "Your website now says something different from a fact you approved for your receptionist.",
          approved ? `Your receptionist still knows: ${approved}` : "Your approved fact is still active.",
          website ? `Your website now says: ${website}` : "Open Receptionist Training to review the change.",
          "Nothing was changed automatically. Sign in to EveryCall and choose Keep, Update, or Remove."
        ].join("\n\n"),
        idempotencyKey: `kb-flag-${flag.id}`
      });
      await db.query(
        `UPDATE kb_flag_email_deliveries
         SET status = 'sent', provider_message_id = $2, sent_at = NOW(), updated_at = NOW()
         WHERE flag_id = $1`,
        [flag.id, normalizeText(response?.id) || null]
      );
      await db.query(`UPDATE kb_selection_flags SET notified_at = NOW() WHERE id = $1`, [flag.id]);
      results.push({ flagId: flag.id, status: "sent" });
    } catch (error) {
      await db.query(
        `UPDATE kb_flag_email_deliveries
         SET status = 'failed', last_error = $2, updated_at = NOW()
         WHERE flag_id = $1`,
        [flag.id, normalizeText(error?.message || "mail_send_failed").slice(0, 800)]
      );
      results.push({ flagId: flag.id, status: "failed", error: normalizeText(error?.message) });
    }
  }
  return { processed: results.length, results };
}
