# 18. Breach-notification runbook

What to do, in order, when personal data may have left the boundary the school controls. It is written for the principal, the district's technology lead and whoever runs SmartSchool for them. The product keeps the record of the incident under Compliance > Incidents (slice 19); this document is the procedure around it.

## 1. The clock

| Severity | Tell the district | Tell families and the state | Who decides severity |
|---|---|---|---|
| critical (credentials or many students' records exposed) | within 24 hours of detection | within 72 hours of confirming exposure | the principal, with the district lead |
| high (a device or export with student data lost, a wrong recipient for many records) | within 24 hours | within 72 hours of confirming exposure | the principal |
| medium (one family's records shown to another, a misdirected email) | within 72 hours | within 72 hours of confirming exposure, to the people affected | the principal |
| low (no personal data confirmed exposed) | within 72 hours | only if exposure is later confirmed | the principal |

State laws set their own outer deadlines (for example 30, 45 or 60 days after discovery); the district's counsel confirms which apply. Our 72-hour clock is inside every one of them. The clock starts at **detection**, which is the moment someone at the school or the vendor learns of the event, not the moment it is understood.

## 2. The first hour

1. **Open an incident** in SmartSchool: Compliance > Incidents > Open an incident. Title, severity, what happened, an estimate of people affected, the data categories. The product stamps the detection time and shows both deadlines.
2. **Contain.** Revoke the session or token (Users > the account > sign out everywhere), rotate the join code, disable the SSO provider or wipe the device as the case needs. Write each step on the incident's timeline as you do it.
3. **Preserve evidence.** Do not delete logs. Audit logs are under Audit logs; export them (Audit logs > Export) for the window around the event.
4. **Tell the people who need to act now**: the district lead and the vendor. Compliance > Incidents > Notify administrators sends every principal of the school and every district role an in-app notice and an email, and stamps the clock.

## 3. The first day

- **Scope it.** Which tables, whose records, how many people, what time window. The data map (Compliance > Data map, docs/17) says what each table holds. Record the numbers on the incident.
- **Decide if it is a breach.** Exposure means the data was readable by someone without a legitimate educational interest. Encrypted backups lost with the key intact are not exposure. Write the reasoning on the timeline.
- **Mark it contained** once the hole is closed. The timeline shows when.

## 4. Notifying families and the state

- Write the notice in plain language, in English and Spanish: what happened, what data, when, what the school has done, what families can do, whom to call. Use the data categories recorded on the incident.
- Send it through SmartSchool messaging to the guardians of every affected student (Messages > New, to the affected classes or families) and by letter where the school's policy requires one.
- File with the state education agency and, where the law says so, the state attorney general, using the district's templates.
- Set the incident to **notified** on the day the notices go out; the product records the time.

## 5. Afterwards

- **Close** the incident with a final timeline entry: root cause, what changed so it cannot repeat, what it cost.
- Review the data map and retention settings: less data kept for less time is less data to lose.
- If a vendor was involved, record it against the data-privacy agreement.

## 6. What the product guarantees

- Every incident, every status change and every notification is in the audit log with who did it and when.
- Incidents move forward only (open, contained, notified, closed) so a timeline cannot be rewritten.
- Notify administrators always emails, whatever a recipient's notification preferences say.
- Nothing in SmartSchool deletes evidence on its own during an incident: retention jobs remove old rows by age, never by content, and a legal hold on a student stops any erasure.

## 7. Contacts to fill in

| Role | Name | Phone | Email |
|---|---|---|---|
| Principal | | | |
| District technology lead | | | |
| District counsel | | | |
| SmartSchool operator | | | |
| State education agency privacy office | | | |
