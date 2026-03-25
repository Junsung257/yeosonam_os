/**
 * Clobe.ai 슬랙 메시지 파서 — v2
 *
 * ── 실제 Vercel 수신 형식 (HTML Entity 인코딩 포함) ──
 *   입금 2건
 *   &gt; 2026-03-16 21:48:56
 *   &gt; 김아름 ·
 *   &gt; 200,000원
 *   &gt; 2026-03-16 14:19:51
 *   &gt; 박준성 ·
 *   &gt; 150,000원
 *   출금 1건
 *   &gt; 2026-03-16 14:16:24
 *   &gt; 주식회사투어폰 ·
 *   &gt; 1,000,500원
 *   거래내역 보러가기
 *
 * ── 핵심 수정 (v2) ──
 *   [Bug#1] 다중 트랜잭션: 트랜잭션 커밋 후 step='AWAIT_TYPE'으로 리셋하면
 *           같은 타입 블록의 2번째 거래 DateTime 라인을 아무 핸들러도
 *           못 받아서 통째로 SKIP됨.
 *   → 커밋 후 step='AWAIT_DATETIME' (같은 txType 유지, date/name 리셋)
 *   → 타입 헤더 라인은 step 무관하게 항상 우선 인식 → 타입 전환 정상 동작
 */

export interface ClobeTransaction {
  type:            '입금' | '출금';
  name:            string;
  amount:          number;
  memo:            string;
  transactionDate: string;  // ISO 8601 KST (+09:00)
}

type ParseStep = 'AWAIT_TYPE' | 'AWAIT_DATETIME' | 'AWAIT_NAME' | 'AWAIT_AMOUNT';

// ─── 전처리 ─────────────────────────────────────────────────────────────────

/**
 * HTML Entity 디코딩 + 마크다운 제거 + `>` 구분자 → 줄바꿈 정규화
 *
 * blocks/rich_text 에서 추출된 텍스트는 이미 디코딩된 상태일 수 있으므로
 * 두 형태 모두 처리.
 */
function preprocessClobeText(raw: string): string {
  return raw
    .replace(/&gt;/g,  '>')
    .replace(/&lt;/g,  '<')
    .replace(/&amp;/g, '&')
    .replace(/\*/g,    '')
    .replace(/[_~`]/g, '')
    .replace(/[ \t]*>[ \t]*/g, '\n');  // > 구분자 → 줄바꿈
}

// ─── 메인 파서 ───────────────────────────────────────────────────────────────

export function parseClobeMessage(raw: string): ClobeTransaction[] {
  const results: ClobeTransaction[] = [];

  // 1단계: 전처리 & 줄 분해
  const cleaned = preprocessClobeText(raw);
  console.log('[ClobeParser v2] 전처리 완료 (앞 400자):\n', cleaned.slice(0, 400));

  const lines = cleaned
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^거래내역\s*보러가기/i.test(l));

  console.log('[ClobeParser v2] 정규화 줄 목록:', lines);

  // 2단계: 상태머신
  //
  // ── 핵심 수정 ──
  // 초기 step = 'AWAIT_TYPE' 이지만, 트랜잭션 커밋 후엔 'AWAIT_DATETIME'으로
  // 리셋하여 같은 타입 블록 내 다음 거래를 연속 처리.
  // 타입 헤더 ("입금/출금 N건") 는 step 무관하게 항상 최우선 감지.
  let step:   ParseStep    = 'AWAIT_TYPE';
  let txType: '입금' | '출금' = '입금';
  let txDate: string       = '';
  let txName: string       = '';

  for (const line of lines) {

    // ── [최우선] 유형 헤더: "입금 N건" / "출금 N건" ──
    // step 관계없이 항상 선처리 → 타입 전환 & 새 블록 시작
    const typeMatch = line.match(/^(입금|출금)\s+\d+\s*건/);
    if (typeMatch) {
      txType = typeMatch[1] as '입금' | '출금';
      txDate = '';
      txName = '';
      step   = 'AWAIT_DATETIME';
      console.log(`[ClobeParser v2] 유형 헤더 감지: ${txType}`);
      continue;
    }

    // ── 날짜/시각: "YYYY-MM-DD HH:mm:ss" ──
    // AWAIT_DATETIME 또는 AWAIT_NAME(날짜 누락 케이스 허용) 에서 처리
    if (step === 'AWAIT_DATETIME' || step === 'AWAIT_NAME') {
      const dtMatch = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
      if (dtMatch) {
        txDate = `${dtMatch[1]}T${dtMatch[2]}+09:00`;
        step   = 'AWAIT_NAME';
        continue;
      }
    }

    // ── 이름: "거래처명 ·" / "거래처명" ──
    if (step === 'AWAIT_NAME') {
      const isDatetime = /^\d{4}-\d{2}-\d{2}/.test(line);
      const isAmount   = /^[\d,]+\s*원/.test(line);

      if (!isDatetime && !isAmount) {
        txName = line.replace(/\s*[·•]\s*$/, '').trim();
        step   = 'AWAIT_AMOUNT';
        console.log('[ClobeParser v2] 이름 파싱:', txName);
        continue;
      }
    }

    // ── 금액: "1,000,500원" ──
    if (step === 'AWAIT_AMOUNT') {
      const amtMatch = line.match(/^([\d,]+)\s*원/);
      if (amtMatch && txName) {
        const amount = parseInt(amtMatch[1].replace(/,/g, ''), 10);

        console.log(
          `[ClobeParser v2] 파싱 성공 — 유형: ${txType} | 날짜: ${txDate} | 이름: ${txName} | 금액: ${amount}원`,
        );

        if (amount > 0) {
          results.push({
            type:            txType,
            name:            txName,
            amount,
            memo:            '',
            transactionDate: txDate || new Date().toISOString(),
          });
        }

        // ★ 핵심 수정: AWAIT_TYPE → AWAIT_DATETIME
        //   같은 타입 블록의 다음 거래 DateTime 라인을 즉시 처리할 수 있게 함.
        //   (타입 전환은 최우선 헤더 감지에서 처리됨)
        txDate = '';
        txName = '';
        step   = 'AWAIT_DATETIME';
        continue;
      }
    }
  }

  // 3단계: 정규식 폴백 (상태머신 결과 없을 때)
  if (results.length === 0) {
    console.warn('[ClobeParser v2] 상태머신 결과 없음 → 정규식 폴백 시도');

    // 폴백: 전처리된 cleaned 텍스트에서 트랜잭션 블록을 직접 추출
    const fallbackRe =
      /(입금|출금)\s*\d+\s*건.*?(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.*?)(?:\s*[·•])?\s*\n\s*([\d,]+)\s*원/gs;

    let m: RegExpExecArray | null;
    while ((m = fallbackRe.exec(cleaned)) !== null) {
      const type   = m[1] as '입금' | '출금';
      const date   = `${m[2]}T${m[3]}+09:00`;
      const name   = m[4].trim();
      const amount = parseInt(m[5].replace(/,/g, ''), 10);

      console.log(
        `[ClobeParser v2] 폴백 성공 — 유형: ${type} | 날짜: ${date} | 이름: ${name} | 금액: ${amount}원`,
      );

      if (amount > 0 && name) {
        results.push({ type, name, amount, memo: '', transactionDate: date });
      }
    }

    // 두 번째 폴백: 금액+이름만 있는 단순 패턴 (날짜 없는 경우)
    if (results.length === 0) {
      const simpleFallbackRe = /(입금|출금)\s*\d+\s*건[\s\S]*?([\d,]+)\s*원/g;
      const fallbackType = cleaned.includes('입금') ? '입금' : '출금';
      let sm: RegExpExecArray | null;
      while ((sm = simpleFallbackRe.exec(cleaned)) !== null) {
        const t = sm[1] as '입금' | '출금';
        const amount = parseInt(sm[2].replace(/,/g, ''), 10);
        if (amount > 0) {
          results.push({ type: t, name: '(이름 불명)', amount, memo: '', transactionDate: new Date().toISOString() });
          console.log(`[ClobeParser v2] 단순 폴백 — 유형: ${t} | 금액: ${amount}원 (이름 불명)`);
        }
      }
      if (results.length === 0) {
        console.error('[ClobeParser v2] 모든 폴백 실패. 원문:\n', cleaned.slice(0, 500));
        // 마지막 수단: 금액 숫자만 추출
        const amountOnlyRe = /([\d,]+)\s*원/g;
        let ao: RegExpExecArray | null;
        while ((ao = amountOnlyRe.exec(cleaned)) !== null) {
          const amount = parseInt(ao[1].replace(/,/g, ''), 10);
          if (amount > 0) {
            results.push({ type: fallbackType, name: '(이름 불명)', amount, memo: '', transactionDate: new Date().toISOString() });
            console.log(`[ClobeParser v2] 최후 폴백 — 금액: ${amount}원`);
          }
        }
      }
    }
  }

  // 4단계: 중복 제거 — Slack이 preview + body 동일 텍스트를 2회 전송할 경우 방어
  // 키: type|transactionDate|name|amount 가 완전히 동일하면 첫 번째만 유지
  const seen = new Set<string>();
  const deduped = results.filter(tx => {
    const key = `${tx.type}|${tx.transactionDate}|${tx.name}|${tx.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (deduped.length !== results.length) {
    console.log(`[ClobeParser v2] 중복 제거: ${results.length}건 → ${deduped.length}건`);
  }

  console.log(`[ClobeParser v2] 최종 파싱 결과: ${deduped.length}건`);
  return deduped;
}
