import { AsyncLocalStorage } from 'async_hooks';

const context = new AsyncLocalStorage<boolean>();
export const isBackgroundWork = () => context.getStore() === true;
export const runScheduledWork = <T>(work: () => T): T =>
  context.run(true, work);
