# 19. Accessibility conformance report (WCAG 2.2 AA)

The claim: the SmartSchool web application conforms to WCAG 2.2 Level AA on every screen, for every role, at desktop and phone width, with the exceptions listed in section 4. The claim is re-tested every slice; the automated part runs from the browser-check scripts and the manual part is this checklist, walked by hand on the screens that changed.

Standard: WCAG 2.2 (W3C Recommendation, 5 October 2023), Level AA, plus Section 508 as it incorporates WCAG. Scope: `apps/web` (Next.js), signed-in and public pages. Out of scope: PDF exports (report cards, transcripts) are generated documents without tagged structure; H5P interactive content is authored by teachers and depends on the H5P library's own accessibility.

## 1. How it is tested

| Check | Tool | Coverage |
|---|---|---|
| Automated rules, desktop | axe-core 4.x, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice | every navigation page plus the first detail page of every list, as teacher, student, parent, principal, superadmin and counselor; public pages (`a11y.mjs`) |
| Automated rules, phone | same, at 360 x 740 with touch | every navigation page and the first detail page of courses, classes, assignments and students, five roles (`a11y-mobile.mjs`) |
| Reflow (1.4.10) | script: `document.scrollWidth > innerWidth` at 360 px | same pages |
| Text zoom (1.4.4) | script: 200% root font size, clipped text detector | dashboard, insight, compliance |
| Keyboard, focus, skip link | manual, and the skip-link step in `flows19.mjs` | every slice's flows |
| Screen reader | manual, NVDA on Windows with Chrome, on the screens each slice adds | per slice |

Latest automated results: see section 5.

## 2. Conformance by success criterion (Level A and AA)

Supports = meets the criterion on every screen tested. Partially supports = meets it with the exceptions noted. Not applicable = the product has no such content.

| Criterion | Level | Result | Notes |
|---|---|---|---|
| 1.1.1 Non-text content | A | Supports | Icons are decorative (`aria-hidden`) or labelled; charts carry `role="img"` with a text alternative and the numbers are repeated in text |
| 1.2.x Time-based media | A/AA | Not applicable | No audio or video is produced by the product; teacher-uploaded media is content |
| 1.3.1 Info and relationships | A | Supports | Native headings, lists, tables with headers, form labels, landmarks (`aside`, `nav`, `main`) |
| 1.3.2 Meaningful sequence | A | Supports | DOM order matches reading order; no CSS reordering of content |
| 1.3.3 Sensory characteristics | A | Supports | Status is never colour alone: every badge carries text |
| 1.3.4 Orientation | AA | Supports | No orientation lock |
| 1.3.5 Identify input purpose | AA | Supports | `autocomplete` on sign-in, registration and profile fields |
| 1.4.1 Use of colour | A | Supports | Grade and status pills carry words; links are underlined on hover and distinguishable by colour and weight |
| 1.4.2 Audio control | A | Not applicable | |
| 1.4.3 Contrast (minimum) | AA | Supports | Tested by axe; the slate-600 on tinted backgrounds fix from slice 14 holds |
| 1.4.4 Resize text | AA | Supports | 200% root font: no clipped text on the three dense pages tested; layouts stack |
| 1.4.5 Images of text | AA | Supports | None |
| 1.4.10 Reflow | AA | Supports | No horizontal scroll at 360 px except inside tables and code, which scroll in their own container |
| 1.4.11 Non-text contrast | AA | Supports | Inputs and buttons have 3:1 borders or fills; focus ring is brand-500 at 2 px |
| 1.4.12 Text spacing | AA | Supports | No fixed heights on text containers |
| 1.4.13 Content on hover or focus | AA | Supports | Only native `title` tooltips and persistent details |
| 2.1.1 Keyboard | A | Supports | Every control is a button, link, input or select; the practice ratings, tabs (radiogroup) and chat are keyboard operable |
| 2.1.2 No keyboard trap | A | Supports | Modals are not used; celebrations dismiss on a button or on their own |
| 2.1.4 Character key shortcuts | A | Not applicable | None |
| 2.2.1 Timing adjustable | A | Supports | Session length is a setting; no timed interactions in the interface |
| 2.2.2 Pause, stop, hide | A | Supports | Animations are short, respect reduced motion, and the celebration can be dismissed |
| 2.3.1 Three flashes | A | Supports | No flashing |
| 2.4.1 Bypass blocks | A | Supports | Skip link to `#main-content` (slice 19), landmarks |
| 2.4.2 Page titled | A | Supports | Each route sets its title |
| 2.4.3 Focus order | A | Supports | Follows DOM order |
| 2.4.4 Link purpose (in context) | A | Supports | Link text names the target; "See everything" style links sit next to the card title that gives context |
| 2.4.5 Multiple ways | AA | Supports | Navigation, search on lists, links between related pages |
| 2.4.6 Headings and labels | AA | Supports | |
| 2.4.7 Focus visible | AA | Supports | Focus ring on every control |
| 2.4.11 Focus not obscured (minimum) | AA | Supports | No sticky bars cover focused controls; the header is not sticky |
| 2.5.1 Pointer gestures | A | Supports | No multipoint or path gestures |
| 2.5.2 Pointer cancellation | A | Supports | Native click |
| 2.5.3 Label in name | A | Supports | Accessible names start with the visible text |
| 2.5.4 Motion actuation | A | Not applicable | |
| 2.5.7 Dragging movements | AA | Supports | Reordering modules has buttons as well as drag |
| 2.5.8 Target size (minimum) | AA | Supports | Checked by the axe target-size rule; buttons are at least 24 x 24 CSS px with spacing |
| 3.1.1 Language of page | A | Supports | `lang` follows the chosen locale (en or es) |
| 3.1.2 Language of parts | AA | Partially supports | Family-facing screens are fully translated; staff screens stay English and are marked as such in the language switcher's note |
| 3.2.1 On focus / 3.2.2 On input | A | Supports | No context change on focus; selects that filter lists do so without moving focus |
| 3.2.3 Consistent navigation / 3.2.4 Consistent identification | AA | Supports | One navigation, one pattern per action |
| 3.2.6 Consistent help | A | Supports | The same help link and the same disclaimer placement on every screen |
| 3.3.1 Error identification / 3.3.3 Error suggestion | A/AA | Supports | Problem details are shown in an alert with the field named |
| 3.3.2 Labels or instructions | A | Supports | |
| 3.3.4 Error prevention (legal, financial, data) | AA | Supports | Erasure has a 30-day grace period and a legal hold; grading has confirm steps; report cards publish explicitly |
| 3.3.7 Redundant entry | A | Supports | Forms remember what was typed on failure; the family switcher and filters persist |
| 3.3.8 Accessible authentication (minimum) | AA | Supports | Password managers work; no cognitive tests; MFA by authenticator app or recovery code, both pasteable |
| 4.1.2 Name, role, value | A | Supports | Custom tabs are a radiogroup; progress bars carry `aria-valuenow`; live regions on chat and status |
| 4.1.3 Status messages | AA | Supports | Saves, sends and queue states use `role="status"` |

## 3. Accommodations the product adds

Beyond conformance, a student's accommodation plan (slice 12) switches on large text, reduced motion, reduced distraction (hides optional cards), read-aloud on lesson text, and extended time on due dates, for that student only.

## 4. Known exceptions

- PDF exports (report cards, transcripts) are not tagged PDF. The same data is on screen in accessible form.
- H5P content accessibility depends on the content type and the author; the editor lists the H5P library's own conformance.
- Staff-only screens are English only (3.1.2 partially supports) until the staff language pass.
- Charts in Insight are SVG with a text alternative; the data points are not individually focusable (the table below each chart carries the numbers).

## 5. Latest results

Filled in by the slice that last ran the audits (see docs/07 for the date).

| Audit | Result |
|---|---|
| Desktop axe, six roles | 7 October 2026: 167 pages, 0 violations |
| Phone axe, five roles | 7 October 2026: 93 pages, 0 violations (fixed on the way: a low-contrast course title on the Insight class list; scrolling tables made keyboard reachable with role=region and tabindex) |
| Reflow and 200% zoom | 7 October 2026: no horizontal page scroll at 360 px on any page, no clipped text at 200% (fixed on the way: the app header, planner and calendar controls, the standards list, the class roster table and the grades table) |
| Skip link flow | 7 October 2026: Tab lands on the skip link first; Enter moves focus to main |
