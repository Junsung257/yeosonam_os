-- 여행 상품 테이블
CREATE TABLE travel_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  destination VARCHAR(255),
  duration INT,
  price INT,
  filename VARCHAR(255),
  file_type VARCHAR(20),
  raw_text TEXT,
  itinerary TEXT[] DEFAULT '{}',
  inclusions TEXT[] DEFAULT '{}',
  excludes TEXT[] DEFAULT '{}',
  accommodations TEXT[] DEFAULT '{}',
  special_notes TEXT,
  confidence FLOAT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  parsed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  notes TEXT
);

-- Q&A (고객 문의) 테이블
CREATE TABLE qa_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  inquiry_type VARCHAR(50), -- product_recommendation, price_comparison, general_consultation
  related_packages UUID[] DEFAULT '{}',
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  status VARCHAR(50) DEFAULT 'pending', -- pending, answered, closed
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP DEFAULT NULL,
  answered_by UUID
);

-- AI 생성 응답 테이블
CREATE TABLE ai_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id UUID REFERENCES qa_inquiries(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  ai_model VARCHAR(50), -- openai, claude, gemini
  confidence FLOAT DEFAULT 0,
  used_packages UUID[] DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  admin_feedback TEXT,
  approved BOOLEAN DEFAULT FALSE
);

-- 마진율 관리 테이블
CREATE TABLE margin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID REFERENCES travel_packages(id) ON DELETE CASCADE,
  base_price INT NOT NULL,
  vip_margin_percent FLOAT DEFAULT 10, -- VIP 고객 마진율
  regular_margin_percent FLOAT DEFAULT 15, -- 일반 고객 마진율
  bulk_margin_percent FLOAT DEFAULT 20, -- 단체 마진율
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 제휴사 정보 테이블
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100), -- airline, hotel, activity, guide
  api_endpoint VARCHAR(500),
  api_key VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스 생성 (성능 최적화)
CREATE INDEX idx_packages_status ON travel_packages(status);
CREATE INDEX idx_packages_destination ON travel_packages(destination);
CREATE INDEX idx_inquiries_status ON qa_inquiries(status);
CREATE INDEX idx_inquiries_created_at ON qa_inquiries(created_at);
CREATE INDEX idx_responses_inquiry_id ON ai_responses(inquiry_id);
CREATE INDEX idx_responses_created_at ON ai_responses(created_at);
