import { paidBillingRestriction } from './paidBillingLifecycle.js';

export async function getPaidBillingReadModel(pool,row,{now=new Date()}={}){
 if(!row?.paid_purchase_id)return null;
 const episode=(await pool.query('SELECT * FROM billing_delinquencies WHERE tenant_key=$1',[row.tenant_key])).rows[0];
 const debts=(await pool.query('SELECT kind,status,amount_remaining_cents FROM billing_invoice_debts WHERE tenant_key=$1',[row.tenant_key])).rows;
 const restriction=paidBillingRestriction(row,episode,debts,now);
 const amountOwedCents=debts.filter(d=>['open','uncollectible'].includes(d.status)).reduce((sum,d)=>sum+Number(d.amount_remaining_cents),0);
 return {restriction:restriction==='normal'?'none':restriction,amountOwedCents,graceEndsAt:amountOwedCents?episode?.grace_ends_at||null:null,
  numberReleaseAt:['suspended','ended'].includes(restriction)?episode?.number_release_at||null:null,
  changedNumberAckRequired:Boolean(row.changed_number_ack_required),canReinstate:restriction==='ended',
  outstandingDebtMustBeSettled:amountOwedCents>0,baseTermStart:row.current_period_start,baseTermEnd:row.current_period_end,
  paidBaseThrough:row.paid_base_through,usageAnchorAt:row.usage_anchor_at,monthlyOverageBilling:true,
  recoveryUrl:`/client/account/billing?tenantKey=${encodeURIComponent(row.tenant_key)}`};
}

export function paidUsageInvoiceEstimate(row,plan,estimate,usageEnd){
 const baseDue=!row.cancel_at_period_end&&!row.service_ended_at&&usageEnd&&new Date(usageEnd).getTime()===new Date(row.current_period_end).getTime();
 const base=baseDue?Number(plan.baseAmountCents||0):0;
 const overage=Number(estimate.overageAmountCents||0),adjustments=Number(estimate.netAdjustmentAmountCents||0);
 return {...estimate,baseAmountCents:base,discountedBaseAmountCents:base,monthlyDiscountPercent:0,totalEstimatedInvoiceCents:base+overage+adjustments};
}
