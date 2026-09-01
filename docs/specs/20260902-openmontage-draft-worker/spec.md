# Feature Spec: OpenMontage draft sandbox

## Goal

Prepare a pinned, rights-aware internal video draft sandbox without connecting it to production data, uploads, social publishing, or database writes.

## Success Criteria

- [x] Official upstream commit, AGPL license, and digest-pinned container base are recorded.
- [x] Brief, source manifest, and deliverable contracts fail closed on facts, rights, format, providers, and VA approval.
- [x] Three synthetic informational fixtures pass and a stock-for-hotel substitution fails.
- [ ] Docker image build/preflight and three real approved informational blog renders pass.
- [ ] A commercially approved Korean Piper voice is pinned and reviewed.

## In Scope

- Docker tool sandbox, immutable upstream manifest, source/deliverable policy, deterministic tests, and current SSOT update.

## Out Of Scope

- DB migrations, queues, production providers, upload/SNS publishing, paid Hero providers, upstream modification, and network service operation.

## Users And Risks

- Primary audience: internal media operator and VA reviewer
- Risk tier: Tier 2
- Sensitive surfaces: approved content evidence and licensed media

## Open Questions

- [x] The known Korean Piper voice is non-commercial and remains blocked; live rendering waits for an approved replacement.
