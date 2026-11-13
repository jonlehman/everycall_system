import {getPool} from '../../_lib/db.js';
import {releaseRetiredNumber} from '../../_lib/retiredNumberRelease.js';
export const config={api:{bodyParser:{sizeLimit:'1kb'}},maxDuration:45};
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
 if(Object.keys(req.query||{}).length||Object.keys(req.body||{}).length)return res.status(400).json({error:'fixed_operation_only'});
 const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');
 if(!match)return res.status(401).json({error:'operator_capability_required'});
 const pool=getPool();if(!pool)return res.status(503).json({error:'database_unavailable'});
 try{return res.status(200).json(await releaseRetiredNumber(pool,{capability:match[1],runtimeRevision:process.env.VERCEL_GIT_COMMIT_SHA||process.env.RENDER_GIT_COMMIT||''}));}
 catch{return res.status(409).json({error:'operator_release_requires_reconciliation'});}
}
