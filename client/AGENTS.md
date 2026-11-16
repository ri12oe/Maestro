# AGENTS.md

## Project Goal
Recreate the full UI of the target website as accurately as possible.

**Target website:** https://maestro-production-70bb78b5.up.railway.app/
**Tech stack:** React + Vite + TypeScript + Tailwind CSS (or adjust as needed)
**Priority:** Visual fidelity > perfect code structure (structure can be cleaned later)

## Design Source of Truth
1. Use the official Figma plugin whenever a Figma file or frame is provided.
2. When no Figma file exists, use screenshots, the live website, and Chrome DevTools inspection as the source of truth.
3. Always match:
   - Spacing (use the site’s actual scale)
   - Typography (font, size, weight, line-height)
   - Colors (exact hex/rgb when possible)
   - Component structure and hierarchy
   - Responsive behavior across mobile, tablet, and desktop

## Workflow Rules
- Before writing any code for a new page or section, first describe the plan (layout structure, components, and breakpoints).
- Prefer daisyUI or existing project components when they match the design. Fall back to custom Tailwind only when necessary.
- Implement one major section at a time (hero → features → footer, etc.) and confirm visual accuracy before moving on.
- After implementing a section, take a screenshot (or ask to compare) and iterate until it matches the reference.
- Extract reusable components as soon as a pattern appears more than once.

## Implementation Guidelines
- Use semantic HTML + Tailwind utility classes.
- Keep components small and focused.
- Prefer CSS variables or Tailwind theme extension for colors and spacing if the design system is clear.
- Make all interactive states (hover, focus, active) match the original site.
- Ensure the layout is responsive and matches the original at common breakpoints (375px, 768px, 1280px+).

## Figma-Specific Instructions (when Figma is connected)
- Always call the design-to-code skill / get design context before implementing a frame.
- Respect auto-layout, constraints, and component variants from Figma.
- Map Figma components to code components whenever possible (use Code Connect if available).

## Quality Checklist (run before marking a section complete)
- [ ] Spacing matches the reference
- [ ] Typography matches (family, size, weight, color)
- [ ] Colors are accurate
- [ ] Layout is responsive
- [ ] Interactive states exist
- [ ] No obvious visual regressions from previous sections

## Notes
- Do not invent new design decisions. When something is unclear, ask for clarification or a screenshot.
- If the original site uses a specific library or design system, try to mirror it.
