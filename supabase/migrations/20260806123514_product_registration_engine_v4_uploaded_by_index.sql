-- Cover the service-role uploader foreign key used by V4 source lineage.
create index if not exists idx_product_source_documents_uploaded_by
  on public.product_source_documents(uploaded_by, created_at desc);
