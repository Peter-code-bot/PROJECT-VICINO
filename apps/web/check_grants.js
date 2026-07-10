const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://oxxdkwywprkfghhbnoto.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94eGRrd3l3cHJrZmdoaGJub3RvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEyMjg0NSwiZXhwIjoyMDg5Njk4ODQ1fQ.Q1OWhvSBkPNDEejkiWGyRTITgxXr6J-RnTsV49Wmx-E'
);

async function checkGrants() {
  const { data, error } = await supabase.rpc('query_sql', {
    query: "SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges WHERE table_name = 'profiles';"
  });

  if (error) {
    // try to query directly using postgrest if possible (probably not exposed)
    console.log("RPC Error:", error.message);
  } else {
    console.log("Grants:", JSON.stringify(data, null, 2));
  }
}

checkGrants();
