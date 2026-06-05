const DOW_ORDER = ['일', '월', '화', '수', '목', '금', '토'];
const DOW_RE = /[일월화수목금토]/g;

function normalizeDowText(value: string): string | null {
  if (/매일/.test(value)) return '매일';
  const compact = value.replace(/\s+/g, '');
  if (/^(출발일|요일)$/.test(compact)) return null;
  if (/출발일|취소|수수료|만료일/.test(compact) && !/[(/][일월화수목금토]/.test(compact)) return null;
  const days: string[] = value.match(DOW_RE) ?? [];
  const unique = days.filter((day, index) => days.indexOf(day) === index && DOW_ORDER.includes(day));
  return unique.length > 0 ? unique.join(',') : null;
}

export function inferDepartureDaysFromRawText(rawText: string | null | undefined): string | null {
  if (!rawText?.trim()) return null;

  const compact = rawText.replace(/\r/g, '');
  const lines = compact.split(/\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/취소|수수료|만료일|출발일\s*기준/.test(line)) continue;
    if (/매일\s*출발/.test(line)) return '매일';
    if (!/출\s*발\s*일/.test(line)) continue;

    const context = [line, ...lines.slice(i + 1, i + 4)];
    const contextText = context.join(' ');
    if (/매일\s*출발/.test(contextText)) return '매일';

    const paren = contextText.match(/\(([^)]*[일월화수목금토][^)]*)\)/);
    if (paren?.[1]) {
      const local = normalizeDowText(paren[1]);
      if (local) return local;
    }

    for (const next of lines.slice(i + 1, i + 4)) {
      if (/판매가|요금|인원|룸타입|포함/.test(next)) break;
      if (/^(요일|출\s*발\s*일)$/.test(next.replace(/\s+/g, ''))) continue;
      const normalized = normalizeDowText(next);
      if (normalized) return normalized;
    }
  }

  const direct = compact.match(/출\s*발\s*일[\s\S]{0,120}?\(([^)]*[일월화수목금토][^)]*)\)/);
  if (direct?.[1]) {
    const normalized = normalizeDowText(direct[1]);
    if (normalized) return normalized;
  }

  return null;
}
