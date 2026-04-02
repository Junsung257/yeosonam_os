-- short_code: URL용 짧은 상품코드 (예: TP-NHA-05-02)
ALTER TABLE travel_packages ADD COLUMN IF NOT EXISTS short_code VARCHAR(20) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_packages_short_code ON travel_packages(short_code);
