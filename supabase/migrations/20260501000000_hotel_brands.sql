-- hotel_brands: 동일 성급 내 브랜드 품질 티어 마스터
-- within_star_score: 같은 성급 내 상대적 품질 (0.5 = 평균, 1.0 = 최고급)
-- hotel_brand_max_bonus는 scoring_policies.hotel_brand_max_bonus (KRW)로 조절
-- 예) Aman(1.0) + max_bonus 60,000 → 5성 기본 150,000 + 60,000 = 210,000/박

CREATE TABLE hotel_brands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_family     text NOT NULL UNIQUE,
  name_patterns    text[] NOT NULL,          -- lowercase, no-space 패턴 배열
  applicable_stars int[] NOT NULL,           -- 적용 성급 {4,5} / {5} / {3,4,5}
  within_star_score numeric(3,2) NOT NULL CHECK (within_star_score BETWEEN 0 AND 1),
  notes            text,
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX hotel_brands_stars_idx ON hotel_brands USING GIN (applicable_stars);

-- ─────────────────────────────────────────────────────────────
-- 5성 Ultra Luxury (within_star_score ≥ 0.90)
-- ─────────────────────────────────────────────────────────────
INSERT INTO hotel_brands (brand_family, name_patterns, applicable_stars, within_star_score, notes) VALUES
('Aman',               ARRAY['아만','aman'],                                                       '{5}',   1.00, '최고급 부티크 리조트'),
('Six Senses',         ARRAY['식스센스','sixsenses','six senses'],                                '{5}',   0.97, '웰니스 울트라럭셔리'),
('Park Hyatt',         ARRAY['파크하얏트','parkhyatt','park hyatt'],                               '{5}',   0.95, NULL),
('Four Seasons',       ARRAY['포시즌','four seasons','fourseasons','포 시즌스'],                    '{5}',   0.95, NULL),
('Ritz-Carlton',       ARRAY['리츠칼튼','리츠 칼튼','ritzcarlton','ritz-carlton','ritz carlton'],  '{5}',   0.92, NULL),
('Mandarin Oriental',  ARRAY['만다린오리엔탈','만다린 오리엔탈','mandarin oriental'],               '{5}',   0.90, NULL),

-- ─────────────────────────────────────────────────────────────
-- 5성 Luxury (0.80–0.89)
-- ─────────────────────────────────────────────────────────────
('St. Regis',          ARRAY['세인트레지스','st regis','stregis'],                                  '{5}',   0.88, NULL),
('Rosewood',           ARRAY['로즈우드','rosewood'],                                               '{5}',   0.87, NULL),
('W Hotels',           ARRAY['w호텔','w hotel','whotels'],                                         '{4,5}', 0.85, NULL),
('Conrad',             ARRAY['콘래드','conrad'],                                                   '{5}',   0.85, NULL),
('JW Marriott',        ARRAY['jw메리어트','jw marriott','jw 메리어트'],                             '{5}',   0.82, NULL),
('Westin',             ARRAY['웨스틴','westin'],                                                   '{4,5}', 0.80, NULL),
('Hyatt Regency',      ARRAY['하얏트리젠시','hyatt regency','하얏트 리젠시'],                       '{4,5}', 0.78, NULL),
('InterContinental',   ARRAY['인터컨티넨탈','intercontinental','ihg'],                             '{4,5}', 0.78, NULL),
('Hilton',             ARRAY['힐튼','hilton'],                                                     '{4,5}', 0.75, '플래그십 힐튼 (Conrad 제외)'),
('Sheraton Grand',     ARRAY['쉐라톤그랜드','그랜드쉐라톤','sheraton grand'],                       '{5}',   0.72, NULL),
('Sofitel',            ARRAY['소피텔','sofitel'],                                                  '{4,5}', 0.70, NULL),

-- ─────────────────────────────────────────────────────────────
-- 5성 Upper Upscale (0.60–0.69)
-- ─────────────────────────────────────────────────────────────
('Pullman',            ARRAY['풀만','pullman'],                                                    '{4,5}', 0.68, NULL),
('Novotel',            ARRAY['노보텔','novotel'],                                                  '{4}',   0.65, NULL),
('Crowne Plaza',       ARRAY['크라운플라자','crowne plaza','크라운 플라자'],                        '{4,5}', 0.65, NULL),

-- ─────────────────────────────────────────────────────────────
-- 4성 (within_star_score 기준 4성 체인)
-- ─────────────────────────────────────────────────────────────
('Marriott',           ARRAY['메리어트','marriott'],                                               '{4}',   0.95, 'JW 제외 일반 메리어트'),
('Sheraton',           ARRAY['쉐라톤','sheraton'],                                                 '{4}',   0.88, 'Grand 제외'),
('Hyatt Place',        ARRAY['하얏트플레이스','hyatt place'],                                      '{4}',   0.85, NULL),
('Courtyard',          ARRAY['코트야드','courtyard'],                                              '{4}',   0.82, 'Courtyard by Marriott'),
('DoubleTree',         ARRAY['더블트리','doubletree'],                                             '{4}',   0.80, NULL),
('Holiday Inn',        ARRAY['홀리데이인','holiday inn'],                                          '{3,4}', 0.72, NULL),
('Ramada',             ARRAY['라마다','ramada'],                                                   '{3,4}', 0.68, NULL),
('Best Western',       ARRAY['베스트웨스턴','best western'],                                       '{3,4}', 0.62, NULL),

-- ─────────────────────────────────────────────────────────────
-- 3성
-- ─────────────────────────────────────────────────────────────
('ibis Styles',        ARRAY['이비스스타일','ibis styles','이비스 스타일'],                         '{3}',   0.88, NULL),
('Hampton',            ARRAY['햄프턴','hampton'],                                                  '{3}',   0.85, 'Hampton Inn by Hilton'),
('ibis',               ARRAY['이비스','ibis'],                                                     '{3}',   0.70, NULL);

-- scoring_policies에 hotel_brand_max_bonus 컬럼 추가 (KRW 단위 보너스 상한)
-- default 60,000 → Aman 5성 = 150,000 + 60,000 = 210,000/박
ALTER TABLE scoring_policies
  ADD COLUMN IF NOT EXISTS hotel_brand_max_bonus integer NOT NULL DEFAULT 60000;
