export type InboundCallStartup<T> = {
  answerPromise: Promise<void>;
  bootstrapPromise: Promise<T>;
};

export function beginInboundCallStartup<T>(
  answerCall: () => Promise<unknown>,
  bootstrapSession: () => Promise<T>
): InboundCallStartup<T> {
  const answerPromise = Promise.resolve(answerCall()).then(() => undefined);
  const bootstrapPromise = Promise.resolve(bootstrapSession());
  return { answerPromise, bootstrapPromise };
}
