import assert from 'node:assert/strict';
import draftHandler from '../../pages/api/v1/admin/sales/prospects/[prospectId]/intro-email/draft.js';
import sendHandler from '../../pages/api/v1/admin/sales/prospects/[prospectId]/intro-email.js';

export async function testSalesIntroEmailApi({pool,call,salesCookie,adminCookie,repId,adminId}) {
  await pool.query("INSERT INTO sessions(id,user_id,role,expires_at) VALUES('intro-admin-token',$1,'admin',NOW()+INTERVAL '1 day')",[adminId]);
  adminCookie='everycall_session=intro-admin-token';
  for(const [id,owner] of [['intro-api',repId],['intro-api-foreign',adminId]]) {
    await pool.query("INSERT INTO sales_prospects(prospect_id,source_key,business_name,phone_e164,contact_name,contact_email,email_permission,assigned_rep_user_id) VALUES($1,$1,'Intro fixture','+12065550177','Api Person','api-person@example.test',TRUE,$2)",[id,owner]);
  }
  const request=(cookie=salesCookie,body={contactId:'contact_legacy_intro-api'},prospectId='intro-api')=>({method:'POST',query:{prospectId},body,headers:{cookie,'idempotency-key':crypto.randomUUID()}});
  for(const handler of [draftHandler,sendHandler]) {
    assert.equal((await call(handler,request(''))).statusCode,401);
    assert.equal((await call(handler,request('everycall_session=sales-token'))).statusCode,401);
    assert.equal((await call(handler,request('everycall_sales_session=invalid; '+adminCookie))).statusCode,401);
    assert.equal((await call(handler,request(salesCookie,{},'intro-api-foreign'))).statusCode,403);
    assert.equal((await call(handler,{...request(),method:'GET'})).statusCode,405);
  }
  const initial=await call(draftHandler,request());assert.equal(initial.statusCode,200);assert.equal(initial.headers['cache-control'],'no-store');
  assert.equal(initial.body.draft.recipient,'api-person@example.test');assert.equal(initial.body.draft.replyTo,'seller@example.com');
  const ownAdmin=await call(draftHandler,request(adminCookie));assert.equal(ownAdmin.statusCode,200);assert.equal(ownAdmin.body.draft.replyTo,'owner@example.com');
  await pool.query("INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,email) VALUES('intro-second','intro-api','Second','second-api@example.test')");
  const second=await call(draftHandler,request(salesCookie,{contactId:'intro-second'}));assert.equal(second.body.draft.requiresEmailPermissionConfirmation,true);
  const {draftToken,subject,text}=second.body.draft;
  const sendRequest=request(salesCookie,{draftToken,subject,text,confirmedEmailPermission:true});
  for(const field of ['to','replyTo','from','cc','bcc','html','contactId','salesCallId','expectedRecipient']) {
    const rejected=await call(sendHandler,{...sendRequest,body:{...sendRequest.body,[field]:'spoofed@example.test'}});
    assert.equal(rejected.statusCode,400);assert.equal(rejected.body.error,'intro_email_field_not_allowed');
  }
  assert.equal((await call(sendHandler,request(salesCookie,{draftToken,subject,text}))).body.error,'intro_email_permission_required');
  const oldFetch=globalThis.fetch,oldProvider=process.env.MAIL_PROVIDER,oldKey=process.env.RESEND_API_KEY;const sent=[];
  try {
    process.env.MAIL_PROVIDER='resend';process.env.RESEND_API_KEY='fixture';
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({id:'intro-api-message'})};};
    const delivered=await call(sendHandler,sendRequest);assert.equal(delivered.statusCode,200);assert.equal(delivered.body.delivery.status,'sent');
    assert.deepEqual(sent[0].to,['second-api@example.test']);assert.equal(sent[0].reply_to,'seller@example.com');assert(!('html' in sent[0]));
    assert.equal((await call(sendHandler,sendRequest)).statusCode,200);assert.equal(sent.length,1);
    assert.equal((await call(sendHandler,{...sendRequest,headers:{...sendRequest.headers,'idempotency-key':'alternate-key'}})).body.error,'intro_email_request_changed');
  }finally{globalThis.fetch=oldFetch;if(oldProvider===undefined)delete process.env.MAIL_PROVIDER;else process.env.MAIL_PROVIDER=oldProvider;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;}
}
