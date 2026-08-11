import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { parseHwpFileWithRhwp } from '@/lib/product-registration-v4/rhwp';

type Result = {
  filename: string;
  ok: boolean;
  chars?: number;
  pages?: number;
  tables?: number;
  error?: string;
};

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

async function main(): Promise<void> {
  const directory = arg('dir') || process.env.HWP_SAMPLE_DIR || 'C:\\Users\\admin\\Downloads\\코덱스테스트';
  const strict = process.argv.includes('--strict');
  const json = process.argv.includes('--json');
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.hwp'))
    .map(entry => entry.name)
    .sort();
  const results: Result[] = [];

  for (const filename of files) {
    try {
      const parsed = await parseHwpFileWithRhwp({ path: join(directory, filename), filename, sourceType: 'hwp' });
      results.push({ filename, ok: true, chars: parsed.text.length, pages: parsed.ir.pages, tables: parsed.ir.tables.length });
    } catch (error) {
      results.push({ filename, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const summary = {
    directory,
    parser: 'rhwp@0.8.2',
    files: files.length,
    success: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    totalChars: results.reduce((sum, result) => sum + (result.chars ?? 0), 0),
    totalPages: results.reduce((sum, result) => sum + (result.pages ?? 0), 0),
    totalTables: results.reduce((sum, result) => sum + (result.tables ?? 0), 0),
    results,
  };

  if (json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`V4 HWP verification: ${summary.success}/${summary.files} succeeded`);
    console.log(`pages=${summary.totalPages} tables=${summary.totalTables} chars=${summary.totalChars}`);
    for (const result of results.filter(item => !item.ok)) console.error(`FAILED ${result.filename}: ${result.error}`);
  }
  if (strict && summary.failed > 0) process.exitCode = 1;
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
