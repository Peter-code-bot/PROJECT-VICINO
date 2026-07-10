const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://oxxdkwywprkfghhbnoto.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94eGRrd3l3cHJrZmdoaGJub3RvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEyMjg0NSwiZXhwIjoyMDg5Njk4ODQ1fQ.Q1OWhvSBkPNDEejkiWGyRTITgxXr6J-RnTsV49Wmx-E'
);

async function checkGrants() {
  const { data, error } = await supabase.from('profiles').select('*').limit(1);
  if (error) {
    console.error("Service role select error:", error);
  } else {
    console.log("Service role select success.");
  }

  // Now let's try querying pg_catalog or information_schema directly using a PostgREST workaround?
  // We can't unless we created an RPC.
  // Instead, let's create a temporary RPC to check grants!
}

checkGrants();
