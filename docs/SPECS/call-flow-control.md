# Spec: Call Flow Control (Pre-Close + Interruptions)

## Goal
Guarantee pre-close question is asked and enforce barge-in behavior.

## Non-Goals
- Full dialog manager or state machine.
- Sentiment-based routing.

## Desired Behavior
- Once required info is collected, always ask:
  "Do you have any other questions, or anything else I can help with?"
- Do not close until the caller responds.
- If the caller asks a question, answer it, then re-ask pre-close.
- If the caller interrupts, stop assistant speech immediately.

## Deterministic Rules
- Track `preCloseAsked` and `preCloseAnswered`.
- If assistant attempts to close without pre-close, inject pre-close question.
- On caller barge-in:
  - send `response.cancel`
  - clear audio output queue
  - stop output pump

## Logging
- `assistant_response_canceled` with reason
- `preclose_injected` when system forces the question

## Edge Cases
- Caller says "stop talking" while assistant is speaking.
- Caller gives partial responses or pauses.
