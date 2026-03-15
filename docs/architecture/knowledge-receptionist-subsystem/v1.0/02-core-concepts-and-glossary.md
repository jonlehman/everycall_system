# 02 Core Concepts and Glossary

Status: Draft — substantive vocabulary pass

## Purpose

This document freezes the key vocabulary used across the subsystem.  
The goal is to ensure product, engineering, QA, and Codex CLI all use the same meanings.

## Canonical terms

### Domain
Broad category of business behavior shared across many tenants.

### Subdomain
Specialty or service-family delta layered beneath a domain.

### Tenant
A customer business using EveryCall.

### Domain Pack
Canonical shared rules for a domain. Defines shared intents, entities, ranking rules, boundaries, prompt fragments, and QA expectations.

### Subdomain Pack
Canonical shared delta rules for a subdomain. Extends a parent domain pack without duplicating it.

### Business Call Intent Card
Tenant-specific statement of the business's phone-call mission, tone, outcomes, disclosure, and stage playbook.

### Business Setup Interview Intent Card
Tenant-specific interview playbook used when EveryCall is interviewing the business owner/operator to capture source knowledge and onboarding configuration.

### Source Channel
The approved origin path for a captured source, such as `website_page`, `website_file`, `owner_interview`, or `uploaded_document`.

### Source Authority
A normalized authority label describing how directly the source represents business truth, such as `public_website`, `business_uploaded`, or `interview_confirmed`.

### Source Intake Session
A bounded ingestion event, such as one website crawl, one upload batch, or one owner interview session, whose captured artifacts can feed a build.

### Owner/Operator Interview
A guided phone interview run by the system to collect business knowledge and configuration before or during onboarding.


### Conversation Stage Playbook
Ordered, skippable, revisitable call stages that guide runtime call structure.

### Knowledge Fact
Atomic evidence-backed claim derived from a source segment.

### Knowledge Card
One answerable conversational unit synthesized from facts.

### Source Ref
Evidence reference to captured content from any approved source channel.

### Knowledge Build
Versioned published artifact set for a tenant.

### Runtime Bundle
Compact turn-specific set of cards, rules, and context sent to Realtime.

### Call State
Gateway-side state record for the active call.

### Caller Turn Intent
What the caller is trying to do on the current turn.

### Call Outcome Intent
Desired end state for the call, such as booked, callback requested, message taken, handoff, or redirect.

### Hard Override
Manually entered tenant fact that wins over compiled knowledge.

### Temporary Operational Notice
Time-bound manual instruction that temporarily outranks compiled knowledge.

### Soft Guidance
Tenant preference that shapes phrasing/behavior but is not a hard fact override.

### Approved Answer Snippet
Curated answer pattern for a recurring question.

### Dangerous Question
A question that requires bounded handling, escalation, or special phrasing.

### Operational Core Content
Content safe and primary for receptionist use.

### Policy Boundary Content
Restrictions, exclusions, urgent rules, and route rules.

### Descriptive Content
Explanatory but non-policy content.

### Marketing Content
Persuasive but low-priority content for truth.

### Educational Content
Informational article/blog content with reduced receptionist priority.

### Active Domain / Active Subdomain
The domain/subdomain currently selected by the gateway for a live turn.

### Mode
The runtime action pattern for a turn: `answer`, `partial_answer`, `clarify`, `handoff`, or `emergency_redirect`.

### Stage
The current step in the conversation stage playbook.

### Published Build
The tenant build currently active for runtime retrieval.

### Pack Maturity
Status of a domain/subdomain pack as `new` or `established`.

### Scope
The context within which an artifact applies, such as location, provider, domain, subdomain, or time window.

### Quality Score
A derived score indicating confidence/quality for a synthesized artifact such as a knowledge card.

### Reassurance
A brief, confidence-building statement that remains within supported facts.

## Vocabulary rules

- Use **card** to mean the primary answerable runtime unit, not a raw website chunk.
- Use **fact** to mean an atomic claim, not a user-facing answer.
- Use **bundle** to mean the per-turn payload to Realtime, not the full tenant knowledge base.
- Use **stage** to mean a playbook step, not a user intent.
- Use **mode** to mean the runtime response pattern, not a domain/subdomain.
- Use **domain/subdomain** for shared behavior categories, not tenant-specific service offerings.
