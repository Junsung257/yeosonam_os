
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function check() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing env');
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log('--- destination_masters ---');
  const { data: dests } = await supabase.from('destination_masters').select('*').limit(1);
  console.log(JSON.stringify(dests, null, 2));

  console.log('--- tour_blocks ---');
  const { data: blocks } = await supabase.from('tour_blocks').select('*').limit(1);
  console.log(JSON.stringify(blocks, null, 2));
}

check();
