# MILESTONES.md

## 总体原则

项目采用：

- Android 优先
- React + TypeScript + Vite
- Capacitor
- Local-first SQLite
- 核心功能不依赖付费 AI
- Gemini Free 优先
- DeepSeek 仅作为可选廉价 fallback
- 所有外部平台能力必须可降级
- 每个 Milestone 独立验收后再进入下一个

Codex 每次只处理一个 Milestone。

不得为了“顺便完善”提前实现后续阶段功能。

---

# Milestone 0 — App Foundation

## 目标

建立一个可以在 Android 真机运行的稳定项目骨架。

## 必须完成

- 建立 monorepo
- `apps/mobile`
- `apps/api` 先建立空骨架
- `packages/domain`
- `packages/shared`
- `packages/recommendation`
- `packages/integrations`
- React + TypeScript + Vite
- Capacitor Android
- React Router
- Tailwind CSS
- Design Token 基础结构
- 使用与 Capacitor major 匹配的 `@capacitor-community/sqlite` 初始化 native SQLite（不引入 ORM）
- Android application ID 固定为 `app.motion`，数据库名为 `motion`
- 建立并离线备份后续保留个人数据所用的固定 release signing key；不得提交到 Git
- 基础 error boundary
- 基础 logging
- 底部导航：
  - Today
  - Training
  - Food
  - Body
  - Me
- 全局 Coach 入口占位
- Light theme
- Dark theme 结构预留
- Git 初始化
- 基础 README
- `/docs` 目录

## 页面先只使用 Mock Data

Today 页面能够显示：

- 今日训练
- Streak
- 热量
- 蛋白质
- 体重趋势

但不实现业务逻辑。

## 不做

- AI
- Health Connect
- Quark
- B站解析
- 小红书解析
- 推荐算法
- 饮食识别
- 通知
- 真实训练计划

## 验收

三星手机安装 APK 后：

1. App 可以正常启动。
2. 五个 Tab 可以切换。
3. 完全杀死 App 后重新打开不崩溃。
4. SQLite 可以写入和读取一条测试记录。
5. 完全杀死 App、重启手机后，该 native SQLite 测试记录仍存在。
6. 使用同一 application ID 和 signing key 安装一次升级 APK 后，测试记录仍存在。
7. 页面不存在明显 WebView 感或桌面网页布局问题。

---

# Milestone 1 — Core Data Layer

## 目标

把 `DATA_MODEL.md` 转换为真正的数据层。

## 必须完成

建立 SQLite schema 和 migration 系统。

优先实现：

### Training

- ActivityType
- ActivityPreference
- WorkoutContent
- WorkoutImport
- ContentAnalysis
- TrainingPlan
- TrainingPlanDay
- TrainingPlanDayItem
- TrainingPlanRun
- TrainingPlanRunDay
- MiniRoutineVersion
- MiniRoutineItem
- DailyRecommendation
- ExplorationRecommendation
- TrainingSession
- WorkoutFeedback

### Motivation

- ActiveDay
- StreakState
- StreakProtectionEvent
- WeeklyGoal

### System

- UserProfile
- AppPreference

未列入本 Milestone 的后续功能表不得因为“以后可能需要”而提前建立。Mini Routine 在本阶段只建立已接受的最小版本化结构，不实现动作组合或 Rescue 业务。

## Repository Layer

所有 SQLite 操作不得散落在 React Component 内。

例如：

```text
WorkoutRepository
TrainingPlanRepository
TrainingSessionRepository
PreferenceRepository
```

## Seed Data

加入：

- 默认 ActivityType
- 不可删除的系统 `OTHER` ActivityType
- 用户当前低优先级活动类型

20–30 个真实 Rescue 动作和 Routine 内容留到 Milestone 6，不在此处加入占位动作。

## 验收

开发模式可以：

- 新增训练
- 查询训练
- 修改训练
- 删除/Archive训练
- 创建 Plan
- 创建并 reschedule/skip/complete 一个 TrainingPlanRunDay
- 创建 Session
- 重启后恢复或 abandon 唯一的 in-progress Session
- App 重启后数据仍存在
- 从空数据库迁移到最新版本
- 从至少一个旧 schema fixture 升级并保留历史引用
- migration 失败时完整 rollback，不清空数据库
- FK、唯一约束和 singleton 约束生效
- 修改/删除历史 Session 后，ActiveDay、Streak 和 Plan 进度在同一 transaction 中正确重算

---

# Milestone 2 — Training Library

## 目标

完成第一个真正可日常使用的核心功能：

> 我的训练库。

## 必须完成

Training 页面：

### Library

支持：

- 查看全部训练
- 搜索
- Activity Type 筛选
- 来源筛选
- 时长筛选
- 喜好筛选
- 未做过
- 最近没做
- 暂时隐藏

训练详情显示：

- 标题
- 来源
- 时长
- 类型
- 强度
- 标签
- 上次训练
- 完成次数
- ❤️ 👍 😐 👎
- 暂时不要推荐

## 支持手工添加 URL

仅作为测试/兜底。

用户只需提供：

- URL

标题等其他信息允许为空。

## 不允许

要求用户必须填写：

- 类型
- 强度
- 身体部位
- 器械
- 时长

信息缺失也可以保存。

## 验收

能够建立至少：

- B站训练
- 小红书训练
- 夸克训练
- Free Activity

并在库中管理。

---

# Milestone 3 — Android Share Import

## 目标

实现最重要的训练库增长路径：

> B站 / 小红书 / 浏览器 → 分享 → App。

## 必须完成

Android Share Intent：

接收：

- URL
- 分享文字
- URL + 标题类文本

进入 App 后创建：

`WorkoutImport`

## Import Pipeline V1

顺序：

1. 解析分享文本
2. 提取 URL
3. 提取可能存在的标题
4. 判断 SourceType
5. 尝试轻量 metadata 获取
6. 本地规则分类
7. 保存 WorkoutContent

## 信息不足

显示：

> 信息还不完整，但已经帮你存好了。

不得阻止导入。

## 导入完成以后

提供：

**今天就做这个**

如果用户点击：

在本 Milestone 中，将该内容保存为当天待执行选择，不提前创建 TrainingSession。Milestone 4 完成后，同一动作才进入正式 Start/Complete 流程。

## 验收

在三星真机：

### B站

分享一个视频到 App。

### 小红书

分享一个训练内容到 App。

两者无论解析成功程度如何，都必须：

- 成功进入训练库
- 不要求手填完整表单

---

# Milestone 4 — Training Plan & Daily Execution

## 目标

实现：

> 当前训练周期 + 今天只做一个主训练。

## 必须完成

### Training Plan

支持：

- 创建训练计划
- Day 1...Day N
- Rest Day
- 开始计划
- 暂停
- 恢复
- 结束
- 完成计划

### Today

根据当前 `TrainingPlanRun` 显示：

- 当前 Day
- 今日一个主要任务
- 时长
- 强度
- 来源
- 开始
- 完成

## Session

点击开始：

创建 TrainingSession。

点击完成：

保存实际时长和状态。

## 训练反馈

完成以后可跳过反馈。若填写，只出现：

- 轻松
- 刚刚好
- 太累

以及可选：

- ❤️
- 👍
- 😐
- 👎

## 周期规则

实现：

- 漏练默认顺延
- 不追课
- 暂停不算漏练
- 原计划与实际训练永远分离
- 同时最多一个 current Plan Run（ACTIVE 或 PAUSED）
- 每个执行日使用 TrainingPlanRunDay 保存 scheduled date 和结果
- reschedule 保持 pending，skip 明确关闭，不产生训练债务
- 顺延时整体移动后续 pending run-days；Pause 恢复时整体移动未关闭 run-days
- 移动 Planned Rest 只交换两个 scheduled dates，不新增休息日
- Planned Rest 不创建 Active Day；Pause 不自动保护 Streak
- replacement 从训练库手动选择，并记录 `planEquivalence`

本 Milestone 的 replacement 是手动执行关系，用来验证计划与实际训练分离。智能候选选择属于 Milestone 5。

## 验收

建立一个 7 天测试计划，连续模拟：

- 正常完成
- partial completion
- skip / reschedule
- planned rest
- 漏一天
- 暂停
- 恢复
- 手动替换训练并验证 FULL / PARTIAL / NONE equivalence
- App 被杀死后恢复 in-progress Session
- 重复 Start / Complete 不产生重复 Session、进度或 Active Day

数据不得混乱。

---

# Milestone 5 — Recommendation Engine

## 目标

在不使用云 AI 的情况下，让 App 已经具备“智能推荐”。

## Local Recommendation Engine

输入：

- 当前 Plan
- 最近 3–7 天训练
- 时长
- 强度
- Activity Preference
- Workout Preference
- 完成率
- 最近完成时间
- 新鲜度
- 心情
- 用户希望强度
- 用户希望时长
- Streak 状态

Milestone 5 中 Streak/Rescue 输入必须允许缺失。所有 mode 的候选选择可以测试，但 `RESCUE` / `RESTART` 的时间触发、Streak 触发和通知接线在 Milestone 6 完成。

## 必须支持模式

- NORMAL
- LIGHT
- EXPLORATION
- SWAP
- RECOVERY
- RESCUE
- RESTART

## 「今天想换一个」

用户选择：

### 心情

- 很不想动
- 有点累
- 正常
- 很有劲
- 想来点新鲜的

### 强度

- 轻
- 中
- 高
- 系统决定

### 时长

- 5–15 min
- 15–30 min
- 30–45 min
- 45+ min

### 新鲜度

- 熟悉
- 混合
- 尽量新鲜

输出：

> 只显示一个推荐。

## 「给我一个运动灵感」

可以推荐：

> ActivityType，而不是现有 WorkoutContent。

例如：

> 今天试试健美操。

如果库里没有：

提供：

> 去找一个新的。

用户可以去 B站/小红书找到视频，再分享到 App。

返回后：

> 今天就做这个？

## 推荐算法要求

必须存在少量随机扰动。

避免：

> 永远推荐最高分同一个视频。

同时必须尊重：

- AVOID
- Temporarily Hidden
- 时长硬限制
- 器械限制

## 验收

同样条件多次推荐：

- 不应完全随机
- 也不应永远同一个
- 新鲜度改变后推荐明显变化

---

# Milestone 6 — Motivation & Streak System

## 目标

正式加入行为心理学机制。

## 必须完成

### Active Streak

- 当前连续天数
- 最长连续天数

### Minimum Effective Day

有效运动可以是：

- 至少 6 分钟的 valid completed Session
- 或完整满足所引用 MiniRoutineVersion 的全部 required items

IN_PROGRESS / ABANDONED Session 永不计入 Active Day。

### Weekly Goal

例如：

> 本周目标 5 天  
> 当前 3 / 5

### Streak Protection

- 最大库存 1
- Streak 首次达到每个 7 的倍数时可获得，保留日不计入获得进度
- 仅用户明确选择后消耗，不自动使用
- 一张只保护一个 missed date，不创建 Active Day 或增加 Streak
- Ledger 记录来源

### Rescue Mode

如果当天到用户设定时间仍未有效运动：

提供：

> 今天轻一点也可以。

可以选择：

- 5–10分钟轻量视频
- Mini Routine
- 顺延
- 休息

Planned Rest 可以保持 Streak 但不增加 Active Day / Weekly Goal。Pause 本身不保持 Streak；未训练且没有 Protection 时仍会中断。

### Never Miss Twice

连续第二天仍未训练时，提高 Rescue / Restart 优先级。

不是发送羞辱性提示。

## Mini Routine

建立约 20–30 个无需器械的动作基础库。

能够自动组成：

约 4–10 分钟的小训练。

## Notification

Android Local Notification。

## 验收

模拟：

- 连续7天
- 中断一天
- Protection使用
- Rescue成功
- 连续两天没练

Streak必须准确。

---

# Milestone 7 — Nutrition Core

## 目标

实现一个低摩擦、能长期坚持的饮食记录系统。

## 必须完成

### 快速记录

支持：

> 600 kcal

直接保存。

### 自然语言输入

第一阶段允许先用规则/Mock接口。

AI在后续 Milestone 接入。

### Meal

- 早餐
- 午餐
- 晚餐
- 加餐

### 常用餐

- 保存模板
- 一键复制
- 复制昨天

### Daily Nutrition Target

根据：

- 身高
- 体重
- 年龄
- 性别
- 活动水平
- 减脂目标

计算：

- Calories range
- Protein range

## Today

显示：

> 已吃多少  
> 今天还能吃多少  
> 蛋白质还差多少

## 超量

本地规则禁止：

- 推荐禁食补偿
- 推荐强制额外运动偿还
- 第二天极端降低热量

## 验收

一天至少测试：

- 精确记录
- 粗略记录
- 复制餐食
- 超目标
- 未记录完整

---

# Milestone 8 — Nutrition Plans

## 目标

实现饮食周期。

## 支持

- Stable Fat Loss
- Focused Fat Loss
- Maintenance
- High Protein
- TRE
- Low Carb
- Keto
- Flexible Day
- Planned Low Intake

## 必须完成

NutritionPlanRun 独立于 TrainingPlanRun。

例如：

> 训练计划继续  
> 饮食从减脂切到维护

不能互相终止。

## Dynamic Target

每天可以因为：

- Training Day
- Rest Day
- Flexible Day

产生不同的营养目标。

但不允许剧烈波动。

## 验收

创建一个两周测试饮食周期，并验证历史目标不会被新目标覆盖。

---

# Milestone 9 — Body & Health Connect

## 目标

把身体和恢复数据正式带入 App。

## Body

支持：

- Weight
- Body Fat
- 其他 BIA 数据

## 手动输入

作为兜底。

## Screenshot Import

实现：

> 薄荷截图 → OCR → 数据预览 → 用户确认。

优先本地 OCR。

## Health Connect

开发 Capacitor Kotlin Plugin。

读取：

- Steps
- Exercise
- Sleep
- Resting HR
- Heart Rate
- Active Calories
- Weight
- Body Fat

## HealthDailySummary

把原始数据聚合为每日摘要。

推荐系统只读取 Summary。

## 薄荷直接同步

本阶段只做：

**Technical Spike**

目标：

验证是否存在稳定可用路线。

如果不存在：

继续截图方案。

不得因此阻塞发布。

## 验收

三星真机：

- Health Connect 权限
- 拒绝权限不会崩溃
- 同意以后能够读取至少步数/睡眠之一
- OCR 可以从测试截图识别身体数据

---

# Milestone 10 — AI Layer

## 目标

加入真正的生成式 AI，但 App 不得依赖它才能正常工作。

## AI Router

实现：

```text
Local
↓
Gemini Free
↓
Optional DeepSeek
```

## Gemini

负责：

- Coach
- Meal Text
- Meal Photo
- Screenshot辅助
- Workout metadata辅助
- Training Plan图文理解

## DeepSeek

仅作为可选 fallback。

默认：

```text
strategy = FREE_FIRST
monthlyPaidBudgetCny = 0
```

用户必须主动修改预算才允许收费。

## Coach

能够回答：

- 今天不想练
- 给我换个训练
- 今天吃多了
- 最近为什么没掉秤
- 我想开始集中减脂
- 我想换一套训练

## Context

只发送必要摘要。

严禁直接发送：

- 全部训练历史
- 全部健康数据库
- 全部饮食原始记录

## AI Usage

记录：

- Provider
- Model
- Task
- Token
- Estimated Cost
- 是否免费

## AI失败降级

例如 Gemini quota exceeded：

不得弹出：

> AI unavailable

而应该优先退回：

- Local Recommendation
- 本地模板
- 手动/规则解析

## 验收

断开 AI 服务后：

- Today仍可推荐
- 训练仍可完成
- Streak仍正常
- 营养目标仍正常
- Progress仍正常

---

# Milestone 11 — Quark Training Plan Import

## 优先级

P1，但用户实际使用价值很高。

## 目标

读取夸克指定训练目录，并尽量自动建立完整训练周期。

## Import Pipeline

优先理解：

1. 文件夹名称
2. 文件名
3. 图片课程表
4. 图文说明
5. PDF
6. 视频 metadata
7. 必要时才进一步分析

## 例如

```text
30天减脂/
├── 课程表.jpg
├── 注意事项.jpg
├── Day01.mp4
├── Day02.mp4
└── ...
```

自动形成：

`TrainingPlan`

+

`TrainingPlanDay`

+

`WorkoutContent`

## 重要原则

不得默认逐个分析全部视频。

## 验收

至少成功导入一套真实训练计划。

---

# Milestone 12 — Progress & History

## 目标

把长期反馈做成产品亮点之一。

## 必须完成图表

### Training

- 每日运动分钟趋势
- 月历 / Heatmap
- 训练天数
- 哪天没练
- 训练类型分布
- 当前 / 最长 Streak

### Nutrition

- 每日饮食目标完成百分比
- Protein 达标趋势
- 记录完整度

### Body

- Weight trend
- 7-day average
- Body Fat trend

### Plan

显示：

- Original Plan completion
- Actual Active Rate
- AI Replacement
- Exploration
- Rescue
- Rest

点击任意日期：

进入 Daily Detail。

## Daily Detail

显示：

- 当天训练
- 类型
- 时长
- 强度
- Feedback
- 饮食
- Nutrition %
- Weight
- Health Summary

---

# Milestone 13 — Rewards & Visual Milestones

## 目标

加入用户偏好的视觉奖励系统。

## 功能奖励

保留：

- Streak Protection

## 视觉里程碑

例如：

- 7 Active Days
- 30 Active Days
- 100 Active Days
- 完成第一个 Training Plan
- 累计训练特定次数/时长

不需要复杂徽章系统。

## Journey Poster

按照 Design System：

> Neo Art Nouveau + Japanese Experimental Editorial

生成艺术海报式里程碑页面。

例如：

```text
30 DAYS

24 Workouts
728 Minutes
5 Styles
```

## Real-world Reward

用户可以设：

> 达成 X → 奖励自己 Y

显示进度。

---

# Milestone 14 — Polish, Backup & Release

## 目标

让它真正成为每天可用的私人 App。

## 必须完成

- JSON / ZIP 完整备份
- 恢复备份
- Schema migration测试
- Loading 状态
- Offline 状态
- 空数据状态
- 错误处理
- 权限处理
- 导入失败处理
- AI quota处理
- Crash修复
- 性能检查
- Android后退键行为
- App icon
- Splash
- Versioning

## 真机测试

至少连续实际使用 7 天。

重点观察：

- 打开 App 是否想点“开始训练”
- Today 是否信息过多
- 分享训练是否足够快
- Rescue 是否烦人
- Food 是否懒得记录
- AI 是否调用过多
- Battery / Storage
- Notification 是否可靠

完成后生成：

**Release APK**

---

# 开发优先级

## 第一阶段 — 能真正训练

```text
M0 Foundation
↓
M1 Data
↓
M2 Library
↓
M3 Share Import
↓
M4 Training Plan
↓
M5 Recommendation
↓
M6 Motivation
```

完成这里以后：

> App 已经具有独立使用价值。

---

## 第二阶段 — 减脂管理

```text
M7 Nutrition
↓
M8 Nutrition Plan
↓
M9 Body / Health
```

---

## 第三阶段 — 智能化

```text
M10 AI
↓
M11 Quark
```

---

## 第四阶段 — 长期使用体验

```text
M12 Progress
↓
M13 Rewards
↓
M14 Polish
```

---

# Codex 工作规则

每个 Milestone 开始前：

1. 阅读 `/docs`
2. 检查已有实现
3. 给出 implementation plan
4. 只修改当前 Milestone 范围
5. 执行 lint
6. 执行 typecheck
7. 执行 tests
8. 完成 Android build
9. 总结改动
10. 列出人工真机验收步骤

不得未经授权：

- 更换框架
- 重构整个项目
- 修改已冻结产品规则
- 新增账号系统
- 新增社交
- 改变 UI 设计方向
- 引入付费服务
- 将核心功能依赖云 AI

---

# Git Rule

建议：

```text
main
│
├─ feat/m0-foundation
├─ feat/m1-data-layer
├─ feat/m2-training-library
├─ feat/m3-share-import
...
```

每个 Milestone：

> branch → implement → test → user acceptance → merge

验收前不得自动进入下一个 Milestone。
