// The owner's November 13 clarification is a private, identity-bound exception.
// It does not create a setup purchase or make the retired public price available.
export const PRIVATE_OWNER_ACCOUNT = Object.freeze({
 tenantKey: 'creative_dynamic', customerId: 'cus_UNTATkOgHvbz4z',
 subscriptionId: 'sub_1TOjCdFgMKdd4EaWRmHZ00gE',
 priceId: 'price_1TOjCWFgMKdd4EaWiiwPcda1', productId: 'prod_UN6NJxwcNIj30v',
 amountCents: 150, currency: 'usd', interval: 'month'
});
const id = value => typeof value === 'string' ? value : value?.id;
const reject = () => { throw Error('private_owner_canonical_billing_review_required'); };

export function privateOwnerSubscriptionTerm(subscription) {
 const c=PRIVATE_OWNER_ACCOUNT,item=subscription?.items?.data?.[0];
 const start=Number(item?.current_period_start||subscription?.current_period_start);
 const end=Number(item?.current_period_end||subscription?.current_period_end);
 if(subscription?.id!==c.subscriptionId||id(subscription.customer)!==c.customerId||subscription.livemode!==true
  ||!['active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused'].includes(subscription.status)
  ||subscription.metadata?.tenant_key!==c.tenantKey||subscription.items?.has_more||subscription.items?.data?.length!==1
  ||id(item.price)!==c.priceId||id(item.price?.product)!==c.productId||item.price?.unit_amount!==c.amountCents
  ||item.price?.currency!==c.currency||item.price?.recurring?.interval!==c.interval||item.price?.recurring?.interval_count!==1
  ||Number(item.quantity)!==1||subscription.schedule||subscription.pending_update
  ||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<=start
  ||(subscription.discounts||[]).length||(item.discounts||[]).length)reject();
 return {start,end,cancelAtPeriodEnd:subscription.cancel_at_period_end===true,status:subscription.status};
}

export function privateOwnerInvoiceCoverage(invoice,term) {
 const c=PRIVATE_OWNER_ACCOUNT,line=invoice?.lines?.data?.[0];
 if(!invoice?.id?.startsWith('in_')||invoice.livemode!==true||id(invoice.customer)!==c.customerId
  ||id(invoice.subscription||invoice.parent?.subscription_details?.subscription)!==c.subscriptionId
  ||invoice.currency!==c.currency||invoice.status!=='paid'||Number(invoice.amount_remaining)!==0
  ||Number(invoice.amount_paid)!==c.amountCents||Number(invoice.total)!==c.amountCents
  ||invoice.lines?.has_more||invoice.lines?.data?.length!==1||Number(line.amount)!==c.amountCents
  ||id(line.price||line.pricing?.price_details?.price)!==c.priceId
  ||id(line.subscription||line.parent?.subscription_item_details?.subscription)!==c.subscriptionId
  ||line.proration===true||line.parent?.subscription_item_details?.proration===true
  ||Number(line.period?.start)!==term.start||Number(line.period?.end)!==term.end)reject();
 return {invoiceId:invoice.id,start:term.start,end:term.end,amountCents:c.amountCents};
}
