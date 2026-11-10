// Speaker-only progress audio. Server call state remains the only authority.
export function createLocalRingback({
  createContext = () => {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    return AudioContext ? new AudioContext() : null;
  },
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let attempt = null;
  const safely = (action) => { try { Promise.resolve(action()).catch(() => {}); } catch {} };
  const stop = () => {
    const previous = attempt;
    attempt = null; // Invalidate pending resume/create/poll callbacks first.
    if (!previous) return;
    for (const timer of previous.timers) clearTimer(timer);
    for (const oscillator of previous.oscillators) {
      safely(() => oscillator.stop());
      safely(() => oscillator.disconnect());
    }
    safely(() => previous.gain?.disconnect());
    safely(() => previous.context?.close());
  };
  const schedule = (current, action, delay) => {
    const timer = setTimer(() => {
      current.timers.delete(timer);
      if (attempt === current) action();
    }, delay);
    current.timers.add(timer);
    return timer;
  };
  const start = (current) => {
    if (attempt !== current || !current.accepted || !current.resumed || current.started) return;
    try {
      const context = current.context;
      current.gain = context.createGain();
      current.gain.gain.setValueAtTime(0, context.currentTime);
      // Never connect to microphone streams, a MediaStreamDestination, or Telnyx.
      current.gain.connect(context.destination);
      for (const frequency of [440, 480]) {
        const oscillator = context.createOscillator();
        current.oscillators.push(oscillator);
        oscillator.frequency.value = frequency;
        oscillator.connect(current.gain);
        oscillator.start();
      }
      current.started = true;
      const pulse = () => {
        const time = context.currentTime;
        const gain = current.gain.gain;
        gain.setValueAtTime(0, time);
        gain.linearRampToValueAtTime(0.06, time + 0.015);
        gain.setValueAtTime(0.06, time + 1.985);
        gain.linearRampToValueAtTime(0, time + 2);
        schedule(current, pulse, 6000);
      };
      pulse();
      // Local audio fails quiet even if a server remains stuck in dialing.
      schedule(current, stop, 90000);
    } catch { stop(); }
  };
  return {
    // Call synchronously in the actual Call-button handler, before any await.
    prepare() {
      stop();
      const current = { context: null, oscillators: [], timers: new Set(), callId: null };
      attempt = current;
      try {
        current.context = createContext();
        if (!current.context) { stop(); return current; }
        Promise.resolve(current.context.resume()).then(() => {
          if (attempt !== current) return;
          current.resumed = current.context.state === "running";
          if (!current.resumed) { stop(); return; }
          start(current);
        }).catch(() => { if (attempt === current) stop(); });
      } catch { stop(); }
      return current;
    },
    bind(token, callId) {
      if (attempt === token) token.callId = callId;
    },
    update(call) {
      const current = attempt;
      if (!current?.callId) return;
      if (!call || call.id !== current.callId || call.terminal || call.prospectConnected || call.connectedAt || call.aiLive || call.providerError) { stop(); return; }
      if (call.state !== "dialing_prospect") {
        if (current.accepted || call.state !== "connecting_browser") stop();
        return;
      }
      current.accepted = true;
      if (current.freshnessTimer) {
        clearTimer(current.freshnessTimer);
        current.timers.delete(current.freshnessTimer);
      }
      current.freshnessTimer = schedule(current, stop, 6000);
      start(current);
    },
    stop,
  };
}
