const fs = require('fs');
const path = require('path');

const distDir = process.env.NEXT_DIST_DIR || '.next';
const typesDir = path.join(process.cwd(), distDir, 'types');
const shimPath = path.join(typesDir, 'routes.js');

fs.mkdirSync(typesDir, { recursive: true });

if (!fs.existsSync(shimPath)) {
  // Next 15 emits routes.d.ts while its generated validator imports ./routes.js.
  // Keeping this type-only module present avoids intermittent build resolution failures.
  fs.writeFileSync(shimPath, 'export {};\n', 'utf8');
}
