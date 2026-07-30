import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import PackagesPageClient from './PackagesPageClient';
import { packageDatabaseStatuses, parseAdminPackageStatus } from './package-workflow';

export const dynamic = 'force-dynamic';

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const params = await searchParams;
  const initialStatus = parseAdminPackageStatus(
    Array.isArray(params.status) ? params.status[0] : params.status,
  );

  if (!isSupabaseAdminConfigured) {
    return <PackagesPageClient initialPackages={[]} initialStatus={initialStatus} />;
  }

  let query = supabaseAdmin
    .from('travel_packages')
    .select(`
      id, title, destination, category, product_type, trip_style,
      departure_days, departure_airport, airline, min_participants,
      ticketing_deadline, price, price_tiers, status,
      created_at, internal_code, audit_status,
      duration, nights,
      display_title, hero_tagline, is_airtel,
      products(internal_code, display_name, departure_region, net_price, selling_price, margin_rate)
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  const databaseStatuses = packageDatabaseStatuses(initialStatus);
  if (databaseStatuses) query = query.in('status', [...databaseStatuses]);

  const { data } = await query;

  return (
    <PackagesPageClient
      initialPackages={(data ?? []) as unknown as import('./PackagesPageClient').Package[]}
      initialStatus={initialStatus}
    />
  );
}
