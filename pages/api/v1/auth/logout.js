import { deleteSession, clearSessionCookie } from "../../_lib/auth.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method_not_allowed" });
    }
    await deleteSession(req);
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "auth_logout_error", message: err?.message || "unknown" });
  }
}
