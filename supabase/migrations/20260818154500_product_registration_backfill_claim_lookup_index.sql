-- The terminal-state sync repairs bind-pending legacy rows by looking up the
-- deterministic authority binding key inside upload_jobs.v4_stage_state. A
-- functional partial index keeps the cron claim under the database statement
-- timeout as the upload table grows.
create index if not exists idx_upload_jobs_authority_binding_operation_key
  on public.upload_jobs ((v4_stage_state->>'authorityBindingOperationKey'))
  where v4_stage_state ? 'authorityBindingOperationKey';
