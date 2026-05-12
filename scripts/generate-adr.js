#!/usr/bin/env node
/**
 * Architecture Decision Record (ADR) Generator
 *
 * Creates a new ADR file with proper structure.
 *
 * Usage:
 *   node scripts/generate-adr.js "Title of the decision"
 *   node scripts/generate-adr.js --list  # List all ADRs
 *   node scripts/generate-adr.js --status <number> <status>  # Update status
 */

const fs = require('fs');
const path = require('path');

const ADR_DIR = 'docs/adr';

function ensureDir() {
  if (!fs.existsSync(ADR_DIR)) {
    fs.mkdirSync(ADR_DIR, { recursive: true });
    console.log(`Created ${ADR_DIR}/`);
  }
}

function getNextNumber() {
  ensureDir();
  const files = fs.readdirSync(ADR_DIR).filter(f => /^\d{4}-.+\.md$/.test(f));

  if (files.length === 0) return 1;

  const numbers = files.map(f => parseInt(f.substring(0, 4)));
  return Math.max(...numbers) + 1;
}

function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s가-힣-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);

  return slug || 'untitled';
}

function createAdr(title) {
  ensureDir();
  const number = getNextNumber();
  const slug = slugify(title);
  const filename = `${String(number).padStart(4, '0')}-${slug}.md`;
  const filePath = path.join(ADR_DIR, filename);

  if (fs.existsSync(filePath)) {
    console.error(`Error: ADR already exists: ${filePath}`);
    process.exit(1);
  }

  const date = new Date().toISOString().split('T')[0];

  const template = `# ADR-${String(number).padStart(4, '0')}: ${title}

**Status:** Proposed
**Date:** ${date}
**Deciders:** [List participants]

## Context

[What is the issue or problem motivating this decision?
Describe the forces at play: technical, business, regulatory, etc.
What constraints exist?]

## Decision

[What is the change being proposed and/or accepted?
State the decision clearly and concisely.]

## Consequences

### Positive
- [Benefit 1]
- [Benefit 2]

### Negative
- [Trade-off 1]
- [Trade-off 2]

### Neutral
- [Side effect 1]

## Alternatives Considered

### Option A: [Alternative name]
- **Pros:** [Benefits]
- **Cons:** [Drawbacks]
- **Why rejected:** [Reason]

### Option B: [Alternative name]
- **Pros:** [Benefits]
- **Cons:** [Drawbacks]
- **Why rejected:** [Reason]

## Implementation Notes

[Technical details, migration steps, rollout plan]

## References

- [Related ADRs, RFCs, documentation links]
- [External resources]

---

**Status History:**
- ${date}: Proposed
`;

  fs.writeFileSync(filePath, template);
  console.log(`✅ Created ADR: ${filePath}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Edit the file to fill in details`);
  console.log(`   2. Discuss with team`);
  console.log(`   3. Update status to "Accepted" or "Rejected"`);
  console.log(`      node scripts/generate-adr.js --status ${number} Accepted`);
}

function listAdrs() {
  ensureDir();
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => /^\d{4}-.+\.md$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('No ADRs found. Create one with:');
    console.log('  node scripts/generate-adr.js "Title of decision"');
    return;
  }

  console.log(`📋 Architecture Decision Records (${files.length}):\n`);

  files.forEach(file => {
    const content = fs.readFileSync(path.join(ADR_DIR, file), 'utf8');
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const statusMatch = content.match(/\*\*Status:\*\*\s+(\w+)/);
    const dateMatch = content.match(/\*\*Date:\*\*\s+(\S+)/);

    const title = titleMatch ? titleMatch[1] : file;
    const status = statusMatch ? statusMatch[1] : 'Unknown';
    const date = dateMatch ? dateMatch[1] : 'N/A';

    const icon = {
      Accepted: '✅',
      Rejected: '❌',
      Deprecated: '🗑️',
      Superseded: '🔄',
      Proposed: '🤔'
    }[status] || '❓';

    console.log(`${icon} ${title}`);
    console.log(`   File: ${file}`);
    console.log(`   Status: ${status} | Date: ${date}\n`);
  });
}

function updateStatus(number, newStatus) {
  ensureDir();
  const paddedNumber = String(number).padStart(4, '0');
  const files = fs.readdirSync(ADR_DIR);
  const file = files.find(f => f.startsWith(paddedNumber + '-'));

  if (!file) {
    console.error(`Error: ADR ${number} not found`);
    process.exit(1);
  }

  const filePath = path.join(ADR_DIR, file);
  let content = fs.readFileSync(filePath, 'utf8');

  const validStatuses = ['Proposed', 'Accepted', 'Rejected', 'Deprecated', 'Superseded'];
  if (!validStatuses.includes(newStatus)) {
    console.error(`Error: Invalid status. Valid: ${validStatuses.join(', ')}`);
    process.exit(1);
  }

  content = content.replace(/(\*\*Status:\*\*)\s+\w+/, `$1 ${newStatus}`);

  const date = new Date().toISOString().split('T')[0];
  const statusLine = `- ${date}: ${newStatus}`;

  if (content.includes('**Status History:**')) {
    content = content.replace(
      /(\*\*Status History:\*\*\n(?:- [^\n]+\n)*)/,
      `$1${statusLine}\n`
    );
  }

  fs.writeFileSync(filePath, content);
  console.log(`✅ Updated ADR-${paddedNumber} status to: ${newStatus}`);
}

function generateIndex() {
  ensureDir();
  const files = fs.readdirSync(ADR_DIR)
    .filter(f => /^\d{4}-.+\.md$/.test(f))
    .sort();

  let index = `# Architecture Decision Records\n\n`;
  index += `> ADRs document significant architectural decisions made during the project lifecycle.\n\n`;
  index += `## Index\n\n`;
  index += `| # | Title | Status | Date |\n`;
  index += `|---|-------|--------|------|\n`;

  files.forEach(file => {
    const content = fs.readFileSync(path.join(ADR_DIR, file), 'utf8');
    const number = file.substring(0, 4);
    const titleMatch = content.match(/^#\s+ADR-\d+:\s+(.+)$/m);
    const statusMatch = content.match(/\*\*Status:\*\*\s+(\w+)/);
    const dateMatch = content.match(/\*\*Date:\*\*\s+(\S+)/);

    const title = titleMatch ? titleMatch[1] : file;
    const status = statusMatch ? statusMatch[1] : 'Unknown';
    const date = dateMatch ? dateMatch[1] : 'N/A';

    index += `| ${number} | [${title}](${file}) | ${status} | ${date} |\n`;
  });

  index += `\n## Creating a New ADR\n\n`;
  index += `\`\`\`bash\n`;
  index += `node scripts/generate-adr.js "Title of the decision"\n`;
  index += `\`\`\`\n\n`;
  index += `## ADR Lifecycle\n\n`;
  index += `- **Proposed** → Draft, under discussion\n`;
  index += `- **Accepted** → Approved and implemented\n`;
  index += `- **Rejected** → Considered but not adopted\n`;
  index += `- **Deprecated** → No longer relevant\n`;
  index += `- **Superseded** → Replaced by a newer decision (link to new ADR)\n`;

  const indexPath = path.join(ADR_DIR, 'README.md');
  fs.writeFileSync(indexPath, index);
  console.log(`✅ Generated index: ${indexPath}`);
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help') {
  console.log(`Architecture Decision Record (ADR) Generator

Usage:
  node scripts/generate-adr.js "Title of the decision"
  node scripts/generate-adr.js --list
  node scripts/generate-adr.js --status <number> <Proposed|Accepted|Rejected|Deprecated|Superseded>
  node scripts/generate-adr.js --index
  node scripts/generate-adr.js --help

Examples:
  node scripts/generate-adr.js "Use Supabase for primary database"
  node scripts/generate-adr.js --status 1 Accepted
  node scripts/generate-adr.js --list
`);
  process.exit(0);
}

if (args[0] === '--list') {
  listAdrs();
} else if (args[0] === '--status') {
  if (args.length < 3) {
    console.error('Error: --status requires <number> and <status>');
    process.exit(1);
  }
  updateStatus(args[1], args[2]);
  generateIndex();
} else if (args[0] === '--index') {
  generateIndex();
} else {
  createAdr(args[0]);
  generateIndex();
}
