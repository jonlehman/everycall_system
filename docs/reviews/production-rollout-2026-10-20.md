# Production rollout review, 2026-10-20

This review covers the maintenance procedure for the production recovery and knowledge-governance release. The functional implementation is commit `fb6f4aeeebe408f9c2b9a41691cbb959ff8264dc`, including the independently reviewed fixes in `2471d2f`. This document records procedure approval, not a claim that deployment or audible-call acceptance has completed.

## Required sequence

1. Verify the production database fingerprint and exact source commit. Keep the original checkout's unrelated worker changes and artifacts out of the release.
2. Confirm no active calls, operator sessions, demo timers, unresolved provider legs, recoverable Sales calls/events, active knowledge builds or leases, or running/pending worker jobs.
3. Enable Render public maintenance on both gateways. Pause the Vercel project and verify the actual app, API, minute-cron paths and current production deployment URL return `503 DEPLOYMENT_PAUSED`. Hold private callers and administrative initiators as well. Historical deployment URLs protected by Vercel SSO are restricted diagnostic surfaces: no rollout actor may invoke their legacy API handlers during maintenance.
4. Let existing Vercel executions drain for their full 300-second limit. Repeat the database and gateway idle checks after fencing. Suspend both gateways and the worker and verify their original instances have exited before migration.
5. Apply only reviewed migrations `0051`–`0055` through the fingerprint-guarded transactional runner. Verify physical schema readiness and receipts before running the replacement application. Migration `0051` intentionally binds or revokes legacy invitations; the release is not universally data-preserving.
6. Deploy the exact Sales release before advancing `main`, keeping the worker stopped and the app/cron fences in place. Confirm the original Sales instance has disappeared and one healthy replacement runs the intended revision.
7. Advance `main` only after that Sales gate. Inspect automatically triggered Vercel, inbound and worker deployments before triggering anything manually. Reverify Vercel's pause after a new production deployment exists; do not assume a pause of the old deployment fences the new one.
8. Verify all intended revisions, schema, startup/recovery state and old-instance retirement. Restore app and gateway intake in a controlled order, check public and authenticated health, and inspect post-release errors. Keep audible-call acceptance distinct from service health.

## Reviewed Sales maintenance exception

The normal Sales procedure requires the old process to stop before its replacement starts. Render's normal deployment can overlap old and new instances, and its suspended-deployment/resume behavior is not fully specified by public documentation. First prefer a supported, observed stopped-to-replacement transition. A same-current-revision probe may establish that behavior before any migration, but an accepted request alone is insufficient proof; correlate deployment ID, instance identity and events.

For this release only, an independent critical review approved an inert maintenance transition if deployment from suspended state is rejected. This is an explicit exception to the literal process ordering, not permission to roll active Sales calls across overlapping processes:

- All public, private, app, cron, browser, worker and administrative initiators remain held. The worker stays stopped and `main` stays unchanged throughout the Sales transition.
- Both recovery routines on each resumed old and replacement Sales process must report `scanned=0` and `failed=0`. Require zero recoverable events and calls, sessions, timers, provider legs and in-flight actions. A result of merely `recovered=0` is insufficient.
- Recheck those inputs throughout any temporary idle-process overlap. Both reviewed Sales revisions require one of these inputs to perform recovery effects. Any new input or unaccounted initiator invalidates the exception.
- Keep maintenance until the original instance is absent and exactly one healthy replacement runs the exact release revision. Preserve one configured Sales instance and disabled automatic deployment.

If an attempted stopped-service deploy returns a validation rejection, resume the old revision only after fresh inspection proves there is no accepted, queued or in-progress replacement and no remaining instance. An accepted request, timeout or transport failure requires inspection before another mutation. Do not blindly retry or resume.

The 97 historical dead-letter jobs are outside this rollout and must not be bulk replayed. Existing published knowledge remains active; new builds retain the release's explicit review/publication gates.

## References

- [Render maintenance mode](https://render.com/docs/maintenance-mode)
- [Render deployment lifecycle](https://render.com/docs/deploys)
- [Render instance inspection](https://api-docs.render.com/reference/list-instances)
- [Vercel project pause](https://vercel.com/docs/projects/managing-projects#pausing-a-project)
- [Implementation review](production-remediation-2026-10-20.md)
