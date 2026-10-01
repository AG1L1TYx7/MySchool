# 12. UX: motion system and gamified experience

Status: accepted requirement (1 Oct 2026). Applies to every screen from Release 1 slice 5 onward, and the existing screens are brought up to it in a dedicated UX slice (see section 5). Owner: the web client (`apps/web`); the API supplies the data (gamification domain, docs/02 section 14).

## 1. Why

Students use SmartSchool every day. An interface that feels alive and rewards effort keeps them coming back; a static form-filling interface does not. Competitors (docs/08) treat gamification as a plugin. Here it is part of the core experience, and motion is the language that makes progress visible.

## 2. Principles

1. **Motion explains, never decorates.** Every animation answers "what changed, where did it go, what can I do next". Nothing moves without a reason.
2. **Fast and calm.** Micro-interactions 120 to 200 ms, transitions 200 to 320 ms, celebrations at most 1.2 s and skippable. Easing: standard `cubic-bezier(0.2, 0, 0, 1)` for entering, `cubic-bezier(0.4, 0, 1, 1)` for leaving.
3. **Respect the person.** `prefers-reduced-motion` turns transforms into opacity fades and disables celebrations. Motion never blocks input. Keyboard focus is always visible and animated the same way as pointer hover.
4. **Age-aware.** Younger bands (K to 5) get warmer, bigger, more playful feedback (confetti, mascots, sounds off by default); older bands (6 to 12) get streaks, levels and leaderboards opt-in; adults (teachers, parents, administrators) get precise, quiet motion and no game mechanics except progress views.
5. **Earned, not bought.** Rewards come from learning behaviour (finishing lessons, submitting on time, improving a score, helping a classmate), never from clicks. Teachers can award manually; administrators configure what counts.
6. **No shaming.** Leaderboards are opt-in and class-scoped; comparisons default to "you versus your past self"; attendance and grades never produce negative badges.

## 3. Motion system (web)

Tokens live in `apps/web/src/lib/motion.ts` and Tailwind config.

| Token | Value | Used for |
|---|---|---|
| `duration.fast` | 150 ms | hover, press, toggles, checkbox ticks |
| `duration.base` | 240 ms | panels, cards entering, list reorders, tab switches |
| `duration.slow` | 320 ms | page transitions, drawers, modals |
| `duration.celebrate` | 900 to 1200 ms | confetti, level-up, badge unlock |
| `ease.enter` / `ease.exit` | see principle 2 | all transforms |
| `spring.soft` | stiffness 260, damping 24 | progress rings, XP bars, draggable cards |

Patterns:

- **Page transitions:** fade and 8 px rise on route change; shared-element move for a card that opens into its detail page (class card to class page, assignment row to assignment page).
- **Lists:** items enter with a 40 ms stagger; reorder (modules, lessons) animates position; delete collapses height.
- **Feedback:** buttons scale 0.98 on press; success states tick-draw an icon; errors shake once (4 px, 300 ms) and announce via `aria-live`.
- **Progress:** XP bars and progress rings animate from the previous value to the new one, never from zero; numbers count up.
- **Loading:** skeletons shimmer in place of content; no spinners over empty pages; optimistic updates for marks, toggles and submissions with rollback on failure.
- **Celebrations:** on a submission, a graded result, a completed module, a streak milestone and a level-up. One celebration per event, dismissible, never stacked.

Library: `framer-motion` for component motion and layout animation, CSS for hover and focus states. All motion components are wrapped so that `prefers-reduced-motion` is honoured in one place.

## 4. Gamified experience

Built on the Release 2 gamification domain (`StudentPoints`, `RewardTransactions`, `Achievements`, `Badges`, `Titles`, `Leaderboards`, docs/02 section 14), surfaced in the interface as follows.

| Mechanic | Where it appears | Rule |
|---|---|---|
| **XP and levels** | header pill, dashboard ring, profile | XP for finishing a lesson, submitting work, on-time submission bonus, improving a score; level thresholds grow geometrically; levels never go down |
| **Streaks** | dashboard, lesson pages | consecutive school days with at least one learning action; freeze tokens earned weekly so one missed day does not reset; teachers see class streaks |
| **Badges and achievements** | profile, unlock toast, class wall (opt-in) | curriculum badges (module mastery), habit badges (five on-time submissions), growth badges (score improved twice in a row), kindness badges (teacher awarded) |
| **Quests** | dashboard "this week" card | teacher or auto-generated weekly goals ("finish two lessons in Algebra", "submit before Thursday"); progress bar with checkpoints |
| **Progress maps** | course page | modules shown as a path with nodes that light up as lessons complete; the next step is always highlighted |
| **Mastery rings** | course and class pages | per-topic mastery from grades and practice (Release 2 learning science), animated on change |
| **Class challenges** | class page | optional cooperative goals ("class reaches 90 % submissions"); rewards shared; no individual blame |
| **Leaderboards** | class page, opt-in per student | weekly, class-scoped, show top five plus "you"; off by default for K to 5 |
| **Teacher console** | class page | award points or a badge with a reason; see who is close to a milestone; configure what counts |
| **Parent view** | parent dashboard | child's streak, level and latest badges with plain-language explanations; no leaderboard |
| **AI tutor tie-in** | tutor chat (slice 5) | finishing a tutor-guided practice set counts as a learning action; the tutor congratulates on streaks and suggests the next quest step |

Anti-abuse: XP for an action is granted once per entity (one lesson, one assignment), rate-limited per day, and never granted for AI-generated answers submitted without edits. All grants are audited.

## 5. Delivery

- **Slice 5 onward:** every new screen ships with the motion tokens, skeleton loading, animated progress and the feedback patterns above (part of the docs/11 definition of done, section 1 item 7 "walk-through" includes a motion check).
- **UX slice (after slice 5, two weeks):** retrofit the existing screens (sign-in, dashboard, courses, classes, assignments, grades, attendance, students) with the motion system; add the design tokens file, the `Motion` wrapper components, page transitions, skeletons and the first celebration (submission and grade). Add Playwright flows that assert reduced-motion behaviour and that celebrations do not block input.
- **Release 2 gamification slice:** XP, levels, streaks, badges, quests, progress maps, class challenges, leaderboards, teacher console and parent view, on the gamification tables; evaluation of engagement metrics in docs/08 section 6 (daily active students, lesson completion, on-time submission rate).

## 6. Acceptance checklist (per screen)

- [ ] Enter and exit motion uses the tokens; nothing moves without a reason.
- [ ] `prefers-reduced-motion` verified in the browser devtools emulation.
- [ ] Loading uses skeletons; no layout shift when content arrives.
- [ ] Success and error feedback is visible, announced to screen readers, and does not block input.
- [ ] Progress elements animate from the previous value.
- [ ] Any game mechanic on the screen follows section 2 principles 4 to 6.
