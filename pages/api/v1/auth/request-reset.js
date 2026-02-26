import crypto from "crypto";
import { ensureTables, getPool } from "../../_lib/db.js";
import { MailtrapClient } from "mailtrap";

const mailtrapToken = process.env.MAILTRAP_TOKEN;
const mailtrapSender = {
  email: process.env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co",
  name: process.env.MAILTRAP_SENDER_NAME || "EveryCall"
};
const mailtrapClient = mailtrapToken ? new MailtrapClient({ token: mailtrapToken }) : null;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }

    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }
    await ensureTables(pool);

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "tenant");
    if (!email) {
      return res.status(400).json({ error: "missing_email" });
    }

    let user = null;
    if (role === "admin") {
      const row = await pool.query(`SELECT id, email FROM admin_users WHERE email = $1 LIMIT 1`, [email]);
      user = row.rows[0] || null;
    } else {
      const row = await pool.query(`SELECT id, email, tenant_key FROM tenant_users WHERE email = $1 LIMIT 1`, [email]);
      user = row.rows[0] || null;
    }

    if (!user) {
      return res.status(200).json({ ok: true });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_tokens (token, token_type, user_id, email, tenant_key, expires_at)
       VALUES ($1, 'password_reset', $2, $3, $4, $5)`,
      [token, user.id, user.email, user.tenant_key || null, expiresAt.toISOString()]
    );

    let delivered = false;
    let deliveryError = null;
    if (mailtrapClient) {
      const baseUrl = process.env.APP_BASE_URL || "https://everycallsystem.vercel.app";
      const resetUrl = `${baseUrl}/reset?token=${encodeURIComponent(token)}`;
      try {
        await mailtrapClient.send({
          from: mailtrapSender,
          to: [{ email }],
          subject: "Reset your EveryCall password",
          text: `Reset your password using this link:\n${resetUrl}\n\nThis link expires in 1 hour.`,
          category: "Password Reset"
        });
        delivered = true;
      } catch (err) {
        deliveryError = err?.message || "mailtrap_failed";
      }
    }

    return res.status(200).json({ ok: true, delivered, deliveryError });
  } catch (err) {
    return res.status(500).json({ error: "reset_request_error", message: err?.message || "unknown" });
  }
}
