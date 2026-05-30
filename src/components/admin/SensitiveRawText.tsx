interface SensitiveRawTextProps {
  value: string | null | undefined;
  title?: string;
  description?: string;
  className?: string;
}

export default function SensitiveRawText({
  value,
  title = '원문',
  description = '민감정보가 포함될 수 있어 기본적으로 숨깁니다. 검수 목적일 때만 펼쳐 확인하세요.',
  className = '',
}: SensitiveRawTextProps) {
  const text = String(value ?? '').trim();

  if (!text) {
    return (
      <div className={`rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3 text-admin-xs text-admin-muted ${className}`}>
        저장된 원문이 없습니다.
      </div>
    );
  }

  return (
    <details className={`rounded-admin-sm border border-admin-border bg-admin-surface-2 ${className}`}>
      <summary className="cursor-pointer list-none px-3 py-2 text-admin-xs font-semibold text-admin-text hover:bg-admin-surface">
        <span>{title}</span>
        <span className="ml-2 font-normal text-admin-muted">{description}</span>
      </summary>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-admin-border px-3 py-3 font-mono text-[11px] leading-relaxed text-admin-text-2">
        {text}
      </pre>
    </details>
  );
}
