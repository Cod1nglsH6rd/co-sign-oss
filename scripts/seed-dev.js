/* eslint-disable no-console */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { DEV_EMAIL } = require('../lib/devLogin');

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing env var: ${key}`);
    process.exit(1);
  }
}

if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_SEED !== 'true') {
  console.error('Refusing to run seed outside dev mode. Set ENABLE_DEV_SEED=true.');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const email = DEV_EMAIL;
  const password = 'Test123!';

  // Create or fetch user
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let user = (existingUsers?.users || []).find(u => u.email === email);

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }

  // Create org
  let org;
  const { data: existingOrg } = await supabase
    .from('organizations')
    .select('*')
    .eq('name', 'Enterprise Test')
    .limit(1)
    .single();

  if (existingOrg) {
    org = existingOrg;
  } else {
    const { data: createdOrg, error: orgError } = await supabase
      .from('organizations')
      .insert([{ name: 'Enterprise Test' }])
      .select()
      .single();
    if (orgError) throw orgError;
    org = createdOrg;
  }

  // Membership
  const { error: memberError } = await supabase
    .from('org_memberships')
    .upsert([{
      org_id: org.id,
      user_id: user.id,
      role: 'admin',
      status: 'active',
    }], { onConflict: 'org_id,user_id' });
  if (memberError) throw memberError;

  console.log('Seed complete:', { org: org.name, email });
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
