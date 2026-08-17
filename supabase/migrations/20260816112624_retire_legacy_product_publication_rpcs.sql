-- Registration Kernel is the only publication authority. These historical
-- entry points either accepted mutable package patches or bypassed the current
-- catalog/revision/proof/pointer contract, so they must not remain callable.

drop function if exists public.publish_product_registration_v6_snapshot_atomic(
  uuid, uuid, uuid, text, uuid, bigint, text, text, text
);

drop function if exists public.publish_product_registration_v5_snapshot_atomic(
  uuid, uuid, uuid, text, uuid, bigint, text, uuid, text, text, text, text
);

drop function if exists public.publish_package_snapshot_atomic(
  uuid, bigint, jsonb, text, jsonb, jsonb, jsonb, jsonb, text, text, text,
  text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text
);

comment on function public.publish_product_registration_snapshot_atomic(jsonb) is
  'Sole proof-bound CAS publication authority for the Registration Kernel.';
