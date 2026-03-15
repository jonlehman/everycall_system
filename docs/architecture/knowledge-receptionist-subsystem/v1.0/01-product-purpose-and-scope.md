# 01 Product Purpose and Scope

Status: Draft — substantive scope pass

## Purpose

This subsystem converts a tenant's **approved business sources** into a **versioned, receptionist-grade knowledge and guidance system** that can support live phone calls through the EveryCall gateway and OpenAI Realtime.

## Product purpose

At a system level, EveryCall is building a **broad receptionist / soft-sales technology**.

This subsystem exists to enable the assistant to:
- answer the phone warmly
- understand what the caller needs
- answer bounded factual questions from approved business knowledge
- build confidence that the business can help
- move the caller toward the correct next step
- capture structured information for the business
- do all of the above without inventing unsupported facts

## In scope

- Website crawling and capture
- On-site downloadable file capture
- Phone interview capture for owner/operator onboarding
- Uploaded-document capture
- Source cleanup and segmentation
- Source typing
- Atomic claim extraction
- Fact normalization
- Knowledge card synthesis
- Conflict resolution
- Embedding generation
- QA analysis of compiled knowledge
- Domain/subdomain pack application
- Business Call Intent Card configuration
- Conversation stage playbook configuration
- Hard overrides, soft guidance, and dangerous-question handling
- Runtime bundle assembly
- Gateway-side call state
- Realtime instruction generation
- Go-live gating, manual rebuilds, versioning, and rollback

## Out of scope for v1

- Third-party sources (Google Business Profile, Yelp, social media, etc.)
- Automatic continuous recrawl
- Fully autonomous pack creation per tenant
- End-user-facing self-serve domain taxonomy editing
- Regulated-domain production launch specifics
- Multilingual runtime support
- Deep appointment-system/CRM native integrations

## Constraints

- Approved v1 input channels are website pages, website-linked files, owner interview sessions, and uploaded documents
- Manual build/publish only
- Maximum build initiation frequency: 1 per tenant per day
- AI-heavy processing is acceptable
- Published build remains live until replacement passes validation
- System must support multiple verticals, not only service businesses
- System must remain receptionist / soft-sales oriented, not advisor / expert oriented

## Non-goals

- Generic website chatbot
- Unbounded search engine over tenant content
- Technical expert system
- Medical/legal/tax advice engine
- Fully autonomous business policy inference without human review paths

## Primary product outcomes

- Caller feels welcomed and understood
- Caller gets a direct and bounded answer when available
- Caller is guided toward the correct next step
- Business receives usable structured output from the call
- System avoids unsupported claims and unsafe behavior

## Architectural framing

This subsystem is not just website ingestion. It is the coordinated architecture for:

1. multi-source business-knowledge ingestion and compilation
2. business-specific call behavior configuration
3. realtime instruction generation
4. gateway retrieval and orchestration
5. governance and operational control
6. testing and evaluation
