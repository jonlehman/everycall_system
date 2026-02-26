import crypto from "crypto";
import { ensureTables, getPool } from "../../_lib/db.js";
import { requireSession, resolveTenantKey } from "../../_lib/auth.js";
import { MailtrapClient } from "mailtrap";

function getTenantKey(req) {
  return String(req.query?.tenantKey || "default");
}

const mailtrapToken = process.env.MAILTRAP_TOKEN;
const mailtrapSender = {
  email: process.env.MAILTRAP_SENDER_EMAIL || "hello@demomailtrap.co",
  name: process.env.MAILTRAP_SENDER_NAME || "EveryCall"
};

const mailtrapClient = mailtrapToken ? new MailtrapClient({ token: mailtrapToken }) : null;

async function sendInviteEmail({ tenantKey, name, email, role }) {
  if (!mailtrapClient) return;
  const baseUrl = process.env.APP_BASE_URL || "https://everycallsystem.vercel.app";

  const subject = `You're invited to EveryCall (${tenantKey})`;
  const token = crypto.randomBytes(24).toString("hex");
  const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  const text = [
    `Hi ${name},`,
    "",
    `You've been invited to join the EveryCall workspace for tenant "${tenantKey}".`,
    `Role: ${role}.`,
    "",
    "Accept your invite here:",
    inviteUrl,
    "",
    "If you have questions, reply to this email."
  ].join("\n");

  const pool = getPool();
  if (pool) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_tokens (token, token_type, email, tenant_key, expires_at)
       VALUES ($1, 'invite', $2, $3, $4)`,
      [token, email, tenantKey, expiresAt.toISOString()]
    );
  }

  await mailtrapClient.send({
    from: mailtrapSender,
    to: [{ email }],
    subject,
    text,
    category: "Invite"
  });
}

export default async function handler(req, res) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "database_unavailable" });
    }

    await ensureTables(pool);

    const session = await requireSession(req, res);
    if (!session) return;
    const tenantKey = resolveTenantKey(session, getTenantKey(req));

    if (req.method === "GET") {
      const rows = await pool.query(
        `SELECT id, name, email, role, status
         FROM tenant_users
         WHERE tenant_key = $1
         ORDER BY id ASC`,
        [tenantKey]
      );
      return res.status(200).json({ users: rows.rows });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "object" && req.body ? req.body : {};
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim();
      if (!name || !email) {
        return res.status(400).json({ error: "missing_fields" });
      }
      const role = String(body.role || "member");
      const status = String(body.status || "invited");
      await pool.query(
        `INSERT INTO tenant_users (tenant_key, name, email, role, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email)
         DO UPDATE SET tenant_key = EXCLUDED.tenant_key,
                       name = EXCLUDED.name,
                       role = EXCLUDED.role,
                       status = EXCLUDED.status`,
        [tenantKey, name, email, role, status]
      );
      try {
        await sendInviteEmail({ tenantKey, name, email, role });
      } catch (mailErr) {
        // Email failure should not block user creation.
        console.error("mailtrap_invite_failed", mailErr?.message || mailErr);
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    return res.status(500).json({ error: "tenant_users_error", message: err?.message || "unknown" });
  }
}
