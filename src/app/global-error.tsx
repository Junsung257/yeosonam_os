'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('[GlobalError]', error.message, error.stack?.split('\n').slice(0, 15).join('\n'));

  return (
    <html>
      <body>
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', textAlign: 'center' }}>
          <h2>문제가 발생했습니다</h2>
          <pre style={{ color: '#c00', background: '#fee', padding: '1rem', borderRadius: '8px', textAlign: 'left', fontSize: '13px', maxWidth: '800px', margin: '1rem auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
{error.message}
{error.stack}</pre>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
