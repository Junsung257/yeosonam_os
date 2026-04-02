-- ============================================================
-- C 파서 정제/검증 레이어 v1
-- 1. normalization_rules: 오타 교정 사전
-- 2. exclusion_rules: 불포함 가드레일
-- ============================================================

-- 1. 정규화 사전 (오타 → 표준어)
CREATE TABLE IF NOT EXISTS normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  typo_pattern TEXT NOT NULL,              -- 오타 패턴 (plain text, NOT regex)
  correct_text TEXT NOT NULL,              -- 교정된 텍스트
  category TEXT DEFAULT 'general',         -- general / golf / tour / meal / hotel
  land_operator_id UUID REFERENCES land_operators(id), -- NULL이면 전체 적용
  is_active BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,                  -- 높을수록 먼저 적용 (충돌 방지)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_norm_rules_active ON normalization_rules(is_active, priority DESC);

-- 2. 불포함 가드레일 (필수 항목 누락 경고)
CREATE TABLE IF NOT EXISTS exclusion_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,                  -- golf / tour / cruise / resort 등
  rule_name TEXT NOT NULL,                 -- '캐디팁/캐디피', '카트비' 등
  match_keywords TEXT[] NOT NULL,          -- {'캐디팁', '캐디피', '캐디 팁'} 하나라도 매칭되면 통과
  severity TEXT DEFAULT 'warning'
    CHECK (severity IN ('warning', 'error')),
  description TEXT,                        -- 관리자 안내 문구
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_excl_rules_cat ON exclusion_rules(category, is_active);

-- ============================================================
-- 초기 시드: 정규화 사전
-- ============================================================
INSERT INTO normalization_rules (typo_pattern, correct_text, category, priority) VALUES
  -- 관광지 오타
  ('군사사석화', '군성사석화', 'tour', 10),
  ('군사사석화 박물관', '군성사석화박물관', 'tour', 11),
  ('군성사석화 박물관', '군성사석화박물관', 'tour', 9),

  -- 마사지 표기 통일
  ('맛사지', '마사지', 'general', 10),
  ('맛싸지', '마사지', 'general', 10),
  ('마싸지', '마사지', 'general', 10),

  -- 띄어쓰기 교정
  ('매너팁별도', '매너팁 별도', 'general', 5),
  ('팁별도', '팁 별도', 'general', 5),
  ('왕복케이블카', '왕복 케이블카', 'tour', 5),

  -- 호텔명 통일
  ('하워드존슨(구 하얏트)', '하워드존슨(하얏트)', 'hotel', 5),
  ('하워드존슨(구하얏트)', '하워드존슨(하얏트)', 'hotel', 5),

  -- 나트랑 관련
  ('롱손사', '롱선사', 'tour', 10),
  ('포나가르 탑', '포나가르탑', 'tour', 5),
  ('포나가르탑', '포나가르탑', 'tour', 1),  -- 이미 맞는 경우 skip용
  ('크레이지 하우스', '크레이지하우스', 'tour', 5),
  ('쑤언흐엉 호수', '쑤언흐엉호수', 'tour', 5),

  -- 항공 관련
  ('22;40', '22:40', 'general', 10),  -- 세미콜론 → 콜론 교정

  -- 가격 표기
  ('200,-', '200,000', 'general', 8),  -- 랜드부산 가격 패턴 (단독 사용 방지를 위해 우선순위 낮춤)

  -- 일반 오타
  ('하이다라오', '하이디라오', 'meal', 10),
  ('하이디라오', '하이디라오', 'meal', 1)   -- 이미 맞는 경우
ON CONFLICT DO NOTHING;

-- ============================================================
-- 초기 시드: 불포함 가드레일
-- ============================================================
INSERT INTO exclusion_rules (category, rule_name, match_keywords, severity, description) VALUES
  -- 골프 상품 필수 불포함 항목
  ('golf', '캐디팁/캐디피', ARRAY['캐디팁', '캐디피', '캐디 팁', '캐디 피'], 'warning',
   '골프 상품에 캐디팁/캐디피 안내가 없습니다. 고객 클레임 위험.'),
  ('golf', '카트비/카트피', ARRAY['카트비', '카트피', '카트 비', '카트 피', '카트요금', '카트 요금'], 'warning',
   '골프 상품에 카트비 안내가 없습니다.'),
  ('golf', '기사/가이드팁', ARRAY['가이드팁', '기사팁', '가이드 팁', '기사 팁', '기사/가이드팁', '기사/가이드 팁'], 'warning',
   '골프 상품에 기사/가이드팁 안내가 없습니다.'),

  -- 관광 상품 필수 불포함 항목
  ('tour', '매너팁/가이드경비', ARRAY['매너팁', '가이드경비', '가이드 경비', '기사경비', '기사 경비', '팁 불포함', '서비스차지'], 'warning',
   '관광 상품에 매너팁/가이드경비 안내가 없습니다.'),
  ('tour', '유류할증료 변동', ARRAY['유류변동', '유류할증', '유류 변동', '유류 할증'], 'warning',
   '유류할증료 변동 안내가 없습니다.'),

  -- 공통 필수 확인 항목
  ('tour', '여권 유효기간', ARRAY['여권', '6개월', '유효기간'], 'warning',
   '여권 유효기간 안내가 없습니다.'),
  ('golf', '여권 유효기간', ARRAY['여권', '6개월', '유효기간'], 'warning',
   '여권 유효기간 안내가 없습니다.'),

  -- 베트남 특수
  ('tour', '전자담배 금지 (베트남)', ARRAY['전자담배', '아이코스', '힛츠'], 'warning',
   '베트남 전자담배 금지 안내가 없습니다. (2025.01.01~)'),
  ('golf', '전자담배 금지 (베트남)', ARRAY['전자담배', '아이코스', '힛츠'], 'warning',
   '베트남 전자담배 금지 안내가 없습니다. (2025.01.01~)')
ON CONFLICT DO NOTHING;
