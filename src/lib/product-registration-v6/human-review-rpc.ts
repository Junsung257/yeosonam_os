import type { SupabaseClient } from '@supabase/supabase-js';

type RpcResult = { data: unknown; error: { message?: string } | null };

/** New V6 review RPCs are not in the generated schema until the migration is applied. */
export async function callProductReviewRpc<T = unknown>(
  supabase: SupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<RpcResult>;
  const { data, error } = await rpc(functionName, args);
  if (error) throw error;
  return data as T;
}
