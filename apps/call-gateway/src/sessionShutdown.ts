// Successful cleanup steps are never repeated; failed steps remain retryable.
// All steps start independently so a failing/hung persistence call cannot block
// socket closure or provider hangup. The caller retains the state until complete.
export type ShutdownProgress = {
  done: Set<string>;
  running?: Promise<boolean>;
};
export function runSessionShutdown(
  progress: ShutdownProgress,
  steps: Record<string, () => Promise<unknown> | unknown>,
  onError: (step: string, error: unknown) => void
): Promise<boolean> {
  if (progress.running) return progress.running;
  const running = Promise.all(Object.entries(steps).map(async ([name, step]) => {
    if (progress.done.has(name)) return true;
    try {
      await step();
      progress.done.add(name);
      return true;
    } catch (error) {
      onError(name, error);
      return false;
    }
  })).then(results => results.every(Boolean));
  progress.running = running;
  void running.finally(() => { if (progress.running === running) delete progress.running; });
  return running;
}
