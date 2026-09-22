import { AsyncLocalStorage } from "node:async_hooks";

export interface SearchContext {
  log: (message: string) => void;
  checkCancelled: () => void;
  signal: AbortSignal;
}

export const searchContext = new AsyncLocalStorage<SearchContext>();

export function logSearch(message: string) {
  searchContext.getStore()?.log(message);
}

export function checkSearchCancelled() {
  searchContext.getStore()?.checkCancelled();
}
