alter table public.tenant_api_tokens
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.tenant_api_tokens
  drop constraint if exists tenant_api_tokens_provider_check;

alter table public.tenant_api_tokens
  add constraint tenant_api_tokens_provider_check
  check (provider in ('google_ads', 'meta', 'naver', 'google_analytics', 'kakao_biz', 'clobe'));

comment on column public.tenant_api_tokens.metadata is
  'Non-secret provider metadata such as OAuth client_id, token_endpoint, and resource. Tokens remain encrypted in encrypted_* columns.';
