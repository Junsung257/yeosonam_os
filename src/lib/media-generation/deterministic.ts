import sharp from 'sharp';
import { assertDeterministicRenderingAllowed } from './policy';
import { normalizeAndInspectMediaImage } from './image-quality';
import {
  buildMediaIdempotencyKey,
  completeMediaAsset,
  createPendingMediaAsset,
  failMediaAsset,
  findPersistedMediaAsset,
} from './persistence';
import type { RenderDeterministicMediaInput } from './types';

const DETERMINISTIC_PROMPT_VERSION = 'yeosonam-deterministic-v1';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildSvg(input: RenderDeterministicMediaInput): string {
  const eyebrow = escapeXml(compact(input.eyebrow || input.brief.destination || '여소남 여행 가이드', 46));
  const title = escapeXml(compact(input.title, 42));
  const lines = input.lines.map((line) => compact(line, 58)).filter(Boolean).slice(0, 4);
  const footer = escapeXml(compact(input.footer || '실제 일정과 조건은 본문 및 예약 안내에서 확인하세요.', 80));
  const lineNodes = lines.map((line, index) => `
    <g transform="translate(128 ${430 + index * 78})">
      <circle cx="16" cy="-7" r="7" fill="#F59E0B"/>
      <text x="48" y="0" font-family="Pretendard, Arial, sans-serif" font-size="34" font-weight="600" fill="#E2E8F0">${escapeXml(line)}</text>
    </g>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864" viewBox="0 0 1536 864">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0F172A"/>
        <stop offset="1" stop-color="#1E3A5F"/>
      </linearGradient>
      <radialGradient id="glow" cx="78%" cy="22%" r="60%">
        <stop offset="0" stop-color="#38BDF8" stop-opacity=".26"/>
        <stop offset="1" stop-color="#38BDF8" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1536" height="864" fill="url(#bg)"/>
    <rect width="1536" height="864" fill="url(#glow)"/>
    <rect x="88" y="80" width="1360" height="704" rx="34" fill="#0B1220" fill-opacity=".42" stroke="#FFFFFF" stroke-opacity=".12"/>
    <text x="128" y="170" font-family="Pretendard, Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="2" fill="#FBBF24">${eyebrow}</text>
    <text x="128" y="302" font-family="Pretendard, Arial, sans-serif" font-size="68" font-weight="800" fill="#FFFFFF">${title}</text>
    <rect x="128" y="342" width="110" height="7" rx="4" fill="#38BDF8"/>
    ${lineNodes}
    <text x="128" y="738" font-family="Pretendard, Arial, sans-serif" font-size="24" fill="#94A3B8">${footer}</text>
    <text x="1330" y="738" text-anchor="end" font-family="Pretendard, Arial, sans-serif" font-size="24" font-weight="700" fill="#FFFFFF">YEOSONAM</text>
  </svg>`;
}

export async function renderDeterministicMedia(
  input: RenderDeterministicMediaInput,
) {
  assertDeterministicRenderingAllowed(input.brief);
  const enrichedBrief = {
    ...input.brief,
    factualConstraints: [
      ...(input.brief.factualConstraints ?? []),
      input.eyebrow ?? '',
      input.title,
      ...input.lines,
      input.footer ?? '',
    ].filter(Boolean),
  };
  const idempotencyKey = buildMediaIdempotencyKey(enrichedBrief, DETERMINISTIC_PROMPT_VERSION);
  const existing = await findPersistedMediaAsset(idempotencyKey);
  if (existing) return existing;
  const id = await createPendingMediaAsset({
    brief: enrichedBrief,
    promptVersion: DETERMINISTIC_PROMPT_VERSION,
    sourceKind: 'code_rendered',
    provider: 'code',
    model: 'sharp-svg-v1',
    idempotencyKey,
  });

  try {
    const png = await sharp(Buffer.from(buildSvg(input))).png().toBuffer();
    const normalized = await normalizeAndInspectMediaImage(png);
    return await completeMediaAsset({
      id,
      brief: enrichedBrief,
      sourceKind: 'code_rendered',
      provider: 'code',
      model: 'sharp-svg-v1',
      promptVersion: DETERMINISTIC_PROMPT_VERSION,
      mainBytes: normalized.bytes,
      ogBytes: normalized.ogBytes,
      squareBytes: normalized.squareBytes,
      portraitBytes: normalized.portraitBytes,
      sha256: normalized.sha256,
      ogSha256: normalized.ogSha256,
      squareSha256: normalized.squareSha256,
      portraitSha256: normalized.portraitSha256,
      width: normalized.width,
      height: normalized.height,
      qa: normalized.qa,
      costUsd: 0,
      approvalMode: input.approvalMode ?? 'automatic',
    });
  } catch (error) {
    await failMediaAsset(id, error);
    throw error;
  }
}
