# DATA_MODEL.md

## 1. 数据模型原则

V1 采用 **Local-first SQLite**。

必须遵守以下原则：

1. `WorkoutContent`（训练内容）与 `TrainingSession`（实际训练记录）分离。
2. `TrainingPlan`（原始计划）与用户实际执行情况分离。
3. AI/算法推测的数据与用户确认的数据分离。
4. 历史营养目标按日期保存，不能使用“当前目标”反算历史。
5. 训练库允许信息不完整，解析失败不能阻止保存。
6. 所有自动导入内容尽量保存原始信息，方便以后重新解析。
7. 用户可以修改或删除错误的训练、饮食和身体数据。
8. Streak 必须基于真实日期和有效运动记录计算。
9. App 必须能在没有任何云端 AI 的情况下运行核心功能。
10. 所有 AI 调用必须可统计，以支持“免费优先 + 月预算上限”。

### ID 与日期

所有普通实体：

- `id`: UUID / UUIDv7，SQLite 中存 `TEXT`
- 时间点：UTC timestamp
- 与“哪一天训练”有关的数据，同时保存 `localDate: YYYY-MM-DD`

明确使用 natural key 的每日聚合记录和使用固定 key 的 singleton 记录可以不另设 UUID。

普通训练的 `localDate` 使用训练开始时设备所在时区的日历日期，并同时保存当时的 IANA timezone ID 与 UTC offset。跨过午夜的训练仍属于开始日期。

旅行或设备时区变化只影响新记录。历史 `localDate` 不自动重算；只有用户明确修改日期时才改变，并触发相关派生数据重算。

### 数据权威与约束

权威记录包括内容/计划定义、`TrainingPlanRun`、`TrainingPlanRunDay`、`TrainingSession`、用户反馈和 Protection ledger。以下是可重建的派生/缓存数据：

- `TrainingPlanRun.currentDayIndex`
- `TrainingSession.qualifiesForActiveDay`
- `ActiveDay`
- `StreakState`
- `ActivityPreference` 的计数与 `inferredScore`
- `WeeklyGoal.achievedActiveDays`

修改或删除权威记录时，必须在同一 SQLite transaction 内重算受影响的派生数据。历史修改从最早受影响日期开始重算到今天。

核心关系使用 SQLite foreign keys。被 Plan Run 或 Session 引用的计划/训练内容不得 hard delete，只能 archive；已经被运行引用的计划结构不可修改，需要修改时复制为新计划/版本。

---

# 2. Training Domain

## 2.1 ActivityType

表示“运动本身是什么”，与视频来源无关。

### 主要类型

- `LOW_IMPACT_CARDIO`
- `CARDIO`
- `AEROBICS` — 健美操
- `DANCE_CARDIO`
- `BODYWEIGHT_STRENGTH`
- `CORE`
- `PILATES`
- `YOGA`
- `STRETCH_MOBILITY`
- `RECOVERY`
- `WALKING`
- `RUNNING`
- `CYCLING`
- `OUTDOOR`
- `OTHER`

### 低推荐权重但保留

- `COMBAT_CARDIO`
- `SWIMMING`
- `BALL_RECREATIONAL`
- `MARTIAL_ARTS`

运动类型不得设计成不可扩展 enum。

数据库应允许：

```text
activity_types
- id
- systemKey?
- name
- isSystem
- isActive
```

用户未来可以增加新的 Activity Type。

---

## 2.2 ActivityPreference

记录用户对一种运动类型的长期偏好。

```text
id
activityTypeId
explicitPreference
inferredScore
timesRecommended
timesAccepted
timesCompleted
timesRejected
lastCompletedAt
temporarilySuppressedUntil?
```

`explicitPreference`：

- `LOVE`
- `LIKE`
- `NEUTRAL`
- `DISLIKE`
- `AVOID`

系统同时学习：

> 用户说喜欢什么

和：

> 用户实际上容易完成什么。

目前搏击、游泳、球类娱乐、武术格斗初始化为低推荐权重，而不是永久禁止。

---

# 3. WorkoutContent

表示一个可以执行的训练内容。

例如：

- 一个 B站跟练视频
- 一个小红书跟练
- 一个夸克 MP4
- 一个自由运动模板“快走”
- 一个 App 内置 6 分钟救援训练

```text
WorkoutContent
- id
- contentKind
- title?
- description?
- sourceType
- sourceUrl?
- externalId?
- thumbnailUri?
- durationMinutes?
- primaryActivityTypeId?
- estimatedIntensity?
- impactLevel?
- requiresEquipment?
- hasJumping?
- bodyAreas?
- psychologicalBarrier?
- userVisibility
- createdAt
- updatedAt
```

### contentKind

- `FOLLOW_ALONG`
- `FREE_ACTIVITY`
- `MINI_ROUTINE`

### sourceType

- `BILIBILI`
- `XIAOHONGSHU`
- `QUARK`
- `YOUTUBE`
- `LOCAL`
- `WEB`
- `APP_BUILTIN`
- `MANUAL`

### userVisibility

- `ACTIVE`
- `TEMPORARILY_HIDDEN`
- `ARCHIVED`

“最近做腻了”使用 `TEMPORARILY_HIDDEN`，而不是删除。

标题缺失时，UI 使用来源名称、文件名或“未命名训练”作为显示 fallback；fallback 不是写回的用户标题。

## 3.1 MINI_ROUTINE 可执行结构

`WorkoutContent.contentKind = MINI_ROUTINE` 只作为训练库入口。实际动作定义使用不可变版本：

```text
MiniRoutineVersion
- id
- workoutContentId
- versionNumber
- completionCriterion
- createdAt

MiniRoutineItem
- id
- miniRoutineVersionId
- sortOrder
- movementName
- durationSeconds?
- repetitions?
- instructions?
- isRequired
```

V1 只支持：

```text
completionCriterion = ALL_REQUIRED_ITEMS
```

每个 Item 必须至少提供 `durationSeconds` 或 `repetitions`。完成 Mini Routine 时，Session 保存实际使用的 `miniRoutineVersionId`；用户确认所有 required items 完成后，Session 才能记录 `completionStatus = COMPLETE`。不保存逐动作遥测，也不建立通用训练编排引擎。

`UNIQUE(workoutContentId, versionNumber)`，`UNIQUE(miniRoutineVersionId, sortOrder)`。

---

# 4. WorkoutImport

保存“内容怎么进入 App”。

例如用户：

> B站 → 分享 → App

创建：

```text
WorkoutImport
- id
- sourceType
- rawUrl?
- rawSharedText?
- rawFilePath?
- rawMetadataJson?
- fingerprint?
- importStatus
- workoutContentId?
- importedAt
- lastCheckedAt?
```

### importStatus

- `RECEIVED`
- `PARSING`
- `READY`
- `NEEDS_MORE_INFO`
- `FAILED`
- `IGNORED`

重要规则：

> `FAILED` 也可以生成一个信息不完整的 WorkoutContent。

不能因为解析失败要求用户重新输入一堆内容。

---

# 5. ContentAnalysis

自动识别结果单独保存。

```text
ContentAnalysis
- id
- workoutContentId
- fingerprint
- analysisVersion
- method
- provider?
- confidence
- extractedDataJson
- analyzedAt
```

### method

- `METADATA`
- `RULES`
- `OCR`
- `LOCAL_ML`
- `GEMINI`
- `DEEPSEEK`
- `MANUAL`

例如 AI 推测：

```text
intensity = MODERATE
confidence = 0.72
```

但用户以后说：

> 这个其实非常累。

不能覆盖掉用户真实反馈。

---

# 6. TrainingPlan

表示一整套训练计划。

例如：

> 30天减脂  
> 60天塑形

```text
TrainingPlan
- id
- title
- description?
- sourceType
- sourceReference?
- plannedDays?
- coverUri?
- originalMetadataJson?
- createdAt
```

计划本身只代表：

> 原作者设计了什么。

不保存“用户做到第几天”。

---

# 7. TrainingPlanDay

```text
TrainingPlanDay
- id
- trainingPlanId
- dayIndex
- originalLabel?
- title?
- isRestDay
- expectedDurationMinutes?
- expectedIntensity?
- notes?
```

例如：

```text
Day 12
HIIT
35min
```

如果原计划一天确实存在多个内容，使用：

## TrainingPlanDayItem

```text
- id
- trainingPlanDayId
- workoutContentId
- sortOrder
- role
```

role：

- `PRIMARY`
- `SUPPLEMENTAL`

UI V1仍然坚持：

> 每天突出一个主训练。

---

# 8. TrainingPlanRun

非常重要。

表示“用户实际开始执行这套计划的一次实例”。

同一套30天计划未来可以重复做两次，所以不能把进度存在 `TrainingPlan` 本身。

```text
TrainingPlanRun
- id
- trainingPlanId
- startedOn
- status
- currentDayIndex?
- pausedAt?
- completedAt?
- endedReason?
```

status：

- `ACTIVE`
- `PAUSED`
- `COMPLETED`
- `ABANDONED`

`currentDayIndex` 是从未关闭的 `TrainingPlanRunDay` 推导出的缓存，不是执行历史的唯一来源。

同一时间最多存在一个 current run；`ACTIVE` 和 `PAUSED` 都算 current。开始另一套计划前，必须先把 current run 标记为 `COMPLETED` 或 `ABANDONED`。暂停不会创建、推进或关闭 run-day，恢复继续同一个 run。

Run 开始时，按 Plan Day 顺序从 `startedOn` 起连续建立 Run Day，初始状态都是 `SCHEDULED`。只有最早未关闭的 Run Day 是 current。底层 `TrainingPlanDay.isRestDay = true` 的 current Run Day 在其 scheduled date 到达时关闭为 `PLANNED_REST`。

## 8.1 TrainingPlanRunDay

表示原计划某一天在本次 Run 中的实际调度和结果。

```text
TrainingPlanRunDay
- id
- trainingPlanRunId
- trainingPlanDayId
- originalScheduledLocalDate
- scheduledLocalDate
- status
- executionKind
- planEquivalence?
- rescheduleCount
- completedAt?
- updatedAt
```

status：

- `SCHEDULED`
- `IN_PROGRESS`
- `COMPLETED`
- `PARTIALLY_COMPLETED`
- `SKIPPED`
- `PLANNED_REST`

executionKind：

- `PLANNED`
- `REPLACEMENT`
- `NONE`

`planEquivalence`：

- `FULL`
- `PARTIAL`
- `NONE`

Reschedule 不是终态：保留 `originalScheduledLocalDate`，更新 `scheduledLocalDate`、增加 `rescheduleCount`，状态继续为 `SCHEDULED`。向后顺延时，同步移动后续未关闭 Run Day，避免同日堆叠两个主要任务。Skipped 会关闭该 run-day，但不会把训练债务堆到后续日期。

Pause 不关闭或推进 Run Day。Resume 时，把所有未关闭 Run Day 按暂停经过的 local dates 整体后移。移动 Rest Day 时，只交换一个底层 `TrainingPlanDay.isRestDay = true` 的未关闭 Run Day 与一个未关闭训练 Run Day 的 `scheduledLocalDate`，不新增 Rest Day。

原计划正常完成时使用 `executionKind = PLANNED` 和 `planEquivalence = FULL`。Replacement Session 连接到同一 run-day，使用 `executionKind = REPLACEMENT` 并独立保存 equivalence，不能修改 `TrainingPlanDay`。

Session 的 `completionStatus = COMPLETE` 时 Run Day 关闭为 `COMPLETED`；`MOSTLY_COMPLETE` / `PARTIAL` 时关闭为 `PARTIALLY_COMPLETED`。`planEquivalence` 独立表示对原计划的满足程度，因此 Replacement 可以是 `COMPLETED + NONE`，也可以是 `COMPLETED + FULL`。

没有 valid completed Session 才使用 `SKIPPED`。当全部 Run Day 都已关闭时，`TrainingPlanRun` 可以标记为 `COMPLETED`；原计划 adherence 另按 `planEquivalence` 统计，不由 Run status 代替。

所有 Run Day 进入 `COMPLETED`、`PARTIALLY_COMPLETED`、`SKIPPED` 或 `PLANNED_REST` 后，Run 可以标记 `COMPLETED`。原计划 adherence 根据 `planEquivalence` 另行计算，不由 Run status 代替。

`PLANNED_REST` 不需要 Session，不算 Active Day。只有 Run 为 `ACTIVE` 时才允许开始或推进 run-day。

---

# 9. DailyRecommendation

记录系统某一天推荐了什么。

```text
DailyRecommendation
- id
- localDate
- recommendationMode
- recommendationSource
- trainingPlanRunId?
- originalPlanDayId?
- selectedWorkoutContentId?
- suggestedActivityTypeId?
- mood?
- requestedIntensity?
- requestedDurationMin?
- requestedDurationMax?
- noveltyPreference?
- scoreBreakdownJson?
- reasonCodesJson?
- displayMessage?
- status
- createdAt
```

### recommendationMode

- `NORMAL`
- `LIGHT`
- `EXPLORATION`
- `SWAP`
- `RECOVERY`
- `RESCUE`
- `RESTART`

### recommendationSource

- `PLAN`
- `LIBRARY`
- `EXPLORATION`
- `RESCUE`
- `FREE_ACTIVITY`

### status

- `SUGGESTED`
- `ACCEPTED`
- `REJECTED`
- `REPLACED`
- `COMPLETED`

---

# 10. ExplorationRecommendation

当用户说：

> 我今天不知道想做什么，给我一个新运动灵感。

可以先推荐一个运动类型，而不是具体视频。

```text
ExplorationRecommendation
- id
- localDate
- activityTypeId
- mood?
- desiredIntensity?
- durationMin?
- durationMax?
- noveltyLevel
- accepted
- resultingWorkoutContentId?
```

典型流程：

```text
AI/算法推荐健美操
↓
用户去B站找
↓
分享新视频
↓
WorkoutImport
↓
WorkoutContent
↓
resultingWorkoutContentId
↓
今天开始训练
```

这条链必须能够完整追踪。

---

# 11. TrainingSession

这是**用户真正做了什么**。

```text
TrainingSession
- id
- localDate
- localDateSource
- timeZoneIdAtStart?
- utcOffsetMinutesAtStart?
- startedAt
- endedAt?
- durationMinutes?
- workoutContentId?
- activityTypeId?
- trainingPlanRunDayId?
- dailyRecommendationId?
- miniRoutineVersionId?
- sessionOrigin
- lifecycleStatus
- completionStatus?
- qualifiesForActiveDay
- qualificationReason?
- qualificationRuleVersion?
- perceivedIntensity?
- moodBefore?
- notes?
- createdAt
- updatedAt
```

### localDateSource

- `START_TIME`
- `USER_SELECTED`

正常 Start 使用 `START_TIME`：根据开始时设备 timezone 得到 `localDate`，并保存 `timeZoneIdAtStart` 和 `utcOffsetMinutesAtStart`。跨午夜不改变日期。历史手工记录或明确改日使用 `USER_SELECTED`。

### lifecycleStatus

- `IN_PROGRESS`
- `COMPLETED`
- `ABANDONED`

### sessionOrigin

- `PLAN`
- `EXISTING_LIBRARY`
- `NEW_IMPORT`
- `FREE_ACTIVITY`
- `RESCUE`

### completionStatus

- `COMPLETE`
- `MOSTLY_COMPLETE`
- `PARTIAL`

`completionStatus` 和 `durationMinutes` 在 `IN_PROGRESS` 时为空。只有从 `IN_PROGRESS` 成功转为 `COMPLETED` 后才填写完成结果并进行 Active Day 判定。`ABANDONED` 是 lifecycle 终态，不设置 completionStatus，也永不计入 Active Day。

App 启动时如果存在 `IN_PROGRESS` Session，必须进入恢复流程：继续同一条 Session，或将它完成/标记为 `ABANDONED`。不得静默创建新 Session。

App/process interruption 不创建第四种 lifecycle status；在用户完成恢复选择前，原记录保持 `IN_PROGRESS`。

V1 全局最多一条 `IN_PROGRESS` Session。Start 使用 transaction 中的条件检查/唯一约束防止重复点击创建两条记录。Complete 只允许对 `IN_PROGRESS` 做一次条件更新；重复 Complete 返回已有结果，不重复推进 Plan、Streak 或计数。

Completed Session 必须有 `durationMinutes` 和有效 `activityTypeId`。如果内容仍无法分类，使用系统 ActivityType `OTHER`；未完成或未分类的 library content 可以保持 `activityTypeId = null`。

`qualifiesForActiveDay`、`qualificationReason` 和 `qualificationRuleVersion` 是根据完成事实保存的派生结果，历史修正时必须重算。

### 关键原则

例如：

```text
原计划 Day 16
→ 35min HIIT

实际
→ 新找到的25min健美操
```

不能修改 Day16。

TrainingSession 记录实际训练。

Session 通过 `trainingPlanRunDayId` 连接本次执行；Plan Run 和原 Plan Day 不在 Session 中重复保存。`planEquivalence` 存在 `TrainingPlanRunDay`：

```text
planEquivalence = FULL / PARTIAL / NONE
```

---

# 12. WorkoutFeedback

训练结束后的极简反馈。

```text
WorkoutFeedback
- id
- trainingSessionId
- exertion?
- preference?
- discomfort?
- discomfortArea?
- createdAt
```

### exertion

- `EASY`
- `JUST_RIGHT`
- `HARD`

### preference

- `LOVE`
- `LIKE`
- `NEUTRAL`
- `DISLIKE`

这里的实际体验权重高于 AI 对视频强度的自动判断。

Feedback 整行可省略。创建 Feedback 时，`exertion`、`preference`、`discomfort` 至少一个必须有值；每个 Session 最多一条 Feedback。

---

# 13. Nutrition Domain

## Meal

一顿饭。

```text
Meal
- id
- localDate
- mealType
- loggedAt
- note?
```

mealType：

- `BREAKFAST`
- `LUNCH`
- `DINNER`
- `SNACK`
- `OTHER`

---

# 14. FoodEntry

```text
FoodEntry
- id
- mealId
- name
- quantity?
- unit?
- caloriesKcal?
- proteinG?
- carbsG?
- fatG?
- estimationMethod
- confidenceLevel
- rawInput?
- createdAt
```

### estimationMethod

- `EXACT_WEIGHT`
- `PACKAGE_LABEL`
- `FOOD_DATABASE`
- `TEXT_AI`
- `PHOTO_AI`
- `ROUGH_CALORIE`
- `MANUAL`

### confidenceLevel

- `HIGH`
- `MEDIUM`
- `LOW`
- `ROUGH`

因此：

> “午饭大约700 kcal”

也是合法的一条记录。

---

# 15. MealTemplate

用于：

- 平时早餐
- 昨天一样
- 经常吃的组合

```text
MealTemplate
- id
- name
- templateDataJson
- lastUsedAt?
- useCount
```

---

# 16. DailyNutritionTarget

**必须按日期保存。**

```text
DailyNutritionTarget
- id
- localDate
- caloriesMin
- caloriesMax
- proteinMinG
- proteinMaxG
- carbsTargetG?
- fatTargetG?
- nutritionPlanRunId?
- dayType
- calculationVersion
- rationaleJson?
```

dayType：

- `NORMAL`
- `TRAINING`
- `REST`
- `FLEXIBLE`
- `MAINTENANCE`
- `LOW_INTAKE`

以后历史图表计算：

```text
实际摄入 / 当天目标
```

而不是使用今天的目标。

---

# 17. NutritionPlan

表示一种饮食周期模板。

```text
NutritionPlan
- id
- title
- goal
- durationWeeks?
- description?
```

支持策略：

- 稳定减脂
- 集中减脂
- 维护
- 高蛋白
- TRE
- 低碳
- Keto
- 弹性日
- 计划性低摄入日

极端禁食不作为正常策略。

---

# 18. NutritionPlanRun

```text
NutritionPlanRun
- id
- nutritionPlanId
- startedOn
- plannedEndOn?
- status
- createdAt
```

训练周期和饮食周期：

> 相互读取信息，但相互独立。

更换训练计划不会结束饮食计划。

---

# 19. Body Domain

## BodyMeasurement

```text
BodyMeasurement
- id
- measuredAt
- localDate
- sourceType
- weightKg
- bodyFatPercent?
- bmi?
- fatMassKg?
- muscleMassKg?
- skeletalMuscle?
- bodyWaterPercent?
- visceralFatLevel?
- boneMassKg?
- bmrKcal?
- bodyAge?
- rawDataJson?
- confidenceLevel?
- userVerified
```

sourceType：

- `BOOHEE`
- `HEALTH_CONNECT`
- `SCREENSHOT_OCR`
- `MANUAL`
- `OTHER`

体重是最主要长期指标。

BIA其他数据更多用于趋势，而不是单日训练决策。

---

# 20. MeasurementImport

用于：

> 薄荷截图 → OCR → 用户确认。

```text
MeasurementImport
- id
- sourceType
- imageUri?
- rawOcrText?
- parsedDataJson?
- status
- resultingMeasurementId?
- importedAt
```

---

# 21. Health Domain

## HealthDailySummary

Health Connect 的高频原始数据不需要全部复制进业务层。

每天聚合：

```text
HealthDailySummary
- localDate
- steps?
- activeCaloriesKcal?
- exerciseMinutes?
- sleepMinutes?
- restingHeartRate?
- averageHeartRate?
- sourceSummaryJson?
- lastSyncedAt
```

AI Coach 和推荐系统优先读取 Summary。

---

# 22. HealthSyncState

```text
HealthSyncState
- provider
- lastSyncAt?
- syncToken?
- status
- lastError?
```

Health Connect 使用增量同步。

---

# 23. Motivation Domain

## ActiveDay

用于判定：

> 这一天到底算不算“我运动了”。

```text
ActiveDay
- localDate
- qualifies
- qualifyingMinutes
- qualificationType
- calculatedAt
- qualificationRuleVersion
```

qualificationType：

- `NORMAL_TRAINING`
- `RESCUE_TRAINING`
- `FREE_ACTIVITY`
- `MINI_ROUTINE`
- `NONE`

最低有效运动：

> 同一天至少一条 lifecycle 为 `COMPLETED` 的 Session 实际完成 6 分钟；或完整完成所引用版本的 Mini Routine。

`MOSTLY_COMPLETE` / `PARTIAL` 只有在实际完成时长达到 6 分钟时才可通过时长规则。`IN_PROGRESS` / `ABANDONED` 永不计入。

`ActiveDay` 是每个 `localDate` 唯一的派生记录。Planned Rest、Plan Pause、Streak Protection 都不能令 `qualifies = true`，也不增加 Weekly Goal。

---

# 24. StreakState

它是缓存状态。真实来源是 `TrainingSession` 推导出的 `ActiveDay`、`TrainingPlanRunDay` 的 Planned Rest，以及 `StreakProtectionEvent` ledger。

```text
StreakState
- currentStreak
- longestStreak
- protectionBalance
- lastQualifiedDate?
- updatedAt
```

Streak 按日历日期重算：

- `ActiveDay.qualifies = true`：Streak 增加 1。
- 当前 Plan Run 中该日明确为 `PLANNED_REST`：保持原值，不增加。
- 该日有有效的 Protection `USED` event：保持原值，不增加。
- Plan 处于 `PAUSED`：本身没有保护作用；若当天没有 Active Day，Streak 中断。
- 其他未达标日期：Streak 中断。

因此 `currentStreak` / `longestStreak` 只统计真实 Active Days；被保留的日期只维持连续性。

---

# 25. StreakProtectionEvent

Protection 使用 ledger，而不是只改数字。

```text
StreakProtectionEvent
- id
- type
- localDate
- reason
- balanceDelta
- sourceKey?
- createdAt
```

type：

- `EARNED`
- `USED`
- `MANUAL_ADJUSTMENT`

因此永远可以知道：

> 一张保护卡是怎么得到、什么时候使用的。

V1 Protection 规则：

- 最大余额为 1；余额由 ledger 推导，`StreakState.protectionBalance` 只是缓存。
- `EARNED.balanceDelta = +1`，`USED.balanceDelta = -1`；`MANUAL_ADJUSTMENT` 只用于明确的数据修正，值为 `+1` 或 `-1`。Transaction 必须保证余额始终为 0 或 1。
- Streak 首次达到 7、14、21……个 qualifying Active Days 时获得 1 张；余额已满时不增加。
- `EARNED.sourceKey` 使用对应 milestone（例如 `STREAK:14`）并保持唯一，防止重复发放。
- `USED` 必须由用户明确选择，App 不自动消耗。
- 1 个 `USED` 只保护 1 个原本不达标的日期；同一日期最多 1 个。
- Planned Rest 不消耗 Protection；Plan Pause 不提供 Protection。
- 被 Planned Rest 或 Protection 保留的日期不增加 Streak，也不参与下一张 Protection 的获得。
- Protection 只能用于当前连续链中最近一个导致中断的未达标日期；在出现第二个未保护的未达标日期后，不能用一张 Protection 回补整段历史。

---

# 26. WeeklyGoal

```text
WeeklyGoal
- id
- weekStartDate
- targetActiveDays
- achievedActiveDays
- status
```

即使 Streak 中断：

> 周目标仍然可以继续完成。

---

# 27. RewardGoal

现实奖励。

例如：

> 完成30个运动日 → 买一个东西。

```text
RewardGoal
- id
- title
- rewardDescription
- goalType
- targetValue
- currentValue
- status
- createdAt
- completedAt?
```

goalType：

- `ACTIVE_DAYS`
- `STREAK`
- `WORKOUT_COUNT`
- `PLAN_COMPLETION`
- `CUSTOM`

---

# 28. MilestoneEvent

用于艺术海报式视觉成就。

```text
MilestoneEvent
- id
- milestoneType
- achievedAt
- localDate
- value?
- snapshotJson
- artworkVersion?
```

例如：

```text
30 DAYS
24 workouts
728 minutes
5 styles
```

这里保存 snapshot，保证半年以后打开这张纪念卡时数字不会变化。

---

# 29. Coach Domain

## CoachConversation

```text
CoachConversation
- id
- title?
- createdAt
- updatedAt
```

## CoachMessage

```text
CoachMessage
- id
- conversationId
- role
- content
- provider?
- model?
- createdAt
```

role：

- `USER`
- `COACH`
- `SYSTEM`

---

# 30. CoachContextSnapshot

AI不应该收到全部数据库。

每次需要复杂 Coach 回答时，生成一个精简 context：

```text
CoachContextSnapshot
- id
- createdAt
- localDate
- contextJson
```

例如：

```text
最近7天训练4次
平均27min
当前Streak 8天
当前计划 Day17
最近睡眠6h12m
今天摄入约1600/2100 kcal
体重7日均值下降0.4kg
```

而不是上传三个月原始记录。

---

# 31. AIUsageEvent

这是 V1 非常重要的一张表。

用于落实：

> 免费优先，必要时便宜付费。

```text
AIUsageEvent
- id
- provider
- model
- taskType
- usedFreeTier
- inputTokens?
- outputTokens?
- estimatedCostCny
- success
- createdAt
```

taskType：

- `COACH`
- `MEAL_TEXT`
- `MEAL_PHOTO`
- `WORKOUT_ANALYSIS`
- `PLAN_ANALYSIS`
- `OCR_ASSIST`
- `OTHER`

App可以显示：

```text
本月AI使用

Gemini Free   143次
DeepSeek       0次
费用           ¥0.00
```

---

# 32. AI Settings

```text
AISettings
- strategy
- monthlyPaidBudgetCny
- preferredFreeProvider
- fallbackProvider?
```

strategy：

- `ABSOLUTELY_FREE`
- `FREE_FIRST`
- `QUALITY_FIRST`

默认：

```text
strategy = FREE_FIRST
monthlyPaidBudgetCny = 0
preferredFreeProvider = GEMINI
```

只有用户主动提高预算，才允许收费调用。

---

# 33. NotificationPreference

```text
NotificationPreference
- trainingReminderEnabled
- trainingReminderTime?
- rescueReminderEnabled
- rescueReminderTime?
- nutritionReminderEnabled
- weighInReminderEnabled
```

救援提醒时间必须由用户配置。

---

# 34. UserProfile

V1 单用户。

```text
UserProfile
- id
- birthDate?
- sex?
- heightCm?
- goalType
- targetWeightKg?
- desiredWeightLossRate?
- createdAt
```

不需要账号、邮箱、密码。

---

# 35. AppPreference

```text
AppPreference
- theme
- locale
- firstDayOfWeek
- minimumEffectiveMinutes
- defaultNoveltyPreference
- coachTone
```

默认：

```text
minimumEffectiveMinutes = 6
coachTone = WARM_GENTLE
```

---

# 36. IntegrationConnection

```text
IntegrationConnection
- id
- provider
- status
- externalAccountLabel?
- credentialAlias?
- lastSyncedAt?
```

provider：

- `HEALTH_CONNECT`
- `QUARK`
- `YOUTUBE`
- `BOOHEE`
- `OTHER`

真正 OAuth token 不存普通 SQLite。

只保存 Keystore credential alias。

---

# 37. BackupMetadata

```text
BackupMetadata
- id
- backupVersion
- createdAt
- appVersion
- schemaVersion
```

V1必须允许：

> 导出完整备份  
> 从完整备份恢复

---

## 37.1 Core SQLite constraints

M1 至少落实以下约束：

- 每个数据库连接启用 `PRAGMA foreign_keys = ON`。
- `ActivityType.systemKey` 非空时唯一；系统 `OTHER` 行必须存在且不可删除。
- `ActivityPreference.activityTypeId` 唯一。
- `TrainingPlanDay(trainingPlanId, dayIndex)` 唯一。
- `TrainingPlanDayItem(trainingPlanDayId, sortOrder)` 唯一；每个非 Rest Day 最多一个 `PRIMARY`，Rest Day 不包含 Item。
- `TrainingPlanRunDay(trainingPlanRunId, trainingPlanDayId)` 与 `TrainingPlanRunDay(trainingPlanRunId, scheduledLocalDate)` 分别唯一。
- 全库最多一个 status 为 `ACTIVE` 或 `PAUSED` 的 `TrainingPlanRun`。
- 全库最多一个 lifecycleStatus 为 `IN_PROGRESS` 的 `TrainingSession`。
- Session 状态约束：`IN_PROGRESS` 没有 endedAt/duration/completionStatus；`COMPLETED` 必须有 endedAt、非负 duration、completionStatus 和 activityTypeId；`ABANDONED` 没有 completionStatus 且不得 qualify。
- `WorkoutFeedback.trainingSessionId` 唯一。
- `ActiveDay.localDate` 唯一。
- `StreakProtectionEvent` 的 `EARNED.sourceKey` 唯一，且每个 `localDate` 最多一个 `USED`。
- `UserProfile`、`AppPreference`、`StreakState` 使用固定 singleton key 或等价 `CHECK` 约束，确保每表最多一行。

历史父记录的 FK 使用 `RESTRICT` / `NO ACTION`。只有完全由父记录拥有、且没有 Session/Run 历史引用的明细可以 cascade delete。

Plan Run/Session 状态转换、历史修正和相关派生记录更新必须在一个 transaction 中完成。

---

# 38. 最核心关系

```text
ActivityType
     ↑
WorkoutContent
     ↑
TrainingPlanDayItem ← TrainingPlanDay ← TrainingPlan
                                       ↓
                                TrainingPlanRun
                                       ↓
                            TrainingPlanRunDay
                                       ↓
DailyRecommendation ─────────→ TrainingSession
         ↑                            ↓
 ExplorationRecommendation      WorkoutFeedback
```

每天的数据关系：

```text
                    LocalDate
                        │
          ┌─────────────┼─────────────┐
          ↓             ↓             ↓
   TrainingSession     Meal      BodyMeasurement
          ↓             ↓             ↓
       ActiveDay   NutritionTarget HealthSummary
          └─────────────┬─────────────┘
                        ↓
                Recommendation Engine
                        ↓
                    AI Coach
```

---

# 39. V1 必须保证的几个场景

数据模型必须能无损表示：

### Scenario A

原计划 Day12，用户正常完成。

### Scenario B

原计划 Day12，但用户选择 AI 换练并完成另一条视频。

### Scenario C

用户突然想尝鲜，系统推荐“健美操”，训练库没有，于是用户去 B站找到新视频并分享到 App，当天立即完成。

### Scenario D

用户只运动6分钟救援动作，但成功保持 Streak。

### Scenario E

连续两天没练，第二天晚上进入 Rescue / Restart。

### Scenario F

用户第一次看到一个 B站链接，系统解析失败，但仍保存到训练库，并在以后逐渐补充信息。

### Scenario G

同一套30天训练计划半年后再次执行，历史互不污染。

### Scenario H

当天饮食只是粗略记录1800 kcal，另一日则精确记录所有食物，两种都能参与趋势统计但可信度不同。

### Scenario I

用户改变营养目标后，三个月前的饮食完成百分比仍然保持原结果。

### Scenario J

Gemini免费额度失效，App仍然可以训练、记录、计算营养、维持Streak并进行基础推荐。

---

# 40. 不允许的建模方式

Codex不得：

- 把当前训练 Day 直接存在 `TrainingPlan`
- 用 WorkoutContent 代表一次实际训练
- AI 替换训练时覆盖原计划
- 使用一个全局 calorieTarget 计算所有历史日期
- AI识别失败时拒绝保存训练链接
- 把用户反馈覆盖到 AI 自动分析字段
- 把 OAuth Token / API Key 存 SQLite 明文
- 用 LLM 实时计算本来能由 SQLite/本地算法计算的图表
- 把 Streak 只存在一个整数里而没有真实 ActiveDay 依据
- 为了 Gemini / DeepSeek 写死业务层接口

---

## V1 Data Model Status

**Status: Accepted baseline**

允许在实施中增加技术字段、索引、migration 字段和内部表。

涉及以下内容的结构变化需要重新做产品决策：

- Training Plan 原始计划与实际执行关系
- Streak 判定
- AI换练
- Exploration / 新运动发现
- 饮食周期
- 动态营养目标
- 用户反馈与AI推测数据关系
