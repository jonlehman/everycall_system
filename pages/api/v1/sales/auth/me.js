import { ensureTables, getPool } from "../../../_lib/db.js";
import { getAdminActor, getSalesSession, getSession, hasSalesSessionCookie } from "../../../_lib/auth.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const pool = getPool();
    if (!pool) return res.status(500).json({ error: "database_unavailable" });
    await ensureTables(pool);
    const salesCookiePresent = hasSalesSessionCookie(req);
    const session = salesCookiePresent ? await getSalesSession(req) : await getSession(req);
    if (!session || !["sales", "admin"].includes(session.role)) {
      return res.status(200).json({ authenticated: false });
    }
    const user = session.role === "sales" ? session.user : await getAdminActor(session);
    if (!user) return res.status(200).json({ authenticated: false });
    return res.status(200).json({
      authenticated: true, role: session.role,
      user: { id: user.id, email: user.email, username: user.username || "" }
    });
  } catch {
    return res.status(500).json({ error: "sales_auth_me_error" });
  }
}
