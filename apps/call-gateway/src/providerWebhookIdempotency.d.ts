declare module "../../../pages/api/_lib/providerWebhookIdempotency.js" {
  export function claimInboundWebhookEvent(
    pool: { query: (...args: any[]) => Promise<any> } | null,
    args: {
      provider: string,
      eventId: string | null | undefined,
      eventType?: string | null | undefined,
      rawPayload?: string | null | undefined
    }
  ): Promise<{
    accepted: boolean,
    duplicate: boolean
  }>;
}
