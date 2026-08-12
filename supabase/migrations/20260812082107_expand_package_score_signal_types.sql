-- Keep the database contract aligned with the public score-signal API. The
-- original table constraint accepted only the legacy click signal, so customer
-- detail/LP lead-sheet events returned HTTP 200 but were silently discarded.
ALTER TABLE public.package_score_signals
  DROP CONSTRAINT IF EXISTS package_score_signals_signal_type_check;

ALTER TABLE public.package_score_signals
  ADD CONSTRAINT package_score_signals_signal_type_check
  CHECK (signal_type IN (
    'view',
    'click',
    'booking',
    'recommend_badge_view',
    'recommend_reason_open',
    'comparison_open',
    'intent_chip_select',
    'lead_sheet_open'
  ));
