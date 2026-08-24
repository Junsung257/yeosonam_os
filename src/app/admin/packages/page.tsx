import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { PackagesReadOnlyClient, type ReadOnlyPackage } from './PackagesReadOnlyClient';

export const dynamic = 'force-dynamic';

export default async function PackagesPage() {
  if (!isSupabaseAdminConfigured) {
    return <PackagesReadOnlyClient initialPackages={[]} />;
  }

  const { data } = await supabaseAdmin
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
    .limit(200);

  return <PackagesReadOnlyClient initialPackages={(data ?? []) as unknown as ReadOnlyPackage[]} />;
}
