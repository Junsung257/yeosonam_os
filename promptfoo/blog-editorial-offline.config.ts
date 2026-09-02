import { createRequire } from 'node:module';
import { evaluateBlogEditorialPromptfooV4 } from './assertions/blog-editorial-contract-v4';

const require = createRequire(import.meta.url);
const tests = require('./load-blog-editorial-tests.cjs') as Array<Record<string, unknown>>;

export default {
  description: 'Yeosonam people-first blog editorial harness (100 frozen offline fixtures)',
  prompts: [{ id: 'recorded-blog-candidate', raw: '{{candidate_answer}}' }],
  providers: [{ id: 'echo', label: 'committed-blog-candidate' }],
  defaultTest: {
    options: { disableVarExpansion: true },
    assert: [{
      type: 'javascript',
      value: evaluateBlogEditorialPromptfooV4,
      metric: 'people-first-editorial-contract-v4',
    }],
  },
  tests,
  commandLineOptions: {
    share: false,
    cache: false,
    write: false,
    maxConcurrency: 1,
  },
};
