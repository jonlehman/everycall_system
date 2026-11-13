// UPIB-012/014: support cannot grant unpaid service or extend a paid term.
export default function handler(req,res){return res.status(410).json({error:'paid_owner_recovery_required',message:'The owner must settle outstanding invoices or complete a full paid reinstatement from Billing.'});}
