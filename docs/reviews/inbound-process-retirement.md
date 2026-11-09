# Inbound process retirement evidence

This prerequisite adds lifecycle evidence only to `call-gateway`. It changes no
database schema, call cleanup, webhook recovery, voice behavior, or service
configuration. Publish it from the deployed pre-migration revision before a
release that requires proof that old inbound recovery polling has stopped.
Deploying a later schema-dependent feature to obtain this evidence is unsafe.

The Docker command runs Node directly. The gateway and its first-party packages
have no existing process signal handlers. The helper installs once, before
gateway initialization, and writes content-free JSON directly to stderr with
`writeSync`, bypassing buffered application logging. Fields are `message`,
`level`, `pid`, UTC `timestamp`, `signal`, `exitCode`, `terminationMode`, and the
exact `RENDER_INSTANCE_ID` as `instanceId` when present. No other environment
values, provider identifiers, credentials, or call content are included.

With no other SIGTERM handler, SIGTERM still terminates immediately, without
asynchronous cleanup or a grace period. The deliberate compatibility difference
is numeric exit status 143 (`128 + SIGTERM`) instead of OS-signaled death; this
allows Node's synchronous `exit` event to emit a terminal marker. No new recovery
poll or other asynchronous callback can run after the exit event. This marker is
evidence of the terminal Node exit phase, not an independently observed OS reap.
Synchronous exit listeners may still execute in that phase; future lifecycle
changes must reassess this proof. SIGINT and SIGKILL retain native behavior and
do not produce a terminal marker. An unavailable log sink does not block exit;
missing markers must be treated as missing evidence.

Existing or subsequently added SIGTERM handlers retain ownership. The helper
does not force exit or impose a deadline on them. A later handler disables the
default-exit observer, which is removed immediately after handler registration
in a microtask so Node's native signal watcher remains correctly registered.
The helper never reinstalls it, even if that handler is later removed; Node's
default signal behavior then resumes. Exit instrumentation remains installed.

## Verification before a maintenance migration

1. Confirm the prerequisite revision is deployed and healthy. Record every
   old inbound instance's `call_gateway_lifecycle_ready` marker, exact provider
   instance identity, PID, UTC timestamp, and deployed revision. The expected
   `terminationMode` for the reviewed gateway is `immediate_exit`. If the
   instance ID is absent, obtain an exact provider log-stream-to-instance
   binding; PID or a service-wide timestamp alone is insufficient.
2. Suspend the service using the approved release procedure. For each recorded
   instance, require `call_gateway_sigterm_received` followed by
   `call_gateway_process_exit`, both with the same instance ID/PID, signal
   `SIGTERM`, exit code `143`, and mode `immediate_exit`. Use timestamp and
   deployment identity to reject markers from earlier processes/restarts.
   The terminal marker is emitted synchronously from Node's exit event; that
   process can no longer run the 15-second recovery poll or other asynchronous
   application work. A signal-received marker alone is insufficient.
3. Check for replacement instances/startup markers and correlate all log
   streams. Keep the service suspended and account for every process before
   authorizing the schema migration. Provider suspension state, empty instance
   lists, `instance_count=0`, and elapsed time alone do not prove retirement.
4. If `call_gateway_lifecycle_external_handler` appears, or readiness reports
   `external_handler`, stop using the default SIGTERM/code-143 proof. Handler
   timing is unbounded by this helper. Investigate the deployed handler; only
   the terminal exit marker or independent provider process-exit evidence can
   establish retirement. Missing terminal evidence blocks the migration.

## Offline validation

Build with `pnpm --filter @everycall/call-gateway build`, then run
`node scripts/test-call-gateway-process-lifecycle.mjs`. The test sends real OS
signals to isolated child Node processes and checks immediate exit/status,
terminal JSON fields, no asynchronous work after exit, duplicate installation,
absent instance ID, existing and later asynchronous handlers, prepended once
handlers, removed handlers, ordinary exit, unchanged SIGINT behavior, and an
unavailable stderr sink. It uses no real providers or databases.

These local checks do not prove that the provider has deployed the prerequisite
or retained its logs. Capture that evidence during the authorized deployment
before attempting the schema-changing release.
