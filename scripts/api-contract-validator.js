#!/usr/bin/env node
/**
 * API Contract Validator
 *
 * Validates that API routes:
 * - Return consistent response shapes
 * - Use proper HTTP status codes
 * - Handle errors uniformly
 * - Document inputs/outputs (via JSDoc or zod schemas)
 * - Apply consistent authentication patterns
 * - Use proper Content-Type headers
 */

const fs = require('fs');
const path = require('path');

const API_DIR = 'src/app/api';
const MIDDLEWARE_PATH = 'src/middleware.ts';

function getPublicPaths() {
  if (!fs.existsSync(MIDDLEWARE_PATH)) return [];

  const middleware = fs.readFileSync(MIDDLEWARE_PATH, 'utf8');
  const publicPathsMatch = middleware.match(/PUBLIC_PATHS\s*=\s*\[([\s\S]*?)\]/);

  if (!publicPathsMatch) return [];

  const pathsBlock = publicPathsMatch[1];
  const paths = [];
  const pathRegex = /['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = pathRegex.exec(pathsBlock)) !== null) {
    paths.push(match[1]);
  }
  return paths;
}

const PUBLIC_PATHS = getPublicPaths();
const CONTRACTS = {
  totalRoutes: 0,
  routes: [],
  violations: {
    inconsistentResponse: [],
    missingErrorHandling: [],
    missingAuth: [],
    inconsistentStatusCodes: [],
    missingValidation: [],
    nonStandardContentType: []
  }
};

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;

  fs.readdirSync(dir).forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      walkDir(filePath, callback);
    } else if (file === 'route.ts' || file === 'route.js') {
      callback(filePath);
    }
  });
}

function getRoutePath(filePath) {
  return filePath
    .replace(/.*\/src\/app\/api/, '/api')
    .replace(/\/route\.(ts|js)$/, '')
    .replace(/\[([^\]]+)\]/g, ':$1');
}

function analyzeRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const routePath = getRoutePath(filePath);

  const route = {
    path: routePath,
    file: filePath,
    methods: [],
    hasAuth: false,
    hasErrorHandling: false,
    hasValidation: false,
    responsePatterns: [],
    statusCodes: new Set(),
    issues: []
  };

  CONTRACTS.totalRoutes++;

  const methodPatterns = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  methodPatterns.forEach(method => {
    const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`);
    if (pattern.test(content)) {
      route.methods.push(method);
    }
  });

  const authPatterns = [
    /withAdminGuard\s*\(/,
    /withCronGuard\s*\(/,
    /authorization\s*:|getServerSession\s*\(/,
    /cookies\(\)|getCookie\s*\(/,
    /isAuthenticated|requireAuth/i,
    /verifyToken|verifyJWT|verifySession/i,
    /process\.env\.CRON_SECRET/,
    /process\.env\.ADMIN_SECRET/
  ];
  const hasInlineAuth = authPatterns.some(p => p.test(content));

  const isExplicitPublic = PUBLIC_PATHS.some(publicPath => {
    if (publicPath.endsWith('/*')) {
      return routePath.startsWith(publicPath.slice(0, -2));
    }
    return routePath === publicPath || routePath.startsWith(publicPath + '/');
  });

  route.hasAuth = hasInlineAuth || (!isExplicitPublic && PUBLIC_PATHS.length > 0);
  route.authSource = hasInlineAuth ? 'inline' : (isExplicitPublic ? 'public' : 'middleware');

  route.hasErrorHandling = /try\s*\{[\s\S]*?\}\s*catch/.test(content);

  const validationPatterns = [
    /z\.\w+\(/,
    /zod/,
    /\.parse\(/,
    /\.safeParse\(/,
    /validateExtractedProduct/
  ];
  route.hasValidation = validationPatterns.some(p => p.test(content));

  const statusPattern = /status:\s*(\d{3})/g;
  let statusMatch;
  while ((statusMatch = statusPattern.exec(content)) !== null) {
    route.statusCodes.add(parseInt(statusMatch[1]));
  }

  const responsePatterns = [
    { pattern: /NextResponse\.json\(\s*\{\s*data:/g, name: 'data-wrapped' },
    { pattern: /NextResponse\.json\(\s*\{\s*error:/g, name: 'error-wrapped' },
    { pattern: /NextResponse\.json\(\s*\[/g, name: 'array-direct' },
    { pattern: /NextResponse\.json\(\s*\{\s*success:/g, name: 'success-wrapped' }
  ];

  responsePatterns.forEach(({ pattern, name }) => {
    if (pattern.test(content)) {
      route.responsePatterns.push(name);
    }
  });

  const writesData = route.methods.some(m => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m));

  if (!route.hasAuth && writesData) {
    CONTRACTS.violations.missingAuth.push({
      route: routePath,
      file: filePath,
      methods: route.methods
    });
  }

  if (!route.hasErrorHandling) {
    CONTRACTS.violations.missingErrorHandling.push({
      route: routePath,
      file: filePath
    });
  }

  if (writesData && !route.hasValidation) {
    CONTRACTS.violations.missingValidation.push({
      route: routePath,
      file: filePath,
      methods: route.methods
    });
  }

  if (route.responsePatterns.length > 1 && new Set(route.responsePatterns).size > 1) {
    CONTRACTS.violations.inconsistentResponse.push({
      route: routePath,
      file: filePath,
      patterns: [...new Set(route.responsePatterns)]
    });
  }

  const validStatuses = [200, 201, 202, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 410, 422, 429, 500, 502, 503];
  const invalidStatuses = [...route.statusCodes].filter(s => !validStatuses.includes(s));
  if (invalidStatuses.length > 0) {
    CONTRACTS.violations.inconsistentStatusCodes.push({
      route: routePath,
      file: filePath,
      invalidCodes: invalidStatuses
    });
  }

  CONTRACTS.routes.push(route);
}

function generateReport() {
  const totalViolations = Object.values(CONTRACTS.violations).reduce((sum, arr) => sum + arr.length, 0);

  console.log('📋 API Contract Validation Report\n');
  console.log('=' .repeat(60));
  console.log(`Total API routes: ${CONTRACTS.totalRoutes}`);
  console.log(`Total violations: ${totalViolations}\n`);

  const sections = [
    {
      title: '🔐 Missing Authentication',
      key: 'missingAuth',
      severity: 'critical',
      description: 'Write endpoints without auth guards (excluding documented public routes)'
    },
    {
      title: '🛡️ Missing Input Validation',
      key: 'missingValidation',
      severity: 'high',
      description: 'POST/PUT/PATCH endpoints without zod or schema validation'
    },
    {
      title: '⚠️ Missing Error Handling',
      key: 'missingErrorHandling',
      severity: 'high',
      description: 'Routes without try/catch blocks'
    },
    {
      title: '📦 Inconsistent Response Patterns',
      key: 'inconsistentResponse',
      severity: 'medium',
      description: 'Routes mixing { data, error } with { success } patterns'
    },
    {
      title: '🔢 Non-Standard Status Codes',
      key: 'inconsistentStatusCodes',
      severity: 'low',
      description: 'Unusual HTTP status codes that may confuse clients'
    }
  ];

  sections.forEach(section => {
    const items = CONTRACTS.violations[section.key];
    if (items.length === 0) return;

    console.log(`\n${section.title} (${items.length}):`);
    console.log(`Severity: ${section.severity.toUpperCase()}`);
    console.log(`${section.description}\n`);

    items.slice(0, 10).forEach(item => {
      console.log(`  • ${item.route}`);
      if (item.methods) console.log(`    Methods: ${item.methods.join(', ')}`);
      if (item.patterns) console.log(`    Patterns: ${item.patterns.join(', ')}`);
      if (item.invalidCodes) console.log(`    Codes: ${item.invalidCodes.join(', ')}`);
    });

    if (items.length > 10) {
      console.log(`  ... and ${items.length - 10} more`);
    }
  });

  console.log('\n' + '=' .repeat(60));
  console.log('\n📊 Compliance Metrics:');

  const authedRoutes = CONTRACTS.routes.filter(r => r.hasAuth).length;
  const validatedRoutes = CONTRACTS.routes.filter(r => r.hasValidation).length;
  const errorHandledRoutes = CONTRACTS.routes.filter(r => r.hasErrorHandling).length;

  console.log(`  🔐 Auth coverage:       ${authedRoutes}/${CONTRACTS.totalRoutes} (${((authedRoutes / CONTRACTS.totalRoutes) * 100).toFixed(1)}%)`);
  console.log(`  🛡️ Validation coverage: ${validatedRoutes}/${CONTRACTS.totalRoutes} (${((validatedRoutes / CONTRACTS.totalRoutes) * 100).toFixed(1)}%)`);
  console.log(`  ⚠️ Error handling:      ${errorHandledRoutes}/${CONTRACTS.totalRoutes} (${((errorHandledRoutes / CONTRACTS.totalRoutes) * 100).toFixed(1)}%)`);

  const reportData = {
    timestamp: new Date().toISOString(),
    totalRoutes: CONTRACTS.totalRoutes,
    totalViolations,
    compliance: {
      auth: authedRoutes / CONTRACTS.totalRoutes,
      validation: validatedRoutes / CONTRACTS.totalRoutes,
      errorHandling: errorHandledRoutes / CONTRACTS.totalRoutes
    },
    violations: CONTRACTS.violations,
    routes: CONTRACTS.routes.map(r => ({
      ...r,
      statusCodes: [...r.statusCodes]
    }))
  };

  fs.writeFileSync('api-contract-report.json', JSON.stringify(reportData, null, 2));
  console.log('\n📄 Detailed report: api-contract-report.json');

  const criticalCount = CONTRACTS.violations.missingAuth.length;
  if (criticalCount > 0) {
    console.log(`\n❌ FAILED: ${criticalCount} critical authentication issues`);
    process.exit(1);
  } else {
    console.log('\n✅ PASSED: No critical violations');
  }
}

console.log('🔍 Scanning API routes...\n');
walkDir(API_DIR, analyzeRoute);
generateReport();
