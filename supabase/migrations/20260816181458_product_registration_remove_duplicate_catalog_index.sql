-- The tenant/id UNIQUE constraint already provides the identical btree index.
drop index if exists internal_product_registration.idx_catalog_products_tenant_id_id;
