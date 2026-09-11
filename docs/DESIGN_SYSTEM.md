# DESIGN_SYSTEM.md

> Status: Accepted visual baseline for the App development project  
> Scope: Visual design system only  
> Instruction to Codex / frontend developers: Do not reinterpret, simplify, or replace this baseline with a generic design system. Where this document says `Not finalized`, preserve the stated constraints and leave the unresolved decision configurable rather than inventing a permanent choice.

---

## 1. Design Vision / 核心视觉理念

The App uses a **balanced fusion of Neo Art Nouveau and Japanese Experimental Editorial** as its primary visual language.

The intended feeling is:

- artistic but usable
- soft but not weak
- modern but not cold
- romantic but not sweet or childish
- organic but not rustic
- calm in everyday use
- visually forceful only at selected moments
- light, clean, translucent, and contemporary

The App should feel closer to an **interactive art/editorial object** than to a conventional fitness product, generic wellness dashboard, or template-driven SaaS application.

The emotional structure is intentionally dual-layered:

- **Functional surfaces** should be clean, readable, calm, and efficient.
- **Emotional moments** such as achievements, milestones, summaries, streaks, transitions, and important calls to action may become more expressive, poster-like, and dramatic.

A useful internal principle is:

> **Function pages serve use. Emotional pages create memory.**

The design should not be visually empty. The user prefers **art + a small amount of breathing room**, rather than extreme minimalism or large unused white fields.

The visual atmosphere should be **soft, luminous, modern, organic, editorial, slightly romantic, and selectively bold**.

---

## 2. Visual Hierarchy / 各设计流派分别承担什么角色

### 2.1 Primary Layer — F: Neo Art Nouveau

**Role: Core aesthetic foundation.**

Neo Art Nouveau is the strongest and most preferred direction. It should define the App’s organic and emotional visual identity.

Use it for:

- botanical curves
- floral line work
- elegant organic movement
- flowing decorative contours
- growth-related metaphors
- soft natural compositions
- milestone poster composition
- subtle framing and visual rhythm

Do not reproduce historical Art Nouveau literally. Avoid heavy vintage ornament, dense floral borders, sepia paper, or antique-poster imitation.

The required interpretation is:

> **Modernized, light, digital Neo Art Nouveau.**

### 2.2 Primary Layer — A: Japanese Experimental Editorial

**Role: Layout, composition, typography behavior, and information rhythm.**

Use it for:

- asymmetrical layouts
- text as a compositional element
- vertical text where appropriate
- strong scale contrast
- unusual but controlled alignment
- editorial cropping
- deliberate visual tension
- poster-like section composition
- carefully structured density

Japanese Editorial is not an excuse for randomness. Layouts may be experimental, but hierarchy and usability must remain clear.

The system should avoid looking like a conventional centered-card mobile template.

### 2.3 Supporting Layer — D: Wabi-Sabi

**Role: Calmness, restraint, natural pacing, quietness.**

Keep:

- calm composition
- quiet visual rhythm
- imperfect/natural feeling
- understated elegance
- softness
- restraint

Do **not** keep:

- dark beige
- aged yellow paper
- heavy paper fibers
- distressed print
- excessive grain
- dirty or faded vintage tones

The user explicitly does **not** want the dim, yellowed, old-paper interpretation of Wabi-Sabi.

### 2.4 Accent Layer — C: Neo-Brutalism

**Role: Rare, high-impact visual emphasis.**

Neo-Brutalism must **not** become the global UI style.

Use it selectively for:

- achievement moments
- streak milestones
- major numbers
- completion states
- strong action cues
- large-scale typography
- important visual interrupts

Examples of acceptable use:

- `DONE.`
- `7 DAYS`
- a large milestone number
- a brief high-contrast completion screen

Do not convert the interface into a black-border / fluorescent / raw-web neo-brutalist system.

### 2.5 Material Layer — M: Soft Tech

**Role: Surface treatment and contemporary digital materiality.**

Use it for:

- glass-like cards
- translucent surfaces
- subtle blur
- luminous layers
- soft glow
- clean digital depth
- gentle modern-tech atmosphere

The visual target is not “futuristic HUD.” It is a **soft digital surface with an artistic soul**.

---

## 3. Color System / 已确认配色及使用规则

### 3.1 Accepted Base Palette

The color direction is **Palette A as the base, with Palette C as the emphasis system**.

The user prefers soft color but explicitly dislikes:

- dark beige
- yellowed cream
- muddy warm neutrals
- old-paper tones
- dim vintage color grading

The softness must feel:

> **clean, airy, translucent, bright, and lightly luminous**

rather than aged, dusty, or antique.

### 3.2 Accepted Core Colors

```css
:root {
  --color-bg-primary: #F7F9F7;
  --color-primary: #91AA98;
  --color-secondary-pink: #EBC9CF;
  --color-secondary-lilac: #CBC9E5;
  --color-accent: #E95C40;
  --color-text-primary: #252525;
}
```

### 3.3 Usage Rules

**Pearl white / mist white**
- default app background
- primary negative space
- main surface context
- should remain bright and clean

**Botanical green**
- primary brand/health color
- main CTA family
- progress indicators
- selected states
- organic line work
- calm status emphasis

**Soft blush**
- secondary emotional surface
- soft cards
- gentle highlights
- flower-related accent
- non-critical state differentiation

**Pale lavender**
- secondary atmospheric color
- recovery / sleep / reflection-like visual areas where semantically appropriate
- glass tint
- decorative background geometry

**Vermilion-coral**
- editorial accent from Palette C
- should be used sparingly
- ideal for milestones, editorial markers, key numbers, selected poster typography, important high-emphasis moments
- must not become the default CTA color

**Near-black**
- body text
- strong title text
- high-contrast numbers
- use instead of absolute `#000000` where possible

### 3.4 Color Proportion

A previous working proportion was:

- ~70% light background
- ~15% botanical green
- ~5% blush
- ~5% lilac
- ~5% vermilion-coral

This proportion is a **guideline, not a hard token**. Exact screen-by-screen ratios are `Not finalized`.

### 3.5 Additional Soft-Tech Colors

Soft mist-blue or glass tints may be introduced only when needed to support Soft Tech materiality.

Exact additional colors are `Not finalized`.

Do not expand the palette casually.

---

## 4. Typography / 字体方向、字号层级、英文/数字/中文处理原则

### 4.1 Accepted Direction

Typography must feel **modern**.

The user is not committed to a specific font family. Therefore:

**Exact font family: `Not finalized`.**

Do not lock the project to a decorative Art Nouveau font.

The visual system should use typography as a modern anchor against the organic illustration language.

### 4.2 Structural Rule

Use:

- a **modern sans-serif** for normal UI
- optional **modern serif** for a small amount of artistic/editorial display text
- serif usage should remain limited and intentional

The App should not feel like a vintage literary product.

### 4.3 English

English typography may use:

- generous tracking for small labels
- large-scale display words
- editorial line breaks
- controlled vertical placement
- strong contrast between micro-copy and display type

Do not use overly sci-fi, cyberpunk, condensed-gym, or sports-display typefaces as the main family.

### 4.4 Numbers

Numbers are important visual objects.

Use them for:

- body metrics
- calories
- steps
- streaks
- milestones
- progress
- workout duration

They should be:

- clean
- modern
- easy to scan
- allowed to become oversized in milestone contexts
- visually stronger than surrounding secondary copy

Do not stylize numeric data to the point of reducing readability.

### 4.5 Chinese

Chinese UI text should remain:

- modern
- highly legible
- clean
- not faux-calligraphic in ordinary interface use

Vertical Chinese text may be used as an **editorial decorative/compositional device**, not for essential high-frequency interaction text.

### 4.6 Serif Usage

Serif may be used for:

- achievement poster phrases
- poetic micro-copy
- selected section titles
- occasional editorial statements

It should not dominate navigation, forms, data, or controls.

### 4.7 Type Scale

Exact numeric font sizes, line heights, weights, and tracking tokens are:

`Not finalized`

Codex should implement the hierarchy semantically and keep type tokens centralized/configurable.

Required hierarchy:

1. Display / milestone
2. Page title
3. Section title
4. Metric number
5. Card title
6. Body
7. Secondary body
8. Label / metadata / caption
9. Editorial microtext

---

## 5. Layout / 网格、留白、非对称编辑排版原则

### 5.1 Core Layout Principle

The user prefers:

> **Art + a small amount of breathing room**

Avoid both extremes:

- overcrowded decorative collage
- sterile minimalism with excessive empty space

### 5.2 Grid Behavior

The App should use a real underlying grid for usability, but the visible composition may break symmetry.

Use:

- stable content margins
- modular card alignment
- controlled asymmetry
- staggered editorial sections
- occasional edge-aligned decorative elements
- scale contrast
- cropped motifs
- text/image overlap only when readability remains intact

### 5.3 Editorial Asymmetry

Asymmetry should feel deliberate, not accidental.

Good:
- title offset from body content
- one decorative flower breaking a card boundary
- vertical side label
- off-center sun/moon graphic
- one oversized number balancing smaller content
- asymmetric poster composition

Bad:
- random misalignment
- inconsistent spacing
- controls that appear misplaced
- unstable content rhythm
- ornamental overlap over tappable elements

### 5.4 White Space

Use enough empty space to:

- separate functional groups
- give artwork room to breathe
- preserve readability
- create editorial rhythm

Do not turn every screen into a museum-style sparse layout.

### 5.5 Exact Grid Tokens

Column count, baseline grid, and exact page gutters:

`Not finalized`

---

## 6. Shapes / 新艺术运动曲线、有机形状、边框、圆角原则

### 6.1 Organic Form Language

Use:

- flowing botanical curves
- elongated leaves
- petals
- soft arcs
- irregular organic contours
- circular/sun-like fields
- crescent forms
- subtle abstract silhouettes

Forms should feel elegant and lightly stylized rather than cartoonishly round.

### 6.2 Curves

Neo Art Nouveau curves should appear in:

- illustration
- section framing
- background motifs
- progress decoration
- poster composition
- subtle line dividers

Do not use decorative curves behind every card or every control.

### 6.3 Borders

Heavy black borders are not part of the default system.

Neo-Brutalist border treatment is reserved for rare emphasis contexts only.

Default surfaces should rely more on:

- translucent separation
- subtle tonal boundaries
- light borders
- soft depth

Exact border thickness/token:

`Not finalized`

### 6.4 Radius

The accepted visual direction supports softened card shapes, but exact radii were not explicitly finalized.

Exact radius scale:

`Not finalized`

Do not default automatically to Material Design radius values.

---

## 7. Glass / Blur / Glow / Texture 使用规范

### 7.1 Accepted Priority

The user explicitly prefers:

> **Glass materiality over grain-heavy texture.**

### 7.2 Glass

Use glass for:

- key cards
- floating metric panels
- selected overlays
- navigation surfaces if appropriate
- modal/sheet layers where it supports hierarchy

Glass should feel:

- soft
- thin
- luminous
- restrained
- readable

Do not create low-contrast “everything is glass” screens.

### 7.3 Blur

Blur should be subtle and functional.

Use to:

- separate layers
- soften decorative artwork behind cards
- create Soft Tech atmosphere

Exact blur radius:

`Not finalized`

### 7.4 Glow

Glow is allowed in small amounts.

Good:
- soft edge luminosity
- subtle accent behind decorative orb
- atmospheric highlight around milestone content

Bad:
- neon bloom
- cyberpunk glow
- gaming RGB effects
- high-saturation outer glow around all controls

Exact glow tokens:

`Not finalized`

### 7.5 Texture

Texture should be minimal.

Allowed:
- extremely light surface variation
- subtle natural imperfection
- faint paper/ink reference in isolated art pieces

Avoid:
- obvious grain overlays across the whole UI
- distressed paper
- vintage noise
- dirty scan effects

---

## 8. Illustration & Motifs / 植物、花、星月、抽象元素规范

### 8.1 Accepted Motifs

The user explicitly likes:

- plants
- flowers
- sun
- moon
- stars
- subtle / not-obvious silhouettes

These can become recurring visual motifs.

### 8.2 Illustration Style

Preferred:

- fine-line botanical illustration
- soft organic shapes
- semi-abstract floral forms
- lightly cute treatment
- gentle symbolic forms
- translucent overlays
- simplified celestial geometry
- partially cropped decorative art
- low-detail body silhouettes when needed

### 8.3 “Cute” Rule

The user allows the visual language to be **a little cute**, but not:

- childish
- chibi
- mascot-heavy
- overly bubbly
- sugary
- kawaii as the dominant style

Cute should mean:

> warm, soft, charming, approachable

not:

> toy-like or juvenile.

### 8.4 Human Silhouette

If used:

- low-detail
- abstract
- partially hidden
- secondary to the overall composition
- not anatomically emphasized

### 8.5 Decorative Density

Do not place flowers/plants on every card.

Artwork should create rhythm and identity, not visual clutter.

Exact illustration density by screen:

`Not finalized`

---

## 9. Photography / 真人图片是否使用、如何使用

### 9.1 Accepted Principle

Use **few real-person photographs**.

The App should not rely on mainstream fitness photography.

Avoid:
- sweating gym models
- muscle-centric marketing shots
- before/after body transformation photography
- aggressive workout photography
- generic stock “healthy lifestyle” people

### 9.2 When Photography Is Used

Photography may be used where functionally useful, such as:

- food content
- user-added content
- training video thumbnails from external sources
- editorial feature content if needed

When real people appear, they should not dominate the overall visual identity.

### 9.3 Treatment

Exact photography grading/cropping system:

`Not finalized`

---

## 10. Cards / Surfaces / Buttons / Navigation 视觉规则

### 10.1 Cards

Default cards should feel:

- light
- soft
- layered
- modern
- slightly translucent where appropriate
- editorial rather than dashboard-like

Use decorative botanical elements selectively around or behind cards.

Cards should not all look identical.

A screen may mix:

- clean functional metric card
- image/content card
- poster-like emotional card
- soft glass information panel

while preserving spacing and hierarchy.

### 10.2 Surfaces

Primary surfaces:
- pearl/mist white base
- glass or soft-tinted secondary layers
- pale green/pink/lilac contextual surfaces

Avoid:
- flat gray SaaS dashboard panels
- dark card-on-dark systems
- heavy shadow stacks
- beige paper simulation

### 10.3 Buttons

Accepted direction:
- modern
- readable
- not overly decorative
- can use botanical green as primary action color
- high-emphasis actions may use stronger editorial contrast when justified

Exact:
- button radius
- button height
- border width
- pressed-state styling
- secondary/tertiary variants

are `Not finalized`.

Do not use stock Material buttons without adaptation.

### 10.4 Navigation

The accepted homepage visual prototype included a clean bottom navigation treatment and the user reacted positively to the overall direction.

However, exact navigation architecture and component styling are:

`Not finalized`

Navigation must remain:
- clean
- visually light
- consistent with glass/Soft Tech surfaces
- subordinate to content

Do not introduce heavy pill-nav, gaming nav, or generic Material NavigationBar styling without adaptation.

---

## 11. Today 首页的视觉层级原则

The user selected the **F + A balanced homepage direction** and responded positively to the resulting visual prototype.

This is the accepted homepage visual baseline.

### 11.1 Hierarchy

The Today page should combine:

1. **Editorial identity / daily mood**
   - strong page title
   - small editorial label or micro-copy
   - limited botanical/celestial framing

2. **Primary daily status / progress**
   - prominent but clean metric area
   - glass surface acceptable
   - readable data first

3. **Actionable daily content**
   - training
   - food
   - body / health status
   - recommendation or next action

4. **Continuity**
   - streak
   - consistency
   - progress cues

5. **Emotional reward**
   - milestone poster
   - poetic card
   - visual achievement moment

### 11.2 Visual Balance

The Today page should visibly express:

- F: floral/organic art
- A: editorial composition
- D: calm pacing
- M: glass surfaces
- C: only in a milestone or emphasis block

### 11.3 Exact Component Order

The exact information architecture and card order are:

`Not finalized`

Do not hard-code the generated mockup’s exact content order as product truth.

The accepted part is the **visual hierarchy and aesthetic balance**, not every literal UI element in the concept image.

---

## 12. AI Coach 的视觉身份

A dedicated AI Coach visual identity was **not explicitly finalized** in the visual-design conversation.

`Not finalized`

Until finalized, apply these inherited constraints:

- AI Coach must remain inside the same F + A + D + M system.
- Do not style it as a generic chatbot.
- Do not use a stock AI sparkle-heavy purple gradient identity.
- Do not turn it into a corporate assistant panel.
- Avoid a dominant humanoid avatar unless later approved.
- A slightly cute, abstract, botanical, celestial, or soft-symbolic treatment may be explored later, but is not yet approved.

Exact:
- avatar
- icon
- color treatment
- message bubble design
- coach character/persona visuals

are `Not finalized`.

---

## 13. Training / Food / Body / Progress 各模块应如何保持统一又有所区分

The visual conversation did not finalize separate brand identities for these modules.

Module-specific visual differentiation is:

`Not finalized`

### 13.1 Confirmed Shared Rules

All modules must share:

- the same core palette
- the same modern typography system
- the same glass/surface philosophy
- the same spacing logic
- the same organic/editorial composition principles
- the same clean icon and data hierarchy
- the same restraint on photography
- the same light-mode foundation

### 13.2 Allowed Differentiation

Differentiation may later use:

- secondary colors
- motif emphasis
- local illustration subjects
- chart accent color
- editorial label systems

but no module may look like a separate app.

### 13.3 Do Not Assume

Do not automatically assign:
- green = training
- orange = food
- blue = body
- purple = progress

unless this is later approved.

---

## 14. Data Visualization / 图表规范

### 14.1 Accepted Direction

Charts must be:

- clean
- readable
- restrained
- editorially composed
- visually consistent with the App
- function-first

The user explicitly prefers **clean data visualization** rather than heavily artistic charts.

### 14.2 Use

Preferred:
- simple line charts
- restrained bar charts
- minimal ring/progress charts
- clear labels
- strong numeric summary
- subtle gridlines
- botanical green as a common main-series color where appropriate
- secondary palette colors only when necessary

### 14.3 Avoid

- 3D charts
- decorative data distortion
- excessive gradients
- loud multi-color dashboards
- dense BI-style legends
- spreadsheet-like visual density
- heavy neon
- ornamental curves that obscure data

### 14.4 Editorial Integration

Charts may sit inside an editorial composition with:
- oversized metric number
- small contextual label
- asymmetrical caption placement
- subtle motif nearby

but the chart itself must remain clean.

Exact chart stroke widths, marker sizes, gridline values, and data palettes:

`Not finalized`

---

## 15. Achievement / Milestone Poster 成就海报规范

### 15.1 Accepted Direction

Achievements should use **art-poster visual expression**, not a conventional badge-first system.

This is a confirmed visual differentiator.

### 15.2 Suitable Moments

Poster treatment may be used for:

- streak milestones
- weight milestones
- training consistency
- monthly completion
- personal records
- phase completion
- meaningful recovery/health habits
- long-term journey milestones

### 15.3 Visual Composition

Achievement posters may combine:

- Neo Art Nouveau floral line art
- sun / moon / stars
- Japanese Editorial type composition
- a large number
- short poetic or encouraging copy
- vermilion-coral accent
- selective Neo-Brutalist impact
- clean modern sans-serif
- limited serif phrase
- subtle glass or translucent overlay
- controlled asymmetry

### 15.4 Neo-Brutalism Use

This is one of the most appropriate locations for C-style impact.

Example:
- oversized `7`
- bold `DAYS`
- strong vermilion accent
- small botanical counterbalance

### 15.5 Badges

A badge-only visual language is not the preferred primary achievement direction.

Whether small utility badges will also exist is:

`Not finalized`

---

## 16. Motion / 动效风格

### 16.1 Accepted Dual-System Motion

The user accepted combining gentle and stronger motion styles.

### 16.2 Everyday Motion

Use:

- soft fade
- gentle drift
- subtle floating
- line growth
- floral/organic reveal
- calm scale transitions
- glass layer transitions
- progressive reveal

Feeling:
- calm
- soft
- organic
- non-urgent

### 16.3 High-Impact Motion

Use selectively for:
- workout completion
- achievement reveal
- milestone
- streak
- major progress moment

Allowed:
- large type entry
- number expansion
- brief strong transition
- stronger scale/position movement
- short editorial cut

### 16.4 Avoid

- constant bouncing
- gamified confetti everywhere
- aggressive haptics as a visual substitute
- neon pulses
- fast gaming HUD motion
- excessive parallax
- motion on every component

### 16.5 Motion Tokens

Exact durations and easing curves:

`Not finalized`

---

## 17. Light / Dark Theme 原则

### 17.1 Light Theme

**Light theme is the accepted first implementation direction.**

It should use:
- pearl/mist white
- soft botanical green
- blush/lilac accents
- glass
- translucent light surfaces
- restrained dark text

### 17.2 Dark Theme

The user explicitly has **not decided the dark-theme direction yet**.

Dark theme:

`Not finalized`

Do not auto-generate a dark theme by simply inverting colors.

Do not allow Codex/framework defaults to create an unintended dark mode.

If the platform follows system theme automatically, dark mode should be disabled or intentionally gated until a dedicated visual system is approved.

---

## 18. Design Tokens 建议

This section distinguishes **accepted values** from **implementation tokens that remain unresolved**.

### 18.1 Accepted Color Tokens

```css
:root {
  --ds-bg-primary: #F7F9F7;
  --ds-green-primary: #91AA98;
  --ds-pink-soft: #EBC9CF;
  --ds-lilac-soft: #CBC9E5;
  --ds-accent-vermilion: #E95C40;
  --ds-text-primary: #252525;
}
```

### 18.2 Semantic Color Mapping

```css
:root {
  --surface-page: var(--ds-bg-primary);
  --text-primary: var(--ds-text-primary);
  --brand-primary: var(--ds-green-primary);
  --accent-editorial: var(--ds-accent-vermilion);
  --accent-soft-pink: var(--ds-pink-soft);
  --accent-soft-lilac: var(--ds-lilac-soft);
}
```

Exact secondary text, divider, disabled, warning, error, success, and focus-ring colors:

`Not finalized`

Do not infer them from Material Design defaults.

### 18.3 Spacing Tokens

Exact spacing scale:

`Not finalized`

Implementation requirement:
- centralize spacing in tokens
- do not scatter arbitrary pixel values
- preserve editorial rhythm
- allow larger gaps between conceptual sections than inside functional groups

### 18.4 Radius Tokens

Exact radius values:

`Not finalized`

Implementation requirement:
- centralize radius tokens
- use soft modern card geometry
- avoid excessively bubbly/mobile-game styling
- avoid default Material radius choices unless visually validated

### 18.5 Border Tokens

Exact border system:

`Not finalized`

Implementation requirement:
- default borders light/subtle
- Neo-Brutalist heavy border is not global
- high-contrast border only for rare emphasis

### 18.6 Shadow Tokens

Exact shadows:

`Not finalized`

Implementation requirement:
- soft depth
- low visual weight
- avoid SaaS-style gray elevation stacks
- prefer surface/light separation over dramatic drop shadow

### 18.7 Glass Tokens

Exact values:

`Not finalized`

Token structure should support:

```css
--glass-bg:
--glass-border:
--glass-blur:
--glass-shadow:
--glass-highlight:
```

Do not hard-code glass effects per component.

### 18.8 Motion Tokens

Exact values:

`Not finalized`

Token structure should support at least:

```css
--motion-fast:
--motion-standard:
--motion-gentle:
--motion-emphasis:
--ease-standard:
--ease-organic:
--ease-emphasis:
```

### 18.9 Typography Tokens

Exact sizes/families:

`Not finalized`

Token structure should support:

```css
--font-ui:
--font-display:
--font-serif-accent:

--type-display:
--type-page-title:
--type-section-title:
--type-metric:
--type-card-title:
--type-body:
--type-caption:
--type-micro:
```

---

## 19. Do / Don't

### DO

- Use Neo Art Nouveau as the strongest visual personality.
- Use Japanese Experimental Editorial for composition and typography behavior.
- Keep everyday screens calm and functional.
- Use botanical green as the core brand color.
- Use vermilion-coral sparingly for editorial/high-impact accents.
- Keep backgrounds bright and clean.
- Use modern typography.
- Use glass, soft blur, and translucent layering.
- Use plants, flowers, sun, moon, and stars as recurring motifs.
- Allow slightly cute visual details.
- Keep human silhouettes subtle and abstract.
- Use limited real-person photography.
- Keep charts clean.
- Use achievement posters as emotional reward surfaces.
- Use Neo-Brutalist force only at key moments.
- Keep the experience light-mode first.
- Preserve asymmetry and editorial tension without harming usability.
- Keep the visual language artistic but not overloaded.
- Keep important controls readable and obvious.

### DON'T

The following directions have been explicitly rejected or ruled out as primary styles:

- hard-core fitness aesthetic
- black background + fluorescent green fitness UI
- aggressive “burn / grind / no pain” visual tone
- yellow-beige vintage paper aesthetic
- dark/dim cream-heavy Wabi-Sabi
- heavy old-paper texture
- excessive grain/noise
- dense antique Art Nouveau ornament
- excessive floral borders
- large amounts of generic fitness-model photography
- muscle / sweat marketing visuals
- overly cute / chibi / toy-like design
- full Neo-Brutalist interface
- heavy black borders everywhere
- cold pure-futurist HUD
- cyberpunk
- neon gaming interface
- generic glassmorphism with no art direction
- generic Material Design appearance
- generic SaaS analytics dashboard
- generic wellness template
- empty Apple-like minimalism with excessive blank space
- over-experimental layouts that damage usability
- ornate charts
- BI dashboard density
- automatic unreviewed dark mode

---

## 20. Codex Implementation Notes

### 20.1 This Is Not a Template-First Project

Codex must not “normalize” the UI into:

- Material Design
- Material 3
- generic Android wellness UI
- generic iOS health UI
- SaaS dashboard
- admin dashboard
- Bootstrap-style card grid
- generic Tailwind component library appearance
- conventional fitness app branding

Framework primitives may be used technically, but the **rendered visual result must follow this design system**.

### 20.2 Do Not Let Component Libraries Define the Product

If using:
- Material UI
- Chakra
- Ant
- shadcn/ui
- React Native Paper
- NativeBase
- Compose Material
- any design-system library

treat them as implementation primitives only.

Override:
- colors
- radius
- typography
- shadows
- surfaces
- spacing
- buttons
- cards
- navigation
- dialogs
- charts

to match this document.

### 20.3 Preserve the F + A Balance

Codex should not simplify decorative/organic details out of existence.

At the same time, it should not cover every screen with flower illustrations.

The correct balance is:

- **F gives the product identity**
- **A gives the product composition**
- **D gives the product calm**
- **M gives the product material**
- **C gives selected moments impact**

### 20.4 Build Art Direction as Reusable Components

Do not bake decorative artwork into screenshots.

Create reusable primitives such as:

- `BotanicalLineArt`
- `FloralCorner`
- `CelestialMotif`
- `EditorialLabel`
- `VerticalEditorialText`
- `GlassCard`
- `MetricCard`
- `MilestonePoster`
- `EditorialNumber`
- `SoftOrb`
- `OrganicDivider`

Names are implementation examples, not mandatory API names.

### 20.5 Separate Functional and Emotional Surfaces

Functional surfaces:
- forms
- meal entry
- workout controls
- history
- charts
- settings
- body data

should prioritize readability.

Emotional surfaces:
- Today hero
- milestone
- achievement
- streak
- summary
- onboarding moment

may carry stronger art direction.

### 20.6 Keep Tokens Centralized

Do not hard-code visual constants throughout components.

At minimum centralize:
- colors
- type roles
- spacing
- radii
- borders
- glass
- shadow
- motion
- z-index/layer behavior

### 20.7 Do Not Invent Unfinalized Decisions

Where this document says `Not finalized`, Codex must:

- keep the decision configurable
- use the closest neutral implementation compatible with the accepted visual baseline
- avoid introducing a new visual style
- avoid locking future design choices into component APIs

### 20.8 Generated Concept Image

The accepted F + A balanced homepage concept should be treated as a **visual direction reference**, not as an exact pixel-spec implementation.

Do not copy:
- literal text
- exact content
- exact metrics
- exact component order
- exact illustrations

unless separately specified by product requirements.

Preserve:
- overall balance
- lightness
- botanical framing
- editorial hierarchy
- clean functional cards
- glass softness
- selective milestone impact
- modern type
- restrained but visible art direction

---

# FINAL ACCEPTED DESIGN BASELINE

This section is the fast-read baseline for developers.

## Core Style

**Primary visual direction**
- Neo Art Nouveau (F)
- Japanese Experimental Editorial (A)

**Supporting**
- Wabi-Sabi (D): calm, natural, restrained
- Soft Tech (M): glass, blur, translucency, soft digital light

**Accent only**
- Neo-Brutalism (C): major numbers, completion, milestone, high-emphasis moments

## Overall Feeling

The App must feel:

- artistic
- modern
- soft
- bright
- organic
- lightly romantic
- clean
- editorial
- calm
- selectively bold

It must **not** feel like a conventional fitness app, SaaS dashboard, Material Design template, cyberpunk HUD, or beige vintage wellness product.

## Accepted Color Baseline

```css
--bg-primary: #F7F9F7;
--primary-green: #91AA98;
--soft-pink: #EBC9CF;
--soft-lilac: #CBC9E5;
--accent-vermilion: #E95C40;
--text-primary: #252525;
```

Palette logic:
- Palette A is the base.
- Palette C provides the strong editorial accent.
- Backgrounds remain clean and bright.
- Avoid dark beige / yellowed cream / muddy vintage neutrals.

## Typography

- Modern typography.
- Modern sans-serif for normal UI.
- Limited modern serif may appear in artistic/editorial moments.
- Exact font family: `Not finalized`.
- Japanese/editorial character should come mainly from composition, scale, spacing, and occasional vertical text—not novelty fonts.
- Numbers may be large and visually important.

## Layout

- Art + a small amount of breathing room.
- Controlled asymmetry.
- Editorial hierarchy.
- Text can participate in composition.
- Avoid both clutter and extreme sparse minimalism.
- Experimental layout must never reduce usability.

## Shape Language

- flowing botanical curves
- flowers
- leaves
- organic arcs
- sun
- moon
- stars
- subtle abstract silhouettes

Avoid dense historical ornament.

## Material

- glass > grain
- soft translucency
- subtle blur
- restrained glow
- minimal texture
- no heavy paper grain or distressed scan treatment

## Illustration

Use:
- plants
- flowers
- celestial motifs
- soft abstract elements
- lightly cute details
- subtle silhouettes

Avoid:
- dominant mascots
- chibi style
- heavy realism
- decorative overload

## Photography

- Use few real-person images.
- Do not build the visual identity around gym models, muscles, sweat, or transformation photography.
- Functional food/video imagery is acceptable.

## Data

- clean
- readable
- restrained
- editorially framed
- function-first
- no decorative chart distortion

## Today Page

Accepted visual direction:
- F + A balanced version
- botanical art + editorial composition
- clean glass-based metric surfaces
- functional daily actions
- calm progression
- milestone poster as emotional emphasis

Exact component order: `Not finalized`.

## AI Coach

Visual identity: `Not finalized`.

Until finalized:
- keep it inside the same F+A+D+M system
- do not turn it into a generic chatbot or purple AI assistant

## Module Differentiation

Training / Food / Body / Progress:
- same core system
- exact module-specific colors/motifs: `Not finalized`
- do not invent separate mini-brand systems

## Achievements

- Art-poster-first
- large milestone numbers allowed
- Neo Art Nouveau + Japanese Editorial
- C-style bold impact may appear here
- ordinary badge-only treatment is not the primary direction

## Motion

Everyday:
- soft
- organic
- floating
- fading
- growing
- gentle glass transitions

Milestones:
- stronger typography
- larger scale motion
- brief editorial impact

Exact motion timings: `Not finalized`.

## Theme

- Light theme first: **confirmed**
- Dark theme: `Not finalized`
- Do not auto-invert or auto-generate dark mode.

## Non-Negotiable Exclusions

Do not redesign into:

- Material Design
- generic SaaS dashboard
- traditional fitness app
- black/neon gym UI
- beige vintage paper UI
- full Neo-Brutalism
- cyberpunk/futuristic HUD
- generic glassmorphism
- chibi/kawaii product
- photography-heavy fitness marketing
- extreme empty minimalism
- visually noisy experimental art UI

## Developer Priority

When resolving a visual ambiguity, preserve this order:

1. usability
2. accepted F + A visual identity
3. calm D atmosphere
4. M glass materiality
5. C impact only when the moment deserves it

Do not create a new visual direction to solve an implementation shortcut.
