'use client';

import { useState } from 'react';

interface PendingAction {
  id: string;
  toolName: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  args: Record<string, unknown>;
}

interface ActionCardProps {
  action: PendingAction;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

const RISK_STYLES = {
  low: { bg: 'bg-green-50', border: 'border-green-300', badge: 'bg-green-100 text-green-700', label: 'Low' },
  medium: { bg: 'bg-amber-50', border: 'border-amber-300', badge: 'bg-amber-100 text-amber-700', label: 'Medium' },
  high: { bg: 'bg-red-50', border: 'border-red-300', badge: 'bg-red-100 text-red-700', label: 'High' },
  critical: { bg: 'bg-red-100', border: 'border-red-500', badge: 'bg-red-700 text-white', label: 'Critical' },
} as const;

export function ActionCard({ action, onApprove, onReject }: ActionCardProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const style = RISK_STYLES[action.riskLevel] ?? RISK_STYLES.high;

  const handleApprove = async () => {
    setLoading('approve');
    try {
      await onApprove(action.id);
    } finally {
      setLoading(null);
    }
  };

  const handleReject = async () => {
    setLoading('reject');
    try {
      await onReject(action.id);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={`my-3 max-w-md rounded-admin-md border-2 ${style.border} ${style.bg} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-admin-text-2">Jarvis approval request</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
          Risk {style.label}
        </span>
      </div>

      <p className="mb-2 text-sm font-medium text-admin-text">{action.description}</p>

      <div className="mb-3 rounded-lg bg-white/70 p-2.5 font-mono text-xs text-admin-muted">
        {Object.entries(action.args).map(([key, value]) => (
          <div key={key} className="break-all">
            <span className="text-purple-700">{key}</span>: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          className="flex-1 rounded-lg bg-purple-700 py-2 text-sm font-semibold text-white transition hover:bg-purple-800 disabled:opacity-50"
        >
          {loading === 'approve' ? 'Processing...' : 'Approve'}
        </button>
        <button
          onClick={handleReject}
          disabled={loading !== null}
          className="flex-1 rounded-lg border border-admin-border-strong bg-white py-2 text-sm font-semibold text-admin-text-2 transition hover:bg-admin-bg disabled:opacity-50"
        >
          {loading === 'reject' ? 'Processing...' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
