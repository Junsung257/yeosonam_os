/**
 * 동일 키에 대한 비동기 작업을 단일 비행(merge)으로 합친다.
 * 동시 refresh / DB 조회 레이스 완화용.
 */
export function createSingleFlight<K extends string, T>() {
  const inflight = new Map<K, Promise<T>>();

  return async (key: K, fn: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key);
    if (existing) return existing;

    const p = fn().finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  };
}
