-- Exact row counts for all public base tables. query_to_xml returns one scalar count per table.
with exact_counts as (
  select
    t.table_name,
    (
      xpath(
        '/row/c/text()',
        query_to_xml(
          format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
          false,
          true,
          ''
        )
      )
    )[1]::text::bigint as row_count
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
)
select
  now() as observed_at,
  count(*) as public_tables,
  count(*) filter (where row_count = 0) as empty_tables,
  count(*) filter (where row_count > 0) as nonempty_tables
from exact_counts;

with exact_counts as (
  select
    t.table_name,
    (
      xpath(
        '/row/c/text()',
        query_to_xml(
          format('select count(*) as c from %I.%I', t.table_schema, t.table_name),
          false,
          true,
          ''
        )
      )
    )[1]::text::bigint as row_count
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
)
select table_name, row_count
from exact_counts
where row_count = 0
order by table_name;
