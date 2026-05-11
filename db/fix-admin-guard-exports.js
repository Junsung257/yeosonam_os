#!/usr/bin/env node

/**
 * Fix missing export statements for admin routes that have const handlers but no exports
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

function fixRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Check if has withAdminGuard import
  if (!content.includes('from \'@/lib/admin-guard\'') && !content.includes('from "@/lib/admin-guard"')) {
    return { status: 'skip', reason: 'No admin guard import' };
  }

  let modified = false;
  let newContent = content;

  for (const method of HTTP_METHODS) {
    const handlerName = `${method.toLowerCase()}Handler`;
    const exportStatement = `export const ${method} = withAdminGuard(${handlerName});`;

    // Check if handler exists
    if (!content.includes(`const ${handlerName} =`)) continue;

    // Check if export already exists
    if (content.includes(`export const ${method} = withAdminGuard`)) {
      continue;
    }

    // Check if old style export exists
    if (content.includes(`export async function ${method}`) || content.includes(`export function ${method}`)) {
      console.warn(`  ⚠️  Old export style for ${method}, skipping`);
      continue;
    }

    // Add export at the end before any trailing helpers
    // Find last closing brace and helper functions
    const lines = newContent.split('\n');
    let insertIndex = lines.length;

    // Find where to insert (before utility functions if any)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('function ') || line.startsWith('const ') || line === '') {
        insertIndex = i;
      } else {
        break;
      }
    }

    lines.splice(insertIndex, 0, `\n${exportStatement}`);
    newContent = lines.join('\n');
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { status: 'fixed' };
  }

  return { status: 'ok' };
}

// Main
const routes = findAdminRoutes();
console.log(`\nFixing exports for ${routes.length} routes...`);

const results = { fixed: 0, ok: 0, skip: 0 };
for (const route of routes) {
  const result = fixRoute(route);
  results[result.status] = (results[result.status] || 0) + 1;
  if (result.status === 'fixed') {
    console.log(`✅ FIXED: ${path.relative(ADMIN_API_DIR, route)}`);
  }
}

console.log(`\n✅ Fixed: ${results.fixed}`);
console.log(`✔️  Already OK: ${results.ok}`);
console.log(`⏭️  Skipped: ${results.skip}`);
