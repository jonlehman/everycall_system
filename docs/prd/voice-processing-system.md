# PRD: Voice Processing System (No Emergency Dispatch)

## Overview
Build a reliable, low-latency voice experience that answers inbound calls, gathers caller info, and returns a short, polite response. This version explicitly excludes emergency dispatch workflows.

## Goals
- Answer inbound calls 24/7 with a receptionist-style AI.
- Collect key details (name, callback, urgency, address, preferred timing).
- Use tenant + industry + system prompts to guide behavior.
- Persist full transcript + structured fields.
- Notify the tenant after call completion.

## Non-Goals
- Emergency dispatch routing or live transfers.
- Complex scheduling or calendar integration.
- Payments or quotes.

## Primary Users
- Callers: customers calling a service business.
- Tenant staff: want accurate call summaries and follow-up info.
- Admins: manage prompts, FAQs, and system configuration.

## Core Flow (No Emergency Dispatch)
1. Inbound call hits Call Gateway webhook.
2. Call Gateway resolves tenant + call state from DB.
3. AI Orchestrator composes prompt (system + industry + tenant override) and generates next text response.
4. Voice Service synthesizes audio from AI response.
5. Call Gateway returns TwiML/audio response to Twilio.
6. Each caller turn updates call state + transcript.
7. On call end, store summary + structured fields and notify tenant.

## Functional Requirements
- Handle inbound calls and continue conversations across turns.
- Keep responses short (1–2 sentences).
- Ask one question at a time.
- Avoid technical questions; collect info only.
- Always answer caller questions before continuing script.
- Persist call record, transcript, and extracted fields.
- Generate summary at call end (or after X turns).
- Use tenant-specific FAQs and prompts for guidance.

## Data Model (High-Level)
- `calls`: call_id, tenant_key, from_number, status, started_at, ended_at.
- `call_events`: call_id, role (caller/assistant), text, timestamp.
- `call_notes`: call_id, summary, extracted_fields (name, phone, address, urgency, timing).
- `agents` / `agent_versions`: prompt overrides and versions.
- `faqs`: tenant FAQs and industry defaults.

## API/Service Responsibilities
- **Call Gateway**
  - Receives Twilio webhook.
  - Loads call state and tenant config.
  - Calls AI Orchestrator and Voice Service.
  - Returns TwiML/stream response.
- **AI Orchestrator**
  - Builds prompt + context.
  - Produces next assistant response and structured updates.
- **Voice Service**
  - Converts assistant text to audio.
  - Returns audio bytes/stream.

## UX/Behavior Requirements
- Use polite, warm receptionist tone.
- Avoid exclamation points; use short sentences.
- Confirm critical info once (name spelling if ambiguous, callback, address).
- Close with a short confirmation and next steps.

## Notifications
- After call end, notify tenant via email (or dashboard entry).
- Include summary + key fields + call transcript link/reference.

## Telemetry & Ops
- Log each call turn with timestamps.
- Track latency per component (gateway, AI, voice).
- Flag errors and retries in logs.

## Open Questions
- Which channel for tenant notification (email only vs SMS too)?
- Maximum conversation length before soft-close?
- Do we want call recording or only transcripts?
