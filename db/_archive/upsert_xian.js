const {createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const envFile=fs.readFileSync('.env.local','utf-8');
const env={};
envFile.split('\n').forEach(l=>{const [k,...v]=l.split('=');if(k)env[k.trim()]=v.join('=').trim();});
const sb=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function main(){
  const data=JSON.parse(fs.readFileSync('db/attractions_xian_batch.json','utf-8'));
  console.log(`Upserting ${data.length} Xi'an attractions...`);

  const {data:result, error}=await sb
    .from('attractions')
    .upsert(data, {onConflict:'name'})
    .select();

  if(error){
    console.error('Upsert error:', error);
    process.exit(1);
  }

  console.log(`Upserted: ${result.length} rows`);

  const {count, error:countErr}=await sb
    .from('attractions')
    .select('*',{count:'exact',head:true});

  if(countErr){
    console.error('Count error:', countErr);
    process.exit(1);
  }

  console.log(`Total attractions in DB: ${count}`);
}

main();
