-- Move extensions out of the exposed public schema.
-- Dependent app-owned functions get an explicit extensions search_path first.

ALTER FUNCTION public.search_similar_customers(text, integer, real)
  SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.prewarm_vector_indexes()
  SET search_path = public, extensions, pg_temp;

ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION pg_prewarm SET SCHEMA extensions;
