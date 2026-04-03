import { getSession } from "../api/_lib/auth.js";
import { ensureTables, getPool } from "../api/_lib/db.js";
import { findCallAlertLink } from "../api/_lib/callAlertLinks.js";

export async function getServerSideProps(context) {
  const token = String(context?.params?.token || "").trim();
  const pool = getPool();
  if (!pool || !token) {
    return { notFound: true };
  }

  await ensureTables(pool);
  const link = await findCallAlertLink(pool, token);
  if (!link) {
    return { notFound: true };
  }

  const destination = `/client/calls?callSid=${encodeURIComponent(link.call_sid)}`;
  const session = await getSession(context.req);
  if (session?.role === "tenant" && String(session.tenant_key || "") === String(link.tenant_key || "")) {
    return {
      redirect: {
        destination,
        permanent: false
      }
    };
  }

  return {
    redirect: {
      destination: `/login?next=${encodeURIComponent(destination)}`,
      permanent: false
    }
  };
}

export default function CallAlertRedirectPage() {
  return null;
}
