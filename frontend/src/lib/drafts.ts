import { useCallback, useSyncExternalStore } from "react";

const drafts = new Map<string, unknown>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
export const hasDrafts = () => drafts.size > 0;
export function clearDrafts() {
  drafts.clear();
  publish();
}
export function useDraft<T>(key: string, initial: T) {
  const current = useSyncExternalStore(
    subscribe,
    () => drafts.get(key) as T | undefined,
  );
  const update = useCallback(
    (value: T) => {
      drafts.set(key, value);
      publish();
    },
    [key],
  );
  const reset = useCallback(() => {
    drafts.delete(key);
    publish();
  }, [key]);
  return {
    value: current ?? initial,
    dirty: current !== undefined,
    update,
    reset,
  };
}
