# INTEGRATIONS.md

## 1. Purpose

This document defines V1 external integration expectations.

All integrations must obey:

> Integration failure must not make the core application unusable.

Every integration requires a fallback.

---

# 2. Integration Priority

Primary user ecosystem:

1. Bilibili
2. Xiaohongshu
3. Quark
4. Boohee Health
5. Samsung / Health Connect

YouTube is supported conceptually but is not a primary user source.

---

# 3. Bilibili

## Product goal

User finds workout in Bilibili:

```text
Share
↓
motion
↓
Workout library
```

User should not manually fill a large workout form.

---

## Import priority

1. Android shared text
2. URL
3. title contained in share payload
4. best-effort public metadata
5. local rules
6. screenshot if needed
7. optional generative AI
8. incomplete save

---

## Desired normalized fields

- source URL
- external ID where detectable
- title
- creator
- duration
- thumbnail
- description
- activity type
- intensity
- impact
- equipment
- jumping
- body areas

Not every field is required.

---

## Restrictions

Do not rely on unofficial behavior as permanent infrastructure without isolating it behind an adapter.

Metadata failure must not block saving.

---

# 4. Xiaohongshu

## Product goal

Same primary user flow:

```text
Share
↓
motion
↓
Workout library
```

---

## Import fallback

If direct metadata is unavailable:

```text
shared text
↓
local parsing
↓
optional screenshot
↓
OCR
↓
optional AI
```

The user should not be asked to manually type all workout details.

---

# 5. Quark

Quark is strategically important because the user stores complete multi-week and multi-month training programs there.

Typical content:

```text
30-day program/
├── introduction image
├── plan image
├── schedule image
├── Day01.mp4
├── Day02.mp4
├── ...
└── Day30.mp4
```

---

## Product objective

Recognize the directory as one `TrainingPlan`, not a collection of unrelated videos.

---

## Import priority

1. folder name
2. filenames
3. directory order
4. images
5. OCR
6. PDF/text material
7. video metadata
8. subtitles/audio if available
9. frame analysis only if genuinely required

---

## Incremental synchronization

If automatic Quark synchronization becomes available:

Do not repeatedly analyze the entire library.

Track:

- external ID
- filename
- size
- modification time
- fingerprint
- analysis version

Only new or changed content should be reprocessed.

---

## V1 implementation status

Automatic Quark cloud synchronization is a technical integration task, not a prerequisite for initial app foundation.

If automation proves difficult, acceptable fallbacks include:

- imported plan images
- imported files
- manually selected downloaded folder
- content sharing into the app

The domain model must remain ready for later automatic synchronization.

---

# 6. YouTube

Low-priority source for this user.

Architecture should support it through the same `ContentIntegration` abstraction.

Do not prioritize YouTube-specific functionality over Bilibili, Xiaohongshu or Quark.

---

# 7. Android Share Intent

High-priority V1 capability.

App should accept:

- URL
- text
- URL + text
- images where appropriate

Received content creates `WorkoutImport` or another matching import object.

---

# 8. Screenshot Import

Screenshots are a universal fallback.

Supported use cases:

- Bilibili
- Xiaohongshu
- Boohee
- Quark training-plan images
- nutrition labels

Pipeline:

```text
Screenshot
↓
Local OCR
↓
Rule-based extraction
↓
Structured preview
↓
User confirms
```

Optional AI only when local interpretation is insufficient.

---

# 9. Boohee Health

## Desired outcome

Body-scale data enters the app with minimal manual work.

---

## Preferred route

If a stable Android-compatible synchronization route is verified:

```text
Boohee
↓
supported health-data bridge
↓
motion
```

Do not assume this exists until validated.

---

## V1 fallback

```text
Boohee result screen
↓
Screenshot
↓
Share/import
↓
OCR
↓
Preview
↓
Confirm
```

Manual entry is final fallback.

---

## Important

The V1 architecture must not require iPhone.

---

# 10. Health Connect

Primary Android health integration.

Potential data:

- steps
- exercise
- sleep
- heart rate
- resting heart rate
- active calories
- weight
- body fat

---

## Behavior

- request only necessary permissions
- tolerate denied permissions
- allow partial data availability
- sync incrementally
- normalize into `HealthDailySummary`

---

# 11. Samsung Health

The application should primarily consume health data through standard Android health-data pathways where possible rather than building application logic directly around Samsung-specific APIs.

Samsung remains the user's primary phone ecosystem.

---

# 12. AI Providers

## Gemini

Primary free generative provider.

Possible tasks:

- Coach
- natural-language meals
- meal photos
- image understanding
- difficult workout classification
- training-plan understanding

---

## DeepSeek

Optional low-cost fallback.

Default:

> disabled for paid usage because monthly paid budget is ¥0.

May be enabled later by user.

---

## OpenAI

Not required for V1.

Architecture should allow future provider implementation without rewriting domain logic.

---

# 13. AI Keys

Provider credentials:

- never committed
- never included in source
- never stored in normal SQLite
- never printed in logs

For personal BYOK mode:

- entered by user
- stored through secure Android credential storage

---

# 14. Integration Adapter Pattern

Conceptual interface:

```text
IntegrationAdapter
- provider
- canHandle()
- parse()
- fetchMetadata()
- normalize()
```

Training-domain code must not care whether content came from Bilibili, Xiaohongshu, Quark or YouTube.

---

# 15. Integration Diagnostics

Settings may show:

```text
Health Connect     Connected
Gemini             Connected
Quark              Not configured
Boohee             Screenshot mode
```

Errors should be actionable.

---

# 16. Integration Failure Philosophy

Bad:

> Import failed.

Better:

> I couldn't read all the details, but I've saved the workout. You can still use it today.

---

# 17. Status

**Accepted V1 integration baseline**

Automatic capabilities remain subject to technical validation.

---

