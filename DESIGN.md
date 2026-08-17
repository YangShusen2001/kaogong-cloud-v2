# Kaogong Cloud Design System

## 1. Atmosphere & Identity

Kaogong Cloud is a calm Chinese editorial workspace: official-source reading material presented with the clarity of a study notebook rather than the density of a dashboard. The signature is the combination of deep institutional blue, restrained gold annotation, and Song-style serif reading titles across warm, lightly elevated surfaces. Account screens must remain quiet supporting pages, not introduce a separate product aesthetic.

## 2. Color

The implementation source of truth is `apps/web/src/styles/global.css`; every role below maps to an existing CSS custom property.

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Canvas | `--bg` | `#f5f7fa` | `#0d1117` | Page background |
| Surface | `--surface` | `#ffffff` | `#161b22` | Cards, reading surfaces |
| Recessed surface | `--surface-2` | `#eef1f6` | `#1c2128` | Inputs, controls |
| Primary text | `--ink` | `#1b2432` | `#e6edf3` | Headlines and body |
| Secondary text | `--sub` | `#5b6472` | `#98a2b3` | Supporting copy |
| Muted text | `--mut` | `#8a93a4` | `#6b7484` | Disabled and tertiary text |
| Divider | `--line` | `#e4e8ef` | `#2a313c` | Borders and separators |
| Primary | `--primary` | `#1d4ed8` | `#7fa8ff` | Links, focus, primary actions |
| Primary deep | `--primary-deep` | `#122a5c` | `#0a1526` | Emphasis and hero depth |
| Primary soft | `--primary-soft` | `#e7eefc` | `#17233c` | Selected states |
| Editorial accent | `--accent` | `#a06d08` | `#e3b341` | Quotes and annotation |
| Success | `--green` / `--green-soft` | `#1f7a56` / `#e6f4ec` | `#5ecf9d` / `#16352a` | Success status |
| Error | `--red` / `--red-soft` | `#b3201c` / `#fbeaea` | `#ff6b66` / `#3b1b19` | Errors and destructive actions |

Rules:

- Blue indicates navigation, focus, or a primary action; gold is reserved for editorial annotation.
- Status colors communicate state and are always paired with text.
- New colors must be added as light/dark tokens in `global.css` and documented here first.

## 3. Typography

| Level | Size | Weight | Line height | Usage |
| --- | --- | --- | --- | --- |
| Display | `38px` | 600 | 1.3 | Homepage hero |
| Page title | `30px`, `24px` mobile | 600 | 1.35 | Reading title |
| Section title | `22px` | 600 | 1.3 | Card headings |
| Subsection | `18px` | 600 | 1.3 | Editorial sections |
| Body reading | `17px` | 400 | 1.9 | Article paragraphs |
| Body UI | `16px` | 400 | 1.7 | Forms and controls |
| Supporting | `14px` | 400 | 1.7 | Help and status text |
| Caption | `13px` | 400 | 1.5 | Metadata |

- UI and body use `--font`: PingFang SC, Microsoft YaHei, Segoe UI, then system sans.
- Reading titles and editorial headings use `--font-serif`: Songti SC, Noto Serif CJK SC, SimSun, then serif.
- Brand wordmark uses `--font-logo`: subsetted PingFangFangMaoTiCaoShu at 50px, text only, no image. Account pages do not imitate it.

## 4. Spacing & Layout

- Base unit: 4px.
- Spacing tokens: `--s-1` 4px, `--s-2` 8px, `--s-3` 12px, `--s-4` 16px, `--s-5` 24px, `--s-6` 32px.
- Radius tokens: `--r-xs` 4px, `--r-sm` 8px, `--r-md` 12px, `--r-lg` 18px, `--r-full` for compact pills and circular controls only.
- Main content is centered at 80% on larger screens and becomes full-width below 640px.
- Account cards use a readable single column capped at 420px; controls stack rather than compress.
- Primary content must have no horizontal overflow at 375px, 768px, or 1280px.

## 5. Components

### Card

- **Structure**: semantic section with heading and one task-focused content stack.
- **States**: loading, content, empty, and error remain inside the card to avoid layout jumps.
- **Accessibility**: loading and errors use live regions where state changes after navigation.
- **Depth**: surface, one divider border, and `--r-lg`; no additional decorative shadow on account cards.

### Button

- **Variants**: solid primary, outlined secondary, compact destructive/navigation action.
- **States**: default, hover, keyboard focus, active, disabled, loading.
- **Accessibility**: native button semantics; disabled and loading state are visible in both label and control state.
- **Motion**: only transform, color, border, and shadow transitions at 150ms.

### Form Field

- **Structure**: visible label followed by input and optional supporting/status text.
- **States**: default, focus, readonly, disabled, invalid.
- **Accessibility**: errors and availability messages are text, not color-only; asynchronous results use `aria-live`.

### Subscription Control

- **Structure**: checkbox, explicit daily-summary label, and adjacent availability explanation.
- **States**: available, unavailable and unsubscribed, unavailable but currently subscribed, saving, success, error.
- **Behavior**: unavailable and unsubscribed disables opt-in; unavailable but subscribed keeps opt-out enabled.
- **Accessibility**: availability copy is associated with the checkbox using `aria-describedby`.

### Navigation Account State

- **Structure**: account link, logout button, and visually compact live status.
- **States**: anonymous, authenticated, logging out, logout failed.
- **Behavior**: a failed logout never reloads or falsely switches to anonymous state.

## 6. Motion & Interaction

| Type | Duration | Usage |
| --- | --- | --- |
| Micro | 150ms | Buttons, links, focus and selected states |
| Navigation | 250ms | Existing collapsing navigation |
| Editorial ambient | 16-22s | Existing homepage aurora only |

- Motion serves state or navigation; account screens add no ambient animation.
- Animate `transform` and opacity for movement; never animate layout dimensions.
- `prefers-reduced-motion: reduce` removes non-essential transitions and ambient motion.

## 7. Depth & Surface

The strategy is mixed but restrained: cards use a one-pixel tokenized border; floating reader tools use `--shadow`; homepage hero depth comes from its existing blue aurora. Account forms remain border-led and do not introduce gradients, glass, or additional elevation.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA with visible keyboard focus, complete keyboard reachability, and minimum 44px primary touch targets on mobile.
- Async request, verification, save, availability, and logout outcomes must be announced through polite or assertive live regions as appropriate.
- Disabled controls must explain why in nearby text.
- Pages must remain usable at 200% zoom and at 375px width without horizontal scrolling.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
| --- | --- | --- | --- |
| Legacy emoji avatar choices | `apps/web/src/pages/profile.astro` | Existing persisted profile contract and user data rely on these values; this task does not migrate avatars | Account owner; replace only with a data migration and an approved icon/avatar set |
| Existing raw colors and spacing outside token use | `apps/web/src/styles/global.css` legacy sections | Extraction documents the current implementation without expanding this account task into a redesign | Web owner; consolidate in a dedicated design-system refactor |
| Lighthouse production audit not recorded | Deployed web routes | No unblocked production deployment URL is available while the release gate is open | Release owner; run mobile and desktop audits after deployment is unblocked |
