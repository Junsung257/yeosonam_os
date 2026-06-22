import { Bot, Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import {
  aiAdTeamStatusLabel,
  priorityLabel,
  type AdOsAgentOperatingModel,
  type AiAdTeamStatus,
} from '../_lib/agent-operating-model';
import { MetricGrid } from './MetricGrid';
import { StatusPill, type StatusPillTone } from './StatusPill';

function tone(status: AiAdTeamStatus): StatusPillTone {
  if (status === 'ready') return 'good';
  if (status === 'attention') return 'warn';
  return 'bad';
}

export function AiAdTeamPanel({
  model,
  onRunDiagnosis,
  onSaveMemory,
  runningDiagnosis = false,
  savingMemory = false,
}: {
  model: AdOsAgentOperatingModel;
  onRunDiagnosis?: () => void;
  onSaveMemory?: () => void;
  runningDiagnosis?: boolean;
  savingMemory?: boolean;
}) {
  const topHypothesis = model.roasDiagnostic.hypotheses[0];

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">AI 광고팀</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            기획, 성과 분석, 소재/카피, 보고 역할을 나눠서 광고 운영 근거를 정리합니다.
          </p>
        </div>
        <StatusPill tone={tone(model.overallStatus)}>
          팀 점수 {model.teamScore}% · {aiAdTeamStatusLabel(model.overallStatus)}
        </StatusPill>
      </div>
      {(onRunDiagnosis || onSaveMemory) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRunDiagnosis && (
            <Button size="sm" variant="primary" onClick={onRunDiagnosis} loading={runningDiagnosis}>
              <Bot size={14} />
              진단 실행
            </Button>
          )}
          {onSaveMemory && (
            <Button size="sm" variant="secondary" onClick={onSaveMemory} loading={savingMemory}>
              <Save size={14} />
              메모리 저장
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-4">
        {model.roles.map((role) => (
          <div key={role.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-admin-sm font-semibold text-admin-text">{role.label}</p>
              <StatusPill tone={tone(role.status)}>{aiAdTeamStatusLabel(role.status)}</StatusPill>
            </div>
            <p className="mt-2 text-admin-2xs leading-5 text-admin-muted">{role.inputSummary}</p>
            <p className="mt-2 text-admin-xs font-semibold text-admin-text">{role.decision}</p>
            <ul className="mt-2 space-y-1">
              {role.evidence.slice(0, 3).map((item) => (
                <li key={item} className="text-admin-2xs leading-5 text-admin-muted">{item}</li>
              ))}
            </ul>
            <p className="mt-2 rounded-admin-xs bg-admin-surface px-2 py-1.5 text-admin-2xs leading-5 text-admin-muted">
              {role.nextAction}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-admin-sm font-semibold text-admin-text">ROAS 진단</p>
              <p className="mt-1 text-admin-2xs text-admin-muted">
                ROAS, CPA, CTR, CVR, 검색어, 랜딩, 예산 안전장치를 고정 루틴으로 점검합니다.
              </p>
            </div>
            <StatusPill tone={tone(model.roasDiagnostic.status)}>{model.roasDiagnostic.score}%</StatusPill>
          </div>
          <MetricGrid
            columns="md:grid-cols-3"
            metrics={[
              { label: '가설 수', value: model.roasDiagnostic.hypotheses.length.toLocaleString('ko-KR') },
              { label: '최우선', value: topHypothesis ? priorityLabel(topHypothesis.priority) : '-' },
              { label: '승인', value: model.roasDiagnostic.hypotheses.some((row) => row.needsHumanApproval) ? '필요' : '불필요' },
            ]}
          />
          <div className="mt-3 space-y-2">
            {model.roasDiagnostic.hypotheses.slice(0, 3).map((hypothesis) => (
              <div key={hypothesis.id} className="rounded-admin-xs bg-admin-surface px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-admin-xs font-semibold text-admin-text">{hypothesis.reason}</p>
                  <StatusPill tone={hypothesis.priority === 'high' ? 'bad' : hypothesis.priority === 'medium' ? 'warn' : 'neutral'}>
                    {priorityLabel(hypothesis.priority)}
                  </StatusPill>
                </div>
                <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{hypothesis.evidence}</p>
                <p className="mt-1 text-admin-2xs leading-5 text-admin-muted">{hypothesis.immediateAction}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-admin-sm font-semibold text-admin-text">캠페인 메모리</p>
              <p className="mt-1 text-admin-2xs text-admin-muted">
                광고주별 목적, 승인 기준, 학습 이력, 리포트 상태, 다음 테스트를 한곳에 묶습니다.
              </p>
            </div>
            <StatusPill tone={tone(model.campaignMemory.status)}>{model.campaignMemory.score}%</StatusPill>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {model.campaignMemory.facts.map((fact) => (
              <div key={fact.label} className="rounded-admin-xs bg-admin-surface px-3 py-2">
                <p className="text-admin-2xs text-admin-muted">{fact.label}</p>
                <p className="mt-1 text-admin-xs font-semibold text-admin-text">{fact.value}</p>
              </div>
            ))}
          </div>
          {model.campaignMemory.persistedAt && (
            <p className="mt-3 text-admin-2xs leading-5 text-admin-muted">
              마지막 저장: {model.campaignMemory.persistedAt}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {model.campaignMemory.nextTests.map((test) => (
              <p key={test} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2 text-admin-2xs leading-5 text-admin-muted">
                {test}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
