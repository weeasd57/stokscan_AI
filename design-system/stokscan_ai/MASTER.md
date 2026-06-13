# Design System Master File (Neo-brutalist Style)

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** stokscan_AI
**Style Philosophy:** Premium Neo-brutalism (النيو-بروتاليزم المالي الفاخر)
**Category:** Fintech / Stock Analysis
**Target Environment:** Local Development & Web Deployment

---

## 🎨 Global Colors & Tokens

We combine Neo-brutalist starkness with a refined financial palette to ensure high contrast, readability, and a premium feel.

| Token | Role | Hex | Tailwind Utility / Usage |
|-------|------|-----|-------------------------|
| `--color-bg-dark` | Dark Background | `#0D0D0D` | `bg-neutral-950` / Deep black base |
| `--color-bg-light` | Light Card Fill | `#FFFFFF` | `bg-white` / Contrast panels (light mode/sections) |
| `--color-primary` | Accent / Target | `#FFDC58` | `bg-amber-300` / Gold accent for wins/gains |
| `--color-cta` | Active tech CTA | `#8B5CF6` | `bg-violet-500` / Primary CTA color |
| `--color-success` | Gains / Up | `#10B981` | `text-emerald-500` / Positive stock returns |
| `--color-danger` | Loss / Down | `#EF4444` | `text-red-500` / Negative stock returns |
| `--color-border` | Brutalist Border | `#000000` / `#FFFFFF` | `border-black` / `border-white` (Thick borders) |

### Typography

- **Heading Font:** IBM Plex Sans (sans-serif)
- **Body Font:** IBM Plex Sans (sans-serif)
- **Data/Numeric Font:** JetBrains Mono (monospace) — *Crucial for alignment of numbers, prices, and metrics.*
- **Mood:** Financial, raw, high-contrast, serious, trustworthy
- **CSS Import:**
  ```css
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700;900&family=JetBrains+Mono:wght@400;700;900&display=swap');
  ```

---

## 📐 Layout & Spacing

| Token | Value | Tailwind equivalent | Usage |
|-------|-------|---------------------|-------|
| `--space-xs` | `4px` | `gap-1` / `p-1` | Micro spacing |
| `--space-sm` | `8px` | `gap-2` / `p-2` | Icon gaps, inline spacing |
| `--space-md` | `16px` | `gap-4` / `p-4` | Standard padding/margins |
| `--space-lg` | `24px` | `gap-6` / `p-6` | Cards, main sections |
| `--space-xl` | `32px` | `gap-8` / `p-8` | Large section spacing |

---

## ⚡ Component Specifications

### 1. Buttons (النيو-بروتاليزم الفاخر)
All buttons must feature a solid border, flat shadow, and tactile click response:

```tsx
// Primary Action Button (Tactile click feedback)
<button className="h-12 px-6 border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all duration-100 cursor-pointer">
  {text}
</button>

// Secondary/Interactive Button (Neutral)
<button className="h-12 px-6 border-4 border-black dark:border-white bg-white dark:bg-zinc-900 text-black dark:text-white font-black uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-50 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all duration-100 cursor-pointer">
  {text}
</button>
```

### 2. Cards & Containers (لوحات العرض)
Cards must be unrounded, bordered, and stand out via flat shadow depth:

```tsx
<div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,0.15)] transition-all">
  {content}
</div>
```

### 3. Inputs (حقول الإدخال)
Unrounded, monospace numbers, high-contrast borders:

```tsx
<input 
  type="number"
  className="h-14 w-full border-4 border-black dark:border-white bg-white dark:bg-zinc-950 px-5 text-lg font-black text-indigo-600 dark:text-indigo-400 outline-none font-mono shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] focus:bg-amber-50 dark:focus:bg-zinc-800 transition-colors"
/>
```

---

## 🏛️ UI/UX Pro Max Rules (قواعد الجودة المفروضة)

To elevate Brutalism from "messy/anti-design" to "premium professional product":

### 🚫 Anti-Patterns (Do NOT Use)
* ❌ **No emojis as icons** — Always use SVG icons (Lucide or Heroicons).
* ❌ **No soft/blurry gradients in brutalist blocks** — Fills must be solid or use stark patterns.
* ❌ **No border-radius larger than 0px-4px** — Keep corners sharp (`rounded-none` or `rounded-sm` max).
* ❌ **No horizontal scrolling on lists/tables** — Wrap text or use overflow indicators.
* ❌ **No missing cursor-pointer** — Every clickable card, button, or selector must have `cursor-pointer`.
* ❌ **No low contrast text** — Slate gray on black is prohibited; body text must be pure white/black or high-contrast zinc (`text-zinc-200` on dark backgrounds).

### 🔍 Pre-Delivery Checklist
- [ ] Emojis replaced with SVGs in all UI controls.
- [ ] Numbers are rendered using `font-mono` (JetBrains Mono) for perfect vertical column alignment.
- [ ] Hover and click states transition smoothly (100-200ms) with correct shift (`translate-x`).
- [ ] Accessibility: Contrast ratio meets 4.5:1 minimum on all interactive components.
- [ ] Responsive design verified at 375px (mobile) and 1440px (desktop).
