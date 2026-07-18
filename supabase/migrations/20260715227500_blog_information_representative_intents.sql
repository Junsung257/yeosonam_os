-- Accept exactly the ten canonical informational intents for new registry rows.
-- NOT VALID preserves any legacy intent rows for the explicit
-- reconciliation dry run instead of mutating operating data automatically.

BEGIN;

ALTER TABLE public.blog_information_representatives
  DROP CONSTRAINT IF EXISTS blog_information_representatives_intent_check;

ALTER TABLE public.blog_information_representatives
  ADD CONSTRAINT blog_information_representatives_intent_v2_check
  CHECK (intent IN (
    'food_budget',
    'monthly_weather',
    'airport_transport',
    'hotel_areas',
    'family_budget',
    'itinerary',
    'shopping_souvenirs',
    'currency_payment',
    'entry_requirements',
    'travel_insurance'
  )) NOT VALID;

COMMENT ON CONSTRAINT blog_information_representatives_intent_v2_check
  ON public.blog_information_representatives IS
  'New rows use the ten canonical information intents. Validate only after legacy reconciliation.';

COMMIT;
