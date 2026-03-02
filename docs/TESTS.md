# Manual Call Test Scripts

Use these after any change to prompts, FAQ routing, or barge-in handling.

## Script 1: Emergency + FAQ + Pre-Close
- "My water heater is leaking. Do you do emergencies?"
- "How soon can someone come out?"
- Name, phone, address, timing.
- Verify pre-close question is asked before closing.

## Script 2: Technical Question + FAQ + Resume
- "Should I pour Drano?"
- "Do you take Apple Pay?"
- Provide name/phone/address/time.
- Verify technical deferral and FAQ answer.

## Script 3: Off-Industry Request
- "I need house cleaning."
- Verify industry mismatch response.
- Confirm prompt does not proceed unless caller confirms correct service.

## Barge-In Test
- Interrupt the assistant mid-sentence with "Sorry—one sec."
- Verify assistant speech stops immediately.
