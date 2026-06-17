import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type ContractArea = 'external-channel' | 'admin-surface';

interface CustomerInquiryContractCheck {
  id: string;
  area: ContractArea;
  file: string;
  description: string;
  expected: string[];
  missing: string[];
  passed: boolean;
}

export interface CustomerInquiryContractSummary {
  total: number;
  passed: number;
  failed: number;
  score: number;
  status: 'pass' | 'fail';
  checks: CustomerInquiryContractCheck[];
}

interface ContractSpec {
  id: string;
  area: ContractArea;
  file: string;
  description: string;
  expected: string[];
}

const CONTRACTS: ContractSpec[] = [
  {
    id: 'kakao-webhook-ingest',
    area: 'external-channel',
    file: 'src/app/api/webhooks/kakao/route.ts',
    description: 'Kakao webhook records inbound messages and appends them to conversations.',
    expected: [
      'x-kakao-signature',
      'kakao_inbound',
      'is_processed',
      'conversations',
      "channel: 'kakao'",
    ],
  },
  {
    id: 'kakao-inbox-admin-feed',
    area: 'external-channel',
    file: 'src/app/api/jarvis/kakao-inbox/route.ts',
    description: 'Jarvis admin can fetch unprocessed Kakao inbound messages.',
    expected: [
      'kakao_inbound',
      'is_processed',
      'received_at',
      'limit(20)',
    ],
  },
  {
    id: 'qa-escalation-cta',
    area: 'external-channel',
    file: 'src/app/api/qa/escalation-cta/route.ts',
    description: 'Customer escalation CTA supports phone/Kakao, rate limiting, learning, and inquiry logging.',
    expected: [
      "new Set(['phone', 'kakao'])",
      'allowRateLimit',
      'recordPlatformLearningEvent',
      'redactForPlatformLearning',
      'saveInquiry',
      "inquiryType: 'escalation_cta'",
    ],
  },
  {
    id: 'admin-jarvis-chat-actions',
    area: 'admin-surface',
    file: 'src/app/admin/jarvis/page.tsx',
    description: 'Admin Jarvis screen exposes chat, HITL approvals, Kakao inbox count, and answer feedback.',
    expected: [
      'useJarvisStream',
      'AgentActionsPanel',
      'JarvisReadinessCard',
      'JarvisRagStatusCard',
      '/api/jarvis/kakao-inbox',
      '/api/agent-actions?status=pending',
      '/api/jarvis/approve',
      '/api/qa/feedback',
    ],
  },
  {
    id: 'admin-rag-search',
    area: 'admin-surface',
    file: 'src/app/admin/jarvis/rag/page.tsx',
    description: 'Admin RAG screen calls the RAG search API and links back to Jarvis.',
    expected: [
      '/api/admin/jarvis/rag-search',
      '/admin/jarvis',
      'source',
      'confidence',
    ],
  },
  {
    id: 'admin-concierge-console',
    area: 'admin-surface',
    file: 'src/app/admin/concierge/page.tsx',
    description: 'Admin concierge screen loads transactions and links to transaction detail handling.',
    expected: [
      '/api/concierge/transactions',
      '/api/admin/mock-configs',
      '/concierge',
      '/admin/concierge/transactions/',
    ],
  },
  {
    id: 'admin-escalations-console',
    area: 'admin-surface',
    file: 'src/app/admin/escalations/page.tsx',
    description: 'Admin escalation console lists QA escalations and supports operator takeover.',
    expected: [
      '/api/admin/hitl/tasks',
      '/api/admin/hitl/takeover',
      'escalation_cta',
      'takeover',
    ],
  },
];

function readProjectFile(projectRoot: string, relativeFile: string): string | null {
  const absolutePath = path.join(projectRoot, relativeFile);
  if (!existsSync(absolutePath)) return null;
  return readFileSync(absolutePath, 'utf8');
}

export function evaluateCustomerInquiryContracts(projectRoot = process.cwd()): CustomerInquiryContractSummary {
  const checks = CONTRACTS.map((contract): CustomerInquiryContractCheck => {
    const content = readProjectFile(projectRoot, contract.file);
    const missing = content === null
      ? contract.expected
      : contract.expected.filter((token) => !content.includes(token));

    return {
      ...contract,
      missing,
      passed: missing.length === 0,
    };
  });
  const passed = checks.filter((check) => check.passed).length;
  const total = checks.length;
  return {
    total,
    passed,
    failed: total - passed,
    score: total === 0 ? 0 : Math.round((passed / total) * 100),
    status: passed === total ? 'pass' : 'fail',
    checks,
  };
}
