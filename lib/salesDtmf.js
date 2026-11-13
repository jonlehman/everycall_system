// A single explicit keypress, never a dial string, pause, or provider target.
export function validSalesDtmfPayload(payload) {
  return Boolean(payload && typeof payload.digit === "string"
    && /^[0-9*#]$/.test(payload.digit)
    && typeof payload.commandId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.commandId));
}

export function canSendSalesDtmf(call) {
  return Boolean(call?.id && call.prospectConnected && !call.terminal
    && ["prospect_connected", "ai_standby_ready", "ai_live", "ai_paused", "demo_ended", "signup_pending", "signup_completed"].includes(call.state));
}
