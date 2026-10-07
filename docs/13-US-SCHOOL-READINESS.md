# US School Readiness

**Version:** 1.0, 2 October 2026. Status: binding for Release 2 and later (ADR-024, ADR-025).

SmartSchool is sold to US K-12 schools and districts. This document turns what those buyers require into concrete product requirements, so each one lands in a slice with tests instead of living in a checklist. It is the fourth document every slice is reviewed against, with 10 (AI), 11 (quality and security) and 12 (UX).

## 1. How a US school adopts software

1. The district already runs a **student information system (SIS)**: PowerSchool, Infinite Campus, Skyward, or similar. It is the legal record of students, staff, classes and enrolments. We never replace it; we read from it.
2. Students and staff already have **Google Workspace for Education** or **Microsoft 365** accounts and sign in to everything with them.
3. Most districts put a **rostering and single sign-on broker** in front of their apps: **Clever** (about two thirds of districts) or **ClassLink**. The broker passes the roster to approved apps and gives every user one login portal.
4. Purchasing asks for: a data-privacy agreement (often the Student Data Privacy Consortium's NDPA), FERPA and COPPA compliance statements, an accessibility conformance report (WCAG 2.2 AA), and evidence of security practice.
5. Teachers compare the product to Google Classroom, Canvas and Schoology, and expect their vocabulary: Assigned, Missing, Turned in, Returned; weighted categories; periods; report cards.

## 2. Rostering and sign-in (slice 9)

**Rostering is the primary way people and classes enter SmartSchool.** Manual creation, CSV import and join codes remain for pilots, parents and small schools.

| Requirement | Detail |
|---|---|
| OneRoster 1.1 import | CSV bundle and REST API. Objects: orgs, academic sessions (year, terms, grading periods), users (students, teachers, staff, parents as agents), courses, classes, enrollments, demographics (optional). Nightly sync with adds, changes and withdrawals. |
| Clever | Instant Login (SSO) and roster read through the Clever API; Secure Sync when a district pays for it. |
| ClassLink | OneRoster API read and LaunchPad SSO (OAuth 2). |
| Google and Microsoft sign-in | OpenID Connect. Accounts are matched by the rostered email; a synced account needs no SmartSchool password. |
| Managed records | Every synced user, student, class and enrolment carries `externalId`, `source` (sis, clever, classlink, oneroster, manual) and `managedBySis`. Managed fields are read-only in our screens and the API answers `409 record.managed` on edits. |
| Admin configuration | Organisation settings screen: enable providers, paste credentials, choose which schools and fields, run a dry-run sync, see the last sync report with per-row errors. |
| Identity rules | Email matching is exact after normalisation; a rostered user who already exists locally is linked, never duplicated. Role comes from the roster (student, teacher, staff, parent) and can be raised locally (principal, counselor). |

Costs: Google, Microsoft, ClassLink and Clever Instant Login are free to integrate. Clever Secure Sync, 1EdTech certification and SIS vendor partner programmes are paid and are taken up only when a district requires them.

## 3. School structure (slice 10)

- **Academic year, terms and grading periods** on every organisation, imported or entered. Classes belong to a term; assignments and report cards belong to a grading period.
- **Bell schedule**: periods or blocks with times and days; each class has a period. Attendance is taken per period.
- **Grade levels** are first-class (K to 12), with department and grade-level views for administrators.
- **School calendar**: days off, early release, term boundaries, class events, assignment due dates; iCal feed per user.

## 4. Gradebook and assessment (slice 11)

- Weighted categories per class (for example Homework 20, Quizzes 30, Tests 50), drop-lowest per category, extra credit.
- Marks: Assigned, Missing, Turned in, Returned, Excused, Late, Incomplete, matching Google Classroom vocabulary so teachers and students need no translation.
- Points-based by default; **standards-based grading** as a per-class option with proficiency scales.
- **Standards tagging**: Common Core, NGSS and state sets (starting with Texas TEKS and the states of the first pilots) on lessons, assignments and generated content. Standards are imported from the 1EdTech CASE format.
- **Report cards and progress reports** per grading period, printable to PDF, with comments; GPA on the district's scale.
- Late policy and syllabus visible to students and parents on the class page.

## 5. Attendance (slice 10)

- Period attendance with district code sets: present, tardy, excused absence, unexcused absence, remote, field trip, suspended; codes configurable per organisation.
- Daily deadline with "not yet taken" alerts to the office and the principal dashboard.
- Exports in the layouts state agencies request (average daily attendance, chronic absenteeism lists).

## 6. Students, support and safety (slice 12)

- **Accommodations** from IEP and 504 plans recorded on the student and applied in the product: extended time on timed activities, read-aloud, larger text, reduced-motion and reduced-distraction modes. Visible to the student's teachers only.
- **Counselor** role: caseloads, private notes invisible to teachers, access to the wellness queue.
- **Wellness routing**: when the tutor's safety classifier escalates (self-harm, abuse, danger), the conversation excerpt and student go to the counselor queue with an audit entry; the student sees the caring refusal that names a trusted adult. No emotion inference of any kind.
- **Behaviour records** with parent-visibility rules set by the school.
- Peer-to-peer private messaging stays off by default and is a school-level switch.

## 7. Parents (slice 13)

- Multi-child switcher; per-child grades, attendance, missing work, announcements, messages with teachers.
- Missing-work alerts and a weekly digest email, with per-category preferences already in place.
- **Spanish interface** first (about one in five US families), then other languages the pilots need; all user-facing strings externalised.
- Family-language lesson summaries generated from the teacher's lesson, labelled as AI-generated and reviewed by the teacher before release.

## 8. Teachers and AI (slices 14 to 16)

- Teacher insight from tutor traces: where the class is stuck this week, with a practice set ready to assign.
- Differentiation: the same quiz or reading at three reading levels in one action.
- Substitute access with an expiry date; weekly planner view.
- Export to Google Classroom and Canvas; LTI 1.3 tool so SmartSchool runs inside Canvas or Schoology where a district already has one. **Done in slice 21** (gradebook exports in the Canvas and Classroom layouts, Common Cartridge of a class, LTI 1.3 tool and platform, webhooks and API keys for district IT under Integrations).

## 9. Principals and districts (slices 17 and 20)

- Principal dashboard: attendance today, missing work by grade level, students failing by class, gradebook completeness, AI usage. **Done in slice 17** (`/insight`, scheduled CSV reports by email, PDF transcripts).
- District dashboard and cross-school reports; state reporting exports. **Done in slice 20** (`/district`: every school on one page, four cross-school CSVs, four student-level state exports in a state-neutral layout that the district maps to its state template; each export audited).
- District policy switches: AI features on or off per school, which roles may use which features, retention periods. **Done in slice 20** (`/district`, Policies: AI for the district or per school, student-to-student messaging, feature codes switched off district-wide, retention defaults; a district is a tenant, hosted on a subdomain or its own verified domain with its name and colour on the sign-in page).

## 10. Compliance (every slice, audited in slice 19)

Audited in slice 19 (7 October 2026): the data map is published (docs/17) and generated live with counts; retention is a school setting applied nightly; deletion on request runs end to end with a grace period and a legal hold; the FERPA records export exists for families and administrators; the breach runbook is docs/18 and the product records incidents on its clock; the accessibility conformance report is docs/19. Still open: the third-party penetration test and the signed SDPC agreement, both scheduled before the first district contract.

| Law or standard | What we do |
|---|---|
| **FERPA** | Education records are shown only to the student, their guardians, and school officials with a legitimate educational interest, which our feature permissions encode. Parents can request records; an export per student exists. Directory-information rules are respected in anything public. No student data is used to train models. |
| **COPPA** | For students under 13 the school consents on behalf of parents for core features; AI tutor and content features require recorded consent with a parent opt-out. We collect the minimum, keep it as long as the school says, and delete on request. |
| **State student-privacy laws** (California SOPIPA, Illinois SOPPA, New York Education Law 2-d and others) | No advertising, no sale of data, no profiling for non-educational purposes, breach notification, data map published, deletion on contract end. We sign the SDPC national data-privacy agreement. |
| **Section 508 and WCAG 2.2 AA** | Every screen passes an automated and a manual audit; an accessibility conformance report is published and updated per release. |
| **Data residency** | The AI model runs on the school's or district's own hardware or in a tenancy they control; student conversations never leave that boundary. |
| **Security** | The docs/11 checklist per slice; penetration test before the first district contract; audit log export for IT. |

## 11. Exclusions, with reasons (ADR-024)

| Not built | Why |
|---|---|
| Emotion detection and emotion-based SEL analytics on children | Legal exposure under state biometric and privacy laws, no evidence of benefit, and the first thing a board rejects. The tutor's escalation path covers the safety case. |
| Public leaderboards or any ranking of students visible to other students | Comparative display of minors' performance is a FERPA risk and harms the students at the bottom. Private XP, streaks, badges and class quests stay. |
| "Stakes" and betting-style mechanics on grades or outcomes | Resembles gambling for minors. |
| Recruiter and employer access to student data | Not appropriate for K-12 and incompatible with student-privacy agreements. |

## 12. Definition of ready for a US pilot

A school can be switched on when: rostering or SSO is configured for it, terms and periods exist, the gradebook categories match the teacher's syllabus, attendance codes match the district, consent is recorded for under-13 AI use, the accessibility report is current, and the data-privacy agreement is signed.
