-- Supabase SQL Editor에서 실행하세요
-- 깨진 content_creatives slug 10개 UPDATE

UPDATE content_creatives
SET slug = CASE id
 WHEN '238dc4f6-039a-4243-aadd-a6c0345900e4' THEN 'shimonoseki-fukuoka-beppu-preparation'
 WHEN '1cd353cb-c2f6-4b70-b2ac-899e05e3c523' THEN 'kualalumpur-singapore-malacca-weather'
 WHEN '84ac3cf9-039a-4243-aadd-a6c0345900e4' THEN 'shijiazhuang-currency-2'
 WHEN 'b53c31f6-6cc3-418f-a42e-f0db20df8d47' THEN 'vietnam-visa-free-2026'
 WHEN '7486a31d-e4ec-4254-8bf6-36dc4a9672c4' THEN 'japan-entry-qa'
 WHEN '868fc898-3ff0-4ffa-aef8-ae50e65c4c4f' THEN 'june-family-travel-best-3'
 WHEN '8a855e91-a833-4556-9b1c-b337a01fd2d1' THEN 'june-sapporo-weather'
 WHEN '98544e75-c119-4c7b-84df-7a7333ef2f0f' THEN 'travelwallet-vs-atm'
 WHEN '54335369-e546-423b-991b-c2443c190ad8' THEN 'europe-etias'
 WHEN 'dcf535e5-4efc-4306-8ae4-16e5e6ca3bcf' THEN 'xian-huashan-4n5d-value-a99559'
END
WHERE id IN (
 '238dc4f6-039a-4243-aadd-a6c0345900e4',
 '1cd353cb-c2f6-4b70-b2ac-899e05e3c523',
 '84ac3cf9-039a-4243-aadd-a6c0345900e4',
 'b53c31f6-6cc3-418f-a42e-f0db20df8d47',
 '7486a31d-e4ec-4254-8bf6-36dc4a9672c4',
 '868fc898-3ff0-4ffa-aef8-ae50e65c4c4f',
 '8a855e91-a833-4556-9b1c-b337a01fd2d1',
 '98544e75-c119-4c7b-84df-7a7333ef2f0f',
 '54335369-e546-423b-991b-c2443c190ad8',
 'dcf535e5-4efc-4306-8ae4-16e5e6ca3bcf'
);

-- 실행 후 영향받은 행 수를 확인하려면:
-- SELECT COUNT(*) FROM content_creatives WHERE id = ANY(ARRAY['238dc4f6-...', ...]);
