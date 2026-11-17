import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {query,rosterWrite} from './db.js'
import {parse,id} from './validation.js'
import {audit} from './roster.js'
import {httpError} from './domain.js'
export async function memberships(run=query){const rows=await run('SELECT user_id,team_id FROM user_teams');const map={};for(const row of rows)(map[row.user_id]??=[]).push(row.team_id);return map}
export async function saveMemberships(run,userId,ids){const unique=[...new Set(ids)];for(const team of unique){const [found]=await run('SELECT id FROM teams WHERE id=?',[team]);if(!found)throw httpError(400,'Team no longer exists. Refresh and try again.')}await run('DELETE FROM user_teams WHERE user_id=?',[userId]);for(const team of unique)await run('INSERT INTO user_teams (user_id,team_id) VALUES (?,?)',[userId,team])}
export function registerTeams(app,admin,signedIn){
 app.get('/api/app/teams',signedIn(async()=>query('SELECT id,name,color FROM teams ORDER BY name')))
 const schema=z.object({name:z.string().trim().min(1).max(80),color:z.enum(['blue','purple','green','orange','pink','cyan'])})
 for(const method of ['post','put'])app[method]('/api/app/teams'+(method==='put'?'/:id':''),admin(async(actor,request,reply)=>{
 const fields=parse(schema,request.body),teamId=method==='put'?parse(id,request.params.id):randomUUID()
 await rosterWrite(async run=>{const [duplicate]=await run('SELECT id FROM teams WHERE LOWER(name)=LOWER(?) AND id<>?',[fields.name,teamId]);if(duplicate)throw httpError(409,'A team with this name already exists.');if(method==='put'){const [found]=await run('SELECT id FROM teams WHERE id=?',[teamId]);if(!found)throw httpError(404,'Team not found.');await run('UPDATE teams SET name=?,color=? WHERE id=?',[fields.name,fields.color,teamId])}else await run('INSERT INTO teams (id,name,color) VALUES (?,?,?)',[teamId,fields.name,fields.color]);await audit(run,actor.id,'team.'+(method==='put'?'updated':'created'),teamId,fields)})
 return reply.code(method==='post'?201:200).send({id:teamId,...fields})
 }))
 app.delete('/api/app/teams/:id',admin(async(actor,request,reply)=>{const teamId=parse(id,request.params.id);await rosterWrite(async run=>{await run('DELETE FROM user_teams WHERE team_id=?',[teamId]);await run('DELETE FROM teams WHERE id=?',[teamId]);await audit(run,actor.id,'team.deleted',teamId,{})});return reply.code(204).send()}))
}
