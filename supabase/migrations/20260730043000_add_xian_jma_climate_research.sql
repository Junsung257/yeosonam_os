-- Destination-exact official climate documents for legacy weather recovery.
-- Every registered feed was fetched live and must expose complete reviewed
-- monthly values; a city page without climate rows is intentionally excluded.

begin;

insert into public.blog_information_official_source_registry (
  hostname,
  source_type,
  authority_level,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
values (
  'data.jma.go.jp',
  'meteorological_agency',
  'official_primary',
  true,
  'active',
  'codex_live_climate_source_audit',
  now(),
  'Japan Meteorological Agency first-party 1991-2020 climatological normals tables.'
)
on conflict (hostname, source_type) do update
set
  authority_level = excluded.authority_level,
  allow_subdomains = excluded.allow_subdomains,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

with reviewed_documents(hostname, source_type, source_url, destinations, review_note) as (
  values
    (
      'worldweather.wmo.int',
      'meteorological_agency',
      'https://worldweather.wmo.int/kr/city.html?cityId=239',
      array['서안'],
      'WWIS Xi''an city page reviewed against the Korean city name 시안.'
    ),
    (
      'worldweather.wmo.int',
      'meteorological_agency',
      'https://worldweather.wmo.int/kr/json/239_kr.xml',
      array['서안'],
      'WWIS Xi''an machine-readable 1961-1990 monthly climate normals with all required fields.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php?block_no=47817&prec_no=84&view=p1s',
      array['나가사키'],
      'JMA Nagasaki 1991-2020 monthly main-elements table for maximum and minimum temperature.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php?block_no=47817&prec_no=84&view=a1',
      array['나가사키'],
      'JMA Nagasaki 1991-2020 monthly precipitation table; rain days use the at-least-1.0-mm column.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php?block_no=47656&prec_no=50&view=p1s',
      array['시즈오카'],
      'JMA Shizuoka 1991-2020 monthly main-elements table for maximum and minimum temperature.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php?block_no=47656&prec_no=50&view=a1',
      array['시즈오카'],
      'JMA Shizuoka 1991-2020 monthly precipitation table; rain days use the at-least-1.0-mm column.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_amd_ym.php?block_no=0799&prec_no=83',
      array['유후인'],
      'JMA Yufuin 1991-2020 monthly main-elements table for maximum and minimum temperature.'
    ),
    (
      'data.jma.go.jp',
      'meteorological_agency',
      'https://www.data.jma.go.jp/stats/etrn/view/nml_amd_ym.php?block_no=0799&prec_no=83&view=a1',
      array['유후인'],
      'JMA Yufuin 1991-2020 monthly precipitation table; rain days use the at-least-1.0-mm column.'
    )
)
insert into public.blog_information_official_research_documents (
  official_source_registry_id,
  source_url,
  intents,
  destinations,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
select
  registry.id,
  document.source_url,
  array['monthly_weather'],
  document.destinations,
  'active',
  'codex_live_climate_source_audit',
  now(),
  document.review_note
from reviewed_documents document
join public.blog_information_official_source_registry registry
  on registry.hostname = document.hostname
 and registry.source_type = document.source_type
on conflict (official_source_registry_id, source_url) do update
set
  intents = excluded.intents,
  destinations = excluded.destinations,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

commit;
