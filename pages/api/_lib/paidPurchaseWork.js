import crypto from 'node:crypto';

// These disjoint phases share the existing durable lease. Once released,
// lease_until is the next eligible attempt time; updated_at rotates work fairly.
const PHASES={
 payment:"payment_status='pending' AND provisioning_status<>'payment_review'",
 subscription:"payment_status='paid' AND recurring_consent_at IS NULL AND subscription_params IS NOT NULL AND provisioning_status<>'subscription_review'",
 provisioning:"payment_status='paid' AND livemode=TRUE AND recurring_consent_at IS NOT NULL AND provisioning_status IN('queued','failed','processing')"
};
const REVIEW_ERRORS=new Set([
 'purchase_not_found','purchase_payment_mismatch','recurring_consent_required','purchase_payment_intent_mismatch',
 'purchase_setup_intent_mismatch','verified_legacy_purchase_required','purchase_payment_method_mismatch',
 'purchase_term_reconciliation_required','duplicate_checkout_review_required','duplicate_subscription_review_required',
 'subscription_uncertainty_requires_reconciliation','purchase_subscription_mismatch','unexpected_initial_base_invoice',
 'verified_purchase_required','conversion_owner_mismatch','conversion_owner_conflict','voice_order_connection_mismatch',
 'voice_assignment_conflict','replacement_number_must_differ'
]);

export async function claimPaidPurchaseWork(pool,phase,{limit=10}={}){
 const predicate=PHASES[phase];if(!predicate)throw Error('invalid_paid_work_phase');
 const token=`${phase}:${crypto.randomUUID()}`;
 const batch=Math.max(1,Math.min(50,Math.trunc(Number(limit)||1)));
 const result=await pool.query(`WITH candidates AS (
  SELECT purchase_id FROM paid_purchases WHERE ${predicate}
   AND (lease_until IS NULL OR lease_until<=NOW())
   ORDER BY updated_at,purchase_id FOR UPDATE SKIP LOCKED LIMIT $1
 ) UPDATE paid_purchases p SET lease_token=$2,lease_until=NOW()+interval '15 minutes',updated_at=NOW(),
  provisioning_status=CASE WHEN $3='provisioning' THEN 'processing' ELSE p.provisioning_status END
  FROM candidates c WHERE p.purchase_id=c.purchase_id RETURNING p.*`,[batch,token,phase]);
 return {token,rows:result.rows,rowCount:result.rowCount};
}

export async function finishPaidPurchaseWork(pool,phase,purchaseId,token,{error=null,poll=false}={}){
 const predicate=PHASES[phase];if(!predicate)throw Error('invalid_paid_work_phase');
 const message=error?String(error.message||error).slice(0,300):null;
 const review=error&&REVIEW_ERRORS.has(message);
 const status=review?`${phase}_review`:error&&phase==='provisioning'?'failed':null;
 const delay=review?0:error?300:poll?60:0;
 // A signed webhook can advance the phase while a read-only reconciliation is in
 // flight. Never overwrite that newer phase or its error with stale worker output.
 await pool.query(`UPDATE paid_purchases SET lease_token=NULL,
  lease_until=CASE WHEN (${predicate}) AND $3>0 THEN NOW()+($3::integer*interval '1 second') ELSE NULL END,
  provisioning_status=CASE WHEN (${predicate}) THEN COALESCE($4,provisioning_status) ELSE provisioning_status END,
  last_error=CASE WHEN (${predicate}) THEN $5 ELSE last_error END,updated_at=NOW()
  WHERE purchase_id=$1 AND lease_token=$2`,[purchaseId,token,delay,status,message]);
}

export async function renewPaidPurchaseWork(pool,purchaseId,token){
 const result=await pool.query("UPDATE paid_purchases SET lease_until=NOW()+interval '15 minutes' WHERE purchase_id=$1 AND lease_token=$2 RETURNING purchase_id",[purchaseId,token]);
 if(!result.rowCount)throw Error('paid_purchase_lease_lost');
}
