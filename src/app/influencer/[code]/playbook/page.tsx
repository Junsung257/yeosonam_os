'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useInfluencerAuth } from '../auth-context';

interface BestPractice {
  id?: string;
  title: string;
  channel: string;
  summary: string;
  example_url?: string | null;
  tags?: string[];
}

interface CsScript {
  id?: string;
  category: string;
  title: string;
  script: string;
}

export default function InfluencerPlaybookPage() {
  const params = useParams();
  const code = params.code as string;
  const { authenticated } = useInfluencerAuth();
  const [best, setBest] = useState<BestPractice[]>([]);
  const [scripts, setScripts] = useState<CsScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated) return;
    const run = async () => {
      setLoading(true);
      try {
        const pin = sessionStorage.getItem(`inf_pin_${code}`) || '';
        const res = await fetch(`/api/influencer/playbook?code=${encodeURIComponent(code)}`, {
          headers: pin ? { 'x-influencer-pin': pin } : {},
        });
        const json = await res.json();
        setBest(json.best_practices || []);
        setScripts(json.cs_scripts || []);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [authenticated, code]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  };

  if (!authenticated) return <p className="text-center py-16 text-gray-400">먼저 대시보드에서 인증해주세요.</p>;
  if (loading) return <div className="h-40 bg-white rounded-xl animate-pulse" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">성공사례 & CS 스크립트</h1>
        <p className="text-sm text-gray-500">전환 잘 나오는 패턴과 댓글/클레임 대응 문구를 바로 복사해 사용하세요.</p>
      </div>

      <section className="bg-white rounded-xl p-5 shadow-sm">
        <h2 className="font-bold text-gray-900 mb-3">이번 달 베스트 홍보 사례</h2>
        <div className="space-y-3">
          {best.map((item, idx) => (
            <div key={`${item.title}_${idx}`} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm font-semibold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500 mt-1">{item.channel}</p>
              <p className="text-sm text-gray-700 mt-2">{item.summary}</p>
              {item.tags?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.tags.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-700 rounded">{t}</span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
                  onClick={() => copy(`${item.title}\n${item.summary}`, `best_${idx}`)}
                >
                  {copied === `best_${idx}` ? '복사됨 ✓' : '요약 복사'}
                </button>
                {item.example_url ? (
                  <a href={item.example_url} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100">
                    예시 보기
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl p-5 shadow-sm">
        <h2 className="font-bold text-gray-900 mb-3">클레임/악플 대응 스크립트</h2>
        <div className="space-y-3">
          {scripts.map((s, idx) => (
            <div key={`${s.title}_${idx}`} className="border border-gray-100 rounded-lg p-3">
              <p className="text-sm font-semibold text-gray-900">{s.title}</p>
              <p className="text-[11px] text-gray-500 mt-1">{s.category}</p>
              <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{s.script}</p>
              <button
                className="mt-2 text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
                onClick={() => copy(s.script, `script_${idx}`)}
              >
                {copied === `script_${idx}` ? '복사됨 ✓' : '스크립트 복사'}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

