import {
  evaluateBlogAutopublishActivationV4,
  type BlogAutopublishActivationProbeV4,
} from '../src/lib/blog-autopublish-activation-v4';

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function probe(url: string, headers: Record<string, string>): Promise<BlogAutopublishActivationProbeV4> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers, cache: 'no-store', signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { text: text.slice(0, 500) };
    }
    return { status: response.status, body };
  } catch (error) {
    return {
      status: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const base = argument('base', 'https://www.yeosonam.com').replace(/\/$/, '');
  const secret = process.env.CRON_SECRET || process.env.BLOG_CRON_SECRET || '';
  const headers: Record<string, string> = secret
    ? { authorization: `Bearer ${secret}` }
    : {};
  const report = evaluateBlogAutopublishActivationV4({
    generation: await probe(`${base}/api/cron/blog-generate`, headers),
    publication: await probe(`${base}/api/cron/blog-publication-controller`, headers),
  });
  const output = { ...report, baseUrl: base, authProvided: Boolean(secret) };
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Blog autopublish activation V4: ${report.ready ? 'READY' : 'BLOCKED'}`,
      `generation=${report.generation.status} (${report.generation.reason})`,
      `publication=${report.publication.status} (${report.publication.reason})`,
      `readOnly=true; authProvided=${Boolean(secret)}`,
    ].join('\n') + '\n');
  }
  if (process.argv.includes('--strict') && !report.ready) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`blog autopublish activation verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
