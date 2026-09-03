# Technology Scout Foundation Source Research

Audience: 여소남 대표 및 Agent Office 구현 검토자
Research date: 2026-09-03
Scope: PR-00에 등록된 30개 기술 후보의 현재 공식 GitHub 저장소, 불변
revision, README, root license, release 증거와 여소남 적용 가설
Exclusions: 설치, 실행, 커뮤니티 평판 판정, 가격 비교, Production 데이터,
법률 자문, 실제 모델 Trial

## Executive Answer

기존 선별안은 유지하는 것이 맞습니다. 새 AI 회사 프레임워크를 통째로
도입할 근거는 없고, 현재 Agent Office·Inngest·Promptfoo·OTel을 권위로
유지하면서 Context7·Crawl4AI·Docling 같은 좁은 후보만 격리 Trial하는
구조가 가장 안전합니다.

다만 PR-01D live Pilot은 아직 실행할 수 없습니다. 공식 최신 App Server는
제한 읽기 루트를 문서화했지만 현재 설치 버전의 생성 스키마에는 그 필드가
없습니다. 따라서 30개 공식 소스 고정과 오프라인 계약 평가까지만 완료하고,
실제 Turn과 인간 검수는 차단했습니다.

## Material Findings

1. 30개 프로젝트 모두 2026-09-03 시점의 공식 저장소와 immutable commit을
   확인했습니다. `main`, `master`, `latest`는 평가 근거 URL로 사용하지 않습니다.
2. GitHub의 상위 SPDX 표시만으로는 라이선스를 안전하게 판정할 수 없습니다.
   Inngest는 SSPL과 future Apache 조항, MCP 두 저장소는 MIT→Apache 전환과
   CC-BY 문서, Mastra·Langfuse·Flowise는 core/enterprise 혼합, n8n과 Dify는
   별도 사용 제한을 포함합니다.
3. `ADOPT` 가설은 이미 여소남에서 승인된 Inngest·Promptfoo·OpenTelemetry를
   유지한다는 뜻이며 신규 설치 승인이 아닙니다.
4. Paperclip, Headcount, LangGraph, CrewAI, Temporal, Trigger.dev, Mastra, n8n,
   Dify, Flowise 전체 도입은 기존 Control Plane과 중복되므로 현재 가설은
   `REJECT`입니다. 유용한 계약·평가 패턴은 별도로 `ASSESS`할 수 있습니다.
5. 이 자료는 인간 검토 전 가설입니다. 저장소 이름, 라이선스, 릴리스가 맞아도
   보안·데이터 처리·실제 품질이 검증된 것은 아닙니다.

## Claim-to-source Ledger

각 행의 README와 License 링크는 해당 commit에 고정돼 있습니다.

| ID | Project | Revision | README / License | License hypothesis | Disposition hypothesis |
|---|---|---|---|---|---|
| TS-001 | Paperclip | `da0947d` | [README](https://github.com/paperclipai/paperclip/blob/da0947d3582ac7779d6bf11851c9938eca6c5c8c/README.md) / [MIT](https://github.com/paperclipai/paperclip/blob/da0947d3582ac7779d6bf11851c9938eca6c5c8c/LICENSE) | permissive | REJECT whole |
| TS-002 | Headcount | `9cbf3400` | [README](https://github.com/cbrock84/headcount/blob/9cbf34005e3e8a980a6af9b55eb226bd926a62b3/README.md) / [MIT](https://github.com/cbrock84/headcount/blob/9cbf34005e3e8a980a6af9b55eb226bd926a62b3/LICENSE) | permissive | REJECT bulk |
| TS-003 | OpenAI Agents JS | `8e862b33` | [README](https://github.com/openai/openai-agents-js/blob/8e862b3380a577df1315bef17f351c1b58c2938b/README.md) / [MIT](https://github.com/openai/openai-agents-js/blob/8e862b3380a577df1315bef17f351c1b58c2938b/LICENSE) | permissive | HOLD runtime |
| TS-004 | LangGraph | `11738d83` | [README](https://github.com/langchain-ai/langgraph/blob/11738d83db4320bb191804342b5c76ae7eca54a0/README.md) / [MIT](https://github.com/langchain-ai/langgraph/blob/11738d83db4320bb191804342b5c76ae7eca54a0/LICENSE) | permissive | REJECT runtime |
| TS-005 | CrewAI | `3d72c707` | [README](https://github.com/crewAIInc/crewAI/blob/3d72c707d523d09aac43ab55c04fec6c0da30f46/README.md) / [MIT](https://github.com/crewAIInc/crewAI/blob/3d72c707d523d09aac43ab55c04fec6c0da30f46/LICENSE) | permissive | REJECT runtime |
| TS-006 | AutoGen | `027ecf0a` | [README](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/README.md) / [root license](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/LICENSE) | mixed review | REJECT runtime |
| TS-007 | Google ADK | `c506ddf3` | [README](https://github.com/google/adk-python/blob/c506ddf3bc34a6312ffc81899221bfa3f2da3b1d/README.md) / [Apache-2.0](https://github.com/google/adk-python/blob/c506ddf3bc34a6312ffc81899221bfa3f2da3b1d/LICENSE) | permissive | ASSESS patterns |
| TS-008 | Inngest | `91ca35e0` | [README](https://github.com/inngest/inngest/blob/91ca35e039adea81b1fe40a75d4b13f088a17429/README.md) / [SSPL/future Apache](https://github.com/inngest/inngest/blob/91ca35e039adea81b1fe40a75d4b13f088a17429/LICENSE.md) | source-available | ADOPT existing |
| TS-009 | Temporal TS SDK | `40ea6db4` | [README](https://github.com/temporalio/sdk-typescript/blob/40ea6db4d52ad14235332ddf8f88d3952cf2b123/README.md) / [MIT](https://github.com/temporalio/sdk-typescript/blob/40ea6db4d52ad14235332ddf8f88d3952cf2b123/LICENSE) | permissive | REJECT second engine |
| TS-010 | Trigger.dev | `e3db7a82` | [README](https://github.com/triggerdotdev/trigger.dev/blob/e3db7a820f6166dba740dd7849029c31d040b03a/README.md) / [Apache-2.0](https://github.com/triggerdotdev/trigger.dev/blob/e3db7a820f6166dba740dd7849029c31d040b03a/LICENSE) | permissive | REJECT second engine |
| TS-011 | MCP TypeScript SDK | `dcc01028` | [README](https://github.com/modelcontextprotocol/typescript-sdk/blob/dcc01028ff6a499a5728c2b6181c1727d52e2fab/README.md) / [transition license](https://github.com/modelcontextprotocol/typescript-sdk/blob/dcc01028ff6a499a5728c2b6181c1727d52e2fab/LICENSE) | mixed | ASSESS narrow tools |
| TS-012 | MCP Servers | `d73f99ef` | [README](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/README.md) / [transition license](https://github.com/modelcontextprotocol/servers/blob/d73f99efbfd40c3aa1b61e88728b3d49fb52608f/LICENSE) | mixed | REJECT bulk |
| TS-013 | Context7 | `6d777619` | [README](https://github.com/upstash/context7/blob/6d777619c2777a79ad0754dc48b48845cb912bac/README.md) / [MIT](https://github.com/upstash/context7/blob/6d777619c2777a79ad0754dc48b48845cb912bac/LICENSE) | permissive | TRIAL isolated |
| TS-014 | Promptfoo | `6cbdea0f` | [README](https://github.com/promptfoo/promptfoo/blob/6cbdea0ff4bfd7e8831b559095bfa18537338b45/README.md) / [MIT](https://github.com/promptfoo/promptfoo/blob/6cbdea0ff4bfd7e8831b559095bfa18537338b45/LICENSE) | permissive | ADOPT existing |
| TS-015 | OpenTelemetry JS | `83651ca6` | [README](https://github.com/open-telemetry/opentelemetry-js/blob/83651ca60b109c393169e41d7f2cc7c9fe6514f0/README.md) / [Apache-2.0](https://github.com/open-telemetry/opentelemetry-js/blob/83651ca60b109c393169e41d7f2cc7c9fe6514f0/LICENSE) | permissive | ADOPT existing |
| TS-016 | Crawl4AI | `862f6bcc` | [README](https://github.com/unclecode/crawl4ai/blob/862f6bccb9c063f49b9d42701baa0eea17a4993f/README.md) / [Apache-2.0](https://github.com/unclecode/crawl4ai/blob/862f6bccb9c063f49b9d42701baa0eea17a4993f/LICENSE) | permissive | TRIAL benchmark |
| TS-017 | Docling | `c09ddfab` | [README](https://github.com/docling-project/docling/blob/c09ddfabff27b1ba6217ab47e207cb646b4ba023/README.md) / [MIT](https://github.com/docling-project/docling/blob/c09ddfabff27b1ba6217ab47e207cb646b4ba023/LICENSE) | permissive | TRIAL benchmark |
| TS-018 | OpenMontage | `f633b5f4` | [README](https://github.com/tjebastin/openmontage/blob/f633b5f428b9be9a2afecba851dfddd101619756/README.md) / [AGPL-3.0](https://github.com/tjebastin/openmontage/blob/f633b5f428b9be9a2afecba851dfddd101619756/LICENSE) | copyleft | ASSESS only |
| TS-019 | AgentShield | `1bd56f98` | [README](https://github.com/agentshield-ai/agentshield/blob/1bd56f9854426e29d59715e81c45fcfe38c7ee0e/README.md) / [Apache-2.0](https://github.com/agentshield-ai/agentshield/blob/1bd56f9854426e29d59715e81c45fcfe38c7ee0e/LICENSE) | permissive | ASSESS only |
| TS-020 | Strix | `5d015df6` | [README](https://github.com/usestrix/strix/blob/5d015df6b1b58934152f897e37d3032f0dc32e0d/README.md) / [Apache-2.0](https://github.com/usestrix/strix/blob/5d015df6b1b58934152f897e37d3032f0dc32e0d/LICENSE) | permissive | ASSESS preview-only |
| TS-021 | Hermes Agent | `05f548f3` | [README](https://github.com/NousResearch/hermes-agent/blob/05f548f35dd3242bf2ff74743e9112acde251f77/README.md) / [MIT](https://github.com/NousResearch/hermes-agent/blob/05f548f35dd3242bf2ff74743e9112acde251f77/LICENSE) | permissive | HOLD |
| TS-022 | OpenClaw | `e07515f8` | [README](https://github.com/openclaw/openclaw/blob/e07515f8f5f99396dea5ae9af261e320928d6f6c/README.md) / [MIT text](https://github.com/openclaw/openclaw/blob/e07515f8f5f99396dea5ae9af261e320928d6f6c/LICENSE) | permissive | HOLD |
| TS-023 | Vercel AI SDK | `a8e8ad0b` | [README](https://github.com/vercel/ai/blob/a8e8ad0bec23a137a8a1385d3fec4a2c69f20bd6/README.md) / [Apache-2.0 text](https://github.com/vercel/ai/blob/a8e8ad0bec23a137a8a1385d3fec4a2c69f20bd6/LICENSE) | permissive | ASSESS patterns |
| TS-024 | Pydantic AI | `7bde4d2a` | [README](https://github.com/pydantic/pydantic-ai/blob/7bde4d2a215ebf26b9790aca5985046dcf227a19/README.md) / [MIT](https://github.com/pydantic/pydantic-ai/blob/7bde4d2a215ebf26b9790aca5985046dcf227a19/LICENSE) | permissive | REJECT runtime |
| TS-025 | Mastra | `d80d6bee` | [README](https://github.com/mastra-ai/mastra/blob/d80d6beebf26a82a48c047294914fcacfdf6c5ee/README.md) / [mixed license](https://github.com/mastra-ai/mastra/blob/d80d6beebf26a82a48c047294914fcacfdf6c5ee/LICENSE.md) | mixed | REJECT runtime |
| TS-026 | Langfuse | `94428222` | [README](https://github.com/langfuse/langfuse/blob/94428222e4cf0023c105c25b18b8d24261313135/README.md) / [mixed license](https://github.com/langfuse/langfuse/blob/94428222e4cf0023c105c25b18b8d24261313135/LICENSE) | mixed | HOLD |
| TS-027 | n8n | `fd6db75b` | [README](https://github.com/n8n-io/n8n/blob/fd6db75b1560078934d1fb2a451d3efbd5b6e58b/README.md) / [Sustainable Use](https://github.com/n8n-io/n8n/blob/fd6db75b1560078934d1fb2a451d3efbd5b6e58b/LICENSE.md) | source-available | REJECT platform |
| TS-028 | Dify | `e982a3de` | [README](https://github.com/langgenius/dify/blob/e982a3de3392e6c6a03f955506182c000e19ef55/README.md) / [modified Apache](https://github.com/langgenius/dify/blob/e982a3de3392e6c6a03f955506182c000e19ef55/LICENSE) | source-available | REJECT platform |
| TS-029 | Flowise | `9291856d` | [README](https://github.com/FlowiseAI/Flowise/blob/9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb/README.md) / [mixed license](https://github.com/FlowiseAI/Flowise/blob/9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb/LICENSE.md) | mixed | REJECT platform |
| TS-030 | Semantic Kernel | `b7553d9e` | [README](https://github.com/microsoft/semantic-kernel/blob/b7553d9e32efbc18bad7e62262bd37711fdaf7ac/README.md) / [MIT](https://github.com/microsoft/semantic-kernel/blob/b7553d9e32efbc18bad7e62262bd37711fdaf7ac/LICENSE) | permissive | ASSESS patterns |

## Limitations and Stop Reason

- GitHub root license evidence does not replace dependency, model-weight, asset,
  hosted-service, patent, trademark, or legal review.
- Repository descriptions state project intent, not measured suitability or security.
- No community evidence was used, so this pass does not measure real-world operator
  sentiment.
- The live Runtime, 20-case output quality, three-trial variance, token/latency/cost,
  and human correction rate remain unmeasured.
- Research stopped because the missing restricted-read Runtime boundary is a hard
  safety gate; gathering more mutable secondary sources would not resolve it.
