#!/usr/bin/env node
/**
 * PostToolUse hook (Edit | Write | MultiEdit)
 * 거버넌스 MD 파일이 권장 크기를 초과하면 stderr로 비차단 경고.
 *
 * 한도:
 *   - .claude/CLAUDE.md: 200줄 (Anthropic 공식 권장)
 *   - .claude/rules/*.md: 150줄 (path-scoped 룰은 더 좁게)
 *
 * exit 0 = 항상 통과 (warning only). 차단하지 않음.
 */
const fs = require('fs');
const path = require('path');

let stdinData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (stdinData += chunk));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(stdinData || '{}');
    const fp = payload?.tool_input?.file_path;
    if (!fp) return;

    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const rel = path.relative(projectDir, fp).replace(/\\/g, '/');

    let limit = null;
    let label = null;
    if (rel === '.claude/CLAUDE.md') {
      limit = 200;
      label = 'CLAUDE.md';
    } else if (rel.startsWith('.claude/rules/') && rel.endsWith('.md')) {
      limit = 150;
      label = `rule (${rel.replace('.claude/rules/', '')})`;
    } else if (rel.startsWith('.claude/commands/') && rel.endsWith('.md')) {
      limit = 500;
      label = `command (${rel.replace('.claude/commands/', '')})`;
    } else {
      return;
    }

    if (!fs.existsSync(fp)) return;
    const lines = fs.readFileSync(fp, 'utf8').split('\n').length;

    if (lines > limit) {
      process.stderr.write(
        `⚠️  ${label} is now ${lines} lines (recommended ≤${limit}). ` +
          `Consider carving sections into .claude/rules/ (path-scoped) or supporting files.\n`,
      );
    }
  } catch {
    // Silent on parse errors — don't block the agent's flow
  }
});
