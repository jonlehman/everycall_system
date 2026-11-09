import { writeSync } from "node:fs";

let installed = false;

/** Observe process retirement without introducing asynchronous call cleanup. */
export function installProcessLifecycleObservability(): void {
  if (installed) return;
  installed = true;

  let signal: "SIGTERM" | null = null;
  let ownsDefaultTermination = process.listenerCount("SIGTERM") === 0;
  const instanceId = process.env.RENDER_INSTANCE_ID;

  function marker(message: string, exitCode: number | null): void {
    try {
      // Bypass buffered console/application logging during process termination.
      writeSync(2, `${JSON.stringify({
        level: "info", message, instanceId, pid: process.pid,
        timestamp: new Date().toISOString(), signal, exitCode,
        terminationMode: ownsDefaultTermination ? "immediate_exit" : "external_handler"
      })}\n`);
    } catch {
      // An unavailable log sink must not prevent termination. Missing evidence
      // is an operational verification failure, never proof of retirement.
    }
  }

  function onSigterm(): void {
    if (!ownsDefaultTermination) return;
    signal = "SIGTERM";
    marker("call_gateway_sigterm_received", 143);
    // Node's default SIGTERM action is immediate termination. Retain that
    // timing, but explicitly exit with 128 + SIGTERM so the exit event fires.
    // This changes OS-signaled death to numeric exit status 143, intentionally.
    process.exit(143);
  }

  function onNewListener(event: string | symbol): void {
    if (event !== "SIGTERM") return;
    // A future handler owns its existing shutdown semantics, even if it is a
    // prepended once-listener. Do not impose our exit or alter its ordering.
    ownsDefaultTermination = false;
    process.removeListener("newListener", onNewListener);
    // newListener fires before insertion. Removing the sole SIGTERM listener
    // inside it would stop Node's native signal watcher during registration.
    // Finish that registration first; microtasks run before OS signal callbacks.
    queueMicrotask(() => process.removeListener("SIGTERM", onSigterm));
    marker("call_gateway_lifecycle_external_handler", null);
  }

  process.once("exit", exitCode => marker("call_gateway_process_exit", exitCode));
  if (ownsDefaultTermination) {
    process.on("SIGTERM", onSigterm);
    process.on("newListener", onNewListener);
  }
  marker("call_gateway_lifecycle_ready", null);
}
