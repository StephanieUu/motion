# ARCHITECTURE.md

## 1. Purpose

This document defines the V1 technical architecture for the private Android-first fitness and weight-loss application currently codenamed `motion`.

The architecture should optimize for:

1. low or zero recurring cost
2. reliable Android usage
3. offline-first core functionality
4. low maintenance burden
5. future AI/provider flexibility
6. gradual integration with Chinese content platforms
7. long-term personal data ownership
8. safe incremental development with Codex

The application must remain useful even when:

- there is no internet connection
- Gemini free quota is unavailable
- DeepSeek is disabled
- Quark integration fails
- Boohee integration is unavailable
- external content metadata cannot be parsed

---

# 2. Architecture Principles

## 2.1 Local-first

The Android device is the primary source of truth for personal application data.

Core data resides in local SQLite.

Core workflows must not require a server.

Core workflows include:

- viewing today's workout
- training-plan progression
- workout completion
- workout feedback
- local recommendation
- Streak
- weekly goals
- rescue mode
- nutrition logging
- nutrition target calculations
- body measurement history
- progress charts
- reward tracking

---

## 2.2 Cloud AI is optional enhancement

Generative AI improves:

- Coach conversation
- food understanding
- meal-photo estimation
- ambiguous workout classification
- training-plan image understanding
- difficult content parsing

Generative AI must not be required for the application's basic operation.

---

## 2.3 External integrations must degrade gracefully

Every external integration requires a fallback.

Example:

```text
Bilibili metadata succeeds
        ↓
automatic workout card

Bilibili metadata fails
        ↓
shared text parsing

still insufficient
        ↓
optional screenshot

still insufficient
        ↓
save incomplete workout
```

The application must prefer incomplete data over blocking the user.

---

## 2.4 Product rules override implementation convenience

Technical changes must not silently alter accepted product rules.

Examples:

- Today displays one primary workout.
- Training plans are not overwritten by replacement workouts.
- Streak and weekly goals remain separate concepts.
- Food overconsumption does not automatically trigger compensatory exercise.
- AI failure does not disable core workflows.

---

# 3. Technology Stack

## Mobile

- React
- TypeScript
- Vite
- Capacitor
- React Router
- Tailwind CSS
- CSS custom properties / design tokens
- SQLite
- Recharts or equivalent lightweight charting layer
- Android native APIs through Capacitor plugins

## Android Native

Use Kotlin only where native access is required.

Examples:

- Health Connect
- secure credential storage
- Android Share Intent
- local notifications
- file access when Capacitor abstractions are insufficient

The majority of application logic remains TypeScript.

## M0 Android storage baseline

- V1 application ID: `app.motion`. It must not change after persistent user data is created.
- Native SQLite adapter: `@capacitor-community/sqlite`, using the release compatible with the selected Capacitor major.
- Database name: `motion`.
- Repositories use the adapter directly; V1 does not add an ORM.
- Browser storage or mocked repositories may support UI development, but only the native Android database satisfies persistence acceptance.
- Debug builds may use the Android debug certificate. APKs used for retained personal data use one persistent private release signing key stored and backed up outside the repository. Replacing that key or application ID is treated as a new application installation, not a routine upgrade.

---

# 4. Repository Structure

Recommended monorepo:

```text
motion/
│
├── apps/
│   ├── mobile/
│   └── api/
│
├── packages/
│   ├── domain/
│   ├── shared/
│   ├── recommendation/
│   └── integrations/
│
├── docs/
│   ├── PRODUCT.md
│   ├── ARCHITECTURE.md
│   ├── DESIGN_SYSTEM.md
│   ├── AI_COACH.md
│   ├── DATA_MODEL.md
│   ├── INTEGRATIONS.md
│   ├── MILESTONES.md
│   └── DECISIONS.md
│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# 5. Mobile Application Structure

Suggested structure:

```text
apps/mobile/src/

app/
  router/
  providers/
  bootstrap/

components/
  primitives/
  layout/
  feedback/

features/
  today/
  training/
  nutrition/
  body/
  health/
  motivation/
  progress/
  rewards/
  coach/
  imports/

db/
  migrations/
  repositories/
  schema/
  sqlite/

native/
  health/
  sharing/
  notifications/
  secure-storage/

services/
  ai/
  import/
  backup/

styles/
  tokens/
  themes/
  global/

lib/
hooks/
types/
```

Feature modules should own feature-specific UI and logic.

Shared generic components belong in `components`.

Database access must remain outside React presentation components.

---

# 6. Domain Packages

## `packages/domain`

Contains platform-independent domain types and business rules.

Examples:

- WorkoutContent
- TrainingPlan
- TrainingSession
- NutritionPlan
- BodyMeasurement
- recommendation input/output contracts

It should not depend on React.

---

## `packages/recommendation`

Contains the zero-cost recommendation engine.

Responsibilities:

- candidate filtering
- scoring
- novelty calculation
- recovery adjustment
- rescue selection
- plan-vs-exploration decisions
- deterministic explanations / reason codes

It must work without Gemini or DeepSeek.

---

## `packages/integrations`

Contains shared contracts and adapters for external sources.

Example conceptual interface:

```text
ContentIntegration
  identify()
  parseSharedContent()
  fetchMetadata()
  normalize()
```

Provider-specific implementation must not leak into training-domain logic.

---

## `packages/shared`

Contains genuinely shared utilities only.

Avoid turning it into a dumping ground.

---

# 7. Data Layer

## Primary database

SQLite.

The database is the source of truth for:

- workout library
- training plans
- plan runs
- sessions
- preferences
- recommendations
- nutrition
- body measurements
- health summaries
- streak history
- milestones
- AI usage metadata
- application preferences

Authoritative records include user-entered or imported facts and explicit state transitions: workout and plan definitions, plan runs and run-days, training sessions, feedback, and protection ledger events.

Derived records and caches include `TrainingPlanRun.currentDayIndex`, `TrainingSession.qualifiesForActiveDay`, `ActiveDay`, `StreakState`, activity-preference counters/inferred scores, and achieved weekly-goal counts. They may be stored for efficient reads, but must be reproducible from authoritative records and rules.

Plan definitions referenced by a run are immutable. To change their structure, create a new plan/version. Referenced workout or plan content is archived rather than hard-deleted; foreign keys must continue to resolve for historical sessions.

---

## Repository pattern

UI code must not execute arbitrary SQL.

Example:

```text
TodayPage
   ↓
TodayService
   ↓
TrainingSessionRepository
WorkoutRepository
NutritionRepository
```

Repositories provide persistence.

Services coordinate domain rules.

React components render state.

Changes that affect dependent state must use one SQLite transaction. This includes starting or finishing a session, advancing a plan run-day, applying protection, and editing or deleting a historical record. Recalculate affected active days, weekly counts, preference caches, plan progress, and Streak state before committing.

When a historical date changes, Streak recalculation begins at the earliest affected date and continues through the current date. A failed transaction leaves both authoritative and derived records unchanged.

---

# 8. Database Migrations

Every database schema change requires a migration.

Requirements:

- application-owned, sequential integer schema versions stored with SQLite `PRAGMA user_version`
- ordered SQL migration files committed with the application
- each pending migration applied exactly once and inside a transaction
- migrations tested against existing data
- no destructive reset as a normal upgrade path

The SQLite adapter's upgrade hooks may execute the migrations, but the application migration files remain the source of truth. Startup must fail safely with an actionable local error if a migration cannot complete; it must not delete or recreate the database automatically.

Development convenience must never assume the user can delete the database.

The user may eventually have months or years of history.

---

# 9. Recommendation Architecture

The recommendation system is not primarily an LLM.

Pipeline:

```text
User state
   ↓
Current plan
   ↓
Recent training load
   ↓
Preferences
   ↓
Hard filters
   ↓
Candidate scoring
   ↓
Novelty adjustment
   ↓
Small random perturbation
   ↓
Top candidate
   ↓
Optional AI refinement / wording
```

---

## Hard filters

Examples:

- explicit AVOID preference
- temporarily hidden content
- equipment unavailable
- duration outside hard user limits
- activity inappropriate for reported discomfort
- excessive intensity for recovery state

---

## Soft scoring

Possible factors:

- current plan relevance
- actual historical completion probability
- user preference
- perceived intensity fit
- recency
- novelty
- recent activity-type repetition
- psychological barrier
- mood match
- recovery match

Exact weights may evolve.

The data model must support experimentation without schema redesign.

---

# 10. Recommendation Output

Recommendation output must be structured.

Conceptually:

```text
RecommendationResult
- mode
- workoutContentId?
- suggestedActivityTypeId?
- score
- reasonCodes
- duration
- intensity
- novelty
```

Natural-language Coach text is presentation, not the recommendation itself.

---

# 11. AI Architecture

Use a provider-agnostic layer.

Conceptual interface:

```text
AIProvider

chat()
analyzeMealText()
analyzeMealImage()
analyzeWorkoutMetadata()
analyzePlanImage()
structureOcrText()
```

Business logic must never directly depend on Gemini-specific or DeepSeek-specific response structures.

---

# 12. AI Routing Strategy

Default strategy:

```text
Local logic
    ↓
Is generative AI actually necessary?
    ↓
No → finish locally
    ↓
Yes
    ↓
Gemini free-capable provider
    ↓
Unavailable/quota exhausted?
    ↓
Use local fallback
    ↓
Optional DeepSeek only if paid budget permits
```

Paid AI budget defaults to:

```text
¥0
```

No paid provider invocation may occur unless explicitly enabled.

---

# 13. AI Key Handling

API keys must never be hard-coded into source files or bundled into the APK.

For a private V1 application, two deployment modes are allowed.

## Mode A — BYOK direct mode

User enters their own provider API key.

The key:

- is never committed to Git
- is not stored in SQLite
- is stored using Android secure credential storage / Keystore-backed storage
- is never included in logs

This is acceptable for private personal use.

---

## Mode B — Optional API proxy

A future lightweight backend may proxy:

- Gemini
- DeepSeek
- future providers

This becomes preferable if:

- the app is distributed to other users
- provider secret isolation becomes important
- external integration OAuth requires server callbacks
- centralized usage control is needed

V1 core operation must not depend on this server.

---

# 14. `apps/api`

Create the package in Milestone 0 so architecture does not need restructuring later.

Initially it should contain minimal scaffolding only.

Possible future responsibilities:

- AI proxy
- OAuth callback handling
- Quark synchronization
- scheduled integration jobs
- encrypted cloud backup

Do not move ordinary personal application data to the backend without an explicit architecture decision.

---

# 15. Coach Architecture

Coach context should be generated from structured summaries.

Do not submit the complete local database.

Example context:

```text
Today:
- current plan: Day 17
- today's original workout: 30 min low-impact cardio
- workout not yet completed

Recent:
- 4 active days in last 7
- average duration 26 minutes
- current streak 8
- HIIT frequently skipped

Nutrition:
- approximately 1500 / 2100 kcal
- protein approximately 95 / 145 g

Recovery:
- sleep 6 h 12 min
- activity level moderate
```

This reduces:

- token usage
- cost
- privacy exposure
- irrelevant model context

---

# 16. Coach Memory

Long-term personal learning should primarily live in structured local fields:

- ActivityPreference
- WorkoutFeedback
- completion statistics
- plan history
- nutrition patterns
- Coach preference settings

Do not rely on sending endless historical chat transcripts to the model.

Coach conversation history may be locally retained, but older threads should be summarized before sending to cloud AI.

---

# 17. OCR Architecture

Prefer on-device OCR where possible.

Primary OCR use cases:

- Boohee screenshots
- training-plan screenshots
- nutrition labels
- screenshots from Bilibili/Xiaohongshu
- Quark plan images

Pipeline:

```text
Image
 ↓
Local OCR
 ↓
Rule-based parsing
 ↓
Confidence check
 ↓
Optional generative AI
 ↓
User confirmation if necessary
```

AI should not be called when OCR + deterministic parsing is sufficient.

---

# 18. Workout Import Architecture

Unified pipeline:

```text
External source
    ↓
WorkoutImport
    ↓
source identification
    ↓
shared text extraction
    ↓
metadata extraction
    ↓
rules / OCR
    ↓
optional AI enrichment
    ↓
WorkoutContent
```

All sources eventually normalize into the same domain entity.

---

# 19. Android Share Flow

The Android application must register as a supported share target.

Typical flow:

```text
Bilibili
  ↓
Share
  ↓
motion
  ↓
WorkoutImport created
  ↓
automatic parse
  ↓
Workout library
```

Same concept for:

- Xiaohongshu
- browser
- text links
- compatible local files/images

---

# 20. Quark Architecture

Quark requires separate treatment because content may represent complete programs.

Primary abstraction:

```text
TrainingPlanImporter
```

Possible inputs:

- folder structure
- filenames
- plan images
- PDF
- text instructions
- videos

The importer should attempt to understand the plan before analyzing individual videos.

Do not analyze every video by default.

Quark automatic cloud synchronization is a later integration spike.

The domain model must support it now.

---

# 21. Health Connect Architecture

Use a dedicated Capacitor-to-Kotlin bridge.

Conceptual flow:

```text
React / TypeScript
       ↓
HealthService
       ↓
Capacitor plugin
       ↓
Kotlin
       ↓
Health Connect
```

Read only required health categories.

Health data should be normalized into app-owned summaries.

The recommendation engine should read normalized `HealthDailySummary`, not directly query native APIs.

---

# 22. Health Synchronization

Use incremental synchronization where possible.

Requirements:

- track last successful sync
- tolerate permission removal
- tolerate missing data
- never block the app because Health Connect fails
- surface source attribution where useful

Health data is optional context, not a mandatory requirement.

---

# 23. Boohee Architecture

Direct Android synchronization remains unconfirmed.

Treat it as a technical spike.

Fallback chain:

```text
Direct/standard integration if available
        ↓
Screenshot share/import
        ↓
Local OCR
        ↓
Structured preview
        ↓
User confirmation
        ↓
BodyMeasurement
```

The app must not require iPhone for V1.

---

# 24. Nutrition Architecture

Nutrition calculations should be deterministic.

Local engine calculates:

- estimated maintenance energy
- target calorie range
- protein range
- daily remaining calories
- daily remaining protein
- daily target percentage

Generative AI may help interpret foods but must not perform arithmetic that can be performed locally.

---

# 25. Nutrition Logging

Input modes:

```text
Quick calorie
Natural-language meal
Meal photo
Detailed food entry
Template
Copy previous meal
```

All normalize into:

```text
Meal
  ↓
FoodEntry
```

Estimation confidence must be retained.

---

# 26. Nutrition Plan Architecture

`NutritionPlan` defines strategy.

`NutritionPlanRun` defines an actual period of use.

`DailyNutritionTarget` stores the historical daily result.

Changing the current plan must never alter historical targets.

---

# 27. Motivation Architecture

`ActiveDay` is a derived per-date activity qualification computed from valid completed sessions.

Streak is then derived from:

```text
ActiveDay
TrainingPlanRunDay planned-rest dates
StreakProtectionEvent USED dates
```

Cached summary:

```text
StreakState
```

Streak must not exist only as a mutable integer.

Planned Rest and used Protection may preserve continuity without creating an Active Day or increasing the Streak. Plan Pause has no preservation effect by itself.

---

# 28. Rescue Architecture

Rescue mode is local.

It should not require server or AI availability.

Inputs:

- current time
- today's completion state
- previous missed day
- current Streak
- plan state
- user notification settings

Outputs:

- lightweight library workout
- mini routine
- rest/plan adjustment options

---

# 29. Notifications

Use local Android notifications for:

- training reminder
- rescue reminder
- optional food reminder
- optional weigh-in reminder

Do not use a cloud notification service in V1.

---

# 30. Progress Architecture

Charts should be computed from SQLite queries / local aggregations.

Examples:

- training minutes per day
- active-day calendar
- workout-type distribution
- nutrition adherence percentage
- protein target adherence
- weight trend
- 7-day rolling average
- body-fat trend

LLMs should never be required to generate chart data.

---

# 31. Rewards

Reward and milestone triggers should be deterministic.

Examples:

- 7 active days
- 30 active days
- completed training plan
- personal reward target reached

Visual rendering follows `DESIGN_SYSTEM.md`.

Milestone snapshots must preserve historical values.

---

# 32. Backup

V1 must eventually support local export and restore.

Backup should include:

- SQLite data
- relevant application metadata
- schema version
- application version
- user-managed imported assets where practical

Secrets must not be included.

Never export:

- provider API keys
- OAuth access tokens
- secure credentials

---

# 33. Security

Minimum requirements:

- no secrets committed to Git
- no API key hard-coded in APK
- secure credential storage
- sensitive health data excluded from logs
- sanitized error logs
- least-required permissions
- minimal data sent to AI providers
- explicit paid AI opt-in

---

# 34. Privacy

The application is private and single-user.

Design defaults should therefore favor:

- local storage
- minimal network transmission
- no analytics SDK unless explicitly accepted
- no advertising
- no social tracking
- no unnecessary account creation

---

# 35. Offline Behavior

Offline mode must continue to support:

- Today's existing recommendation
- library browsing
- training-plan execution
- session logging
- feedback
- Streak
- rescue routines
- nutrition logging
- nutrition calculations
- body history
- progress charts

Unavailable offline:

- cloud AI
- live external metadata fetch
- remote Quark synchronization

These failures should degrade quietly.

---

# 36. Error Handling

Every integration must expose typed errors.

Examples:

- `NETWORK_UNAVAILABLE`
- `PROVIDER_RATE_LIMIT`
- `AUTH_REQUIRED`
- `PERMISSION_DENIED`
- `CONTENT_UNAVAILABLE`
- `PARSER_FAILED`
- `AI_QUOTA_EXCEEDED`

User-facing UI should translate technical errors into calm actions.

Example:

Not:

> Gemini 429 Resource Exhausted

Instead:

> Free AI is unavailable right now. Your local recommendation is still ready.

---

# 37. Testing Strategy

## Unit tests

Priority:

- recommendation scoring
- plan progression
- Streak
- rescue rules
- nutrition calculations
- daily target calculations
- data parsers

## Repository tests

- CRUD
- empty database to latest schema
- every supported prior schema fixture to latest schema
- failed migration rollback
- historical-data preservation
- foreign-key and uniqueness enforcement
- correction/deletion recalculation in one transaction

## Integration tests

- Share Intent parsing
- AI provider adapters
- OCR normalization

## Manual Android testing

Required for:

- Health Connect
- share target
- notifications
- SQLite persistence
- process termination and device restart persistence
- signed APK upgrade with retained database and historical references
- Android back behavior

---

# 38. Development Rule

Codex may choose reasonable implementation details inside this architecture.

Codex must not independently change:

- framework
- local-first design
- core domain relationships
- recommendation philosophy
- AI cost policy
- single-user scope
- training-first hierarchy

Such changes require an explicit architectural decision.

---

# 39. Architecture Status

**Status: Accepted V1 baseline**

Architecture may evolve through explicit ADR entries in `DECISIONS.md`.

Implementation discoveries may add technical detail without changing product semantics.
