#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return e?.stdout?.toString?.().trim?.() || '';
  }
}

function parseGitStatus() {
  const raw = run('git status --porcelain');
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      // porcelain v1: XY<space>PATH — 단, 일부 환경에서 `M path`처럼 보이는 줄이 있으면
      // slice(3) 이 경로 첫 글자를 잘라먹을 수 있어 분기 처리한다.
      let status;
      let path;
      if (line.length >= 3 && line[2] === ' ') {
        status = (line.slice(0, 2) || '??').padEnd(2, ' ');
        path = line.slice(3);
      } else {
        const sp = line.indexOf(' ');
        if (sp <= 0) {
          status = '??';
          path = line.trim();
        } else {
          status = line.slice(0, sp).padEnd(2, ' ').slice(0, 2);
          path = line.slice(sp + 1);
        }
      }
      if (path.includes(' -> ')) {
        const parts = path.split(' -> ');
        path = parts[parts.length - 1] || path;
      }
      path = path.trim().replace(/^"+|"+$/g, '');
      return { status, path: path || line.trim() };
    });
}

function isNoisePath(path) {
  const p = path.replace(/\\/g, '/');
  return (
    p.startsWith('.next/') ||
    p.startsWith('node_modules/') ||
    p.startsWith('.cursor/') ||
    p === 'docs/os-improvement-inbox.md' ||
    p === '.cursor-home-fetch.html' ||
    p.endsWith('.log') ||
    p === 'lint_output.txt'
  );
}

function collectTodoMarkers() {
  const raw = run('rg -n "(TODO|FIXME|HACK|XXX)" src docs');
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).slice(0, 200);
}

function scorePriority(path) {
  const p = path.replace(/\\/g, '/').toLowerCase();
  let score = 0;
  if (p.includes('/api/auth/') || p.includes('/payments') || p.includes('booking') || p.includes('ledger')) score += 100;
  if (p.includes('/api/cron/') || p.includes('/api/tracking') || p.includes('/lib/kakao') || p.includes('/affiliat')) score += 80;
  if (p.includes('/middleware') || p.includes('supabase') || p.includes('/migrations/')) score += 70;
  if (p.includes('/app/page') || p.includes('/components/')) score += 40;
  if (p.endsWith('.md')) score -= 15;
  return score;
}

function classifyBand(score) {
  if (score >= 100) return 'P0';
  if (score >= 70) return 'P1';
  if (score >= 35) return 'P2';
  return 'P3';
}

function detectArea(path) {
  const p = path.replace(/\\/g, '/');
  if (p.includes('/api/')) return 'API';
  if (p.includes('/app/')) return 'APP';
  if (p.includes('/components/')) return 'UI';
  if (p.includes('/lib/')) return 'LIB';
  if (p.includes('/migrations/')) return 'DB';
  if (p.startsWith('docs/')) return 'DOCS';
  return 'ETC';
}

function toKstIso() {
  const d = new Date();
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d).replace(' ', 'T') + '+09:00';
}

function main() {
  const status = parseGitStatus();
  const actionable = status.filter((s) => !isNoisePath(s.path));
  const todos = collectTodoMarkers();
  const prioritized = actionable
    .map((row) => {
      const score = scorePriority(row.path);
      return { ...row, score, band: classifyBand(score) };
    })
    .sort((a, b) => b.score - a.score);
  const p0p1 = prioritized.filter((r) => r.band === 'P0' || r.band === 'P1').slice(0, 30);
  const areaCount = new Map();
  for (const row of prioritized) {
    const area = detectArea(row.path);
    areaCount.set(area, (areaCount.get(area) || 0) + 1);
  }

  const lines = [];
  lines.push('# OS Improvement Inbox');
  lines.push('');
  lines.push(`- generated_at_kst: ${toKstIso()}`);
  lines.push(`- actionable_changed_files: ${actionable.length}`);
  lines.push(`- todo_markers: ${todos.length}`);
  lines.push(
    `- areas: ${Array.from(areaCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
  lines.push('');
  lines.push('## 1) Actionable Changed Files');
  lines.push('');
  if (actionable.length === 0) {
    lines.push('- 없음');
  } else {
    for (const row of actionable.slice(0, 200)) {
      lines.push(`- \`${row.status}\` \`${row.path}\``);
    }
  }
  lines.push('');
  lines.push('## 2) TODO/FIXME/HACK/XXX Markers');
  lines.push('');
  if (todos.length === 0) {
    lines.push('- 없음');
  } else {
    for (const row of todos) lines.push(`- ${row}`);
  }
  lines.push('');
  lines.push('## 3) Auto Priority Candidates (P0/P1)');
  lines.push('');
  if (p0p1.length === 0) {
    lines.push('- 없음');
  } else {
    for (const row of p0p1) {
      lines.push(`- [ ] ${row.band} \`${row.status}\` \`${row.path}\``);
    }
  }
  lines.push('');
  lines.push('## 4) Next Actions (Manual Prioritization Queue)');
  lines.push('');
  lines.push('- [ ] P0: 운영 장애/결제/데이터 정합성 이슈');
  lines.push('- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)');
  lines.push('- [ ] P2: UX/관리자 생산성 개선');
  lines.push('- [ ] P3: 리팩토링/문서화');
  lines.push('');
  lines.push('> 실행: `npm run os:inbox`');

  const outDir = join(process.cwd(), 'docs');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'os-improvement-inbox.md');
  writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`written: ${outPath}\n`);
}

main();
