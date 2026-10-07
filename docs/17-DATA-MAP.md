# 17. Data map

What SmartSchool holds about people, whose it is, why, where, and for how long. This is the published copy of the map the product generates live under Compliance > Data map (with row counts for the school). It is written for families and for the district's privacy office; the source of truth is `apps/api/src/modules/compliance/compliance-rules.ts`, and the unit test there fails if a table is listed twice.

Nothing in this map is sold, used for advertising, used to profile students for non-educational purposes, or used to train models. The AI model runs inside the school's or district's own boundary (docs/13 section 10).

## Retention switches

A school sets these under Compliance > Retention; a nightly job removes rows older than the window. Education records (grades, attendance, report cards, support plans) are not on a timer: they stay with the student until a deletion request is approved, or until the "withdrawn students" window if the school sets one.

| Switch | Default | Allowed |
|---|---|---|
| AI tutor conversations | 365 days | 30 to 1825 |
| In-app notifications | 180 days | 30 to 730 |
| Audit log | 1095 days | 365 to 3650 |
| Learning records (xAPI) | 1095 days | 365 to 3650 |
| Push delivery logs | 60 days | 7 to 365 |
| Withdrawn students | 0 (only on request) | 0 to 3650 days after withdrawal |

## Tables

| Table | Holds | Whose | Purpose | Legal basis | Kept | Where |
|---|---|---|---|---|---|---|
| Users | Name, email, role, sign-in and MFA details, locale | everyone | Accounts and sign-in | School official with a legitimate educational interest (FERPA); contract | with the record | database |
| Students | Name, student number, grade level, date of birth, learning preferences, status | student | The education record | FERPA education record | withdrawn-students switch | database |
| StudentGuardians | Which adult is responsible for which student | guardian | Family access and notices | FERPA parent rights | with the record | database |
| ClassEnrollments | Class membership and current grade | student | Teaching and grading | FERPA education record | with the record | database |
| AssignmentSubmissions | Submitted text and attached files | student | Grading | FERPA education record | with the record | database and file store |
| Grades | Scores, letters, feedback | student | Grading and report cards | FERPA education record | with the record | database |
| Attendance | Daily and period attendance | student | Attendance and state reporting | FERPA education record; state law | with the record | database |
| ReportCards | Term grades, GPA, comments | student | Report cards and transcripts | FERPA education record | with the record | database |
| Accommodations | Support plans and accommodations | student | Delivering accommodations | FERPA; IDEA and Section 504 | with the record | database |
| BehaviorRecords | Behaviour notes | student | Support and family communication | FERPA education record | with the record | database |
| CounselorNotes | Counselor notes | student | Counseling (sole-possession notes, not shared) | FERPA sole-possession exemption | with the record | database |
| AiConversations | Tutor conversations and messages | everyone | AI tutoring and teacher assistance | COPPA consent for under-13; school policy | AI conversations switch | database and AI service logs |
| AiConsents | Consent decisions for AI features | student | COPPA compliance | COPPA | with the record | database |
| Messages | Messages between staff, families and students | everyone | School communication | School policy | with the record | database |
| Notifications | In-app notices | everyone | Notices | School policy | notifications switch | database |
| PushDevices | Device push tokens | everyone | Push notifications | Consent by registering the device | with the record (silent devices switched off after 90 days) | database |
| PushLogs | Push delivery results | everyone | Troubleshooting delivery | School policy | push logs switch | database |
| XapiStatements | Learning records (what was attempted, scores, time) | student | Learning analytics and mastery | FERPA education record | learning records switch | database |
| SrsCards | Practice cards and reviews | student | Spaced practice | FERPA education record | with the record | database |
| MasteryLevels | Mastery per standard | student | Insight for teachers and families | FERPA education record | with the record | database |
| RewardTransactions | XP, badges, streaks | student | Private motivation | School policy | with the record | database |
| AuditLogs | Who did what, when, from where | everyone | Security and accountability | Security; state privacy law | audit log switch | database |
| FileUploads | Uploaded files and their owners | everyone | Submissions and content | FERPA education record | with the record | database and file store |

## Rights the product supports

- **A copy of the records (FERPA).** A guardian, the student, a counselor or an administrator downloads a zip of JSON files per section from the family home or the student page (`GET /students/{id}/records-export.zip`). Counselor sole-possession notes and other families' data are never included. Every export is audited.
- **Erasure.** A guardian, the student or an administrator asks; an administrator approves or declines; approved requests are carried out after a 30-day grace period, or at once. A legal hold on the student blocks erasure until it is lifted. What goes is listed on the request itself.
- **Consent for AI (COPPA).** Recorded per student under Support; the tutor refuses to start without it for students under 13 when the school's default requires it.
- **Breach notice.** docs/18.
