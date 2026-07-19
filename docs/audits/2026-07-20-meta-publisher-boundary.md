# 2026-07-20 Meta Publisher Boundary Audit

## Scope

Pre-launch review of the admin `MetaAutoPublisher` external-write affordance against
`docs/marketing-current-ssot.md`.

## Evidence

- `src/app/api/meta/creatives/deploy/route.ts` requires both `creative_id` and
  `campaign_id` before creating a Meta creative/ad.
- `src/components/admin/MetaAutoPublisher.tsx` could previously render a deploy
  button without a selected persisted creative/campaign context.
- The UI copy said the action would go live immediately, while the Meta client creates
  ads in `PAUSED` state by design.
- Several Meta/card-news routes reached request body parsing, service-role DB access,
  AI generation, or Meta/Instagram provider calls before proving an admin or cron
  caller.

## Change

- The deploy action is disabled until both a persisted creative id and campaign id are
  present.
- The deploy request now includes `campaign_id` when a caller provides the context.
- The operator-facing copy now describes the result as a `PAUSED` Meta ad draft, not a
  live ad.
- Meta campaign/creative/performance routes now require admin authorization
  before body parsing, DB writes, or provider mutation.
- Meta optimize and Instagram publish now allow cron bridge calls only with cron
  authorization; otherwise they require admin authorization.
- Cron/internal publisher bridges now forward `CRON_SECRET` when calling the protected
  route.

## Gate Still Open

This does not approve, activate, or bypass the external advertising workflow. Live
activation remains a separate approval/confirmation path under the marketing SSOT
external-write boundary.
