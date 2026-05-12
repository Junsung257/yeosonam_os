import { supabaseAdmin } from '@/lib/supabase';
import PackagesPageClient from './PackagesPageClient';

export const revalidate = 30;

export default async function PackagesPage() {
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

  return <PackagesPageClient initialPackages={(data ?? []) as any} />;
}
