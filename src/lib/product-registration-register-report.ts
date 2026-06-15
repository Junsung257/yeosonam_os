export interface UploadRegisterReportPackage {
  id: string;
  internal_code: string | null;
  title: string | null;
  price: number | null;
  airline: string | null;
  status: string | null;
  departure_days: string | null;
  commission_rate?: number | null;
  land_operator?: string | null;
  price_dates?: unknown;
  itinerary_data?: unknown;
}

export interface UploadRegisterReportRow {
  package_id: string;
  short_code: string | null;
  title: string | null;
  price: number | null;
  airline: string | null;
  status: string | null;
  departure_days: string | null;
  mobile_url: string;
  lp_url: string;
  a4_url: string;
  price_rows_saved: number | null;
  price_dates_count: number;
  itinerary_days_count: number;
  commission_rate: number | null;
  land_operator: string | null;
}

function withBaseUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  return normalizedBase ? `${normalizedBase}${path}` : path;
}

export function buildUploadRegisterReport(
  packages: UploadRegisterReportPackage[],
  baseUrl = '',
  options: {
    priceRowsByPackageId?: Map<string, number> | Record<string, number>;
  } = {},
): UploadRegisterReportRow[] {
  return packages.map((pkg) => {
    const map = options.priceRowsByPackageId;
    const priceRowsSaved = map instanceof Map ? map.get(pkg.id) : map?.[pkg.id];
    const priceDates = Array.isArray(pkg.price_dates) ? pkg.price_dates : [];
    const itineraryData = pkg.itinerary_data as { days?: unknown[] } | null | undefined;
    return {
      package_id: pkg.id,
      short_code: pkg.internal_code,
      title: pkg.title,
      price: pkg.price,
      airline: pkg.airline,
      status: pkg.status,
      departure_days: pkg.departure_days,
      mobile_url: withBaseUrl(baseUrl, `/packages/${pkg.id}`),
      lp_url: withBaseUrl(baseUrl, `/lp/${pkg.id}`),
      a4_url: withBaseUrl(baseUrl, `/itinerary/${pkg.id}/print?mode=detail`),
      price_rows_saved: priceRowsSaved ?? null,
      price_dates_count: priceDates.length,
      itinerary_days_count: Array.isArray(itineraryData?.days) ? itineraryData.days.length : 0,
      commission_rate: pkg.commission_rate ?? null,
      land_operator: pkg.land_operator ?? null,
    };
  });
}
