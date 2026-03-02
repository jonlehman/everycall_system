# Runbook

## Deployments
- Admin/client app: Vercel
- Call gateway: Render

## Logs
- Render service logs for call-gateway
- Look for: `openai_realtime_session_updated`, `assistant_response_canceled`, `openai_realtime_response_done`

## Common Issues
- Assistant interrupts caller: check barge-in cancel logic and audio queue clearing.
- Missing pre-close question: verify deterministic enforcement.
- Wrong FAQ answers: verify FAQ retrieval and category mapping.

## Rollback
- Use Render rollback to previous deploy.
