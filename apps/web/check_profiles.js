const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://oxxdkwywprkfghhbnoto.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94eGRrd3l3cHJrZmdoaGJub3RvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDEyMjg0NSwiZXhwIjoyMDg5Njk4ODQ1fQ.Q1OWhvSBkPNDEejkiWGyRTITgxXr6J-RnTsV49Wmx-E'
);

async function main() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, has_seen_onboarding, es_vendedor, nombre, email')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Profiles:', JSON.stringify(data, null, 2));
  }
}

main();
