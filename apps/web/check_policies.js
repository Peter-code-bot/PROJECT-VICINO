const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://oxxdkwywprkfghhbnoto.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94eGRrd3l3cHJrZmdoaGJub3RvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEyMjg0NSwiZXhwIjoyMDg5Njk4ODQ1fQ.Q1OWhvSBkPNDEejkiWGyRTITgxXr6J-RnTsV49Wmx-E'
);

async function checkPolicies() {
  const { data, error } = await supabase.rpc('query_sql', {
    query: "SELECT * FROM pg_policies WHERE tablename = 'profiles';"
  });

  if (error) {
    console.log("RPC Error:", error.message);
    // Fallback: direct REST query if RPC doesn't exist
    const { data: d2, error: e2 } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'profiles');
    console.log("REST Data:", d2);
    console.log("REST Error:", e2?.message);
  } else {
    console.log("Policies:", JSON.stringify(data, null, 2));
  }
}

checkPolicies();
