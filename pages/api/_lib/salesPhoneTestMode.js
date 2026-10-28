// Private backups live in dedicated DB columns and are never included in status/audit payloads.
export const SALES_TEST_NUMBERS = Object.freeze([
  { phoneE164: '+14252300121', label: 'Owner test desk', type: 'shop' },
  { phoneE164: '+14256154640', label: 'Owner test cell', type: 'cell' }
]);
const terminal = "'closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled'";
function conflict(code, message) { return Object.assign(new Error(message), { code, statusCode: 409 }); }

export async function getSalesPhoneTestMode(pool) {
  const result = await pool.query(`SELECT phone_test_mode, (SELECT count(*) FROM sales_prospects WHERE test_original_phone_e164 IS NOT NULL) AS backed_up_count FROM sales_dialer_config WHERE id=TRUE`);
  if (!result.rowCount) throw conflict('sales_test_config_missing', 'Sales settings are unavailable.');
  return { enabled: Boolean(result.rows[0].phone_test_mode), backedUpCount: Number(result.rows[0].backed_up_count), numbers: SALES_TEST_NUMBERS };
}

export async function setSalesPhoneTestMode(pool, enabled, { audit = null } = {}) {
  if (typeof enabled !== 'boolean') throw Object.assign(new Error('Choose enable or restore.'), { code: 'invalid_phone_test_mode', statusCode: 400 });
  const db = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await db.query('BEGIN');
    const config = await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR UPDATE');
    if (!config.rowCount) throw conflict('sales_test_config_missing', 'Sales settings are unavailable.');
    if (config.rows[0].phone_test_mode !== enabled) {
      const active = await db.query(`SELECT 1 FROM sales_call_sessions WHERE state NOT IN (${terminal}) LIMIT 1`);
      const incoming = await db.query("SELECT 1 FROM sales_incoming_calls WHERE state='routing' OR (state='ringing' AND ring_expires_at>NOW()) LIMIT 1");
      const deliveries = await db.query("SELECT 1 FROM sales_checkout_sessions WHERE status IN ('creating','created','sending','delivery_uncertain') UNION ALL SELECT 1 FROM sales_setup_bookings WHERE status='reserving' LIMIT 1");
      if (active.rowCount || incoming.rowCount || deliveries.rowCount) throw conflict('sales_test_activity_pending', 'End all Sales calls and reconcile pending calls, checkout deliveries, and bookings before changing phone test mode.');
      await db.query("SELECT set_config('everycall.sales_test_transition','on',TRUE)");
      if (enabled) {
        const orphan = await db.query('SELECT 1 FROM sales_prospects WHERE test_original_phone_e164 IS NOT NULL LIMIT 1');
        if (orphan.rowCount) throw conflict('sales_test_backup_conflict', 'Saved phone backups need reconciliation before enabling test mode.');
        await db.query(`UPDATE sales_prospects SET test_original_phone_e164=phone_e164, test_original_numbers_json=numbers_json, phone_e164=$1, numbers_json=$2::jsonb, row_version=row_version+1, updated_at=NOW()`, [SALES_TEST_NUMBERS[0].phoneE164, JSON.stringify(SALES_TEST_NUMBERS)]);
      } else {
        await db.query(`UPDATE sales_prospects SET phone_e164=test_original_phone_e164, numbers_json=test_original_numbers_json, test_original_phone_e164=NULL, test_original_numbers_json=NULL, row_version=row_version+1, updated_at=NOW() WHERE test_original_phone_e164 IS NOT NULL`);
      }
      await db.query('UPDATE sales_dialer_config SET phone_test_mode=$1,updated_at=NOW() WHERE id=TRUE', [enabled]);
      await db.query("SELECT set_config('everycall.sales_test_transition','off',TRUE)");
    }
    const status = await getSalesPhoneTestMode(db);
    if (audit) await audit(db,status);
    await db.query('COMMIT');
    return status;
  } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; }
  finally { if (db !== pool) db.release(); }
}

export function assertSalesNotTestCall(call, prospect) {
  if (call?.metadata?.phone_test_mode || prospect?.phoneTestMode) {
    throw conflict('sales_phone_test_external_action_blocked', 'Checkout delivery and real setup bookings are unavailable for test calls. Start a new call after restoring original numbers.');
  }
}
