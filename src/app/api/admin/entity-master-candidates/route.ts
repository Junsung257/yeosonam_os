import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const LIST_FIELDS = [
  'id',
  'candidate_key',
  'category',
  'raw_label',
  'normalized_label',
  'destination_scope',
  'country_scope',
  'region_scope',
  'evidence_count',
  'occurrence_count',
  'package_count',
  'source_context',
  'external_sources',
  'suggested_master',
  'confidence',
  'promotion_status',
  'auto_action',
  'auto_verification_status',
  'verification_score',
  'canonical_name',
  'canonical_name_source',
  'decision_reason',
  'promoted_at',
  'promoted_attraction_id',
  'created_at',
  'updated_at',
].join(', ');

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ candidates: [] });

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const action = searchParams.get('action');
    const search = searchParams.get('search');
    const limit = Math.min(Number(searchParams.get('limit') ?? '200'), 1000);

    let query = supabaseAdmin
      .from('entity_master_candidates')
      .select(LIST_FIELDS)
      .order('occurrence_count', { ascending: false })
      .order('confidence', { ascending: false })
      .limit(limit);

    if (category && category !== 'all') query = query.eq('category', category);
    if (status && status !== 'all') {
      query = query.eq('promotion_status', status);
    } else {
      query = query.not('promotion_status', 'in', '(rejected_noise,promoted)');
    }
    if (action && action !== 'all') query = query.eq('auto_action', action);
    if (search) query = query.ilike('normalized_label', `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ candidates: data ?? [] });
  } catch (error) {
    console.error('[entity-master-candidates] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load candidates' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  try {
    const body = await request.json();
    const id = String(body.id ?? '');
    const action = String(body.action ?? '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: candidate, error: loadError } = await supabaseAdmin
      .from('entity_master_candidates')
      .select('*')
      .eq('id', id)
      .single();
    if (loadError) throw loadError;
    if (!candidate) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });

    if (action === 'reject_noise') {
      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'rejected_noise',
          auto_action: 'reject_noise',
          decision_reason: body.reason || 'admin rejected as non-master/noise',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    if (action === 'mark_needs_review') {
      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'needs_review',
          auto_action: 'needs_review',
          decision_reason: body.reason || 'admin review required',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    if (action === 'make_publishable') {
      const attractionId = body.attraction_id || candidate.promoted_attraction_id;
      if (!attractionId) {
        return NextResponse.json({ error: 'attraction_id is required' }, { status: 400 });
      }

      const { error: attractionError } = await supabaseAdmin
        .from('attractions')
        .update({
          customer_publishable: true,
          verification_status: 'published',
          review_required_reason: null,
        })
        .eq('id', attractionId);
      if (attractionError) throw attractionError;

      const { data, error } = await supabaseAdmin
        .from('entity_master_candidates')
        .update({
          promotion_status: 'promoted',
          promoted_at: new Date().toISOString(),
          promoted_attraction_id: attractionId,
          decision_reason: body.reason || 'admin verified and published',
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ candidate: data });
    }

    return NextResponse.json({ error: `unsupported action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('[entity-master-candidates] PATCH failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to update candidate' },
      { status: 500 },
    );
  }
}
