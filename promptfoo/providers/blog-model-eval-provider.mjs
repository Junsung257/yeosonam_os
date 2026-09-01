import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callBlogModelProvider,
  getBlogModelEvalProvider,
  loadBlogModelEvalPolicy,
} from '../../scripts/lib/blog-model-eval/provider.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const policy = loadBlogModelEvalPolicy(root);

export default class BlogModelEvalProvider {
  constructor() {
    this.providerId = process.env.BLOG_MODEL_EVAL_PROVIDER_ID || '';
    this.provider = getBlogModelEvalProvider(policy, this.providerId);
  }

  id() {
    return `yeosonam:${this.provider.id}:${this.provider.model}`;
  }

  async callApi(prompt) {
    try {
      return await callBlogModelProvider({
        policy,
        providerId: this.provider.id,
        prompt,
        apiKey: process.env[this.provider.apiKeyEnv],
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'BLOG_MODEL_EVAL_PROVIDER_ERROR' };
    }
  }
}
