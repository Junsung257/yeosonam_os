import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttractionData } from '@/lib/attraction-matcher';
import type {
  UploadDepartingLocationRow,
  UploadLandOperatorRow,
} from '@/lib/product-registration/upload-supplier-context';

const UPLOAD_ATTRACTION_SELECT = 'id, name, short_desc, long_desc, aliases, country, region, category, emoji';
const UPLOAD_ATTRACTION_PAGE_SIZE = 1000;
const UPLOAD_ATTRACTION_MAX_ROWS = 8000;

export type UploadRegistrationContext = {
  landOperators: UploadLandOperatorRow[];
  departingLocations: UploadDepartingLocationRow[];
  activeAttractions: AttractionData[];
};

async function loadActiveAttractionsForUpload(input: {
  supabase: SupabaseClient;
}): Promise<AttractionData[]> {
  const rows: AttractionData[] = [];

  for (let from = 0; from < UPLOAD_ATTRACTION_MAX_ROWS; from += UPLOAD_ATTRACTION_PAGE_SIZE) {
    const to = from + UPLOAD_ATTRACTION_PAGE_SIZE - 1;
    const { data, error } = await input.supabase
      .from('attractions')
      .select(UPLOAD_ATTRACTION_SELECT)
      .eq('is_active', true)
      .range(from, to);

    if (error) {
      console.warn('[Upload API] active attractions load failed:', error.message);
      break;
    }

    const page = (data || []) as AttractionData[];
    rows.push(...page);
    if (page.length < UPLOAD_ATTRACTION_PAGE_SIZE) break;
  }

  return rows;
}

export async function loadUploadRegistrationContext(input: {
  supabase: SupabaseClient;
  isSupabaseConfigured: boolean;
  bulkMode: boolean;
}): Promise<UploadRegistrationContext> {
  if (!input.isSupabaseConfigured) {
    return {
      landOperators: [],
      departingLocations: [],
      activeAttractions: [],
    };
  }

  const [landOperatorsResult, departingLocationsResult, activeAttractions] = await Promise.all([
    input.supabase.from('land_operators').select('id, name').eq('is_active', true),
    input.supabase.from('departing_locations').select('id, name').eq('is_active', true),
    input.bulkMode ? Promise.resolve([] as AttractionData[]) : loadActiveAttractionsForUpload(input),
  ]);

  if (landOperatorsResult.error) {
    console.warn('[Upload API] land operators load failed:', landOperatorsResult.error.message);
  }
  if (departingLocationsResult.error) {
    console.warn('[Upload API] departing locations load failed:', departingLocationsResult.error.message);
  }

  return {
    landOperators: (landOperatorsResult.data || []) as UploadLandOperatorRow[],
    departingLocations: (departingLocationsResult.data || []) as UploadDepartingLocationRow[],
    activeAttractions,
  };
}
