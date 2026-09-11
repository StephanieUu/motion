# PRODUCT.md

## 1. Product Overview

Project codename: `motion`

This is a private, single-user Android-first fitness and weight-loss application.

The product is designed around one core objective:

> Make it easier for the user to start and complete meaningful physical activity every day.

The application is not intended to become a generic fitness platform, social fitness network, or calorie-tracking database.

The primary priority is:

1. Maintain exercise consistency
2. Reduce psychological resistance to starting
3. Provide appropriate training recommendations
4. Support sustainable weight loss
5. Track nutrition and body trends
6. Provide useful long-term feedback

Training is the primary product domain.

Nutrition and body data support training and weight-loss decisions but should not create excessive logging burden.

---

# 2. Target User

V1 is designed for one private user.

Primary device:

- Android
- Samsung Galaxy phone
- APK installation

Current Apple ecosystem usage should not be required.

Apple Health / iPhone support may be considered later.

V1 does not require:

- registration
- account system
- multiple users
- social features
- friends
- public profiles
- leaderboards

---

# 3. Core Product Philosophy

## 3.1 One primary task

The Today screen should emphasize only one primary workout.

The user should not open the app and see a large checklist of:

- warm-up
- cardio
- strength
- core
- stretching
- recovery

If a follow-along workout video already contains these elements, the application treats it as one complete training task.

The intended feeling is:

> Today, I only need to do this one thing.

---

## 3.2 Reduce activation energy

The app should minimize the amount of thought and manual setup required before training.

Default behavior:

> Recommend first, ask questions only when necessary.

The app should avoid creating unnecessary decisions.

---

## 3.3 Structure without rigidity

Training plans provide structure.

AI and recommendation logic provide flexibility.

The user should be able to:

- follow the original training plan
- temporarily replace today's training
- explore something new
- move a rest day
- pause a plan
- resume later
- perform a rescue workout

Actual consistency is more important than perfect compliance with the original plan.

---

## 3.4 Gentle but not permissive

The Coach tone should be:

- warm
- calm
- encouraging
- low-pressure
- supportive

But it should still encourage action.

The app should not shame the user.

It should also not allow unlimited avoidance without consequence.

---

# 4. Primary Navigation

V1 primary navigation:

1. Today
2. Training
3. Food
4. Body
5. Me

There is also a global AI Coach entry point.

---

# 5. Today

Today is the most important screen.

Its hierarchy is:

1. Today's primary workout
2. Streak / consistency status
3. Nutrition summary
4. Body trend summary
5. Activity / recovery summary

The first screen should answer:

> What should I do today?

---

## 5.1 Primary workout card

The workout card may display:

- workout title
- duration
- intensity
- source
- current training-plan day
- short recommendation reason
- Start button
- Change Workout button

Example:

> 28 min low-impact full-body workout  
> Moderate intensity  
> Day 12 of current plan

The recommendation explanation should remain short.

Detailed reasoning should be secondary.

---

# 6. Training Content Model

Training content may come from multiple sources.

Supported content concepts:

## 6.1 Follow-along workout

Primary workout form.

Examples:

- Bilibili workout
- Xiaohongshu workout
- Quark video
- YouTube workout
- local video

---

## 6.2 Free activity

Activities not requiring a follow-along video.

Examples:

- walking
- running
- cycling
- outdoor activity

---

## 6.3 Mini routine

Small app-defined routines.

Primarily used for:

- rescue mode
- very low motivation
- minimum effective training

Usually approximately 5–10 minutes or a small number of bodyweight movements.

---

## 6.4 Training plan

A structured multi-day or multi-week program.

Examples:

- 30-day fat-loss program
- multi-month body-shaping program

A plan may include:

- videos
- images
- schedules
- rest days
- written instructions
- PDFs
- course introductions

---

# 7. Activity Types

Primary V1 activity categories include:

- low-impact cardio
- cardio
- aerobics
- dance cardio
- bodyweight strength
- core training
- Pilates
- yoga
- stretching / mobility
- recovery
- walking
- running
- cycling
- outdoor activity
- other

Low-priority but retained for exploration:

- combat cardio
- swimming
- ball / recreational sports
- martial arts / combat sports

Activity types must remain extensible.

---

# 8. Training Library

The training library is not intended to be manually maintained in detail by the user.

The preferred behavior is:

> User saves or shares content.  
> The application understands and organizes it.

Each workout may contain:

- title
- source
- URL
- thumbnail
- duration
- activity type
- intensity
- impact
- jumping
- equipment
- body areas
- psychological barrier
- user preference
- completion history

Incomplete content is allowed.

---

# 9. Content Import

## 9.1 Bilibili

Preferred flow:

> Share → App

The application should attempt to extract:

- URL
- title
- shared text
- metadata

---

## 9.2 Xiaohongshu

Preferred flow:

> Share → App

If automatic parsing is incomplete, the user may optionally provide a screenshot.

---

## 9.3 Quark

Quark is an important source because many saved workouts are complete training plans.

The application should eventually support reading a selected directory structure and recognizing:

- plan name
- day sequence
- introduction images
- training schedule images
- videos
- rest days

---

## 9.4 Import fallback

Import must degrade gracefully:

1. shared text / metadata
2. public metadata
3. local OCR
4. optional free AI
5. screenshot assistance
6. save incomplete content

Parsing failure must not prevent saving.

---

# 10. Content Analysis

Workout analysis should use progressive enrichment.

Priority:

1. cached result
2. filename / title / duration / description
3. images / OCR
4. written plan materials
5. subtitles / audio
6. video frame analysis only when necessary

Previously analyzed content should not be repeatedly reprocessed unless the source changes or analysis is intentionally refreshed.

---

# 11. Training Plans

The original training-plan structure must remain intact.

The app separately stores actual execution.

Example:

Original:

> Day 12 — 35 min HIIT

Actual:

> 25 min aerobics replacement

The original Day 12 should not be overwritten.

## 11.1 V1 plan-run rules

At most one training-plan run may be current at a time. `ACTIVE` and `PAUSED` both count as current. Starting another run requires the current run to be completed or ended first.

Each day in a run has its own scheduled local date and execution state. The original `TrainingPlanDay` remains unchanged.

When a run starts, it creates its run-days in plan order on consecutive local dates beginning with `startedOn`. Only the earliest non-closed run-day is current.

- **Completed:** the actual session has outcome `COMPLETE` and closes the run-day.
- **Partially completed:** the actual session has outcome `MOSTLY_COMPLETE` or `PARTIAL` and closes the run-day.
- **Skipped:** the day is deliberately closed without a valid completed session. It does not create workout debt.
- **Rescheduled:** the run-day remains pending and receives a new scheduled local date. Delaying it shifts later pending run-days by the same amount so two primary plan days are not stacked on one date.
- **Planned rest:** a rest day already present in the plan, including one explicitly moved within the run. It is not an active workout day.
- **Paused:** no run-day is advanced. On resume, pending run-days shift forward by the elapsed pause dates so paused days do not become missed work.
- **Replacement:** the actual session points to the run-day but may use different workout content.

Every executed plan day records `planEquivalence` separately as `FULL`, `PARTIAL`, or `NONE`. Replacement never changes the original plan. A planned session completed as designed is `FULL`; a replacement must be assessed against the planned day.

Run-day completion describes what the user actually did; `planEquivalence` describes how well it satisfied the original plan. A plan run may be marked `COMPLETED` after every run-day is closed even when some days were partial, skipped, or replaced. Plan adherence is reported separately from run completion.

Moving a planned rest day swaps its scheduled date with one pending training run-day; it does not create an additional rest day.

---

# 12. Daily Recommendation System

The recommendation system should combine local algorithms and optional AI.

Recommendation inputs may include:

- current training plan
- current plan day
- recent 3–7 day training history
- duration
- intensity
- previous completion rate
- user preference
- activity preference
- recent repetition
- novelty
- streak state
- recovery
- sleep
- activity level
- mood
- desired intensity
- available time

The recommendation system should prioritize:

> The workout the user is most likely to actually complete today, while remaining appropriate for the user's current state.

---

# 13. Recommendation Modes

The system supports:

- Normal
- Light
- Exploration
- Swap
- Recovery
- Rescue
- Restart

---

# 14. Change Workout

At any time, including while following a training plan, the user can select:

> Change Workout

The user may specify three main factors:

## Mood

- very unmotivated
- tired
- normal
- energetic
- want something fresh

## Intensity

- light
- moderate
- high
- system decides

## Duration

- 5–15 min
- 15–30 min
- 30–45 min
- 45+ min

Optional:

- familiar
- mixed
- as fresh as possible

The output should normally be one recommended workout, not a long list.

---

# 15. New Activity Inspiration

The user may also say:

> I don't know what I want to do today.

The system may recommend an activity type rather than an existing workout.

Example:

> Try aerobics today.

If the library has no suitable workout, the user can:

1. open Bilibili / Xiaohongshu
2. find a new follow-along video
3. share it to the app
4. save it to the training library
5. immediately use it as today's workout

The training library is expected to grow naturally through real usage.

---

# 16. Activity Preferences

The system should learn:

- what the user says they like
- what the user actually accepts
- what the user actually completes
- what the user repeatedly rejects

Preference is not static.

The recommendation engine should distinguish:

> stated preference

from:

> real completion probability

---

# 17. Training Completion

Starting a workout creates one in-progress training session. A session lifecycle is:

- in progress
- completed
- abandoned

A completed session separately records its completion outcome:

- complete
- mostly complete
- partial

An abandoned session does not qualify as activity. After application termination, an existing in-progress session must be recovered and the user may resume, complete, or abandon that same session. The app must not create a second in-progress session for duplicate Start actions, and repeated Complete actions must be idempotent.

The system determines active-day qualification only after a valid completed transition.

## 17.1 Calendar attribution

An ordinary session receives `localDate` from the device's local calendar date when the session starts. The app also records the timezone identifier and UTC offset used for that assignment.

A session crossing midnight remains assigned to its start date. Travel or later timezone changes affect new records only. Existing historical `localDate` values remain stable unless the user explicitly corrects the date.

---

# 18. Workout Feedback

Post-workout feedback should be minimal.

The feedback step may be skipped. Exertion, preference, and discomfort are individually optional; if feedback is saved, at least one answer must be present.

Primary feedback:

- Easy
- Just right
- Hard

Optional preference:

- Love
- Like
- Neutral
- Dislike

Optional discomfort reporting may also be supported.

User-experienced intensity should generally be more important than automatically estimated intensity.

---

# 19. Streak System

The app should use real consistency incentives.

The streak should be meaningful.

If the user performs no qualifying activity, the streak can break.

The app should avoid making streak failure psychologically catastrophic.

---

## 19.1 Active Streak

Tracks qualifying active days across calendar dates that do not break the streak.

Active-day qualification and streak preservation are separate:

- a qualifying workout increments the active-day count and Streak
- a planned rest day preserves the current Streak but does not increment it and does not count toward the weekly active-day goal
- pausing a plan neither qualifies the day nor preserves the Streak
- an applied Streak Protection preserves the Streak for one otherwise missed date but does not create an active day or increment the Streak

---

## 19.2 Weekly Goal

A separate weekly target remains available even if a streak breaks.

Example:

> 4 / 5 active days this week

This creates a recovery path after failure.

---

## 19.3 Streak Protection

A limited Streak Protection mechanism may preserve a streak on rare missed days.

Protection should:

- have a maximum V1 balance of one
- be earned when the active Streak first reaches each multiple of seven qualifying active days
- require explicit use for one missed date and never be consumed automatically
- not become unlimited avoidance

Preserved planned-rest and protected dates do not contribute toward earning the next protection.

---

# 20. Minimum Effective Activity

A rescue day may qualify through:

- at least 6 minutes in a valid completed training session
- or full completion of a versioned Mini Routine, even when that routine is shorter than 6 minutes

Partial or mostly complete sessions may qualify when their recorded completed duration is at least 6 minutes. In-progress and abandoned sessions never qualify.

The purpose is behavioral continuity, not maximum calorie expenditure.

---

# 21. Rescue Mode

If the user has not trained by a configured time, the app may offer a rescue option.

Example:

> Today doesn't need to be a big workout.  
> Want something easy for 5–10 minutes?

Possible actions:

- light follow-along workout
- mini routine
- delay original workout
- take a rest day

---

# 22. Never Miss Twice

Missing one day is allowed.

If a second consecutive miss is likely, the system should increase intervention.

The second day's late-stage prompt may offer:

- very light workout
- rescue routine
- delay
- rest
- pause training plan

The objective is to restore momentum.

---

# 23. Nutrition

Nutrition is important but secondary to training adherence.

The app should prioritize low-friction logging.

---

# 24. Food Logging Methods

Supported methods:

- quick calorie entry
- natural-language food entry
- photo-based AI estimation
- detailed food entry
- meal template
- copy previous meal
- copy yesterday

Incomplete nutrition logging is acceptable.

The app should clearly distinguish exact and estimated values.

---

# 25. Dynamic Nutrition Targets

The app should estimate daily intake using:

- age
- sex
- height
- weight
- weight trend
- activity level
- training
- weight-loss goal
- target rate of loss

Primary daily targets:

- calorie range
- protein range

Carbohydrate and fat targets may remain secondary.

---

# 26. Remaining Intake

After food is logged, the app should show:

- calories consumed
- approximate calories remaining
- protein consumed
- approximate protein remaining

Example:

> Approximately 600–700 kcal remaining today.

---

# 27. Overeating Handling

The app should not frame exercise as punishment for food.

A single overeating event should not trigger:

- mandatory compensatory exercise
- fasting punishment
- extreme calorie reduction the next day

The default behavior is:

> Return to the normal plan.

If overeating continues over multiple days, the system may investigate:

- excessive hunger
- overly aggressive targets
- difficult meal patterns
- adherence problems

---

# 28. Nutrition Plans

Training plans and nutrition plans are separate systems.

Supported nutrition approaches may include:

- stable fat loss
- focused fat loss
- maintenance
- high protein
- time-restricted eating
- low carb
- ketogenic diet
- flexible day
- planned low-intake day

Extreme fasting should not be a normal default strategy.

---

# 29. Flexible Day

The system should prefer:

> Flexible Day / Maintenance Day

rather than unrestricted:

> Cheat Day

The goal is controlled flexibility without turning food into a reward/punishment cycle.

---

# 30. Body Data

Primary body metrics:

- weight
- body-fat percentage

Additional available BIA metrics may be stored:

- BMI
- fat mass
- muscle mass
- water
- visceral fat
- BMR
- bone mass
- body age
- other scale-derived metrics

Weight and body-fat trends are more important than daily fluctuations.

---

# 31. Boohee Integration

Direct Android synchronization with Boohee Health is currently considered an integration to be technically validated.

The product should not depend on it for V1 success.

Fallback:

> Boohee screenshot → OCR → confirmation

Manual entry remains the final fallback.

The user should not be required to use iPhone.

---

# 32. Health Connect

Android Health Connect may provide:

- steps
- exercise
- sleep
- heart rate
- resting heart rate
- active calories
- weight
- body fat

These signals may inform training recommendations but should not automatically overrule user-reported condition.

---

# 33. Progress & History

History should provide meaningful visual feedback.

Required categories include:

## Training

- daily exercise minutes
- training days
- non-training days
- activity types
- actual workout content
- streak
- training-plan progress

## Nutrition

- daily target percentage
- protein target performance
- logging completeness

## Body

- weight trend
- 7-day average
- body-fat trend

---

# 34. Daily History Detail

Selecting a historical date may display:

- training performed
- workout type
- duration
- intensity
- workout feedback
- food intake
- calorie percentage
- protein
- weight
- body-fat data
- health summary

---

# 35. AI Coach

The application contains a global Coach.

The Coach should understand available app context and may help with:

- workout changes
- motivation
- training-plan adjustments
- food logging
- nutrition decisions
- weight-loss questions
- plateau interpretation
- starting a focused weight-loss period
- changing plans

The Coach must not require AI to perform basic product functionality.

---

# 36. AI Strategy

Primary strategy:

> Local intelligence + free AI + optional low-cost fallback

Default:

- local recommendation engine
- local nutrition calculations
- local streak logic
- local charts
- local OCR where practical
- Gemini free tier for generative functions
- DeepSeek only as optional paid fallback

Default paid AI budget:

> 0

The user must explicitly enable paid usage.

---

# 37. AI Cost Control

The application should track:

- provider
- model
- task
- free vs paid
- approximate usage
- approximate cost

The app should support:

- absolutely free
- free first
- quality first

Default:

> Free First

with paid budget:

> 0

---

# 38. Coach Tone

The Coach should be:

- warm
- gentle
- calm
- encouraging
- non-judgmental
- action-oriented

It should not be excessively motivational or childish.

Examples of desired behavior:

> Today can be lighter. Five minutes still counts as starting.

> You're a bit tired today, so we don't need to chase intensity.

> You haven't moved yet today. Want me to find something small enough to get started?

---

# 39. Achievement & Reward System

V1 does not require a complex badge economy.

Priority reward concepts:

## Functional

- Streak Protection

## Visual

- milestone celebrations
- artistic poster-style achievement cards
- journey summaries

## Real-world

The user may define personal rewards.

Example:

> 30 active days → buy something I want

The app may visually display progress toward that reward.

---

# 40. Visual Achievement Philosophy

Achievements should emphasize:

- consistency
- accumulated effort
- meaningful milestones
- journey

Avoid encouraging:

- extreme exercise
- extreme calorie deficits
- excessive rapid weight loss

---

# 41. Visual Direction

The final design system is maintained separately in:

`DESIGN_SYSTEM.md`

The product layer only requires that visual design remain consistent with:

- artistic
- calm
- modern
- experimental
- light
- organic
- visually rewarding
- clean data visualization

The detailed visual system must come from the finalized design specification.

---

# 42. V1 Product Priorities

## P0

- Today
- training library
- training plans
- daily training
- workout swapping
- new activity inspiration
- local recommendation engine
- training feedback
- Streak
- weekly goal
- Rescue
- Never Miss Twice
- nutrition logging
- nutrition targets
- nutrition plans
- Body tracking
- Health Connect
- progress/history
- global Coach
- AI usage controls

## P1

- advanced Quark plan import
- improved workout-content analysis
- improved AI food recognition
- advanced trend analysis
- advanced visual milestones
- cloud backup

## P2

- full iPhone version
- Apple Watch application
- large Keep-style exercise database
- social features
- leaderboards
- complex badge economy
- XP
- virtual currency
- achievement shop

---

# 43. Explicitly Not a Goal

V1 is not intended to become:

- a social fitness network
- a professional athlete training platform
- a gym strength-log application
- a medical diagnosis system
- a commercial SaaS product
- a public nutrition database
- a competitive gamification platform

---

# 44. Product Success Criteria

The product is successful if:

1. The user opens the app and immediately understands what to do today.
2. Starting training requires very little mental effort.
3. The user can change training without abandoning the larger plan.
4. New workout content can enter the library with minimal manual data entry.
5. The application encourages consistency without excessive guilt.
6. Nutrition tracking remains useful even when logging is imperfect.
7. Weight-loss targets adapt over time.
8. The user can understand historical progress visually.
9. AI improves convenience but is not required for core operation.
10. The app remains inexpensive or free to operate.
11. The training library becomes more personalized through actual use.
12. The product remains pleasant enough that the user wants to open it repeatedly.

## Status

V1 product baseline: Accepted.

Changes to core product principles require explicit product review before implementation.
