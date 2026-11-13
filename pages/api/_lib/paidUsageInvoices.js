import { getStripe } from './stripe.js';

// A persisted attempt precedes every provider effect. An expired unknown create
// stays fenced for manual reconciliation rather than receiving a new identity.
export async function collectPaidUsageInvoice(pool,periodId,{stripe=getStripe(),now=new Date()}={}) {
  const claim=await pool.query(`UPDATE billing_periods p SET invoice_attempted_at=COALESCE(invoice_attempted_at,$2),
    invoice_payload=COALESCE(invoice_payload,jsonb_build_object('customer',b.stripe_customer_id,'currency','usd',
      'subscription',b.stripe_subscription_id,
      'amount',p.overage_amount_cents,'description',p.overage_call_count || ' call overages',
      'tenant_key',p.tenant_key,'billing_period_id',p.billing_period_id::text))
    FROM tenant_billing_accounts b WHERE p.billing_period_id=$1 AND b.tenant_key=p.tenant_key
    AND b.paid_purchase_id IS NOT NULL AND p.status='finalized' RETURNING p.*`,[periodId,now]);
  if(!claim.rowCount)return null;
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    let period=(await db.query('SELECT * FROM billing_periods WHERE billing_period_id=$1 FOR UPDATE',[periodId])).rows[0];
    if(period.status==='invoiced'){await db.query('COMMIT');return null;}
    let payload=period.invoice_payload;
    if(!payload?.customer)throw Error('usage_invoice_customer_missing');
    if((await db.query('SELECT 1 FROM billing_period_adjustments WHERE billing_period_id=$1 AND stripe_invoice_item_id IS NULL LIMIT 1',[periodId])).rowCount)throw Error('paid_adjustments_manual_review_required');
    if(Number(payload.amount)<=0) {
      await db.query("UPDATE billing_periods SET status='invoiced',invoiced_at=NOW() WHERE billing_period_id=$1",[periodId]);
      await db.query('COMMIT');return {zero:true};
    }
    if(!period.stripe_invoice_id&&new Date(now).getTime()-new Date(period.invoice_attempted_at).getTime()>23*3600000)throw Error('usage_invoice_uncertain_requires_reconciliation');
    if(!Object.hasOwn(payload,'default_payment_method')&&!period.stripe_invoice_id){
      const subscription=payload.subscription?await stripe.subscriptions.retrieve(payload.subscription):null;
      if(subscription&&(subscription.livemode!==true||(subscription.customer?.id||subscription.customer)!==payload.customer))throw Error('usage_payment_method_subscription_mismatch');
      let method=subscription?.default_payment_method?.id||subscription?.default_payment_method||null;
      if(!method){
        const customer=await stripe.customers.retrieve(payload.customer);
        if(customer.deleted||customer.id!==payload.customer||customer.livemode!==true)throw Error('usage_payment_method_customer_mismatch');
        method=customer.invoice_settings?.default_payment_method?.id||customer.invoice_settings?.default_payment_method||null;
      }
      payload={...payload,default_payment_method:method};
      await db.query('UPDATE billing_periods SET invoice_payload=$2 WHERE billing_period_id=$1',[periodId,payload]);
      // Freeze the payment-method choice before any invoice provider effect.
      await db.query('COMMIT');await db.query('BEGIN');
      period=(await db.query('SELECT * FROM billing_periods WHERE billing_period_id=$1 FOR UPDATE',[periodId])).rows[0];
      if(period.status==='invoiced'){await db.query('COMMIT');return null;}
      payload=period.invoice_payload;
    }
    const key=`paid-usage-${periodId}`;
    let invoice;
    if(period.stripe_invoice_id) invoice=await stripe.invoices.retrieve(period.stripe_invoice_id);
    else {
      if(new Date(now).getTime()-new Date(period.invoice_attempted_at).getTime()>23*3600000) throw Error('usage_invoice_uncertain_requires_reconciliation');
      invoice=await stripe.invoices.create({customer:payload.customer,currency:payload.currency,collection_method:'charge_automatically',
        ...(payload.default_payment_method?{default_payment_method:payload.default_payment_method}:{}),
        auto_advance:false,pending_invoice_items_behavior:'exclude',metadata:{tenant_key:payload.tenant_key,billing_period_id:payload.billing_period_id,item_type:'call_overage'}},{idempotencyKey:`${key}-invoice`});
      // Commit the returned identity before an item/finalize request; a crash can
      // recover this exact invoice even after Stripe's idempotency retention.
      await db.query('UPDATE billing_periods SET stripe_invoice_id=$2 WHERE billing_period_id=$1',[periodId,invoice.id]);
      await db.query('COMMIT');await db.query('BEGIN');
      await db.query('SELECT billing_period_id FROM billing_periods WHERE billing_period_id=$1 FOR UPDATE',[periodId]);
      invoice=await stripe.invoices.retrieve(invoice.id);
    }
    if(invoice.customer!==payload.customer && invoice.customer?.id!==payload.customer)throw Error('usage_invoice_customer_mismatch');
    if(invoice.currency!==payload.currency || invoice.livemode!==true
      || invoice.metadata?.billing_period_id!==payload.billing_period_id || invoice.metadata?.tenant_key!==payload.tenant_key
      || invoice.metadata?.item_type!=='call_overage')throw Error('usage_invoice_identity_mismatch');
    if(invoice.status==='draft') {
      // Lookup the exact bound line first. The invoice never contains unattached items.
      const lines=await stripe.invoices.listLineItems(invoice.id,{limit:100});
      if(lines.has_more)throw Error('usage_invoice_lines_require_review');
      const existing=lines.data.filter(line=>line.metadata?.billing_period_id===payload.billing_period_id && line.metadata?.item_type==='call_overage');
      if(lines.data.length!==existing.length)throw Error('usage_invoice_unexpected_lines');
      if(existing.length>1)throw Error('usage_invoice_duplicate_lines');
      if(!existing.length) {
        if(new Date(now).getTime()-new Date(period.invoice_attempted_at).getTime()>23*3600000)throw Error('usage_invoice_item_uncertain_requires_reconciliation');
        const item=await stripe.invoiceItems.create({customer:payload.customer,invoice:invoice.id,amount:Number(payload.amount),currency:payload.currency,
          description:payload.description,metadata:{billing_period_id:payload.billing_period_id,item_type:'call_overage'}},{idempotencyKey:`${key}-item`});
        await db.query('UPDATE billing_periods SET stripe_invoice_item_id=$2 WHERE billing_period_id=$1',[periodId,item.id]);
      } else if(Number(existing[0].amount)!==Number(payload.amount))throw Error('usage_invoice_amount_mismatch');
      invoice=await stripe.invoices.finalizeInvoice(invoice.id,{auto_advance:true},{idempotencyKey:`${key}-finalize`});
    }
    if(!['open','paid','uncollectible'].includes(invoice.status))throw Error('usage_invoice_not_collectible');
    if(Number(invoice.total)!==Number(payload.amount))throw Error('usage_invoice_total_mismatch');
    await db.query("UPDATE billing_periods SET status='invoiced',invoiced_at=COALESCE(invoiced_at,NOW()) WHERE billing_period_id=$1",[periodId]);
    await db.query('COMMIT');return invoice;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
