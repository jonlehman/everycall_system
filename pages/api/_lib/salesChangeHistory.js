import { SALES_HISTORY_INVENTORY } from '../../../lib/salesHistoryInventory.js';

export const HISTORY_MIGRATION = '0066_sales_change_history.sql';
const entities = [...new Set(Object.values(SALES_HISTORY_INVENTORY).map(value => value.entityType))];
const fields = [...new Set(Object.values(SALES_HISTORY_INVENTORY).flatMap(value => value.fields))].sort();
const actions = ['create','update','clear','archive','delete'];
const invalid = message => Object.assign(new Error(message), { code: 'invalid_history_filter', statusCode: 400 });
const unavailable = () => Object.assign(new Error('Sales change history capture is not installed or verified. Apply the reviewed migration before serving this feature.'), { code: 'sales_history_not_ready', statusCode: 503 });
export async function assertSalesHistoryReady(db) {
  try {
    const receipt = await db.query('SELECT name FROM schema_migrations WHERE name=$1', [HISTORY_MIGRATION]);
    if (!receipt.rowCount) throw unavailable();
    const tables = Object.keys(SALES_HISTORY_INVENTORY);
    const guards = await db.query(`SELECT c.relname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND t.tgenabled IN ('O','A')
      AND ((c.relname=ANY($1::text[]) AND t.tgname='sales_history_'||c.relname AND t.tgfoid='sales_capture_field_changes()'::regprocedure AND t.tgtype=29)
        OR (c.relname='sales_change_history' AND t.tgname IN ('sales_change_history_immutable_row','sales_change_history_immutable_truncate'))
        OR (c.relname='sales_change_history_capture' AND t.tgname IN ('sales_change_history_capture_immutable','sales_change_history_capture_truncate')))`, [tables]);
    if (guards.rowCount !== tables.length + 4) throw unavailable();
    const capture = await db.query('SELECT started_at FROM sales_change_history_capture WHERE id=TRUE');
    if (!capture.rows[0]) throw unavailable();
    return capture.rows[0].started_at;
  } catch { throw unavailable(); }
}
function single(query, key, max=200) {
  if (query[key] === undefined || query[key] === '') return null;
  if (typeof query[key] !== 'string' || query[key].length > max) throw invalid(`Invalid ${key}.`);
  return query[key];
}
export function historyFilters(query={}) {
  const result = {};
  for (const key of ['from','to']) {
    const value = single(query,key,10);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) throw invalid('Dates must be valid YYYY-MM-DD Pacific calendar dates.');
    result[key] = value;
  }
  if (result.from && result.to && result.from > result.to) throw invalid('Start date must be before end date.');
  for (const [key, allowed] of [['entity',entities],['field',fields],['action',actions],['actorKind',['human','system']]]) {
    result[key]=single(query,key);
    if(result[key] && !allowed.includes(result[key])) throw invalid(`Invalid ${key}.`);
  }
  result.actor=single(query,'actor');
  if(result.actor && !/^\d+$/.test(result.actor)) throw invalid('Invalid actor.');
  result.company=single(query,'company');
  result.contact=single(query,'contact');
  result.cursor=single(query,'cursor',1000);
  return result;
}
function whereFor(filters) {
  const clauses=[],params=[];
  const add=(sql,value)=>{params.push(value);clauses.push(sql.replace('?',`$${params.length}`));};
  if(filters.from)add("occurred_at >= (?::date::timestamp AT TIME ZONE 'America/Los_Angeles')",filters.from);
  if(filters.to)add("occurred_at < ((?::date+1)::timestamp AT TIME ZONE 'America/Los_Angeles')",filters.to);
  for(const [key,column] of [['entity','entity_type'],['field','field_path'],['action','action'],['actorKind','actor_kind'],['actor','actor_id']]) if(filters[key])add(`${column}=?`,filters[key]);
  if(filters.contact)add('contact_id=?',filters.contact);
  if(filters.company) add("(position(lower(?) in lower(COALESCE(company_name,'') || ' ' || COALESCE(prospect_id,'')))>0)",filters.company);
  if(filters.cursor) {
    let cursor;
    try { cursor=JSON.parse(Buffer.from(filters.cursor,'base64url').toString()); } catch { throw invalid('Invalid page cursor.'); }
    if(!cursor || typeof cursor.time!=='string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(cursor.time) || !Number.isFinite(Date.parse(cursor.time)) || !/^\d+$/.test(cursor.id))throw invalid('Invalid page cursor.');
    params.push(cursor.time,cursor.id);
    clauses.push(`(occurred_at,event_id)<($${params.length-1}::timestamptz,$${params.length}::bigint)`);
  }
  return {where:clauses.length?`WHERE ${clauses.join(' AND ')}`:'',params};
}
export async function getSalesChangeHistory(db, query={}) {
  if(query.format!==undefined)throw invalid('Export formats are not supported; use the full change view.');
  const startedAt=await assertSalesHistoryReady(db);
  if(query.eventId!==undefined) {
    const eventId=single(query,'eventId');
    if(!eventId || !/^\d{1,19}$/.test(eventId))throw invalid('Invalid event.');
    const row=(await db.query('SELECT *,event_id::text AS event_id FROM sales_change_history WHERE event_id=$1',[eventId])).rows[0];
    if(!row)throw Object.assign(new Error('Change not found.'),{code:'history_not_found',statusCode:404});
    return {event:row};
  }
  const filters=historyFilters(query),{where,params}=whereFor(filters);
  // Listing bounds value previews; detail returns the entire original JSON value.
  // Timestamp text retains PostgreSQL microseconds for lossless keyset pagination.
  const result=await db.query(`SELECT event_id::text,occurred_at,
    to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
    transaction_id,request_id,actor_kind,actor_id,actor_name,actor_role,entity_type,entity_id,
    prospect_id,company_name,contact_id,sales_call_id,number_id,field_path,action,old_present,new_present,
    left(old_value::text,500) AS old_preview,left(new_value::text,500) AS new_preview,
    COALESCE(length(old_value::text)>500,FALSE) AS old_truncated,COALESCE(length(new_value::text)>500,FALSE) AS new_truncated
    FROM sales_change_history ${where} ORDER BY occurred_at DESC,event_id DESC LIMIT 51`,params);
  const rows=result.rows.slice(0,50),last=rows.at(-1);
  const actors=(await db.query(`SELECT actor_id,actor_name,actor_role FROM (
    SELECT DISTINCT ON(actor_id) actor_id,actor_name,actor_role FROM sales_change_history
    WHERE actor_kind='human' ORDER BY actor_id,occurred_at DESC,event_id DESC
    ) actors ORDER BY actor_name,actor_id LIMIT 500`)).rows;
  return {startedAt,events:rows,actors,entities,fields,actions,
    nextCursor:result.rows.length>50?Buffer.from(JSON.stringify({time:last.cursor_time,id:last.event_id})).toString('base64url'):null};
}
