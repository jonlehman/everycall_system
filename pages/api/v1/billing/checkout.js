// Legacy billing activation cannot create a subscription without the purchase ledger.
export default function handler(req,res) {
 return res.status(410).json({error:'paid_intake_required',redirectUrl:'/intake',message:'Start or recover your purchase through paid intake. Existing customers can manage Billing.'});
}
