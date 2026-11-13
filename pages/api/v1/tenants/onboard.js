// UPIB-003/014: draft creation and verified Checkout replace unpaid tenant creation.
export default function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 return res.status(410).json({ok:false,error:'paid_intake_required',message:'Continue through the secure paid signup.',redirectUrl:'/intake'});
}
