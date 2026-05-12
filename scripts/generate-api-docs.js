#!/usr/bin/env node
/**
 * API Documentation Generator
 *
 * Scans src/app/api/**\/route.ts and generates:
 * - OpenAPI 3.0 spec (docs/api-spec.json)
 * - Markdown API reference (docs/API_REFERENCE.md)
 *
 * Detects:
 * - HTTP methods (GET, POST, PUT, PATCH, DELETE)
 * - Route parameters ([id], [...slug])
 * - Query parameters (searchParams.get)
 * - Request body shape (JSON.parse, zod schemas)
 * - Response shapes (NextResponse.json)
 * - Status codes
 * - JSDoc comments
 */

const fs = require('fs');
const path = require('path');

const API_DIR = 'src/app/api';
const routes = [];

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
    .replace(/\\/g, '/')
    .replace(/.*\/src\/app\/api/, '/api')
    .replace(/\/route\.(ts|js)$/, '')
    .replace(/\[\.\.\.([^\]]+)\]/g, '{...$1}')
    .replace(/\[([^\]]+)\]/g, '{$1}');
}

function extractJSDoc(content, methodIndex) {
  const beforeMethod = content.substring(0, methodIndex);
  const lastJSDoc = beforeMethod.lastIndexOf('/**');
  const lastJSDocEnd = beforeMethod.lastIndexOf('*/');

  if (lastJSDoc > -1 && lastJSDocEnd > lastJSDoc) {
    const docBlock = beforeMethod.substring(lastJSDoc, lastJSDocEnd + 2);
    const linesBetween = beforeMethod.substring(lastJSDocEnd + 2).trim();

    if (linesBetween.length < 100) {
      return docBlock
        .split('\n')
        .map(line => line.replace(/^\s*\/?\*+\/?/, '').trim())
        .filter(line => line.length > 0)
        .join('\n');
    }
  }
  return '';
}

function extractQueryParams(methodBody) {
  const params = [];
  const pattern = /searchParams\.get\(['"`]([^'"`]+)['"`]\)/g;
  let match;
  while ((match = pattern.exec(methodBody)) !== null) {
    if (!params.includes(match[1])) {
      params.push(match[1]);
    }
  }
  return params;
}

function extractStatusCodes(methodBody) {
  const codes = new Set();
  const pattern = /status:\s*(\d{3})/g;
  let match;
  while ((match = pattern.exec(methodBody)) !== null) {
    codes.add(parseInt(match[1]));
  }
  if (!methodBody.match(/status:/)) {
    codes.add(200);
  }
  return [...codes].sort();
}

function extractResponseShape(methodBody) {
  const shapes = [];

  const dataMatch = methodBody.match(/NextResponse\.json\(\s*\{\s*data:\s*([^,}]+)/);
  if (dataMatch) shapes.push({ pattern: 'data-wrapped', example: '{ data: T }' });

  const errorMatch = methodBody.match(/NextResponse\.json\(\s*\{\s*error:/);
  if (errorMatch) shapes.push({ pattern: 'error-wrapped', example: '{ error: string }' });

  const successMatch = methodBody.match(/NextResponse\.json\(\s*\{\s*success:/);
  if (successMatch) shapes.push({ pattern: 'success-wrapped', example: '{ success: boolean }' });

  return shapes;
}

function analyzeRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const routePath = getRoutePath(filePath);

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  methods.forEach(method => {
    const pattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`);
    const match = pattern.exec(content);

    if (!match) return;

    const methodStart = match.index;
    let braceCount = 0;
    let inBody = false;
    let methodEnd = methodStart;

    for (let i = methodStart; i < content.length; i++) {
      const char = content[i];
      if (char === '{') {
        braceCount++;
        inBody = true;
      } else if (char === '}') {
        braceCount--;
        if (inBody && braceCount === 0) {
          methodEnd = i + 1;
          break;
        }
      }
    }

    const methodBody = content.substring(methodStart, methodEnd);
    const jsdoc = extractJSDoc(content, methodStart);

    routes.push({
      path: routePath,
      method,
      file: filePath,
      description: jsdoc,
      queryParams: extractQueryParams(methodBody),
      pathParams: (routePath.match(/\{([^}]+)\}/g) || []).map(p => p.replace(/[{}]/g, '')),
      statusCodes: extractStatusCodes(methodBody),
      responseShapes: extractResponseShape(methodBody),
      hasAuth: /withAdminGuard|withCronGuard|getServerSession/.test(content),
      hasValidation: /z\.\w+|\.parse\(|\.safeParse\(/.test(methodBody),
      acceptsBody: ['POST', 'PUT', 'PATCH'].includes(method)
    });
  });
}

function generateOpenAPI() {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: '여소남OS API',
      description: 'B2B2C Travel Platform API',
      version: '1.0.0',
      contact: {
        name: '여소남 OS Team'
      }
    },
    servers: [
      { url: 'https://yeosonam.com/api', description: 'Production' },
      { url: 'http://localhost:3000/api', description: 'Local development' }
    ],
    paths: {}
  };

  routes.forEach(route => {
    const apiPath = route.path.replace('/api', '');
    if (!spec.paths[apiPath]) {
      spec.paths[apiPath] = {};
    }

    const operation = {
      summary: route.description.split('\n')[0] || `${route.method} ${apiPath}`,
      tags: [apiPath.split('/')[1] || 'misc'],
      parameters: [
        ...route.pathParams.map(param => ({
          name: param,
          in: 'path',
          required: true,
          schema: { type: 'string' }
        })),
        ...route.queryParams.map(param => ({
          name: param,
          in: 'query',
          required: false,
          schema: { type: 'string' }
        }))
      ],
      responses: Object.fromEntries(
        route.statusCodes.map(code => [
          code.toString(),
          {
            description: code >= 200 && code < 300 ? 'Success' :
                        code >= 400 && code < 500 ? 'Client error' :
                        'Server error'
          }
        ])
      )
    };

    if (route.acceptsBody) {
      operation.requestBody = {
        content: {
          'application/json': {
            schema: { type: 'object' }
          }
        }
      };
    }

    if (route.hasAuth) {
      operation.security = [{ bearerAuth: [] }];
    }

    spec.paths[apiPath][route.method.toLowerCase()] = operation;
  });

  spec.components = {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  };

  fs.writeFileSync('docs/api-spec.json', JSON.stringify(spec, null, 2));
  console.log(`✅ OpenAPI spec generated: docs/api-spec.json (${routes.length} endpoints)`);
}

function generateMarkdown() {
  const grouped = {};
  routes.forEach(route => {
    const tag = route.path.split('/')[2] || 'misc';
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(route);
  });

  let md = `# 여소남OS API Reference\n\n`;
  md += `> Auto-generated from \`src/app/api/**/route.ts\`\n`;
  md += `> Run \`node scripts/generate-api-docs.js\` to regenerate.\n\n`;
  md += `**Total endpoints:** ${routes.length}\n`;
  md += `**Categories:** ${Object.keys(grouped).length}\n\n`;

  md += `## Table of Contents\n\n`;
  Object.keys(grouped).sort().forEach(tag => {
    md += `- [${tag}](#${tag.toLowerCase()}) (${grouped[tag].length} endpoints)\n`;
  });
  md += `\n---\n\n`;

  Object.keys(grouped).sort().forEach(tag => {
    md += `## ${tag}\n\n`;

    grouped[tag]
      .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
      .forEach(route => {
        md += `### \`${route.method}\` ${route.path}\n\n`;

        if (route.description) {
          md += `${route.description}\n\n`;
        }

        if (route.hasAuth) {
          md += `🔐 **Requires authentication**\n\n`;
        }

        if (route.pathParams.length > 0) {
          md += `**Path Parameters:**\n`;
          route.pathParams.forEach(p => {
            md += `- \`${p}\` (string, required)\n`;
          });
          md += `\n`;
        }

        if (route.queryParams.length > 0) {
          md += `**Query Parameters:**\n`;
          route.queryParams.forEach(p => {
            md += `- \`${p}\` (string, optional)\n`;
          });
          md += `\n`;
        }

        if (route.acceptsBody) {
          md += `**Request Body:** JSON\n`;
          if (route.hasValidation) {
            md += `*Validated with zod schema*\n`;
          }
          md += `\n`;
        }

        if (route.statusCodes.length > 0) {
          md += `**Status Codes:** ${route.statusCodes.join(', ')}\n\n`;
        }

        if (route.responseShapes.length > 0) {
          md += `**Response:**\n`;
          route.responseShapes.forEach(shape => {
            md += `- ${shape.pattern}: \`${shape.example}\`\n`;
          });
          md += `\n`;
        }

        md += `---\n\n`;
      });
  });

  fs.writeFileSync('docs/API_REFERENCE.md', md);
  console.log(`✅ Markdown reference generated: docs/API_REFERENCE.md`);
}

console.log('🔍 Scanning API routes...\n');
walkDir(API_DIR, analyzeRoute);
console.log(`Found ${routes.length} endpoint(s)\n`);
generateOpenAPI();
generateMarkdown();
console.log('\n✅ API documentation generated');
