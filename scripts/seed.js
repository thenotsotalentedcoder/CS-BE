/**
 * ColdStart — Admin Seed Script
 * Run once on first deployment: npm run seed
 *
 * Creates the admin account in Supabase Auth and inserts the users row.
 * Safe to re-run — idempotent.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD must be set in .env');
  process.exit(1);
}

async function seed() {
  console.log(`Seeding admin: ${ADMIN_EMAIL}`);

  // Check if admin user already exists in Auth
  const { data: existingList } = await supabase.auth.admin.listUsers();
  const existing = existingList?.users?.find((u) => u.email === ADMIN_EMAIL);

  let adminId;

  if (existing) {
    console.log('Admin already exists in Supabase Auth — skipping Auth creation');
    adminId = existing.id;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });

    if (error) {
      console.error('Failed to create admin Auth user:', error.message);
      process.exit(1);
    }

    adminId = data.user.id;
    console.log(`Admin Auth user created: ${adminId}`);
  }

  // Upsert users row
  const { error: dbError } = await supabase.from('users').upsert(
    {
      id: adminId,
      email: ADMIN_EMAIL,
      full_name: 'Admin',
      role: 'admin',
    },
    { onConflict: 'id' }
  );

  if (dbError) {
    console.error('Failed to upsert admin users row:', dbError.message);
    process.exit(1);
  }

  console.log('Admin users row upserted successfully');
  console.log('Seed complete.');
}

seed();
