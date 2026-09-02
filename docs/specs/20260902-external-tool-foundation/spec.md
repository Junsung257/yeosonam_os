# Feature Spec: external tool safety foundation

## Goal

Make external agent instructions and multi-agent file ownership reviewable, task-scoped, and enforceable without installing a third-party catalog.

## Success Criteria

- [x] New Tier 2/3 Specs can declare non-overlapping write surfaces.
- [x] Changed tracked and untracked paths can be checked for one declared agent.
- [x] External skills require immutable provenance, capability review, and eval evidence before approval.
- [x] Existing Yeosonam SSOT and approval boundaries remain authoritative.

## In Scope

- Agent surface contract, validator, tests, template, and external Skill intake registry.

## Out Of Scope

- Bulk Headcount/skills.sh installation, production mutations, and global agent configuration changes.

## Users And Risks

- Primary audience: engineering agents and reviewers
- Risk tier: Tier 2
- Sensitive surfaces: agent permissions and external instructions

## Open Questions

- [x] None.
