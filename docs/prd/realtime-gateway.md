# PRD: EveryCall Realtime Gateway (V1, Clean-Slate)

## Purpose
A thin realtime gateway that executes a call flow defined by the EveryCall system, augmented only by tenant greeting + FAQs. The gateway handles call control (initiate, hang up), initial realtime AI call, realtime AI calls to its exposed tools, data persistence, and logging. It should enable the realtime AI to behave like OpenAI's realtime demo: natural, responsive, and tool-driven when needed.

## Core Principle
- All conversational logic lives in the EveryCall system.
- Gateway is runtime + data only.
  - Session setup
  - Call control
  - FAQ lookup when requested
  - Data capture tool handling
  - Data persistence and logging

## Realtime Session Configuration (Admin-stored, not hard-coded)
Must match the web demo configuration:

- Model: `gpt-realtime-1.5`
- Voice: `marin`
- Turn detection: `server_vad`
  - threshold: `0.75`
  - prefix padding: `300ms`
  - silence duration: `500ms`
  - idle timeout: off
- Transcription model: `gpt-4o-mini-transcribe`
- Noise reduction: `far_field`
- Max output tokens: `4096`
- Tools: enabled (FAQ lookup + Data capture)

## Prompt & Instruction Model
**EveryCall System Prompt (authoritative)**
- Defines call flow, tone, safety, and escalation.
- Defines when to call tools (FAQ lookup, data capture).

**Tenant Prompt**
- Greeting, company name, local rules.
- FAQ content.

**Gateway behavior**
- On call start, gateway sends a single `session.update` containing:
  - EveryCall system prompt
  - Tenant greeting + FAQs
  - Session settings above
- No gateway logic for conversation flow.

## Tools (Required)
**Gateway rule:** The gateway must never send any instructions that did not originate from EveryCall. It only forwards EveryCall's prompt content and tool definitions, and relays tool call results.

**Tool 1: FAQ Lookup**
- Purpose: Answer tenant-specific questions using FAQ content.
- Trigger: Caller asks about company-specific details (hours, pricing rules, service area, services offered, etc).
- Instruction source: EveryCall system prompt.

**Tool 2: Data Capture**
- Purpose: Allow realtime AI to send structured call data back to the gateway.
- Data fields are defined by the EveryCall system.
- The realtime AI decides when to call this tool based on instructions provided by the EveryCall prompt.

## Dynamic Field Schema
- Field definitions are not hardcoded in the gateway.
- EveryCall provides a JSON schema for the fields that must be captured for a call.
- The gateway:
  1. Receives and stores the field schema at session start.
  2. Tracks which fields are filled based on data-capture tool calls.
  3. Sends the collected field payloads back to EveryCall for handling.

**Responsibility split**
- EveryCall: defines required fields and how to handle them.
- Gateway: stores schema, receives tool payloads, forwards them.

## Prompt Contract
EveryCall must provide a single payload to the gateway at session start containing:
- `system_prompt`
- `tenant_greeting`
- `tenant_faqs`
- `field_schema`
- `tool_definitions`
- `session_config`

The gateway must treat this payload as the sole source of truth for instructions and tool availability.

## Related Specs
- Prompt contract: `docs/SPECS/realtime-gateway-prompt-contract.md`
- Tool schemas: `docs/SPECS/realtime-gateway-tools.md`
- API surface: `docs/SPECS/realtime-gateway-api.md`
- Call flow sequence: `docs/SPECS/realtime-gateway-call-flow.md`
- Failure & retry policy: `docs/SPECS/realtime-gateway-failure-policy.md`
- Admin settings model: `docs/SPECS/realtime-gateway-admin-settings.md`
- Logging spec: `docs/SPECS/realtime-gateway-logging.md`
- Data storage spec: `docs/SPECS/realtime-gateway-storage.md`

## Error Handling & Fallback
- If the realtime session fails to initialize, the gateway must log and end the call cleanly.
- If a tool call fails or returns invalid data, the gateway must log the error and continue the call without injecting its own instructions.
- If schema validation fails, the gateway should forward the raw tool payload to EveryCall and mark it as invalid.

## Security Boundary
- The gateway must only accept prompt/tool updates from authenticated EveryCall sources.
- External caller audio or untrusted text may never change system instructions or tools.

## Logging & Debugging
- Per-call log reset at call start.
- Log includes:
  - Outbound session instructions
  - Outbound response instructions
  - Raw realtime events
- Log downloadable via internal token.
- Logs are ephemeral.

## Performance Target
- Stable single-instance behavior.
- Target: 10 concurrent calls before scaling.

## Acceptance Criteria
1. Session configuration exactly matches demo settings.
2. Gateway never encodes conversation logic.
3. Gateway never sends instructions not provided by EveryCall.
4. FAQ lookup tool used for tenant-specific questions.
5. Data capture tool available and callable by the realtime AI.
6. Gateway forwards tool payloads and schema to EveryCall.
7. Logs show full instruction history per call.
8. Prompt contract enforced (only EveryCall can define prompts/tools).
9. Errors are logged without the gateway inventing responses.
