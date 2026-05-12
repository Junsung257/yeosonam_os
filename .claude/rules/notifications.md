---
description: 알림 시스템 어댑터 패턴 (Solapi 카카오 알림톡 / Mock 폴백) + message_logs DB 기록 보장.
paths:
  - "src/lib/notification-adapter.ts"
  - "src/lib/kakaoChannel.ts"
  - "src/app/api/notify/**/*.ts"
  - "src/app/api/sms/**/*.ts"
---

# 도메인 레시피: 알림 시스템

알림은 **어댑터 패턴**으로 분리되어 있습니다:
```typescript
const adapter = getNotificationAdapter(); // 환경변수에 따라 자동 선택
// Solapi 키 있음 → KakaoNotificationAdapter (알림톡 + DB)
// Solapi 키 없음 → MockNotificationAdapter (DB만)
await adapter.send(payload);
```

**카카오 알림톡이 실패해도 `message_logs` DB 기록은 반드시 보장됩니다.** 알림톡 발송과 DB 기록은 try/catch 분리.
