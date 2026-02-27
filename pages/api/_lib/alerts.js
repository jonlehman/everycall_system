export async function getSharedSmsNumber(pool) {
  const row = await pool.query(
    `SELECT telnyx_sms_number
     FROM system_config
     WHERE id = 1`
  );
  return row.rows[0]?.telnyx_sms_number || null;
}

export function buildCallSummarySms({ tenantName, caller, callbackNumber, timeRequested }) {
  const parts = [
    `New call summary for ${tenantName}:`,
    caller ? `Caller: ${caller}` : null,
    callbackNumber ? `Callback: ${callbackNumber}` : null,
    timeRequested ? `Time requested: ${timeRequested}` : null
  ].filter(Boolean);
  return parts.join(" ");
}
