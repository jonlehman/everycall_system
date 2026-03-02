# Spec: FAQ Routing (Deterministic)

## Goal
Ensure caller questions are answered using tenant FAQs and not model improvisation.

## Non-Goals
- Embeddings-based retrieval (phase 2).
- Multi-turn FAQ dialog flows.

## Current Behavior
- FAQs exist in DB but are not injected into assistant responses.
- Model may answer from general knowledge, leading to inconsistency.

## Desired Behavior
- Detect FAQ-like questions.
- Retrieve best matching FAQ for tenant.
- Respond with the FAQ answer exactly (no paraphrase).
- If no FAQ match, respond: "I don’t have that detail, but I can have someone call you with the specifics."

## Approach (Phase 1)
- Lightweight intent detection by keyword.
- Token overlap scoring between caller utterance and FAQ question.
- Require a minimal score threshold to be considered a match.
- Direct response with the FAQ answer.

## Logging
- Log intent and matched FAQ question.
- Log fallback usage when no FAQ match.

## Edge Cases
- Caller asks multiple questions in one turn.
- Caller asks out-of-domain question (non-business).
- Caller asks after pre-close question (must still answer, then re-ask pre-close).
