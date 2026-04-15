/**
 * 여소남 OS — 콘텐츠 품질 평가 (Phase 2.5)
 *
 * 목적: 블로그/카드뉴스 등 생성된 콘텐츠가 회사 규칙을 위반하는지 자동 검출
 *
 * 사용법:
 *   npx tsx scripts/eval-content-prompts.ts <file-or-dir>
 *   npx tsx scripts/eval-content-prompts.ts ./samples/
 *   npx tsx scripts/eval-content-prompts.ts ./blog-post.md
 *
 * 검사 규칙 (feedback memory 기반):
 *   1. 금지 형용사: "매력적인", "아름다운", "특별한", "완벽한" 등 클리셰
 *   2. 거짓 경험: "다녀왔", "가봤" — 법적 리스크 + 브랜드 신뢰 훼손
 *   3. 복붙 패턴: 네이버 여소남 참고글의 오프닝/클로징 재사용
 *   4. 원가/커미션 노출: 고객 대상 텍스트에 내부 숫자 유출 방지
 *   5. 랜드사 직접 언급: "랜드사 XX에서" 대신 "여소남"으로 통일
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 규칙 정의 ────────────────────────────────────────────────

const FORBIDDEN_ADJECTIVES = [
  '매력적인', '매력적으로', '매력적',
  '아름다운', '아름답게', '아름다움',
  '특별한', '특별하게', '특별함',
  '완벽한', '완벽하게', '완벽함',
  '환상적인', '환상적', '환상의',
  '잊지 못할', '잊을 수 없는',
  '꿈같은', '꿈꾸던', '꿈의',
  '놓치지 마세요', '놓칠 수 없는',
  '최고의', '최상의', '최고급',
  '유니크한', '독특한',
  '프리미엄급', '럭셔리한',
];

const FORBIDDEN_EXPERIENCE = [
  '다녀왔', '다녀와 봤', '다녀온',
  '가봤', '가 봤',
  '경험해보니', '경험해봤',
  '직접 체크했', '직접 확인했',
  '여러 번 다녀',
  '먹어봤', '묵어봤', '타봤', '이용해봤',
  '저도 가족', '저희 가족이 다녀',
];

const CLICHE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: '과도한 느낌표 (2연속 이상)',
    regex: /!{2,}/g,
  },
  {
    name: '복붙 오프닝 ("안녕하세요 가치 있는 여행을 소개하는 여소남")',
    regex: /안녕하세요[.!?\s]*가치\s*있는\s*여행을\s*소개하는\s*여소남/g,
  },
  {
    name: '복붙 클로징 ("지금 바로 링크를 복사")',
    regex: /지금\s*바로.*?링크를\s*복사/g,
  },
  {
    name: '긴급감 클리셰 ("잔여 좌석이 얼마 남지 않")',
    regex: /잔여\s*좌석이\s*얼마\s*남지\s*않/g,
  },
  {
    name: '원가/커미션 수치 노출 의심 (예: "원가 200만원", "10% 커미션")',
    regex: /원가\s*[\d,]+\s*(원|만원)|커미션\s*\d+\s*%/g,
  },
];

const TENANT_TRAPS: Array<{ name: string; regex: RegExp }> = [
  {
    name: '랜드사명 직접 노출 의심 ("XX랜드", "XX투어")',
    regex: /\b[가-힣A-Z][가-힣A-Za-z]{1,10}(랜드|투어)\b/g,
  },
];

// ── 분석 함수 ────────────────────────────────────────────────

type RuleHit = { label: string; count: number; examples: string[] };

type Report = {
  file: string;
  wordCount: number;
  hits: {
    forbiddenAdjectives: RuleHit[];
    forbiddenExperience: RuleHit[];
    cliches: RuleHit[];
    tenantTraps: RuleHit[];
  };
  totalIssues: number;
  score: number;
};

function countMatches(text: string, needle: string): { count: number; examples: string[] } {
  const regex = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const matches = text.match(regex);
  if (!matches) return { count: 0, examples: [] };
  return { count: matches.length, examples: matches.slice(0, 2) };
}

function regexMatches(text: string, regex: RegExp): { count: number; examples: string[] } {
  const all: string[] = [];
  let m: RegExpExecArray | null;
  const cloned = new RegExp(regex.source, regex.flags);
  while ((m = cloned.exec(text)) !== null) {
    all.push(m[0]);
    if (all.length > 50) break;
  }
  return { count: all.length, examples: all.slice(0, 2) };
}

function analyze(text: string, file: string): Report {
  const wordCount = text.trim().split(/\s+/).length;

  const forbiddenAdjectives: RuleHit[] = FORBIDDEN_ADJECTIVES
    .map((word) => {
      const { count, examples } = countMatches(text, word);
      return count > 0 ? { label: word, count, examples } : null;
    })
    .filter((x): x is RuleHit => !!x);

  const forbiddenExperience: RuleHit[] = FORBIDDEN_EXPERIENCE
    .map((phrase) => {
      const { count, examples } = countMatches(text, phrase);
      return count > 0 ? { label: phrase, count, examples } : null;
    })
    .filter((x): x is RuleHit => !!x);

  const cliches: RuleHit[] = CLICHE_PATTERNS
    .map(({ name, regex }) => {
      const { count, examples } = regexMatches(text, regex);
      return count > 0 ? { label: name, count, examples } : null;
    })
    .filter((x): x is RuleHit => !!x);

  const tenantTraps: RuleHit[] = TENANT_TRAPS
    .map(({ name, regex }) => {
      const { count, examples } = regexMatches(text, regex);
      return count > 0 ? { label: name, count, examples } : null;
    })
    .filter((x): x is RuleHit => !!x);

  const totalIssues =
    forbiddenAdjectives.reduce((s, r) => s + r.count, 0) +
    forbiddenExperience.reduce((s, r) => s + r.count * 3, 0) + // 거짓경험은 가중치 3배 (법적 리스크)
    cliches.reduce((s, r) => s + r.count, 0) +
    tenantTraps.reduce((s, r) => s + r.count, 0);

  // 점수: 1000자당 이슈 비율로 정규화, 100점 만점
  const issuesPerK = (totalIssues / Math.max(1, wordCount)) * 1000;
  const score = Math.max(0, Math.min(100, Math.round(100 - issuesPerK * 5)));

  return {
    file,
    wordCount,
    hits: { forbiddenAdjectives, forbiddenExperience, cliches, tenantTraps },
    totalIssues,
    score,
  };
}

// ── 파일 수집 ────────────────────────────────────────────────

function collectFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.(md|txt|html)$/i.test(e.name))
      .map((e) => path.join(target, e.name));
  }
  return [];
}

// ── 출력 ────────────────────────────────────────────────────

function printReport(r: Report): void {
  const bar = '─'.repeat(64);
  console.log(bar);
  console.log(`파일: ${r.file}`);
  console.log(`글자수(단어 기준): ${r.wordCount}  |  총 이슈: ${r.totalIssues}  |  점수: ${r.score}/100`);
  console.log(bar);

  function section(title: string, hits: RuleHit[]) {
    if (hits.length === 0) return;
    console.log(`\n[${title}]`);
    hits
      .sort((a, b) => b.count - a.count)
      .forEach((h) => {
        const ex = h.examples.map((e) => `"${e.slice(0, 40)}..."`).join(' / ');
        console.log(`  - ${h.label}: ${h.count}회  ${ex ? `예: ${ex}` : ''}`);
      });
  }

  section('🚫 금지 형용사 (Phase 2.5 규정)', r.hits.forbiddenAdjectives);
  section('⚠️  거짓 경험 (법적 리스크, 가중치 3배)', r.hits.forbiddenExperience);
  section('🔁 클리셰/복붙 패턴', r.hits.cliches);
  section('🏷️  테넌트 누출 의심 (랜드사명)', r.hits.tenantTraps);

  if (r.totalIssues === 0) {
    console.log('\n✅ 이슈 없음');
  }
  console.log('');
}

function printSummary(reports: Report[]): void {
  const avg = reports.reduce((s, r) => s + r.score, 0) / Math.max(1, reports.length);
  const fails = reports.filter((r) => r.score < 70);
  console.log('═'.repeat(64));
  console.log(`전체 ${reports.length}개 파일 | 평균 ${Math.round(avg)}/100 | 70점 미만 ${fails.length}개`);
  if (fails.length > 0) {
    console.log('\n❌ 재작성 권고 파일:');
    fails.forEach((r) => console.log(`   ${r.score}/100  ${r.file}`));
  }
  console.log('═'.repeat(64));
}

// ── 진입점 ──────────────────────────────────────────────────

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('사용법: npx tsx scripts/eval-content-prompts.ts <file-or-dir>');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    console.error(`경로 없음: ${abs}`);
    process.exit(1);
  }

  const files = collectFiles(abs);
  if (files.length === 0) {
    console.error('분석 가능한 파일 없음 (.md / .txt / .html)');
    process.exit(1);
  }

  const reports = files.map((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return analyze(text, path.relative(process.cwd(), f));
  });

  reports.forEach(printReport);
  printSummary(reports);

  const worstScore = Math.min(...reports.map((r) => r.score));
  process.exit(worstScore < 50 ? 2 : worstScore < 70 ? 1 : 0);
}

main();
