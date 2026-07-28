function messageFromError(value, fallback = 'Telnyx browser calling failed.') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const source = value?.error || value;
  return String(
    source?.message
    || source?.errorMessage
    || source?.description
    || source?.code
    || fallback
  ).trim();
}

function callStateFromNotification(notification) {
  return String(notification?.call?.state || '').trim().toLowerCase();
}

const TERMINAL_CALL_STATES = new Set(['destroy', 'hangup', 'purge', 'ended']);

export async function connectTelnyxBrowserClient({
  token,
  remoteElement,
  onState,
  onError,
  onCallUpdate,
  timeoutMs = 15000
}) {
  const loginToken = String(token || '').trim();
  if (!loginToken) throw new Error('The server did not provide a Telnyx WebRTC token.');
  if (!remoteElement) throw new Error('The browser audio element is unavailable.');

  onState?.('loading_sdk');
  const { TelnyxRTC } = await import('@telnyx/webrtc');
  if (typeof TelnyxRTC !== 'function') {
    throw new Error('The Telnyx WebRTC client could not be loaded.');
  }

  const client = new TelnyxRTC({
    login_token: loginToken,
    autoReconnect: true,
    mutedMicOnStart: false
  });
  client.remoteElement = remoteElement;
  remoteElement.muted = false;
  remoteElement.volume = 1;

  let activeCall = null;
  let activeCallId = '';
  let disposed = false;
  let ready = false;
  let connectionError = null;

  const readyHandler = () => {
    if (disposed) return;
    ready = true;
    connectionError = null;
    onState?.('ready');
  };
  const errorHandler = (event) => {
    if (disposed) return;
    const message = messageFromError(event);
    onError?.(message);
    const error = event?.error || event;
    const connectionFatal = Boolean(error?.fatal) && !event?.callId;
    if (!ready || connectionFatal) {
      ready = false;
      connectionError = new Error(message);
      onState?.('error');
    }
  };
  const notificationHandler = (notification) => {
    if (disposed || notification?.type !== 'callUpdate' || !notification.call) return;
    if (!activeCallId || notification.call.id === activeCallId) {
      const state = callStateFromNotification(notification) || 'unknown';
      activeCallId = notification.call.id;
      activeCall = TERMINAL_CALL_STATES.has(state) ? null : notification.call;
      onCallUpdate?.({
        id: notification.call.id,
        state,
        cause: String(notification.call.cause || '').trim(),
        causeCode: notification.call.causeCode ?? null,
        call: notification.call
      });
    }
  };

  client
    .on('telnyx.ready', readyHandler)
    .on('telnyx.error', errorHandler)
    .on('telnyx.rtc.mediaError', errorHandler)
    .on('telnyx.notification', notificationHandler);

  onState?.('connecting');
  void client.connect().catch(errorHandler);

  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (disposed) {
        reject(new Error('The Telnyx browser client was disconnected.'));
        return;
      }
      if (ready) {
        resolve();
        return;
      }
      if (connectionError) {
        reject(connectionError);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Telnyx browser calling did not become ready in time.'));
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  }).catch(async (error) => {
    client.off('telnyx.ready', readyHandler);
    client.off('telnyx.error', errorHandler);
    client.off('telnyx.rtc.mediaError', errorHandler);
    client.off('telnyx.notification', notificationHandler);
    await client.disconnect().catch(() => {});
    throw error;
  });

  return {
    isReady() {
      return ready && !disposed;
    },
    placeCall(callOptions = {}, localStream) {
      if (!ready || disposed) throw new Error('Telnyx browser calling is not ready.');
      if (!String(callOptions.destinationNumber || '').trim()) {
        throw new Error('The server did not provide a Telnyx destination for the operator leg.');
      }
      remoteElement.muted = false;
      remoteElement.volume = 1;
      activeCall = client.newCall({
        ...callOptions,
        audio: callOptions.audio === false ? true : (callOptions.audio ?? true),
        localStream: localStream || callOptions.localStream,
        remoteElement,
        mutedMicOnStart: false
      });
      activeCallId = activeCall.id;
      onCallUpdate?.({
        id: activeCall.id,
        state: String(activeCall.state || 'new').toLowerCase(),
        cause: '',
        causeCode: null,
        call: activeCall
      });
      return activeCall;
    },
    async hangup() {
      if (!activeCall) return;
      const call = activeCall;
      await call.hangup().catch(() => {});
      if (activeCall?.id === call.id) activeCall = null;
    },
    async disconnect() {
      if (disposed) return;
      disposed = true;
      ready = false;
      if (activeCall) {
        await activeCall.hangup().catch(() => {});
        activeCall = null;
      }
      activeCallId = '';
      client.off('telnyx.ready', readyHandler);
      client.off('telnyx.error', errorHandler);
      client.off('telnyx.rtc.mediaError', errorHandler);
      client.off('telnyx.notification', notificationHandler);
      await client.disconnect().catch(() => {});
      onState?.('disconnected');
    }
  };
}

export { messageFromError };
