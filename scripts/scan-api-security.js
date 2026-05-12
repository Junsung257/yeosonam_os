#!/usr/bin/env node

/**
 * API Security Scanner
 * Checks for OWASP Top 10 vulnerabilities in API routes
 */

const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '../src/app/api');
const WARNINGS = [];
const ERRORS = [];

const PATTERNS = {
  // CRITICAL = 빌드/배포 중단 사유. 패턴을 좁게 잡아 false positive 최소화.
  // 휴리스틱(SQL/secrets 키워드 매칭)은 HIGH 로 강등하고 정보 출력만.
  CODE_INJECTION: {
    // page.$$eval / obj.eval 같은 정상 메서드 이름 제외 (Playwright/Puppeteer)
    pattern: /(?<![\w$.])eval\s*\(|(?<!\w)new\s+Function\s*\(/g,
    message: 'Code injection risk - avoid eval/new Function with user input',
    severity: 'CRITICAL'
  },
  SQL_INJECTION_SUSPECT: {
    pattern: /query\s*\+\s*req\.(body|query|params)|`SELECT[^`]*\$\{[^}]*req\./gi,
    message: 'Possible SQL injection - use parameterized queries',
    severity: 'HIGH'
  },
  MISSING_AUTH: {
    pattern: /export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE)/gi,
    checker: (file) => {
      const content = fs.readFileSync(file, 'utf8');
      return !content.includes('auth') && !content.includes('session') && !content.includes('user');
    },
    message: 'No authentication check found',
    severity: 'HIGH'
  },
  NO_RATE_LIMIT: {
    pattern: /form|endpoint|api/i,
    checker: (file) => {
      const content = fs.readFileSync(file, 'utf8');
      return !content.includes('rateLimit') && !content.includes('throttle') && !content.match(/timeout.*[0-9]+/i);
    },
    message: 'No rate limiting detected',
    severity: 'MEDIUM'
  },
  XSS_RISK: {
    pattern: /dangerouslySetInnerHTML|innerHTML\s*=/gi,
    message: 'XSS risk - sanitize with DOMPurify',
    severity: 'HIGH'
  },
  // process.env / z.string() / DB 컬럼명("token_type" 등) false positive 가 많아 HIGH 로 강등.
  // 진짜 시크릿은 gitleaks 같은 전용 도구로 별도 게이트하는 게 정확.
  HARDCODED_SECRETS_SUSPECT: {
    pattern: /(password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*['"][a-zA-Z0-9/_+=-]{20,}['"]/gi,
    message: 'Hardcoded credentials suspected - verify (use process.env instead)',
    severity: 'HIGH'
  },
  MISSING_VALIDATION: {
    pattern: /req\.body|req\.query|req\.params/gi,
    checker: (file) => {
      const content = fs.readFileSync(file, 'utf8');
      const hasBody = content.includes('req.body');
      const hasValidation = content.includes('parse') || content.includes('validate') || content.includes('Schema');
      return hasBody && !hasValidation;
    },
    message: 'Input validation missing for user data',
    severity: 'HIGH'
  }
};

function scanFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = file.replace(API_DIR, 'src/app/api');

    Object.entries(PATTERNS).forEach(([name, rule]) => {
      let shouldWarn = false;

      if (rule.pattern) {
        rule.pattern.lastIndex = 0;
        shouldWarn = rule.pattern.test(content);
      }

      if (rule.checker && !shouldWarn) {
        shouldWarn = rule.checker(file);
      }

      if (shouldWarn) {
        const item = {
          file: relativePath,
          rule: name,
          message: rule.message,
          severity: rule.severity
        };

        if (rule.severity === 'CRITICAL') {
          ERRORS.push(item);
        } else {
          WARNINGS.push(item);
        }
      }
    });
  } catch (err) {
    console.error(`Error scanning ${file}:`, err.message);
  }
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !file.startsWith('.')) {
      walkDir(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      scanFile(fullPath);
    }
  });
}

console.log('🔐 Scanning API routes for security issues...\n');
walkDir(API_DIR);

if (ERRORS.length > 0) {
  console.log('❌ CRITICAL Issues Found:\n');
  ERRORS.forEach(err => {
    console.log(`   ${err.file}`);
    console.log(`   ├─ ${err.rule}: ${err.message}`);
  });
  console.log();
}

if (WARNINGS.length > 0) {
  console.log('⚠️  Warnings:\n');
  WARNINGS.forEach(warn => {
    console.log(`   ${warn.file}`);
    console.log(`   ├─ ${warn.rule}: ${warn.message}`);
  });
  console.log();
}

const totalIssues = ERRORS.length + WARNINGS.length;
if (totalIssues === 0) {
  console.log('✅ No security issues detected\n');
  process.exit(0);
} else {
  console.log(`Found ${ERRORS.length} critical + ${WARNINGS.length} warnings\n`);
  process.exit(ERRORS.length > 0 ? 1 : 0);
}
