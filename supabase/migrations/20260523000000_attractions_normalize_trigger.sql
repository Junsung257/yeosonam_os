-- ─────────────────────────────────────────────────────────────────────────
-- attractions INSERT/UPDATE 자동 정규화 (2026-05-15)
-- 사장님 비전: "키워드만 박으면 다음번 등록에서 자동 매칭"
-- Root cause: page.tsx OR clause 가 ISO country 로 필터링하는데
--             caller 가 한글 country 또는 trimmed-only 값을 넣으면 fetch 누락.
-- 처방: BEFORE INSERT/UPDATE trigger 로 country 자동 ISO 정규화 + 공백 trim.
-- region 추론은 caller(예: autoSeedAttraction)에 맡김 — destination 정보 없어 trigger 불가.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_attractions_normalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  k text;
BEGIN
  NEW.name    := NULLIF(btrim(NEW.name), '');
  NEW.country := NULLIF(btrim(COALESCE(NEW.country, '')), '');
  NEW.region  := NULLIF(btrim(COALESCE(NEW.region, '')), '');

  IF NEW.country IS NOT NULL THEN
    k := lower(NEW.country);
    NEW.country := CASE
      WHEN k IN ('한국','대한민국','korea','south korea','kor') THEN 'KR'
      WHEN k IN ('일본','japan','jpn') THEN 'JP'
      WHEN k IN ('중국','china','chn') THEN 'CN'
      WHEN k IN ('베트남','vietnam','viet nam','vnm') THEN 'VN'
      WHEN k IN ('태국','thailand','tha') THEN 'TH'
      WHEN k IN ('필리핀','philippines','phl') THEN 'PH'
      WHEN k IN ('말레이시아','malaysia','mys') THEN 'MY'
      WHEN k IN ('싱가포르','singapore','sgp') THEN 'SG'
      WHEN k IN ('대만','taiwan','twn') THEN 'TW'
      WHEN k IN ('홍콩','hong kong','hkg') THEN 'HK'
      WHEN k IN ('마카오','macau','macao','mac') THEN 'MO'
      WHEN k IN ('인도네시아','indonesia','idn') THEN 'ID'
      WHEN k IN ('라오스','laos','lao') THEN 'LA'
      WHEN k IN ('몽골','mongolia','mng') THEN 'MN'
      WHEN k IN ('미얀마','myanmar','mmr','버마') THEN 'MM'
      WHEN k IN ('캄보디아','cambodia','khm') THEN 'KH'
      WHEN k IN ('인도','india','ind') THEN 'IN'
      WHEN k IN ('미국','usa','united states','us','america','american') THEN 'US'
      WHEN k IN ('영국','uk','united kingdom','britain','great britain') THEN 'GB'
      WHEN k IN ('프랑스','france','fra') THEN 'FR'
      WHEN k IN ('독일','germany','deu','ger') THEN 'DE'
      WHEN k IN ('이탈리아','italy','ita') THEN 'IT'
      WHEN k IN ('스페인','spain','esp') THEN 'ES'
      WHEN k IN ('스위스','switzerland','che','swiss') THEN 'CH'
      WHEN k IN ('호주','australia','aus') THEN 'AU'
      WHEN k IN ('뉴질랜드','new zealand','nzl') THEN 'NZ'
      WHEN k IN ('터키','튀르키예','turkey','tur','türkiye') THEN 'TR'
      ELSE upper(NEW.country)
    END;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_attractions_normalize() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_attractions_normalize ON public.attractions;
CREATE TRIGGER trg_attractions_normalize
BEFORE INSERT OR UPDATE OF country, region, name
ON public.attractions
FOR EACH ROW
EXECUTE FUNCTION public.fn_attractions_normalize();

COMMENT ON FUNCTION public.fn_attractions_normalize() IS
'attractions INSERT/UPDATE 시 country 한글→ISO 자동 변환 + 공백 trim. (2026-05-15) page.tsx OR clause 가 ISO country 로 필터링하는데 caller 마다 한글/ISO 혼재해서 fetch 누락되는 사고 영구 차단.';
