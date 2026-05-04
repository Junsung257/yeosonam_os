/**
 * Partytown 런타임을 public/~partytown 에 복사 (next build / 로컬 dev 공통).
 */
const path = require('path');
const { copyLibFiles } = require('@builder.io/partytown/utils');

const dest = path.join(__dirname, '..', 'public', '~partytown');

copyLibFiles(dest)
  .then(() => {
    console.log('[partytown] lib copied to', dest);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[partytown] copy failed:', e);
    process.exit(1);
  });
