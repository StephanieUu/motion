# DECISIONS.md

## ADR-001 — Training-first product

**Status:** Accepted  
**Date:** 2026-09-10

Training adherence is the highest product priority.

Nutrition and Body support this objective.

---

## ADR-002 — One primary workout on Today

**Status:** Accepted

Today displays one dominant training task.

Do not visually split one complete follow-along workout into warm-up, workout and recovery tasks unless the source itself requires separate execution.

---

## ADR-003 — Follow-along content is the main workout format

**Status:** Accepted

The user primarily trains through follow-along content from:

- Bilibili
- Xiaohongshu
- Quark
- occasional other sources

A large Keep-style action library is not a V1 priority.

---

## ADR-004 — Small action library only for Mini Routine / Rescue

**Status:** Accepted

V1 may contain approximately 20–30 simple equipment-free movements.

Primary purpose:

- rescue
- minimum effective activity
- lightweight movement

---

## ADR-005 — Android-first

**Status:** Accepted

Primary platform:

> Samsung Android phone.

iPhone and Apple Watch are not V1 requirements.

---

## ADR-006 — React + TypeScript + Vite + Capacitor

**Status:** Accepted

Use a web-first React codebase packaged as a native Android application.

Kotlin is used only where native access is required.

---

## ADR-007 — Local-first SQLite

**Status:** Accepted

Core user data lives locally.

Core operation must not require a backend.

---

## ADR-008 — Single-user V1

**Status:** Accepted

No:

- authentication
- registration
- account system
- social system

---

## ADR-009 — Local recommendation engine is mandatory

**Status:** Accepted

Workout recommendation must work without generative AI.

Generative AI enhances recommendation but does not replace deterministic rules and scoring.

---

## ADR-010 — Free-first AI

**Status:** Accepted

Default AI strategy:

```text
Local
↓
Gemini free usage
↓
Local fallback
↓
Optional DeepSeek
```

Default paid budget:

> ¥0

---

## ADR-011 — Provider agnostic AI

**Status:** Accepted

Domain code must not depend directly on Gemini, DeepSeek or OpenAI.

All providers use shared application-level contracts.

---

## ADR-012 — OpenAI not required for V1

**Status:** Accepted

OpenAI may be added later.

ChatGPT subscription status must not affect application operation.

---

## ADR-013 — AI Coach is still a core experience

**Status:** Accepted

Although core logic is local, generative Coach conversation is considered valuable.

It should remain available when free AI capacity permits.

---

## ADR-014 — Coach tone

**Status:** Accepted

Coach should be:

- warm
- gentle
- non-judgmental
- encouraging
- action-oriented

It should reduce pressure without removing responsibility.

---

## ADR-015 — Plan structure and actual execution remain separate

**Status:** Accepted

Replacing a planned workout must never overwrite the original plan.

Store:

- planned task
- actual session
- equivalence result

separately.

---

## ADR-016 — Missed workouts do not create workout debt

**Status:** Accepted

Missed sessions are not stacked into future days.

Default response:

- delay
- restart
- lighten
- pause

depending on context.

---

## ADR-017 — Streak is meaningful

**Status:** Accepted

No qualifying activity may break the Streak.

The system should use limited protection rather than unlimited forgiveness.

---

## ADR-018 — Weekly goal remains separate from Streak

**Status:** Accepted

A broken Streak must not make the whole week feel lost.

Weekly active-day targets remain independently achievable.

---

## ADR-019 — Minimum effective activity

**Status:** Accepted

Rescue may qualify through:

- approximately 5–10 minutes
- or a defined small movement routine

Exact qualification rules can be tuned later.

---

## ADR-020 — Never Miss Twice

**Status:** Accepted

After one missed day, the second day receives stronger recovery/rescue intervention.

No shaming.

---

## ADR-021 — New activity inspiration

**Status:** Accepted

The system may recommend an activity type that is not currently represented in the library.

The user may then search Bilibili/Xiaohongshu, share a new workout back to the app and immediately use it.

---

## ADR-022 — Training library grows through usage

**Status:** Accepted

The user should not manually maintain a large structured training database.

Preferred flow:

> discover → share → train → retain.

---

## ADR-023 — Incomplete content is valid

**Status:** Accepted

Import failure must not block saving.

Unknown fields can be completed later.

---

## ADR-024 — Incremental content analysis

**Status:** Accepted

Existing unchanged workout content should not be repeatedly re-analyzed.

Use source IDs/fingerprints/versioning.

---

## ADR-025 — Quark plans are first-class training plans

**Status:** Accepted

Quark directories may represent complete multi-week programs.

Import logic should understand the entire plan before analyzing individual videos.

---

## ADR-026 — Activity preferences are learned over time

**Status:** Accepted

System uses both:

- explicit preference
- actual behavior

Current low-priority categories include:

- combat
- swimming
- ball/recreational sport
- martial arts/combat sport

Aerobics is explicitly included as a standard category.

---

## ADR-027 — Nutrition logging must tolerate imperfection

**Status:** Accepted

Valid entries include:

- exact food data
- AI estimation
- photo estimation
- rough calorie estimate

Incomplete logging is better than abandoning logging.

---

## ADR-028 — Dynamic nutrition targets

**Status:** Accepted

Daily calorie and protein targets may adapt based on:

- body data
- activity
- training
- weight trend
- current NutritionPlan

Historical targets are stored per date.

---

## ADR-029 — No food/exercise punishment loop

**Status:** Accepted

Overeating does not automatically produce:

- mandatory exercise
- next-day fasting
- severe calorie reduction

Default is to return to normal structure.

---

## ADR-030 — Nutrition plans are supported

**Status:** Accepted

Possible approaches include:

- stable fat loss
- focused fat loss
- maintenance
- high protein
- TRE
- low carb
- Keto
- flexible days
- planned low-intake strategies

More restrictive approaches require more caution.

---

## ADR-031 — Body is background data

**Status:** Accepted

Body tracking should require as little manual work as possible.

The product should emphasize trends over daily fluctuations.

---

## ADR-032 — Boohee Android integration is a technical spike

**Status:** Accepted

Do not block V1 on direct Boohee synchronization.

Screenshot OCR is an accepted fallback.

---

## ADR-033 — Progress uses charts

**Status:** Accepted

Progress should visualize:

- daily exercise amount
- active/non-active days
- activity types
- nutrition adherence percentage
- protein performance
- body trends
- training-plan completion

---

## ADR-034 — Visual rewards prioritized over complex badge systems

**Status:** Accepted

Priority:

1. artistic milestone visuals
2. journey posters
3. real-world reward goals
4. useful Streak protection

Complex badge economies are deferred.

---

## ADR-035 — Design direction maintained separately

**Status:** Accepted

`DESIGN_SYSTEM.md` is the source of truth for visual implementation.

Codex must not replace it with:

- Material Design defaults
- generic SaaS dashboards
- generic fitness-app styling

---

## ADR-036 — Visual baseline

**Status:** Accepted at product level

High-level visual direction:

- Neo Art Nouveau
- Japanese Experimental Editorial
- Wabi-Sabi influence
- selective Neo-Brutalist emphasis
- Soft Tech / glass / glow influence

Detailed implementation remains in `DESIGN_SYSTEM.md`.

---

## ADR-037 — No recurring service cost required

**Status:** Accepted

The app should be meaningfully usable at ¥0 recurring cost.

Paid services are optional enhancements.

---

## ADR-038 — Codex implements, product decisions remain explicit

**Status:** Accepted

Codex may decide implementation details.

Codex must not independently change accepted product behavior.

---

## ADR-039 — Development proceeds milestone by milestone

**Status:** Accepted

Each milestone requires:

- implementation
- tests
- Android build
- user acceptance

before proceeding.

---

## ADR-040 — Core success metric

**Status:** Accepted

The product should maximize:

> the probability that the user actually completes meaningful movement today.

This principle should guide future trade-offs.

---

## ADR-041 — Plan execution uses run-day records

**Status:** Accepted  
**Date:** 2026-09-10

Each `TrainingPlanDay` remains an immutable part of the original plan. Each execution uses a separate `TrainingPlanRunDay` with its scheduled date, current outcome, execution kind, and `planEquivalence`.

Rescheduling changes the run-day schedule without creating workout debt. Skipping closes the run-day. Replacement sessions reference the run-day and never overwrite the plan.

Run-day completion records the actual completion outcome; `planEquivalence` separately records satisfaction of the original plan. Overall run completion means all run-days are closed, while adherence is calculated separately.

At most one `TrainingPlanRun` may be current; both `ACTIVE` and `PAUSED` count as current.

---

## ADR-042 — Training sessions have a separate lifecycle

**Status:** Accepted  
**Date:** 2026-09-10

`TrainingSession.lifecycleStatus` is `IN_PROGRESS`, `COMPLETED`, or `ABANDONED`. Completion outcome is stored separately and exists only for a completed session.

On restart, an in-progress session is resumed, completed, or explicitly abandoned. Start and Complete transitions are idempotent, and only valid completed sessions can qualify an Active Day.

---

## ADR-043 — Active Day and Streak preservation are separate

**Status:** Accepted  
**Date:** 2026-09-10

**Supersedes:** ADR-017 only where Planned Rest or explicit Protection preserves continuity, and ADR-019 only for the exact V1 qualification threshold.

A day qualifies as active through at least 6 completed minutes or full completion of a versioned Mini Routine.

Planned Rest and an explicitly used Streak Protection preserve the current Streak without creating an Active Day or increasing the Streak. Plan Pause provides no automatic preservation.

V1 holds at most one Protection. One is earned when the active Streak first reaches each multiple of seven qualifying Active Days. Use is explicit and protects one missed date.

---

## ADR-044 — Training dates are stable start-date assignments

**Status:** Accepted  
**Date:** 2026-09-10

An ordinary session uses the device-local calendar date at Start and records the timezone and UTC offset used. A session crossing midnight remains on its start date.

Travel and timezone changes affect new records only. Historical dates change only through explicit user correction followed by dependent recalculation.

---

## ADR-045 — Historical facts are authoritative; summaries are rebuildable

**Status:** Accepted  
**Date:** 2026-09-10

Plans, run-days, sessions, feedback, and protection ledger events are authoritative records. Active Day, Streak, progress counters, preference counters, and current plan index are derived or cached.

Edits and deletion apply dependent recalculation in one transaction. Referenced plan definitions remain immutable, and referenced content is archived instead of hard-deleted.

---

## ADR-046 — Mini Routines use small immutable versions

**Status:** Accepted  
**Date:** 2026-09-10

A Mini Routine version contains ordered required items with duration or repetitions and optional instructions. V1 completion means all required items were confirmed complete.

Sessions reference the executed version. V1 does not include a general exercise-programming engine or per-movement telemetry.

---

## ADR-047 — Android SQLite and application identity baseline

**Status:** Accepted  
**Date:** 2026-09-10

V1 uses `@capacitor-community/sqlite`, matched to the selected Capacitor major, without an ORM. Application-owned sequential SQL migrations use integer schema versions and transactional upgrades.

The V1 Android application ID is `app.motion`, and the native database is named `motion`. APKs that retain personal data use one persistent private release signing key stored outside the repository.

Native Android persistence and signed upgrade data preservation are required acceptance checks.

---

# Decision Process

New major decisions should be added as:

```text
ADR-XXX — Title

Status:
Date:

Context:

Decision:

Consequences:
```

Do not silently rewrite historical ADRs.

If a decision changes, create a new ADR that supersedes the old one.

## Status

**Initial project decision log established.**
