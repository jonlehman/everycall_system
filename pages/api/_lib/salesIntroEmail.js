import crypto from 'node:crypto';
import { SALES_INTRO_EMAIL_SUBJECT, salesIntroEmailText } from '../../../lib/salesIntroEmail.js';
import { sendTransactionalEmail } from './mail.js';
import { salesError } from './salesRepository.js';
import { SALES_UNSUPPRESSED_SQL, salesTransaction } from './salesDialer.js';
import { writeAuditLog } from './auditLog.js';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const fail = (code, message, status=409) => salesError(code, message, status);
const pending = () => fail('intro_email_delivery_pending', 'Email delivery needs verification. Do not resend; ask an administrator to check its provider status.');
async function boundedSend(mail, message, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => mail(message)),
      new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('intro_email_provider_timeout')), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}
const email = value => {
  const result = String(value || '').trim().toLowerCase();
  return result.length <= 320 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(result) ? result : null;
};

export function validateSalesIntroEmailMessage(subject, text) {
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\u0000-\u001f\u007f]/.test(subject)) {
    throw fail('invalid_email_subject', 'Enter a subject of 1–200 characters without line breaks.', 400);
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw fail('invalid_email_text', 'Enter an email message of 1–12,000 characters.', 400);
  }
  return {subject, text};
}

async function assertSchema(db) {
  if (!(await db.query("SELECT to_regclass('sales_intro_email_deliveries') AS name")).rows[0]?.name) {
    throw fail('intro_email_schema_not_ready', 'Introduction email is not available until its reviewed database migration is installed.', 503);
  }
}

// All callers use this lock order. Hold these locks through dispatch so edits,
// ownership changes and phone-test transitions cannot change the reviewed target.
async function context(db, {prospectId, contactId, repId, isAdmin=false, salesCallId=null,authenticatedSession}) {
  const config = (await db.query('SELECT phone_test_mode FROM sales_dialer_config WHERE id=TRUE FOR SHARE')).rows[0];
  if (!config) throw fail('sales_test_config_missing', 'Sales settings are unavailable.');
  const actor = (await db.query('SELECT id,email,role FROM admin_users WHERE id=$1 FOR UPDATE', [repId])).rows[0];
  if (!authenticatedSession?.id || authenticatedSession.role !== (isAdmin?'admin':'sales')) throw fail('unauthorized','Your session is no longer valid. Sign in again.',401);
  const session=(await db.query('SELECT user_id,role,tenant_key,expires_at>clock_timestamp() AS valid FROM sessions WHERE id=$1 FOR SHARE',[authenticatedSession.id])).rows[0];
  if (!session?.valid || session.tenant_key || Number(session.user_id)!==Number(repId) || session.role!==authenticatedSession.role) throw fail('unauthorized','Your session is no longer valid. Sign in again.',401);
  const admin = isAdmin && ['admin','super_admin'].includes(actor?.role);
  if (!actor || (!admin && (actor.role !== 'sales' || !(await db.query('SELECT 1 FROM sales_operator_settings WHERE admin_user_id=$1 AND active=TRUE FOR SHARE', [repId])).rowCount))) {
    throw fail('prospect_forbidden', 'Your Sales access is no longer available.', 403);
  }
  const prospect = (await db.query(`SELECT p.*,${SALES_UNSUPPRESSED_SQL} AS unsuppressed FROM sales_prospects p WHERE prospect_id=$1 FOR UPDATE`, [prospectId])).rows[0];
  if (!prospect) throw fail('prospect_not_found', 'Company not found.', 404);
  if (!admin && Number(prospect.assigned_rep_user_id) !== Number(repId)) throw fail('prospect_forbidden', 'This company belongs to another rep.', 403);
  if (config.phone_test_mode || prospect.test_original_phone_e164 != null) throw fail('sales_phone_test_external_action_blocked', 'Restore original Sales phones before sending introduction emails.');
  if (!prospect.unsuppressed || prospect.do_not_call || prospect.suppressed || prospect.email_suppressed_at || ['removed','deleted','not_interested','do_not_call'].includes(prospect.status)) {
    throw fail('prospect_suppressed', 'This company has opted out or is unavailable for email.');
  }
  // Calling permission and email permission are separate. Explicit confirmation
  // below is scoped to this selected email; it never grants campaign permission.
  if (!contactId) throw fail('contact_required', 'Select a company contact.', 400);
  const selected = (await db.query('SELECT contact_id,first_name,email FROM sales_prospect_contacts WHERE prospect_id=$1 AND contact_id=$2 AND archived_at IS NULL', [prospectId,contactId])).rows[0];
  if (!selected) throw fail('contact_unavailable', 'Choose an active contact from this company.');
  const recipient = email(selected.email), replyTo = email(actor.email);
  if (!recipient) throw fail('intro_email_recipient_required', 'Add a valid email to the selected contact before sending.');
  if (!replyTo) throw fail('intro_email_reply_to_required', 'Your authenticated account needs a valid email address before sending.');
  if (salesCallId) {
    const call = (await db.query('SELECT prospect_id,admin_user_id,metadata_json FROM sales_call_sessions WHERE sales_call_id=$1', [salesCallId])).rows[0];
    if (!call || call.prospect_id !== prospectId || Number(call.admin_user_id) !== Number(repId)) throw fail('intro_email_call_forbidden', 'The call does not belong to this company and rep.', 403);
    if (call.metadata_json?.phone_test_mode) throw fail('sales_phone_test_external_action_blocked', 'Introduction emails cannot be sent from test calls.');
    const snapshot = call.metadata_json?.contact_snapshot;
    if (call.metadata_json?.contact_id !== contactId || snapshot?.contactId !== contactId || email(snapshot?.email) !== recipient) {
      throw fail('intro_email_call_contact_changed', 'The selected contact no longer matches the contact recorded on this call. Open the company without the old call.');
    }
  }
  return {prospect, selected, recipient, replyTo, requiresPermission: !(prospect.email_permission && prospect.default_contact_id === contactId && email(prospect.contact_email) === recipient)};
}

// Internal operator maintenance only: intentionally not exposed by a route or
// background job. Evidence must positively establish a provider terminal result;
// absence from a dashboard/search is not evidence that a send did not happen.
export async function reconcileSalesIntroEmailDelivery(pool, {deliveryId,adminUserId,resolution,evidenceReference,providerMessageId=null}) {
  if (!['sent','not_sent'].includes(resolution)
    || typeof evidenceReference !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{5,159}$/.test(evidenceReference)
    || (resolution==='sent' && providerMessageId===null)
    || (providerMessageId!==null && (typeof providerMessageId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,239}$/.test(providerMessageId)))) {
    throw fail('intro_email_reconciliation_evidence_required', 'Provide a verified terminal outcome and a non-PII operator evidence reference; sent outcomes also require the provider message ID.',400);
  }
  await assertSchema(pool);
  return salesTransaction(pool,async db=>{
    await db.query('SELECT id FROM sales_dialer_config WHERE id=TRUE FOR SHARE');
    const actor=(await db.query('SELECT role FROM admin_users WHERE id=$1 FOR UPDATE',[adminUserId])).rows[0];
    if(!['admin','super_admin'].includes(actor?.role))throw fail('forbidden','Only an administrator can reconcile delivery.',403);
    const initial=(await db.query('SELECT prospect_id FROM sales_intro_email_deliveries WHERE draft_token=$1',[deliveryId])).rows[0];
    if(!initial)throw fail('intro_email_delivery_not_found','Delivery not found.',404);
    await db.query('SELECT prospect_id FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[initial.prospect_id]);
    const row=(await db.query("SELECT *,attempted_at <= NOW()-INTERVAL '15 minutes' AS old_enough FROM sales_intro_email_deliveries WHERE draft_token=$1 FOR UPDATE",[deliveryId])).rows[0];
    if(!['sending','uncertain'].includes(row.status))throw fail('intro_email_reconciliation_not_pending','This delivery has no unresolved attempt.');
    if(!row.old_enough)throw fail('intro_email_reconciliation_too_soon','Wait at least 15 minutes after the attempt and obtain verified provider evidence before reconciling.');
    const status=resolution==='sent'?'sent':'canceled';
    await writeAuditLog(db,{actor:`admin:${adminUserId}`,action:'sales.intro_email.reconciled',details:{deliveryId,prospectId:row.prospect_id,contactId:row.contact_id,repUserId:Number(row.rep_user_id),previousStatus:row.status,status,evidenceReference}});
    await db.query("SELECT set_config('everycall.sales_intro_reconciliation',$1,TRUE)",[`${deliveryId}:${adminUserId}`]);
    const updated=(await db.query(`UPDATE sales_intro_email_deliveries SET status=$2,provider_message_id=COALESCE($3,provider_message_id),completed_at=NOW(),reconciled_by=$4,reconciled_at=NOW(),resolution_evidence_ref=$5 WHERE draft_token=$1 RETURNING *`,[deliveryId,status,providerMessageId,adminUserId,evidenceReference])).rows[0];
    await db.query("SELECT set_config('everycall.sales_intro_reconciliation','',TRUE)");
    return receipt(updated);
  });
}

function assertDraftContext(row, current) {
  if (Number(row.expected_row_version) !== Number(current.prospect.row_version)
    || row.recipient_hash !== hash(current.recipient) || row.reply_to_hash !== hash(current.replyTo)
    || row.requires_email_permission !== current.requiresPermission) {
    throw fail('intro_email_context_changed', 'The company, contact, email permission or your account email changed. Close this draft and open a new one.');
  }
}

export async function createSalesIntroEmailDraft(pool, options) {
  await assertSchema(pool);
  return salesTransaction(pool, async db => {
    const current = await context(db, options);
    if ((await db.query("SELECT 1 FROM sales_intro_email_deliveries WHERE prospect_id=$1 AND status IN ('sending','uncertain')", [options.prospectId])).rowCount) throw pending();
    const draftToken = crypto.randomBytes(32).toString('hex');
    await db.query(`INSERT INTO sales_intro_email_deliveries(draft_token,prospect_id,contact_id,rep_user_id,sales_call_id,expected_row_version,recipient_hash,reply_to_hash,requires_email_permission)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [draftToken,options.prospectId,options.contactId,options.repId,options.salesCallId||null,current.prospect.row_version,hash(current.recipient),hash(current.replyTo),current.requiresPermission]);
    return {draftToken,contactId:options.contactId,recipient:current.recipient,replyTo:current.replyTo,
      expectedRowVersion:Number(current.prospect.row_version),requiresEmailPermissionConfirmation:current.requiresPermission,
      subject:SALES_INTRO_EMAIL_SUBJECT,text:salesIntroEmailText(current.selected.first_name)};
  });
}

const receipt = row => ({deliveryId:row.draft_token,status:row.status,contactId:row.contact_id});
async function audit(db, row, action, isAdmin=false) {
  await writeAuditLog(db, {actor:`${isAdmin?'admin':'sales'}:${row.rep_user_id}`,action:`sales.intro_email.${action}`,
    details:{deliveryId:row.draft_token,prospectId:row.prospect_id,contactId:row.contact_id,salesCallId:row.sales_call_id||null,status:row.status,confirmedEmailPermission:row.confirmed_email_permission}});
}

export async function sendSalesIntroEmail(pool, {prospectId,repId,isAdmin=false,authenticatedSession,draftToken,subject,text,confirmedEmailPermission=false,idempotencyKey,mail=sendTransactionalEmail,dispatchTimeoutMs=15000}) {
  await assertSchema(pool);
  validateSalesIntroEmailMessage(subject,text);
  if (typeof draftToken !== 'string' || !/^[a-f0-9]{64}$/.test(draftToken)) throw fail('intro_email_draft_required', 'Open a new email draft.', 400);
  if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,160}$/.test(idempotencyKey)) throw fail('idempotency_key_required', 'A stable send request key is required.', 400);
  if (typeof confirmedEmailPermission !== 'boolean') throw fail('invalid_email_permission_confirmation', 'Confirm permission for this email.', 400);
  const requestHash = hash(JSON.stringify({draftToken,subject,text,confirmedEmailPermission}));
  const options = {prospectId,repId,isAdmin,authenticatedSession};
  const reservation = await salesTransaction(pool, async db => {
    // Read immutable target before taking locks, then reread its mutable status.
    const initial = (await db.query('SELECT * FROM sales_intro_email_deliveries WHERE draft_token=$1 AND prospect_id=$2 AND rep_user_id=$3', [draftToken,prospectId,repId])).rows[0];
    if (!initial) throw fail('intro_email_draft_unavailable', 'Open an email draft for this company and rep.', 403);
    const current = await context(db, {...options,contactId:initial.contact_id,salesCallId:initial.sales_call_id});
    const row = (await db.query('SELECT * FROM sales_intro_email_deliveries WHERE draft_token=$1 FOR UPDATE', [draftToken])).rows[0];
    assertDraftContext(row,current);
    if (row.status !== 'draft') {
      if (row.request_hash !== requestHash || row.idempotency_key !== idempotencyKey) throw fail('intro_email_request_changed', 'This draft already has a different send request.');
      if (row.status === 'sent') return {row,replay:true};
      if (row.status === 'canceled') throw fail('intro_email_canceled', 'This send was canceled before dispatch. Open a new draft.');
      throw pending();
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) throw fail('intro_email_draft_expired', 'This draft expired. Open a new email draft.');
    if (current.requiresPermission && confirmedEmailPermission !== true) throw fail('intro_email_permission_required', 'Confirm that this selected contact has agreed to receive this email.');
    if ((await db.query('SELECT 1 FROM sales_intro_email_deliveries WHERE rep_user_id=$1 AND idempotency_key=$2', [repId,idempotencyKey])).rowCount) throw fail('intro_email_request_changed', 'This send key belongs to another draft.');
    if ((await db.query("SELECT 1 FROM sales_intro_email_deliveries WHERE prospect_id=$1 AND status IN ('sending','uncertain')", [prospectId])).rowCount) throw pending();
    const reserved = (await db.query(`UPDATE sales_intro_email_deliveries SET status='sending',request_hash=$2,idempotency_key=$3,confirmed_email_permission=$4,attempted_at=NOW() WHERE draft_token=$1 RETURNING *`, [draftToken,requestHash,idempotencyKey,confirmedEmailPermission])).rows[0];
    await audit(db,reserved,'reserved',isAdmin);
    return {row:reserved,replay:false};
  });
  if (reservation.replay) return receipt(reservation.row);
  let attempted = false;
  try {
    return await salesTransaction(pool, async db => {
      const row = reservation.row;
      const current = await context(db, {...options,contactId:row.contact_id,salesCallId:row.sales_call_id});
      assertDraftContext(row,current);
      const claimed = (await db.query('SELECT status FROM sales_intro_email_deliveries WHERE draft_token=$1 FOR UPDATE', [draftToken])).rows[0];
      if (claimed?.status !== 'sending') throw pending();
      if (!(await db.query('SELECT 1 FROM sessions WHERE id=$1 AND expires_at>clock_timestamp()',[authenticatedSession.id])).rowCount) throw fail('unauthorized','Your session expired before dispatch. Sign in again.',401);
      attempted = true;
      const result = await boundedSend(mail,{to:current.recipient,replyTo:current.replyTo,subject,text,category:'sales_intro',idempotencyKey:`sales-intro-${draftToken}`},Math.max(1,Math.min(15000,dispatchTimeoutMs)));
      // An accepted response without an identity is still uncertain, never retry.
      if (!result?.id) throw new Error('intro_email_provider_receipt_missing');
      const sent = (await db.query("UPDATE sales_intro_email_deliveries SET status='sent',provider=$2,provider_message_id=$3,completed_at=NOW() WHERE draft_token=$1 RETURNING *", [draftToken,result.provider||null,String(result.id)])).rows[0];
      await audit(db,sent,'sent',isAdmin);
      return receipt(sent);
    });
  } catch (error) {
    // Even if this persistence fails, the committed sending row fences all other
    // drafts/keys. Never expose provider error text or automatically resend.
    await salesTransaction(pool, async db => {
      const row = (await db.query("UPDATE sales_intro_email_deliveries SET status=$2,completed_at=NOW() WHERE draft_token=$1 AND status='sending' RETURNING *", [draftToken,attempted?'uncertain':'canceled'])).rows[0];
      if (row) await audit(db,row,row.status,isAdmin);
    }).catch(() => {});
    if (attempted) throw pending();
    throw error;
  }
}
