import { z } from 'zod';

export const ItineraryScheduleItemSchema = z.object({
  time: z.string().nullable().optional(),
  activity: z.string().min(1, "활동 내용은 필수입니다."),
  type: z.string().optional(),
  transport: z.string().nullable().optional(),
  note: z.string().nullable().optional()
});

export const ItineraryDaySchema = z.object({
  day: z.number().int().positive(),
  regions: z.array(z.string()).optional(),
  meals: z.object({
    breakfast: z.boolean().optional(),
    lunch: z.boolean().optional(),
    dinner: z.boolean().optional(),
    breakfast_note: z.string().nullable().optional(),
    lunch_note: z.string().nullable().optional(),
    dinner_note: z.string().nullable().optional()
  }).optional(),
  hotel: z.object({
    name: z.string(),
    grade: z.string().nullable().optional(),
    note: z.string().nullable().optional()
  }).nullable().optional(),
  schedule: z.array(ItineraryScheduleItemSchema).optional()
});

export const TravelPackageInsertSchema = z.object({
  title: z.string().min(5, "상품명은 5자 이상이어야 합니다."),
  display_title: z.string().min(5, "노출 상품명은 5자 이상이어야 합니다."),
  short_code: z.string().min(4, "short_code는 4자 이상이어야 합니다."), // UI상 상품코드
  
  // 랜드사 검증 강화 (필수)
  land_operator_id: z.string().uuid("랜드사 ID는 올바른 형식(UUID)이어야 합니다."),
  
  // 가격 테이블: A4 포스터 호환을 위해 배열로 강제
  price_dates: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다."),
    price: z.number().positive("가격은 양수여야 합니다."),
    confirmed: z.boolean().optional().default(false)
  })).min(1, "최소 1개 이상의 확정 날짜(price_dates) 데이터가 필요합니다. price_tiers를 사용하지 마십시오."),
  
  product_type: z.string().optional(),
  category: z.string().default('package'),
  status: z.string().default('available'),
  price: z.number().optional(), // 최저가 용도
  
  // 일정표 구조 검증
  itinerary_data: z.object({
    meta: z.object({
      title: z.string().optional(),
      nights: z.number().optional(),
      days: z.number().optional()
    }).passthrough().optional(),
    days: z.array(ItineraryDaySchema).min(1, "최소 1일 이상의 일정 데이터가 필요합니다.")
  })
}).passthrough(); // DB 스키마 업데이트를 위해 다른 필드들도 통과시킴
