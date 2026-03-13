# PRD: Agent Behavior & Prompt System

## Summary
Defines the receptionist’s tone, rules, and deterministic controls to ensure a consistent, non‑technical intake conversation.

## Goals
- Warm, empathetic, non‑announcer voice.
- Avoid technical advice; collect info only.
- Answer caller questions using tenant FAQs.
- Always ask pre‑close question before ending the call.
- Support barge‑in interruptions cleanly.

## Non‑Goals
- Performing technical diagnostics
- Complex multi‑party call handling

## Prompt Composition
Prompts are composed from:
1. System prompts (global personality, confirmation rules, FAQ usage)
2. Industry prompt defaults
3. Tenant overrides
4. Single‑use greeting (per call)

## Deterministic Controls
1. **Knowledge routing**
   - Retrieve the best matching tenant knowledge cards, facts, overrides, and guardrails.
   - If no strong match exists: “I don’t have that detail, but I can have someone call you with the specifics.”
2. **Pre‑close enforcement**
   - Ask: “Do you have any other questions…”
   - Block close until answered.
3. **Barge‑in**
   - Cancel assistant response and audio output when caller interrupts.

## Data & Storage
- `agents`: greeting, voice, prompt overrides
- `knowledge_entries`, `guardrail_question_tests`: tenant authoring layer
- `knowledge_cards`, `knowledge_facts`, `knowledge_overrides`, `knowledge_guardrails`: compiled runtime layer
- `industry_prompts`: industry defaults

## Success Metrics
- Knowledge-grounded answer accuracy
- % calls with pre‑close asked
- Reduction in interrupted assistant turns

## Risks
- Over‑automation making responses too rigid
- Prompt conflicts causing inconsistent tone
