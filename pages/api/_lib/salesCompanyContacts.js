import crypto from 'node:crypto';
import { SALES_COMPANY_EDIT_FIELDS, SALES_PHONE_TYPES, salesContactDisplayName } from '../../../lib/salesCompanyContacts.js';
import { SALES_TEST_NUMBERS } from './salesPhoneTestMode.js';

const terminal = "'closed','ended','completed','failed','no_answer','voicemail','wrong_number','not_interested','do_not_call','canceled','cancelled'";
const fail = (code, message, statusCode=400) => Object.assign(new Error(message), {code,statusCode});
const text = (value, length) => String(value ?? '').trim().slice(0,length);
const cleanEmail = value => {
 const email=text(value,320).toLowerCase();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('invalid_email','Enter a valid contact email.');
 return email;
};
function cleanPhone(value) {
 let phone=text(value,60).replace(/[^+\d]/g,'');
 if(/^\d{10}$/.test(phone))phone=`+1${phone}`;
 else if(/^1\d{10}$/.test(phone))phone=`+${phone}`;
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw fail('invalid_phone','Enter a valid phone number with country code.');
 return phone;
}
export const SALES_CONTACT_COLUMNS_SQL = `
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.contact_id,'firstName',c.first_name,'lastName',c.last_name,'legacyName',c.legacy_name,'email',COALESCE(c.email,''),'title',COALESCE(c.title,''),'decisionMaker',c.decision_maker,'influencer',c.influencer,'numbers',
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.number_id,'phoneE164',n.phone_e164,'type',n.type,'label',n.label) ORDER BY n.position,n.number_id),'[]'::jsonb) FROM sales_prospect_contact_numbers n WHERE n.prospect_id=p.prospect_id AND n.contact_id=c.contact_id AND n.archived_at IS NULL)) ORDER BY c.created_at,c.contact_id),'[]'::jsonb) FROM sales_prospect_contacts c WHERE c.prospect_id=p.prospect_id AND c.archived_at IS NULL) AS contacts_json,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.number_id,'phoneE164',n.phone_e164,'type',n.type,'label',n.label) ORDER BY n.position,n.number_id),'[]'::jsonb) FROM sales_prospect_contact_numbers n WHERE n.prospect_id=p.prospect_id AND n.contact_id IS NULL AND n.archived_at IS NULL) AS shared_numbers_json,
 (EXISTS(SELECT 1 FROM sales_call_sessions s WHERE s.prospect_id=p.prospect_id AND s.state NOT IN (${terminal}))
 OR EXISTS(SELECT 1 FROM sales_incoming_calls i WHERE i.prospect_id=p.prospect_id AND (i.state='routing' OR (i.state='ringing' AND i.ring_expires_at>NOW())))
 OR EXISTS(SELECT 1 FROM sales_checkout_sessions x WHERE x.prospect_id=p.prospect_id AND x.status IN ('creating','created','sending','delivery_uncertain'))
 OR EXISTS(SELECT 1 FROM sales_setup_bookings b JOIN sales_call_sessions s ON s.sales_call_id=b.sales_call_id WHERE s.prospect_id=p.prospect_id AND b.status='reserving')
 OR EXISTS(SELECT 1 FROM sales_signup_invitations v WHERE v.prospect_id=p.prospect_id AND v.status IN ('pending','sending') AND v.revoked_at IS NULL AND v.expires_at>NOW())) AS contact_edit_pending`;

function effectiveNumber(number,isTest) {
 return {...number,phoneE164:isTest?SALES_TEST_NUMBERS.find(n=>n.type===(number.type==='cell'?'cell':'shop')).phoneE164:number.phoneE164,isTest};
}
export function serializeSalesCompanyContacts(row) {
 const isTest=row.test_original_phone_e164!=null;
 const contacts=(row.contacts_json||[]).map(c=>({...c,displayName:salesContactDisplayName(c),numbers:(c.numbers||[]).map(n=>effectiveNumber(n,isTest))}));
 const sharedNumbers=(row.shared_numbers_json||[]).map(n=>effectiveNumber(n,isTest));
 const blocked=Boolean(row.contact_edit_pending);
 const callbackContact=contacts.find(c=>c.id===row.callback_contact_id);
 const canonicalContact=(row.contacts_json||[]).find(c=>c.id===row.callback_contact_id);
 const callbackNumber=[...(row.shared_numbers_json||[]),...(canonicalContact?.numbers||[])].find(n=>n.id===row.callback_number_id);
 const callbackChanged=Boolean(row.callback_number_id&&(!callbackNumber||callbackNumber.phoneE164!==row.callback_contact_snapshot?.phoneE164));
 return {contacts,sharedNumbers,defaultContactId:row.default_contact_id||null,
  editCapabilities:{canEdit:!blocked,reason:blocked?'End the active call and reconcile pending calls, deliveries and bookings before editing this company.':null,canEditPhones:!blocked&&!isTest,phoneReason:blocked?'End the active call and reconcile pending work before changing phones.':isTest?'Restore original Sales phones before adding, removing or changing contact phones.':null},
  callbackTarget:row.callback_contact_id?{contactId:row.callback_contact_id,numberId:row.callback_number_id||null,contactSnapshot:row.callback_contact_snapshot?{...row.callback_contact_snapshot,phoneE164:isTest&&row.callback_contact_snapshot.phoneE164?effectiveNumber({phoneE164:row.callback_contact_snapshot.phoneE164,type:row.callback_contact_snapshot.numberType},true).phoneE164:row.callback_contact_snapshot.phoneE164}:null,requiresSelection:!callbackContact||callbackChanged}:{contactId:null,numberId:null,contactSnapshot:null,requiresSelection:false}};
}
export async function loadSalesCompanyContacts(db,prospectId) {
 const result=await db.query(`SELECT p.*,${SALES_CONTACT_COLUMNS_SQL} FROM sales_prospects p WHERE p.prospect_id=$1`,[prospectId]);
 if(!result.rowCount)throw fail('prospect_not_found','Prospect not found.',404);
 return serializeSalesCompanyContacts(result.rows[0]);
}
export async function resolveSalesContactTarget(db,prospectId,{contactId,numberId,phoneE164,expectedRowVersion,allowNoNumber=false}={}) {
 const result=await db.query(`SELECT p.*,${SALES_CONTACT_COLUMNS_SQL} FROM sales_prospects p WHERE p.prospect_id=$1`,[prospectId]);
 const row=result.rows[0];if(!row)throw fail('prospect_not_found','Prospect not found.',404);
 if(expectedRowVersion!==undefined&&(!Number.isInteger(expectedRowVersion)||expectedRowVersion!==Number(row.row_version)))throw fail('prospect_version_conflict','This company changed. Refresh and choose the contact again.',409);
 const dto=serializeSalesCompanyContacts(row);
 const selected=dto.contacts.find(c=>c.id===(contactId||dto.defaultContactId));
 if(!selected)throw fail('contact_unavailable','Choose an active contact from this company.',409);
 const possible=[...selected.numbers,...dto.sharedNumbers];
 let number=numberId?possible.find(n=>n.id===numberId):phoneE164?possible.find(n=>n.phoneE164===phoneE164):null;
 if(!number&&!numberId&&!phoneE164&&!allowNoNumber)number=possible.find(n=>n.type==='cell')||possible[0];
 if((numberId||phoneE164||!allowNoNumber)&&!number)throw fail('invalid_contact_number','Choose a phone belonging to this contact or a shared company phone.',409);
 if(phoneE164&&number?.phoneE164!==phoneE164)throw fail('contact_number_changed','This contact phone changed. Refresh and choose it again.',409);
 const contactSnapshot={contactId:selected.id,firstName:selected.firstName,lastName:selected.lastName,displayName:selected.displayName,title:selected.title,email:selected.email,decisionMaker:selected.decisionMaker,influencer:selected.influencer,numberId:number?.id||null,phoneE164:number?.phoneE164||null,numberType:number?.type||null,numberLabel:number?.label||null};
 const original=number&&(row.contacts_json||[]).flatMap(c=>c.numbers||[]).concat(row.shared_numbers_json||[]).find(n=>n.id===number.id);
 return {contactId:selected.id,numberId:number?.id||null,phoneE164:number?.phoneE164||null,contactSnapshot,isTest:row.test_original_phone_e164!=null,originalPhoneE164:original?.phoneE164||null};
}

export async function assertSalesCompanyEditable(db,prospectId) {
 const row=(await db.query(`SELECT p.*,${SALES_CONTACT_COLUMNS_SQL} FROM sales_prospects p WHERE p.prospect_id=$1 FOR UPDATE`,[prospectId])).rows[0];
 if(!row)throw fail('prospect_not_found','Prospect not found.',404);
 if(row.contact_edit_pending)throw fail('company_edit_pending','End the active call and reconcile pending calls, deliveries and bookings before editing this company.',409);
 return row;
}
export function validateCompanyEditorFields(changes) {
 const allowed=new Set([...SALES_COMPANY_EDIT_FIELDS,'editorMode','expectedRowVersion','contacts','sharedNumbers','defaultContactId','emailPermissionConfirmation']);
 for(const key of Object.keys(changes))if(!allowed.has(key))throw fail('company_field_not_editable',`This field is managed by its existing workflow: ${key}.`);
 if(!Number.isInteger(changes.expectedRowVersion)||changes.expectedRowVersion<1)throw fail('invalid_row_version','Reload the company before saving.');
}

// Caller holds config/company locks and owns the transaction/audit/idempotency receipt.
export async function saveSalesCompanyContacts(db,row,changes) {
 const current=serializeSalesCompanyContacts(row);
 const supplied=changes.contacts??current.contacts;
 const shared=changes.sharedNumbers??current.sharedNumbers;
 if(!Array.isArray(supplied)||!supplied.length||supplied.length>50)throw fail('invalid_contacts','Keep between 1 and 50 contacts.');
 if(!Array.isArray(shared)||shared.length>30)throw fail('invalid_numbers','Provide at most 30 shared numbers.');
 const allContactRows=(await db.query('SELECT * FROM sales_prospect_contacts WHERE prospect_id=$1',[row.prospect_id])).rows;
 const allNumberRows=(await db.query('SELECT * FROM sales_prospect_contact_numbers WHERE prospect_id=$1',[row.prospect_id])).rows;
 const contactMap=new Map(allContactRows.map(c=>[c.contact_id,c]));const numberMap=new Map(allNumberRows.map(n=>[n.number_id,n]));
 const seenContacts=new Set(),seenNumbers=new Set(),newIds=new Map();
 const contacts=[];const numbers=[];const isTest=row.test_original_phone_e164!=null;
 function identifier(value,prefix,map,seen) {
  const requested=text(value,240);if(!requested)throw fail('contact_id_required','Every contact and phone needs an ID.');
  if(seen.has(requested))throw fail('duplicate_contact_id','Contact and phone IDs must be unique.');seen.add(requested);
  if(requested.startsWith('new_')){const id=`${prefix}_${crypto.randomUUID()}`;newIds.set(requested,id);return id;}
  const old=map.get(requested);if(!old||old.archived_at)throw fail('contact_forbidden','A contact or phone does not belong to this company or was removed.',403);
  return requested;
 }
 function number(raw,owner,position) {
  const id=identifier(raw?.id,'sales_number',numberMap,seenNumbers);const old=numberMap.get(id);
  const type=String(raw?.type||'other');if(!SALES_PHONE_TYPES.includes(type))throw fail('invalid_phone_type','Choose cell, shop or other.');
  const label=isTest?String(raw.label??''):text(raw.label,60)||type;
  if(raw.isTest===true&&!isTest)throw fail('sales_test_export_not_importable','Test destinations cannot replace restored contact phones. Reload the company.');
  const requested=cleanPhone(raw.phoneE164);
  if(isTest) {
   const effective=old&&effectiveNumber({phoneE164:old.phone_e164,type:old.type},true).phoneE164;
   if(!old||requested!==effective||owner!==old.contact_id||type!==old.type||label!==old.label)throw fail('sales_phone_test_mode_active','Restore original Sales phones before changing contact phones.',409);
  }
  numbers.push({id,contactId:owner,phone: isTest?old.phone_e164:requested,type,label,position:isTest?old.position:position});
 }
 for(const c of supplied) {
  const id=identifier(c?.id,'sales_contact',contactMap,seenContacts);
  if(isTest&&!contactMap.has(id))throw fail('sales_phone_test_mode_active','Restore original Sales phones before adding contacts.',409);
  if(!Array.isArray(c.numbers)||c.numbers.length>20)throw fail('invalid_numbers','Provide at most 20 numbers per contact.');
  if(typeof c.decisionMaker!=='boolean'||typeof c.influencer!=='boolean')throw fail('invalid_contact_flags','Choose decision-maker and influencer independently.');
  contacts.push({id,firstName:text(c.firstName,120),lastName:text(c.lastName,120),email:cleanEmail(c.email),title:text(c.title,100),decisionMaker:c.decisionMaker,influencer:c.influencer});
  c.numbers.forEach((n,i)=>number(n,id,i));
 }
 shared.forEach((n,i)=>number(n,null,i));
 if(!numbers.length)throw fail('company_phone_required','Keep at least one company or contact phone number.');
 const defaultId=newIds.get(changes.defaultContactId)||changes.defaultContactId||row.default_contact_id;
 if(!contacts.some(c=>c.id===defaultId))throw fail('default_contact_required','Choose an active default contact.');
 const defaultContact=contacts.find(c=>c.id===defaultId);
 const emailChanged=(row.contact_email||'').toLowerCase()!==(defaultContact.email||'').toLowerCase();
 const confirmation=changes.emailPermissionConfirmation;
 const confirmed=confirmation && (newIds.get(confirmation.contactId)||confirmation.contactId)===defaultId && cleanEmail(confirmation.email)===defaultContact.email;
 if(emailChanged){
  changes.emailPermission=Boolean(defaultContact.email&&changes.emailPermission===true&&confirmed);
  await db.query('UPDATE sales_prospects SET email_permission=$2 WHERE prospect_id=$1',[row.prospect_id,changes.emailPermission]);
 }
 if(isTest&&(allContactRows.filter(c=>!c.archived_at).length!==contacts.length||allNumberRows.filter(n=>!n.archived_at).length!==numbers.length))throw fail('sales_phone_test_mode_active','Restore original Sales phones before removing contacts or phones.',409);
 // Archive numbers first, then contacts; default validation is deferred to commit.
 await db.query('UPDATE sales_prospect_contact_numbers SET archived_at=NOW(),updated_at=NOW() WHERE prospect_id=$1 AND archived_at IS NULL AND NOT(number_id=ANY($2::text[]))',[row.prospect_id,numbers.map(n=>n.id)]);
 await db.query('UPDATE sales_prospect_contacts SET archived_at=NOW(),updated_at=NOW() WHERE prospect_id=$1 AND archived_at IS NULL AND NOT(contact_id=ANY($2::text[]))',[row.prospect_id,contacts.map(c=>c.id)]);
 for(const c of contacts)await db.query(contactMap.has(c.id)?`UPDATE sales_prospect_contacts SET first_name=$3,last_name=$4,email=$5,title=$6,decision_maker=$7,influencer=$8,updated_at=NOW() WHERE contact_id=$1 AND prospect_id=$2`:`INSERT INTO sales_prospect_contacts(contact_id,prospect_id,first_name,last_name,email,title,decision_maker,influencer) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(contact_id) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,email=EXCLUDED.email,title=EXCLUDED.title,decision_maker=EXCLUDED.decision_maker,influencer=EXCLUDED.influencer,updated_at=NOW()`,[c.id,row.prospect_id,c.firstName,c.lastName,c.email||null,c.title||null,c.decisionMaker,c.influencer]);
 for(const n of numbers)await db.query(numberMap.has(n.id)?`UPDATE sales_prospect_contact_numbers SET contact_id=$3,phone_e164=$4,type=$5,label=$6,position=$7,updated_at=NOW() WHERE number_id=$1 AND prospect_id=$2`:`INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,contact_id,phone_e164,type,label,position) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(number_id) DO UPDATE SET contact_id=EXCLUDED.contact_id,phone_e164=EXCLUDED.phone_e164,type=EXCLUDED.type,label=EXCLUDED.label,position=EXCLUDED.position,updated_at=NOW()`,[n.id,row.prospect_id,n.contactId,n.phone,n.type,n.label,n.position]);
 await db.query('UPDATE sales_prospects SET default_contact_id=$2 WHERE prospect_id=$1',[row.prospect_id,defaultId]);
 await syncSalesContactProjection(db,row.prospect_id);
}
export async function syncSalesContactProjection(db,prospectId) {
 const p=(await db.query('SELECT * FROM sales_prospects WHERE prospect_id=$1',[prospectId])).rows[0];
 const c=(await db.query('SELECT * FROM sales_prospect_contacts WHERE prospect_id=$1 AND contact_id=$2',[prospectId,p.default_contact_id])).rows[0];
 const rows=(await db.query('SELECT n.* FROM sales_prospect_contact_numbers n LEFT JOIN sales_prospect_contacts c ON c.prospect_id=n.prospect_id AND c.contact_id=n.contact_id WHERE n.prospect_id=$1 AND n.archived_at IS NULL AND (n.contact_id IS NULL OR c.archived_at IS NULL) ORDER BY n.position,n.number_id',[prospectId])).rows;
 const numbers=[...new Map(rows.map(n=>[n.phone_e164,{...(n.legacy_json||{}),phoneE164:n.phone_e164,type:n.type,label:n.label}])).values()];
 const name=[c.first_name,c.last_name].filter(Boolean).join(' ')||c.legacy_name||null;
 // Exact original backup JSON and test substitutions remain untouched.
 await db.query(`UPDATE sales_prospects SET contact_name=$2,owner_first_name=$3,contact_email=$4,metadata_json=metadata_json||jsonb_build_object('contactRole',$5::text)
 ${p.test_original_phone_e164!=null?'':',numbers_json=$6::jsonb,phone_e164=$7'} WHERE prospect_id=$1`,p.test_original_phone_e164!=null?[prospectId,name,c.first_name||null,c.email,c.title]:[prospectId,name,c.first_name||null,c.email,c.title,JSON.stringify(numbers),numbers.some(n=>n.phoneE164===p.phone_e164)?p.phone_e164:numbers[0]?.phoneE164]);
}

// Legacy CSV remains additive: update its designated legacy person, never replace
// user-added contacts or change a company-selected default.
export async function mergeLegacySalesContacts(db,prospectId,record) {
 const p=(await db.query('SELECT * FROM sales_prospects WHERE prospect_id=$1 FOR UPDATE',[prospectId])).rows[0];
 if(p.test_original_phone_e164!=null)throw fail('sales_phone_test_mode_active','Restore original Sales phones before importing contacts.',409);
 const legacyId=`contact_legacy_${prospectId}`;
 if(record.contactName||record.contactEmail||record.ownerFirstName||record.research?.contactRole) {
  const name=record.contactName?.trim()||'';const parts=name.split(/\s+/);
  await db.query(`UPDATE sales_prospect_contacts SET first_name=COALESCE($3,first_name),last_name=COALESCE($4,last_name),email=COALESCE($5,email),title=COALESCE($6,title),updated_at=NOW() WHERE prospect_id=$1 AND contact_id=$2 AND archived_at IS NULL`,[prospectId,legacyId,name?parts[0]:record.ownerFirstName||null,name?parts.slice(1).join(' '):null,record.contactEmail||null,record.research?.contactRole||null]);
 }
 for(const n of record.numbers||[]) {
  const prior=await db.query('SELECT number_id FROM sales_prospect_contact_numbers WHERE prospect_id=$1 AND phone_e164=$2 AND archived_at IS NULL',[prospectId,n.phoneE164]);
  if(prior.rowCount){
   for(const old of prior.rows)if(old.number_id.startsWith('number_primary_')||old.number_id.startsWith('number_legacy_'))await db.query('UPDATE sales_prospect_contact_numbers SET type=$3,label=$4 WHERE prospect_id=$1 AND number_id=$2',[prospectId,old.number_id,n.type,n.label]);
   continue;
  }
  const activeLegacy=(await db.query('SELECT 1 FROM sales_prospect_contacts WHERE contact_id=$1 AND archived_at IS NULL',[legacyId])).rowCount;
  await db.query('INSERT INTO sales_prospect_contact_numbers(number_id,prospect_id,contact_id,phone_e164,type,label) VALUES($1,$2,$3,$4,$5,$6)',[`sales_number_${crypto.randomUUID()}`,prospectId,n.type==='cell'&&activeLegacy?legacyId:null,n.phoneE164,n.type,n.label]);
 }
 await syncSalesContactProjection(db,prospectId);
}
