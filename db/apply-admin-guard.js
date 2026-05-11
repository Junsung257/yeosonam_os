#!/usr/bin/env node

/**
 * Script to apply withAdminGuard() wrapper to all admin API routes
 * Usage: node db/apply-admin-guard.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ADMIN_API_DIR = path.join(__dirname, '..', 'src', 'app', 'api', 'admin');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function findAdminRoutes() {
  const routes = [];

  function walk(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        walk(fullPath);
      } else if (file.name === 'route.ts') {
        routes.push(fullPath);
      }
    }
  }

  walk(ADMIN_API_DIR);
  return routes;
}

function hasAdminGuardImport(content) {
  return /from\s+['"]@\/lib\/admin-guard['"]/m.test(content);
}

function addAdminGuardImport(content) {
  // Find the last import statement
  const importMatch = content.match(/^import\s+.*?from\s+['"].*?['"];?$/gm);
  if (!importMatch || importMatch.length === 0) {
    // No imports found, add at the top
    return `import { withAdminGuard } from '@/lib/admin-guard';\n\n${content}`;
  }

  const lastImport = importMatch[importMatch.length - 1];
  const insertPos = content.indexOf(lastImport) + lastImport.length;

  if (hasAdminGuardImport(content)) {
    return content;
  }

  return content.slice(0, insertPos) + `\nimport { withAdminGuard } from '@/lib/admin-guard';` + content.slice(insertPos);
}

function transformHandlers(content) {
  let modified = content;

  for (const method of HTTP_METHODS) {
    // Pattern 1: export async function GET(request: NextRequest): Promise<NextResponse> {
    const pattern1 = new RegExp(
      `^export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*:\\s*Promise<NextResponse>\\s*\\{`,
      'gm'
    );

    modified = modified.replace(pattern1, (match) => {
      // Extract the parameter from the original pattern
      const paramMatch = match.match(/\(([^)]*)\)/);
      const params = paramMatch ? paramMatch[1] : 'request: NextRequest';

      return `const ${method.toLowerCase()}Handler = async (${params}): Promise<NextResponse> => {`;
    });

    // Pattern 2: export async function GET(request: NextRequest) {
    const pattern2 = new RegExp(
      `^export\\s+async\\s+function\\s+${method}\\s*\\(([^)]*)\\)\\s*\\{`,
      'gm'
    );

    modified = modified.replace(pattern2, (match) => {
      const paramMatch = match.match(/\(([^)]*)\)/);
      const params = paramMatch ? paramMatch[1] : 'request: NextRequest';

      return `const ${method.toLowerCase()}Handler = async (${params}) => {`;
    });
  }

  // Now add the exports with withAdminGuard wrapper
  for (const method of HTTP_METHODS) {
    // Find function bodies and add export statement after closing brace
    const handlerName = `${method.toLowerCase()}Handler`;
    const pattern = new RegExp(
      `^const\\s+${handlerName}\\s+=\\s+async\\s*\\(([^)]*)\\)\\s*(?::\\s*Promise<NextResponse>)?\\s*=>\\s*\\{([\\s\\S]*?)\\n\\};`,
      'gm'
    );

    if (pattern.test(modified)) {
      modified = modified.replace(pattern, (match, params, body) => {
        return `const ${handlerName} = async (${params}) => {${body}\n};\n\nexport const ${method} = withAdminGuard(${handlerName});`;
      });
    }
  }

  return modified;
}

function processRoute(filePath, dryRun = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check if already has admin guard
    if (hasAdminGuardImport(content)) {
      return { status: 'skip', reason: 'Already has admin guard', filePath };
    }

    // Check if file has any export functions
    const hasExports = /^export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/m.test(content);
    if (!hasExports) {
      return { status: 'skip', reason: 'No HTTP method exports found', filePath };
    }

    const newContent = addAdminGuardImport(transformHandlers(content));

    if (!dryRun) {
      fs.writeFileSync(filePath, newContent, 'utf-8');
    }

    return { status: 'updated', filePath, preview: newContent.slice(0, 200) };
  } catch (err) {
    return { status: 'error', filePath, error: err.message };
  }
}

// Main execution
const dryRun = process.argv.includes('--dry-run');
const routes = findAdminRoutes();

console.log(`Found ${routes.length} admin routes. ${dryRun ? '[DRY RUN]' : 'Processing...'}`);

const results = {
  updated: [],
  skip: [],
  error: [],
};

for (const route of routes) {
  const result = processRoute(route, dryRun);
  const statusKey = result.status.toLowerCase();
  if (statusKey in results) {
    results[statusKey].push(result);
  }
  console.log(`${result.status.toUpperCase()}: ${path.relative(ADMIN_API_DIR, route)}`);
}

console.log(`\n✅ Updated: ${results.updated.length}`);
console.log(`⏭️  Skipped: ${results.skip.length}`);
console.log(`❌ Errors: ${results.error.length}`);

if (results.error && results.error.length > 0) {
  console.log('\nErrors:');
  results.error.forEach((r) => console.log(`  ${r.filePath}: ${r.error}`));
}

process.exit((results.error && results.error.length > 0) ? 1 : 0);
