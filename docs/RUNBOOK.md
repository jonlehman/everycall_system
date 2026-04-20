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
- Wrong knowledge answers: verify compiled knowledge retrieval, overrides, and guardrails.

## Billing Portal
- `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` should point at the live EveryCall portal configuration in Stripe.
- Plan changes are self-serve in Stripe Customer Portal and are expected to be next-renewal changes inside EveryCall.
- Webhook secret rollovers use:
  - `STRIPE_WEBHOOK_SECRET` for the current endpoint secret
  - `STRIPE_WEBHOOK_SECRET_PREVIOUS` during endpoint/API-version cutovers
- Required webhook coverage includes:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `subscription_schedule.created`
  - `subscription_schedule.updated`
  - `subscription_schedule.released`
  - `subscription_schedule.completed`
  - `subscription_schedule.canceled`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_action_required`
- If a customer reports that a future plan change is missing in the app, inspect both the Stripe subscription and any attached subscription schedule before changing local billing data.

## Rollback
- Use Render rollback to previous deploy.
