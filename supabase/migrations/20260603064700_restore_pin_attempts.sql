-- Restore the manually-created affiliate PIN lockout table before Phase 2
-- hardening. Schema only: no authentication attempt rows.

CREATE TABLE IF NOT EXISTS public.pin_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
