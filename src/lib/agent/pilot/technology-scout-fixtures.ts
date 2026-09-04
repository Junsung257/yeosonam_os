import { createHash } from 'node:crypto';

import {
  AGENT_CONTRACT_SCHEMA_REGISTRY,
  TechnologyRadarEntryV1Schema,
  TechnologyScoutTaskInputV1Schema,
  WorkProductEnvelopeV1Schema,
  type TechnologyRadarEntryV1,
  type TechnologyScoutTaskInputV1,
  type WorkProductEnvelopeV1,
} from '@/lib/agent/contracts';
import {
  RuntimePublicInputArtifactSchema,
  type RuntimePublicInputArtifact,
} from '@/lib/agent/runtime/types';
// Keep the fixture corpus on the lightweight contract path. Importing the
// runtime barrel here would pull the Codex worker and stdio adapter into every
// route that only needs schema validation.

export const TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT = '2026-09-03T08:57:44.790Z';
export const TECHNOLOGY_SCOUT_CORPUS_SHA256 = 'sha256:5727fb5678c047b58b2f70ad948c08008ddee14205c45150dd49bf4f90d801f8';

export type TechnologyScoutLicenseClass = TechnologyRadarEntryV1['supplyChain']['licenseClass'];
export type TechnologyScoutDecision = TechnologyRadarEntryV1['decision'];

type SourceFixtureRow = {
  caseId: `TS-${string}`;
  projectName: string;
  repository: `${string}/${string}`;
  revision: string;
  readmeBlobSha: string;
  licensePath: string;
  licenseBlobSha: string;
  licenseClass: TechnologyScoutLicenseClass;
  licenseLabel: string;
  licenseSummary: string;
  capabilityCohort: string;
  expectedDecision: TechnologyScoutDecision;
  releaseTag: string | null;
  releaseDate: string | null;
  description: string;
};

const SOURCE_ROWS = [
  {
    caseId: 'TS-001', projectName: 'Paperclip', repository: 'paperclipai/paperclip', revision: 'da0947d3582ac7779d6bf11851c9938eca6c5c8c', readmeBlobSha: '969882e929409682b453bab97112b1a713389642', licensePath: 'LICENSE', licenseBlobSha: 'a63594a5150d0ae00c3ddc36b61fa8f708c3ca8c', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'AI-company control plane', expectedDecision: 'REJECT', releaseTag: 'v2026.831.1', releaseDate: '2026-09-02', description: 'An open-source application for managing agents at work.',
  },
  {
    caseId: 'TS-002', projectName: 'Headcount', repository: 'cbrock84/headcount', revision: '9cbf34005e3e8a980a6af9b55eb226bd926a62b3', readmeBlobSha: '8843e1dce5e90274499b981bc2d05437b6c665c9', licensePath: 'LICENSE', licenseBlobSha: '1d1ec69a2bcb9c40b28f439b85b2d7ac84d99ebf', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'role and skill catalog', expectedDecision: 'REJECT', releaseTag: null, releaseDate: null, description: 'A company-structured Claude Code agent organization with independently installable departments and skills.',
  },
  {
    caseId: 'TS-003', projectName: 'OpenAI Agents JS', repository: 'openai/openai-agents-js', revision: '8e862b3380a577df1315bef17f351c1b58c2938b', readmeBlobSha: '038ee743d93ea0d39fac33bfc407ce574f6a1bf3', licensePath: 'LICENSE', licenseBlobSha: '0b9aa14f1d62dc4f93fd48437369ceff7ff27cd8', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'agent runtime', expectedDecision: 'HOLD', releaseTag: 'v0.17.0', releaseDate: '2026-08-19', description: 'A TypeScript framework for multi-agent workflows and voice agents.',
  },
  {
    caseId: 'TS-004', projectName: 'LangGraph', repository: 'langchain-ai/langgraph', revision: '11738d83db4320bb191804342b5c76ae7eca54a0', readmeBlobSha: '97c31e9cb4d8fe56be8d768ce3eb5e22400e897e', licensePath: 'LICENSE', licenseBlobSha: 'fc0602feecdd6748623c852ab534e1ca612673c7', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'graph and checkpointer runtime', expectedDecision: 'REJECT', releaseTag: 'sdk==0.4.4', releaseDate: '2026-08-27', description: 'A framework for building resilient agents.',
  },
  {
    caseId: 'TS-005', projectName: 'CrewAI', repository: 'crewAIInc/crewAI', revision: '3d72c707d523d09aac43ab55c04fec6c0da30f46', readmeBlobSha: '4a5360ad587a35625684747157881558c6acae1d', licensePath: 'LICENSE', licenseBlobSha: 'a6ee25527ec07201e4373fcbf89f128f304a6f2e', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'multi-agent runtime', expectedDecision: 'REJECT', releaseTag: '1.15.18', releaseDate: '2026-08-27', description: 'A framework for orchestrating role-playing autonomous agents.',
  },
  {
    caseId: 'TS-006', projectName: 'AutoGen', repository: 'microsoft/autogen', revision: '027ecf0a379bcc1d09956d46d12d44a3ad9cee14', readmeBlobSha: '25f7cc162ae92c3988966d85cce173ff6df48020', licensePath: 'LICENSE', licenseBlobSha: '2f244ac814036ecd9ba9f69782e89ce6b1dca9eb', licenseClass: 'mixed', licenseLabel: 'CC-BY-4.0 root; component review required', licenseSummary: 'The pinned root license is Creative Commons Attribution 4.0, so software-component scope must be reviewed separately.', capabilityCohort: 'multi-agent runtime', expectedDecision: 'REJECT', releaseTag: 'python-v0.7.5', releaseDate: '2025-09-30', description: 'A programming framework for agentic AI.',
  },
  {
    caseId: 'TS-007', projectName: 'Google ADK', repository: 'google/adk-python', revision: 'c506ddf3bc34a6312ffc81899221bfa3f2da3b1d', readmeBlobSha: 'eaafa0a802b7fd5ae488054a3e3ada714dbfc985', licensePath: 'LICENSE', licenseBlobSha: 'd645695673349e3947e8e5ae42332d0ac3164cd7', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'agent and workflow runtime', expectedDecision: 'ASSESS', releaseTag: 'v2.8.0', releaseDate: '2026-08-26', description: 'A code-first Python toolkit for building, evaluating, and deploying AI agents.',
  },
  {
    caseId: 'TS-008', projectName: 'Inngest', repository: 'inngest/inngest', revision: '91ca35e039adea81b1fe40a75d4b13f088a17429', readmeBlobSha: '273529eef574c4ad03122694ede4ecc7959dffd4', licensePath: 'LICENSE.md', licenseBlobSha: '781fe591191b18ab14318aade09d4b6d31f4834a', licenseClass: 'source_available', licenseLabel: 'SSPL-1.0 with future Apache-2.0', licenseSummary: 'The pinned license declares SSPL-1.0 with an Apache-2.0 future-license clause.', capabilityCohort: 'durable workflow', expectedDecision: 'ADOPT', releaseTag: 'v1.44.0', releaseDate: '2026-08-26', description: 'A workflow orchestration platform for stateful step functions and AI workflows.',
  },
  {
    caseId: 'TS-009', projectName: 'Temporal TypeScript SDK', repository: 'temporalio/sdk-typescript', revision: '40ea6db4d52ad14235332ddf8f88d3952cf2b123', readmeBlobSha: '4996862c0f5edef964edf86c6d7aeb301d20efa3', licensePath: 'LICENSE', licenseBlobSha: '7c6bbcaa0b092a065ce47c9fbe94beb229b1d2e0', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'durable workflow', expectedDecision: 'REJECT', releaseTag: 'v1.23.0', releaseDate: '2026-08-26', description: 'The official Temporal TypeScript SDK.',
  },
  {
    caseId: 'TS-010', projectName: 'Trigger.dev', repository: 'triggerdotdev/trigger.dev', revision: 'e3db7a820f6166dba740dd7849029c31d040b03a', readmeBlobSha: '0d7f1ca2930179925a03863e454c659447e42544', licensePath: 'LICENSE', licenseBlobSha: '5e468e5078530707eb8d28fe28cad2f72fb64bf0', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'durable jobs and workflows', expectedDecision: 'REJECT', releaseTag: 'v4.5.16', releaseDate: '2026-09-02', description: 'A managed platform for AI agents and workflows.',
  },
  {
    caseId: 'TS-011', projectName: 'MCP TypeScript SDK', repository: 'modelcontextprotocol/typescript-sdk', revision: 'dcc01028ff6a499a5728c2b6181c1727d52e2fab', readmeBlobSha: '6d5e2328efd2fc4493731b4e4cfd2e117ad1e28d', licensePath: 'LICENSE', licenseBlobSha: '4a93985763241755401a10678395303de4e720ba', licenseClass: 'mixed', licenseLabel: 'Apache-2.0/MIT transition; docs CC-BY-4.0', licenseSummary: 'The pinned license records an MIT-to-Apache-2.0 code transition and CC-BY-4.0 documentation.', capabilityCohort: 'tool protocol SDK', expectedDecision: 'ASSESS', releaseTag: '@modelcontextprotocol/fastify@2.0.0', releaseDate: '2026-07-27', description: 'The official TypeScript SDK for Model Context Protocol servers and clients.',
  },
  {
    caseId: 'TS-012', projectName: 'MCP Servers', repository: 'modelcontextprotocol/servers', revision: 'd73f99efbfd40c3aa1b61e88728b3d49fb52608f', readmeBlobSha: '9c388c80a43c12db37f25049d031c98e1d26b5e0', licensePath: 'LICENSE', licenseBlobSha: '4a93985763241755401a10678395303de4e720ba', licenseClass: 'mixed', licenseLabel: 'Apache-2.0/MIT transition; docs CC-BY-4.0', licenseSummary: 'The pinned license records an MIT-to-Apache-2.0 code transition and CC-BY-4.0 documentation.', capabilityCohort: 'tool server catalog', expectedDecision: 'REJECT', releaseTag: '2026.8.31', releaseDate: '2026-08-31', description: 'A catalog of Model Context Protocol servers.',
  },
  {
    caseId: 'TS-013', projectName: 'Context7', repository: 'upstash/context7', revision: '6d777619c2777a79ad0754dc48b48845cb912bac', readmeBlobSha: 'aa34be9ba8eb98b5edc8dc8b9088a513275356ce', licensePath: 'LICENSE', licenseBlobSha: '17900de42d69131467aaa7a53fa88b92d238dc63', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'current library documentation', expectedDecision: 'TRIAL', releaseTag: '@upstash/context7-mcp@4.0.4', releaseDate: '2026-08-28', description: 'A platform that provides current code documentation to LLMs and AI editors.',
  },
  {
    caseId: 'TS-014', projectName: 'Promptfoo', repository: 'promptfoo/promptfoo', revision: '6cbdea0ff4bfd7e8831b559095bfa18537338b45', readmeBlobSha: '5260a4d7c2d35ed59f940f551000d181f7da8ba0', licensePath: 'LICENSE', licenseBlobSha: 'af3fa111d9303b3041d225fb851534e50a4bbec2', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'evaluation harness', expectedDecision: 'ADOPT', releaseTag: 'code-scan-action-0.2.0', releaseDate: '2026-08-28', description: 'A prompt, agent, RAG, red-team, and model-comparison evaluation tool.',
  },
  {
    caseId: 'TS-015', projectName: 'OpenTelemetry JS', repository: 'open-telemetry/opentelemetry-js', revision: '83651ca60b109c393169e41d7f2cc7c9fe6514f0', readmeBlobSha: '21d77f2f7c6a9d1bdfeda301bff532d043d32e91', licensePath: 'LICENSE', licenseBlobSha: '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'telemetry', expectedDecision: 'ADOPT', releaseTag: 'v2.11.0', releaseDate: '2026-08-31', description: 'The OpenTelemetry JavaScript client implementation.',
  },
  {
    caseId: 'TS-016', projectName: 'Crawl4AI', repository: 'unclecode/crawl4ai', revision: '862f6bccb9c063f49b9d42701baa0eea17a4993f', readmeBlobSha: '310ac0240bfc78563f4ed0e5100ef3836abe699a', licensePath: 'LICENSE', licenseBlobSha: 'ade44a7824869fe57a3dfa98ad4b7ffb764c3cb0', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'web evidence collection', expectedDecision: 'TRIAL', releaseTag: 'v0.9.3', releaseDate: '2026-08-31', description: 'An open-source web crawler and scraper designed for LLM-oriented extraction.',
  },
  {
    caseId: 'TS-017', projectName: 'Docling', repository: 'docling-project/docling', revision: 'c09ddfabff27b1ba6217ab47e207cb646b4ba023', readmeBlobSha: '44d6f1571098d46b25ad27632671ef5d3370350c', licensePath: 'LICENSE', licenseBlobSha: '6684a401bf0f700fd37104ab7c8da340036f7166', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'document extraction', expectedDecision: 'TRIAL', releaseTag: 'v2.124.0', releaseDate: '2026-08-31', description: 'A document conversion and parsing toolkit for generative-AI inputs.',
  },
  {
    caseId: 'TS-018', projectName: 'OpenMontage', repository: 'tjebastin/openmontage', revision: 'f633b5f428b9be9a2afecba851dfddd101619756', readmeBlobSha: 'd12bbf51c458191441a196935f4142617d772254', licensePath: 'LICENSE', licenseBlobSha: 'be3f7b28e564e7dd05eaf59d64adba1a4065ac0e', licenseClass: 'copyleft', licenseLabel: 'AGPL-3.0', licenseSummary: 'The pinned root LICENSE is AGPL-3.0.', capabilityCohort: 'media worker', expectedDecision: 'ASSESS', releaseTag: null, releaseDate: null, description: 'An agentic video-production system with pipelines, tools, and agent skills.',
  },
  {
    caseId: 'TS-019', projectName: 'AgentShield', repository: 'agentshield-ai/agentshield', revision: '1bd56f9854426e29d59715e81c45fcfe38c7ee0e', readmeBlobSha: 'efe8388388aa5fcd9ff50c99bee298ad249ab231', licensePath: 'LICENSE', licenseBlobSha: '2b5b05a4a0481983a845d42bb4f39f4c6b1b438c', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'agent runtime security', expectedDecision: 'ASSESS', releaseTag: 'v2.0.0', releaseDate: '2026-03-03', description: 'An AI Agent Detection and Response plugin for real-time agent monitoring.',
  },
  {
    caseId: 'TS-020', projectName: 'Strix', repository: 'usestrix/strix', revision: '5d015df6b1b58934152f897e37d3032f0dc32e0d', readmeBlobSha: 'e71e2c1d661617b107a42a018aa1262a054281b4', licensePath: 'LICENSE', licenseBlobSha: '65c4e8f58a00552cc29f6bd1dcaf1c4ef10012b8', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE is Apache-2.0.', capabilityCohort: 'agentic security testing', expectedDecision: 'ASSESS', releaseTag: 'v1.6.1', releaseDate: '2026-09-02', description: 'An AI penetration-testing tool for finding application vulnerabilities.',
  },
  {
    caseId: 'TS-021', projectName: 'Hermes Agent', repository: 'NousResearch/hermes-agent', revision: '05f548f35dd3242bf2ff74743e9112acde251f77', readmeBlobSha: 'c05112266746ff99a3326a62c38c33fbc08ecd23', licensePath: 'LICENSE', licenseBlobSha: '75410e73319c72cd3e991a501c5455eb78f38375', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'research and QA runtime', expectedDecision: 'HOLD', releaseTag: 'v2026.8.31', releaseDate: '2026-08-31', description: 'A general AI agent intended to adapt and grow with its user.',
  },
  {
    caseId: 'TS-022', projectName: 'OpenClaw', repository: 'openclaw/openclaw', revision: 'e07515f8f5f99396dea5ae9af261e320928d6f6c', readmeBlobSha: '0b7cac9b022b0b397c3306b40d04eda72147dfcb', licensePath: 'LICENSE', licenseBlobSha: 'ebaebf7c416761a32f932ad70ebe5d1d2e214f68', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE text is MIT even though repository metadata did not classify it.', capabilityCohort: 'personal and mobile assistant entry', expectedDecision: 'HOLD', releaseTag: 'v2026.8.2', releaseDate: '2026-09-01', description: 'A cross-platform personal AI assistant.',
  },
  {
    caseId: 'TS-023', projectName: 'Vercel AI SDK', repository: 'vercel/ai', revision: 'a8e8ad0bec23a137a8a1385d3fec4a2c69f20bd6', readmeBlobSha: '00bf0b8fe329077b6c9487d001abd1d627f3df0f', licensePath: 'LICENSE', licenseBlobSha: '6c16c29f41168411dbf6e3ba3a063ce789c27334', licenseClass: 'permissive', licenseLabel: 'Apache-2.0', licenseSummary: 'The pinned root LICENSE text is Apache-2.0 even though repository metadata did not classify it.', capabilityCohort: 'provider-neutral AI application SDK', expectedDecision: 'ASSESS', releaseTag: '@ai-sdk/xai@4.0.54', releaseDate: '2026-09-02', description: 'A TypeScript toolkit for building AI-powered applications and agents.',
  },
  {
    caseId: 'TS-024', projectName: 'Pydantic AI', repository: 'pydantic/pydantic-ai', revision: '7bde4d2a215ebf26b9790aca5985046dcf227a19', readmeBlobSha: 'c52cebff671dd44b39090a3c142eff81b14994c6', licensePath: 'LICENSE', licenseBlobSha: '1bf1f55e6d1736b499ded961ec6b94bfebb17aec', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'typed Python agent runtime', expectedDecision: 'REJECT', releaseTag: 'v2.38.0', releaseDate: '2026-09-03', description: 'A typed Python framework for agents and model interfaces.',
  },
  {
    caseId: 'TS-025', projectName: 'Mastra', repository: 'mastra-ai/mastra', revision: 'd80d6beebf26a82a48c047294914fcacfdf6c5ee', readmeBlobSha: 'bc74c9520195b43ea85417507421a7b75ec35cff', licensePath: 'LICENSE.md', licenseBlobSha: 'e1b6e4b6455a882dbbf66ee0b13101ec584d5e63', licenseClass: 'mixed', licenseLabel: 'Apache-2.0 core with separately licensed ee directories', licenseSummary: 'The pinned license assigns Apache-2.0 to core content and a separate license to ee directories.', capabilityCohort: 'TypeScript agent and workflow framework', expectedDecision: 'REJECT', releaseTag: '@mastra/core@1.63.0', releaseDate: '2026-08-28', description: 'A TypeScript framework for AI applications, agents, evals, and workflows.',
  },
  {
    caseId: 'TS-026', projectName: 'Langfuse', repository: 'langfuse/langfuse', revision: '94428222e4cf0023c105c25b18b8d24261313135', readmeBlobSha: 'aa96cd81580a43260174793e63561d5a490055f9', licensePath: 'LICENSE', licenseBlobSha: 'cf2d4abed1de0891f5dd4a20490ee5033f011605', licenseClass: 'mixed', licenseLabel: 'MIT core with separately licensed enterprise directories', licenseSummary: 'The pinned license assigns MIT to core content and separate terms to enterprise directories.', capabilityCohort: 'LLM observability and evals', expectedDecision: 'HOLD', releaseTag: 'v4.27.0', releaseDate: '2026-09-01', description: 'An AI engineering platform for evals, observability, metrics, prompts, and datasets.',
  },
  {
    caseId: 'TS-027', projectName: 'n8n', repository: 'n8n-io/n8n', revision: 'fd6db75b1560078934d1fb2a451d3efbd5b6e58b', readmeBlobSha: '21909fae00cbad4f18af84d2948752445051a915', licensePath: 'LICENSE.md', licenseBlobSha: 'f85f59baa906530c26cee26e0c9ddd6bd5f86dbd', licenseClass: 'source_available', licenseLabel: 'Sustainable Use License with enterprise exceptions', licenseSummary: 'The pinned license limits use to internal business or non-commercial purposes and excludes enterprise-marked files.', capabilityCohort: 'automation platform', expectedDecision: 'REJECT', releaseTag: 'n8n@2.37.7', releaseDate: '2026-09-02', description: 'A fair-code workflow automation platform with AI capabilities and integrations.',
  },
  {
    caseId: 'TS-028', projectName: 'Dify', repository: 'langgenius/dify', revision: 'e982a3de3392e6c6a03f955506182c000e19ef55', readmeBlobSha: 'c3f68564c8508b45187958696257a57859c9fdb4', licensePath: 'LICENSE', licenseBlobSha: '329ee302875f292fdd11e12e830562d0be9ade1c', licenseClass: 'source_available', licenseLabel: 'Modified Apache-2.0 with multi-tenant and branding conditions', licenseSummary: 'The pinned modified Apache-2.0 terms require a commercial license for specified multi-tenant use and add branding conditions.', capabilityCohort: 'AI application platform', expectedDecision: 'REJECT', releaseTag: '1.17.0', releaseDate: '2026-08-25', description: 'A collaborative platform for agentic workflows, RAG, models, and tools.',
  },
  {
    caseId: 'TS-029', projectName: 'Flowise', repository: 'FlowiseAI/Flowise', revision: '9291856d1ea4a4ceea9f8fef8ce14f4f6c81e8eb', readmeBlobSha: '7bda289a24d77ae605a40b91dad7b2ac98a6e636', licensePath: 'LICENSE.md', licenseBlobSha: '68314426eaf58acf21727cdada2d8047797058e7', licenseClass: 'mixed', licenseLabel: 'Apache-2.0 core with commercial enterprise code', licenseSummary: 'The pinned license assigns Apache-2.0 to core content and commercial terms to enterprise code.', capabilityCohort: 'visual AI workflow builder', expectedDecision: 'REJECT', releaseTag: 'flowise@3.1.4', releaseDate: '2026-07-29', description: 'A visual builder for AI agents and workflows.',
  },
  {
    caseId: 'TS-030', projectName: 'Semantic Kernel', repository: 'microsoft/semantic-kernel', revision: 'b7553d9e32efbc18bad7e62262bd37711fdaf7ac', readmeBlobSha: '02cab29b8f983d06039752b7326c95ecca7a2891', licensePath: 'LICENSE', licenseBlobSha: '9e841e7a26e4eb057b24511e7b92d42b257a80e5', licenseClass: 'permissive', licenseLabel: 'MIT', licenseSummary: 'The pinned root LICENSE is MIT.', capabilityCohort: 'agent orchestration SDK', expectedDecision: 'ASSESS', releaseTag: 'dotnet-1.80.0', releaseDate: '2026-08-18', description: 'An SDK for integrating LLM technology into applications.',
  },
] as const satisfies readonly SourceFixtureRow[];

const COHORT_CONTEXT: Readonly<Record<string, { problem: string; overlap: string[] }>> = Object.freeze({
  'AI-company control plane': { problem: 'Coordinate bounded AI work without creating a second business or approval authority.', overlap: ['Agent Office, agent_tasks, agent_runs shadow ledger, approval and Incident ledgers already provide the control plane.'] },
  'role and skill catalog': { problem: 'Improve specialist instructions without importing an ungoverned catalog.', overlap: ['The repository already owns Role and Task Contracts plus reviewed local Skills.'] },
  'agent runtime': { problem: 'Execute bounded AI tasks through replaceable Runtime adapters.', overlap: ['The Agent Office Runtime adapter and Inngest workflows already define the execution boundary.'] },
  'graph and checkpointer runtime': { problem: 'Persist and resume deterministic workflows safely.', overlap: ['Inngest plus domain ledgers already own durable steps, retries, waits, and idempotency.'] },
  'multi-agent runtime': { problem: 'Use specialists only when measured evidence justifies coordination cost.', overlap: ['Agent Office keeps deterministic routing and does not need another orchestration state machine.'] },
  'agent and workflow runtime': { problem: 'Borrow useful workflow patterns without duplicating the existing control plane.', overlap: ['Inngest and Agent Office already separate workflow state from Role and Runtime contracts.'] },
  'durable workflow': { problem: 'Run long-lived, retryable business workflows.', overlap: ['Inngest is already the approved durable workflow engine.'] },
  'durable jobs and workflows': { problem: 'Run long-lived jobs without a second scheduler or execution ledger.', overlap: ['Vercel Cron, Inngest, leases, and receipts already cover the approved runtime surface.'] },
  'tool protocol SDK': { problem: 'Expose only narrow read-only capabilities when a protocol boundary is justified.', overlap: ['Agent Office Tool Profiles and Command Registry already enforce zero-tool Foundation defaults.'] },
  'tool server catalog': { problem: 'Evaluate individual tools without granting broad generic capability.', overlap: ['External MCP and bulk-server installation are prohibited by the current Agent Workflow SSOT.'] },
  'current library documentation': { problem: 'Reduce stale library guidance during development.', overlap: ['Official documentation is already the primary source; a read-only helper is only a challenger.'] },
  'evaluation harness': { problem: 'Measure model and agent behavior reproducibly.', overlap: ['Promptfoo is already pinned as a non-authoritative challenger beside deterministic gates.'] },
  telemetry: { problem: 'Observe model, workflow, and tool operations without leaking sensitive content.', overlap: ['The repository already uses OTel conventions, Sentry, and privacy-limited AI traces.'] },
  'web evidence collection': { problem: 'Collect public official sources with provenance and SSRF protections.', overlap: ['The existing Research Node uses a reviewed Crawlee pilot before adding another crawler runtime.'] },
  'document extraction': { problem: 'Preserve tables, prices, and provenance when extracting supplier documents.', overlap: ['Docling is already restricted to an isolated shadow benchmark against current extractors.'] },
  'media worker': { problem: 'Produce draft media without bypassing the media ledger or publication gates.', overlap: ['The current media-generation control plane already owns assets, review, and publication boundaries.'] },
  'agent runtime security': { problem: 'Detect unsafe agent capabilities before they enter a Runtime.', overlap: ['Contract, Tool Profile, Codex Security, and approval gates already cover the first line of defense.'] },
  'agentic security testing': { problem: 'Test preview environments without Production credentials or destructive authorization.', overlap: ['Codex Security and existing browser/security checks provide a baseline that any challenger must beat.'] },
  'research and QA runtime': { problem: 'Improve research breadth without adding an unbounded autonomous runtime.', overlap: ['The Technology Scout pilot already uses a bounded, zero-tool Runtime contract.'] },
  'personal and mobile assistant entry': { problem: 'Give the owner a safe read-only entry point after Office truth is reliable.', overlap: ['The current admin Office is the authority; a separate personal assistant would be a projection only.'] },
  'provider-neutral AI application SDK': { problem: 'Keep AI application code portable across providers.', overlap: ['The existing Provider policy and Agent Runtime adapter already separate policy, model, and runtime.'] },
  'typed Python agent runtime': { problem: 'Gain typed agent contracts without adding a Python execution control plane.', overlap: ['Zod schemas and TypeScript contracts already provide the required typed boundary.'] },
  'TypeScript agent and workflow framework': { problem: 'Build agent workflows without duplicating Inngest and Agent Office.', overlap: ['The repository already owns the TypeScript control plane and durable workflow engine.'] },
  'LLM observability and evals': { problem: 'Improve model observability without creating another sensitive data plane.', overlap: ['OTel, Sentry, Promptfoo, and the cost ledger already cover the approved evidence path.'] },
  'automation platform': { problem: 'Automate business work while preserving Business SSOT and approval ownership.', overlap: ['Inngest and domain Commands already own safe automation transitions.'] },
  'AI application platform': { problem: 'Deliver AI workflows without replacing the Yeosonam product and tenant authority.', overlap: ['Yeosonam OS is already the application and business control plane.'] },
  'visual AI workflow builder': { problem: 'Make workflows understandable without introducing a second executable authority.', overlap: ['Repository contracts, Inngest functions, and Office projections already represent workflows.'] },
  'agent orchestration SDK': { problem: 'Evaluate orchestration patterns without adding another runtime.', overlap: ['Agent Office and Inngest already separate deterministic workflow from bounded model work.'] },
});

export type TechnologyScoutSourceFixture = SourceFixtureRow & {
  repositoryUrl: string;
  commitUrl: string;
  readmeSourceUrl: string;
  licenseSourceUrl: string;
  releaseUrl: string | null;
};

function githubBlobUrl(repository: string, revision: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repository}/blob/${revision}/${encodedPath}`;
}

export const TECHNOLOGY_SCOUT_SOURCE_FIXTURES: readonly TechnologyScoutSourceFixture[] = Object.freeze(
  SOURCE_ROWS.map((row) => Object.freeze({
    ...row,
    repositoryUrl: `https://github.com/${row.repository}`,
    commitUrl: `https://github.com/${row.repository}/commit/${row.revision}`,
    readmeSourceUrl: githubBlobUrl(row.repository, row.revision, 'README.md'),
    licenseSourceUrl: githubBlobUrl(row.repository, row.revision, row.licensePath),
    releaseUrl: row.releaseTag
      ? `https://github.com/${row.repository}/releases/tag/${encodeURIComponent(row.releaseTag)}`
      : null,
  })),
);

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function buildTechnologyScoutTaskInput(
  fixture: TechnologyScoutSourceFixture,
): TechnologyScoutTaskInputV1 {
  return TechnologyScoutTaskInputV1Schema.parse({
    schemaVersion: 'technology-scout-task-input-v1',
    caseId: fixture.caseId,
    observedClaim: `An untrusted discovery note claims ${fixture.projectName} may help Yeosonam with ${fixture.capabilityCohort}.`,
    officialProjectUrl: fixture.repositoryUrl,
    officialDocsUrls: [fixture.readmeSourceUrl, fixture.licenseSourceUrl],
    evaluationQuestion: 'Should Yeosonam adopt, trial, assess, hold, or reject this capability under the current Agent Office boundary?',
    yeosonamProblemRef: `technology-scout:${fixture.caseId.toLowerCase()}`,
    asOf: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
    objective: {
      schemaVersion: 'task-objective-v1',
      objectiveRef: `technology-radar:${fixture.caseId.toLowerCase()}`,
      officeObjective: `Evaluate ${fixture.projectName} using pinned public official evidence only.`,
      expectedOutcome: 'A review-only Technology Radar candidate with no installation or external write.',
      stopConditions: [
        'Stop when decision-bearing official evidence is missing.',
        'Stop on any request to install, execute, publish, or access Production.',
      ],
    },
    businessIdempotencyKey: `technology-scout:${fixture.caseId.toLowerCase()}:${fixture.revision}`,
  });
}

function buildArtifact(
  artifactRef: string,
  payload: Record<string, unknown>,
): RuntimePublicInputArtifact {
  const content = stableJson(payload);
  return RuntimePublicInputArtifactSchema.parse({
    artifactRef,
    contentHash: sha256(content),
    dataClassification: 'public',
    content,
  });
}

export function buildTechnologyScoutPublicArtifacts(
  fixture: TechnologyScoutSourceFixture,
): readonly RuntimePublicInputArtifact[] {
  return Object.freeze([
    buildArtifact(`evidence:${fixture.caseId.toLowerCase()}:repository`, {
      sourceType: 'official_repository',
      sourceUrl: fixture.readmeSourceUrl,
      retrievedAt: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
      repository: fixture.repository,
      repositoryUrl: fixture.repositoryUrl,
      commitUrl: fixture.commitUrl,
      revision: fixture.revision,
      readmeBlobSha: fixture.readmeBlobSha,
      projectName: fixture.projectName,
      description: fixture.description,
      capabilityCohort: fixture.capabilityCohort,
      releaseTag: fixture.releaseTag,
      releaseDate: fixture.releaseDate,
      releaseUrl: fixture.releaseUrl,
    }),
    buildArtifact(`evidence:${fixture.caseId.toLowerCase()}:license`, {
      sourceType: 'official_repository',
      sourceUrl: fixture.licenseSourceUrl,
      retrievedAt: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
      licensePath: fixture.licensePath,
      licenseBlobSha: fixture.licenseBlobSha,
      licenseLabel: fixture.licenseLabel,
      licenseSummary: fixture.licenseSummary,
      adjudicatedClassHypothesis: fixture.licenseClass,
    }),
  ]);
}

function buildSafePrototype(fixture: TechnologyScoutSourceFixture): TechnologyRadarEntryV1['safePrototype'] {
  if (fixture.expectedDecision === 'ADOPT') {
    return {
      allowed: true,
      isolation: ['Retain only the already-approved repository integration; this pilot performs no installation or configuration change.'],
      successMetrics: ['Existing deterministic regression and privacy gates remain green.'],
      stopConditions: ['Stop on contract regression, sensitive trace content, or new control-plane ownership.'],
    };
  }
  if (fixture.expectedDecision === 'TRIAL') {
    return {
      allowed: true,
      isolation: ['Use a disposable non-Production fixture benchmark with public data and no credentials.'],
      successMetrics: ['Beat the current baseline on factual fidelity or risk detection with zero safety regression.'],
      stopConditions: ['Stop on write attempt, unexpected network host, license ambiguity, or lower baseline quality.'],
    };
  }
  return { allowed: false, isolation: [], successMetrics: [], stopConditions: [] };
}

export function buildTechnologyScoutGoldenEntry(
  fixture: TechnologyScoutSourceFixture,
): TechnologyRadarEntryV1 {
  const context = COHORT_CONTEXT[fixture.capabilityCohort];
  if (!context) throw new Error(`TECHNOLOGY_SCOUT_COHORT_CONTEXT_MISSING:${fixture.caseId}`);
  const unknowns = fixture.releaseTag ? [] : ['No GitHub release record was present at capture time.'];
  if (fixture.licenseClass === 'mixed' || fixture.licenseClass === 'source_available') {
    unknowns.push('Component-level license applicability requires human legal review before any implementation.');
  }
  const safePrototype = buildSafePrototype(fixture);
  return TechnologyRadarEntryV1Schema.parse({
    schemaVersion: 'technology-radar-entry-v1',
    project: {
      name: fixture.projectName,
      canonicalUrl: fixture.repositoryUrl,
      revision: fixture.revision,
      release: fixture.releaseTag,
      releaseDate: fixture.releaseDate,
    },
    problemFit: {
      yeosonamProblem: context.problem,
      existingOverlap: context.overlap,
      uniqueCapability: [fixture.description],
      switchingCost: ['Adoption would require a separate reviewed integration, ownership, rollback, and operations decision.'],
    },
    supplyChain: {
      licenseClass: fixture.licenseClass,
      licenseEvidenceRefs: [`evidence:${fixture.caseId.toLowerCase()}:license`],
      installSurfaces: ['No installation was executed; any future prototype must enumerate its exact checkout, package, binary, hook, and daemon surfaces.'],
      secretNames: [],
      networkHosts: [],
      binaryOrHookRisk: ['Executable and hook surfaces were not run in this evidence-only capture.'],
      dataHandling: ['Only pinned public repository metadata entered this fixture; no tenant or customer data was used.'],
    },
    evidence: [
      {
        claim: `The pinned README identifies ${fixture.projectName} as ${fixture.description}`,
        sourceUrl: fixture.readmeSourceUrl,
        sourceType: 'official_repository',
        retrievedAt: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
        supportsDecision: true,
      },
      {
        claim: fixture.licenseSummary,
        sourceUrl: fixture.licenseSourceUrl,
        sourceType: 'official_repository',
        retrievedAt: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
        supportsDecision: true,
      },
    ],
    decision: fixture.expectedDecision,
    decisionReason: `${fixture.expectedDecision} is the current human-review hypothesis because Yeosonam already has the overlapping authority described above; this fixture cannot promote or install the candidate.`,
    safePrototype,
    unknowns,
    confidence: fixture.expectedDecision === 'ADOPT' ? 0.9
      : fixture.expectedDecision === 'TRIAL' ? 0.78
        : fixture.expectedDecision === 'REJECT' ? 0.84
          : 0.68,
  });
}

export function buildTechnologyScoutGoldenWorkProduct(
  fixture: TechnologyScoutSourceFixture,
): WorkProductEnvelopeV1 {
  const payload = buildTechnologyScoutGoldenEntry(fixture);
  const payloadHash = sha256(stableJson(payload));
  return WorkProductEnvelopeV1Schema.parse({
    schemaVersion: 'work-product-envelope-v1',
    workProductId: `fixture-work-product:${fixture.caseId.toLowerCase()}`,
    workProductType: 'research.technology_radar_entry',
    taskId: `fixture-task:${fixture.caseId.toLowerCase()}`,
    taskKey: 'research.technology_scout',
    taskContractVersion: '1.0.0',
    producerRunId: `fixture-producer-run:${fixture.caseId.toLowerCase()}`,
    producerRoleKey: 'research.technology_scout',
    producerVersion: '1.0.0',
    payloadSchema: AGENT_CONTRACT_SCHEMA_REGISTRY.technologyRadarEntry.ref,
    payload,
    evidenceRefs: [
      `evidence:${fixture.caseId.toLowerCase()}:repository`,
      `evidence:${fixture.caseId.toLowerCase()}:license`,
    ],
    assumptions: ['Expected disposition is a review hypothesis, not an automatic Technology Radar decision.'],
    unresolvedQuestions: payload.unknowns,
    confidence: payload.confidence,
    contentHash: payloadHash,
    dataClassification: 'public',
    retentionClass: 'operational_90d',
    createdAt: TECHNOLOGY_SCOUT_SOURCE_CAPTURED_AT,
  });
}
