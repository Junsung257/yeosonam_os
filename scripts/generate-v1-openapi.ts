import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { createV1OpenApiDocument } from '../src/lib/api-contracts/v1';

const CHECK_ONLY = process.argv.includes('--check');
const SPEC_PATH = join(process.cwd(), 'docs', 'api', 'v1-openapi.json');
const TYPES_PATH = join(process.cwd(), 'src', 'generated', 'v1-api.d.ts');

function assertCurrent(path: string, expected: string): void {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) {
    throw new Error(`${path} is stale. Run npm run generate:openapi:v1.`);
  }
}

async function main(): Promise<void> {
  const document = createV1OpenApiDocument();
  const specification = `${JSON.stringify(document, null, 2)}\n`;
  const nodes = await openapiTS(Buffer.from(JSON.stringify(document)));
  const types = astToString(nodes);

  if (CHECK_ONLY) {
    assertCurrent(SPEC_PATH, specification);
    assertCurrent(TYPES_PATH, types);
    console.log('V1 OpenAPI specification and generated types are current.');
    return;
  }

  mkdirSync(dirname(SPEC_PATH), { recursive: true });
  mkdirSync(dirname(TYPES_PATH), { recursive: true });
  writeFileSync(SPEC_PATH, specification, 'utf8');
  writeFileSync(TYPES_PATH, types, 'utf8');
  console.log(`Generated ${SPEC_PATH}`);
  console.log(`Generated ${TYPES_PATH}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
