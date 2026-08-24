import type { AiProviderResult } from './types';

/** Provider SDKs are deliberately hidden behind this callback contract. */
export type AiProviderExecutor<T> = () => Promise<AiProviderResult<T>>;
