import { Bot, Save } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { AdOsAgentOperatingModel, AiAdTeamStatus } from '../_lib/agent-operating-model';
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
          <h2 className="text-admin-base font-semibold text-admin-text-2">AI ad team</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            Role-split campaign planning, performance diagnosis, copy generation, and reporting evidence for Ad OS.
          </p>
        </div>
        <StatusPill tone={tone(model.overallStatus)}>
          team score {model.teamScore}%
        </StatusPill>
      </div>
      {(onRunDiagnosis || onSaveMemory) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRunDiagnosis && (
            <Button size="sm" variant="primary" onClick={onRunDiagnosis} loading={runningDiagnosis}>
              <Bot size={14} />
              Run diagnosis
            </Button>
          )}
          {onSaveMemory && (
            <Button size="sm" variant="secondary" onClick={onSaveMemory} loading={savingMemory}>
              <Save size={14} />
              Save memory
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-4">
        {model.roles.map((role) => (
          <div key={role.id} className="rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-admin-sm font-semibold text-admin-text">{role.label}</p>
              <StatusPill tone={tone(role.status)}>{role.status}</StatusPill>
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
              <p className="text-admin-sm font-semibold text-admin-text">ROAS diagnosis</p>
              <p className="mt-1 text-admin-2xs text-admin-muted">
                Fixed debug loop for ROAS, CPA, CTR, CVR, search terms, landing, and budget guardrails.
              </p>
            </div>
            <StatusPill tone={tone(model.roasDiagnostic.status)}>{model.roasDiagnostic.score}%</StatusPill>
          </div>
          <MetricGrid
            columns="md:grid-cols-3"
            metrics={[
              { label: 'Hypotheses', value: model.roasDiagnostic.hypotheses.length.toLocaleString('ko-KR') },
              { label: 'Top priority', value: topHypothesis?.priority || '-' },
              { label: 'Approval', value: model.roasDiagnostic.hypotheses.some((row) => row.needsHumanApproval) ? 'required' : 'not required' },
            ]}
          />
          <div className="mt-3 space-y-2">
            {model.roasDiagnostic.hypotheses.slice(0, 3).map((hypothesis) => (
              <div key={hypothesis.id} className="rounded-admin-xs bg-admin-surface px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-admin-xs font-semibold text-admin-text">{hypothesis.reason}</p>
                  <StatusPill tone={hypothesis.priority === 'high' ? 'bad' : hypothesis.priority === 'medium' ? 'warn' : 'neutral'}>
                    {hypothesis.priority}
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
              <p className="text-admin-sm font-semibold text-admin-text">Campaign memory</p>
              <p className="mt-1 text-admin-2xs text-admin-muted">
                Tenant-facing planning, guardrail, learning, reporting, and next-test context.
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
              Last saved memory: {model.campaignMemory.persistedAt}
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
