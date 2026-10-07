# SmartSchool Integration Contracts

> **1 October 2026:** the AI boundary is being rebuilt to [10-AI-SYSTEM-DESIGN.md](10-AI-SYSTEM-DESIGN.md) (ADR-021). The LMS-to-AI calls and the AI callbacks described below are the previous contract; they are replaced by the Context and Result Envelopes and the AI service v1 interface in that document when slice 5 lands, and the three H5P callback routes are retired (ADR-022).

**Version:** 1.1, 30 September 2026
**Purpose:** every boundary the system crosses, with the exact contract on both sides. Changing anything here requires updating the other side and the contract tests. LMS routes named here follow docs/09 (`/api/v1/...`); the three AI callback routes keep their previous paths (ADR-017).

---

## 1. LMS API to AI service (HTTP)

**Transport.** HTTP JSON. Base URL from configuration (`AI_SERVICE_URL`, default `http://localhost:8000`). Optional `X-API-Key` header when the AI service has `ALLOWED_API_KEYS` set.
**Resilience.** 30 s timeout by default, 120 s for generation and multimodal routes; three retries with backoff on network errors and 5xx; circuit breaker opens after 5 failures in a minute for 30 s; on open circuit the LMS returns 503 with `{ message: "AI service unavailable" }`.
**Errors.** The AI service returns FastAPI `{ detail }` on 4xx and 5xx. The LMS never forwards Python tracebacks to clients.

### 1.1 Calls the LMS makes

| LMS feature | AI route |
|---|---|
| Tutor chat | `POST /api/ai/tutor/chat` |
| Similar examples | `POST /api/ai/tutor/similar-examples` |
| Prerequisites | `POST /api/ai/tutor/check-prerequisites` |
| Learning path | `POST /api/ai/tutor/learning-path`, `POST /api/ai/tutor/progress`, `POST /api/ai/tutor/record-performance` |
| Content generation | `POST /api/ai/generate/content`, `structured-quiz`, `structured-flashcards`, `structured-fill-in-blanks`, `structured-video-script`, `regenerate` |
| H5P conversion | `POST /api/ai/convert/h5p` |
| Content validation | `POST /api/ai/validate/content` |
| Batch generation | `POST /api/ai/batch/generate`, `GET /api/ai/batch/status/{id}`, `GET /api/ai/batch/results/{id}` |
| Essay grading | `POST /api/ai/grade/essay`, `POST /api/ai/assessment/grade-essay` |
| Code evaluation | `POST /api/ai/assessment/evaluate-code` |
| Plagiarism | `POST /api/ai/assessment/check-plagiarism` |
| Analytics | `POST /api/ai/analytics/predict-performance`, `recommend-interventions`, `analyze-patterns` |
| Recommendations | `POST /api/ai/recommendations/generate` |
| Cache admin | `GET /api/ai/cache/stats`, `POST /api/ai/cache/clear` |
| Superintendent | `POST /api/superintendent/chat`, `report`, `insights`, `quick-stats`, `chart` |
| RAG generate | `POST /api/ai/rag/generate` |
| RAG search | `GET /api/ai/rag/curriculum/search?query=&subject=&grade_level=&n_results=` (the previous LMS called a non-existent `/api/rag/query`) |
| RAG index | `POST /api/ai/rag/curriculum/index` (single), `POST /api/ai/rag/curriculum/index-all-k12` (bulk), `POST /api/ai/embed/content` (arbitrary content) (the previous LMS called non-existent `/api/rag/index*`) |
| Emotion | `/api/ai/emotion/*` (consent, analyze, session, history, delete) |
| Accessibility | `/api/ai/accessibility/*` (simplify, chunk, extend-explanation, screen-reader, alternatives) |
| Agents | `/api/agents/*` (status, statistics, health, workflows execute/status/active, tutor ask, content-creator quiz, learning-path recommend) |

The `AiClient` in `apps/api` wraps every AI route with a typed method, grouped as in the build plan.

### 1.2 Request and response conventions

Requests use snake_case keys (Python side). The LMS maps camelCase DTOs to snake_case at the client boundary and back. Example, tutor chat:

```json
POST /api/ai/tutor/chat
{ "student_id": "…", "message": "…", "subject": "math", "grade_level": "8", "conversation_id": "…", "context": { "course_id": "…" } }

200
{ "answer": "…", "confidence": 0.85, "sources": ["…"], "conversation_id": "…", "suggested_actions": [] }
```

Structured generation returns typed JSON (questions with options, correct index and explanation; flashcards with front and back; blanks with answers and hints) plus `h5p_content_id` when the AI service stored an H5P package through the callback.

---

## 2. AI service to LMS API (HTTP callbacks)

**Transport.** Base URL from `DOTNET_API_URL` (default `http://localhost:5000`), used by `h5p_storage.py`. The variable name stays for compatibility with the retained Python code.

| Route | Purpose | Request | Response |
|---|---|---|---|
| `POST /api/ai/h5p/content` | Store generated H5P content | `{ title, library: "H5P.MultiChoice", libraryVersion: "1.16", parameters: {…}, contentType, metadata: { subject, gradeLevel, topic, difficulty, aiModel, sourceRequestId } }` | `201 { id, slug, libraryId }` |
| `POST /api/ai/h5p/validate` | Validate parameters against the library before storing | `{ library, parameters }` | `200 { valid, errors: [] }` |
| `GET /api/ai/h5p/libraries` | Discover installed libraries and versions | none | `200 [{ name, majorVersion, minorVersion, patchVersion, runnable }]` |

Authentication for callbacks: a shared service token (`AI_CALLBACK_TOKEN` on the LMS, `DOTNET_API_KEY` on the AI service) in the `Authorization: Bearer` header; the LMS treats it as a system principal with `ai.content.generate`.

---

## 3. Socket hub contracts (client to LMS)

Handshake: `Authorization: Bearer <jwt>` header or `access_token` query parameter; unauthenticated connections are rejected. All payloads are camelCase JSON.

### 3.1 `/hubs/notifications`

| Direction | Event | Payload |
|---|---|---|
| client → server | `JoinOrganizationGroup`, `LeaveOrganizationGroup` | `organizationId` |
| client → server | `JoinClassGroup`, `LeaveClassGroup` | `classId` |
| client → server | `AcknowledgeNotification` | `notificationId` |
| client → server | `SendTypingIndicator` | `recipientId` |
| server → client | `NewNotification` | notification DTO |
| server → client | `UserTyping` | `userId` |

### 3.2 `/hubs/messaging`

| Direction | Event | Payload |
|---|---|---|
| client → server | `JoinConversation`, `LeaveConversation` | `conversationId` |
| client → server | `SendMessage` | `conversationId, content` |
| client → server | `ReplyToMessage` | `conversationId, content, replyToMessageId` |
| client → server | `Typing`, `StopTyping` | `conversationId` |
| client → server | `MarkAsRead` | `messageId, conversationId` |
| client → server | `MarkConversationAsRead` | `conversationId` |
| client → server | `EditMessage` | `messageId, conversationId, newContent` |
| client → server | `DeleteMessage` | `messageId, conversationId` |
| client → server | `NotifyParticipantAdded`, `NotifyParticipantRemoved` | `conversationId, userId` |
| client → server | `UpdateStatus` | `status` (Online, Away, Busy, Offline) |
| client → server (ack) | `GetOnlineUsers`, `GetUserStatus` | none / `userId` |
| server → client | `ReceiveMessage` | `{ id, conversationId, senderUserId, content, type, createdAt, isEdited, replyToMessageId, replyToMessage? }` |
| server → client | `UserTyping`, `UserStoppedTyping` | `{ userId, conversationId }` |
| server → client | `MessageRead`, `ConversationRead` | `{ messageId | conversationId, userId, readAt }` |
| server → client | `MessageEdited`, `MessageDeleted` | `{ messageId, conversationId, newContent?, editedAt? }` |
| server → client | `ParticipantAdded`, `ParticipantRemoved`, `AddedToConversation`, `RemovedFromConversation` | `{ conversationId, … }` |
| server → client | `UserOnline`, `UserOffline`, `UserStatusChanged` | `{ userId, userName, status, timestamp | lastSeen }` |
| server → client | `MessageError` | `{ error }` |

### 3.3 `/hubs/agents`

| Direction | Event | Payload |
|---|---|---|
| client → server | `SubscribeToAgent`, `UnsubscribeFromAgent` | `agentId` |
| client → server | `SubscribeToMessageType` | `messageType` |
| client → server | `SubscribeToAllAgents` | none |
| client → server | `SendMessageToAgent` | `targetAgentId, messageType, payload` |
| client → server | `BroadcastMessage` | `messageType, payload` |
| client → server | `GetAgentStatus`, `GetAgentDetails`, `GetAgentsByCapability` | none / `agentId` / `capability` |
| client → server | `StartWorkflow` | `workflowName, parameters` |
| client → server | `CancelWorkflow` | `workflowId` |
| server → client | `Connected`, `Subscribed`, `Unsubscribed`, `SubscribedToMessageType`, `SubscribedToAll` | `{ …, timestamp }` |
| server → client | `MessageSent`, `MessageBroadcast` | `{ messageId, correlationId, targetAgent?, messageType, timestamp }` |
| server → client | `AgentStatusUpdate` | `{ timestamp, totalAgents, activeAgents, agents: [{ id, name, type, status, capabilities, messagesProcessed, lastActiveAt }] }` |
| server → client | `AgentDetails`, `AgentsByCapability`, `AgentNotFound` | agent DTOs |
| server → client | `WorkflowStarted`, `WorkflowStepUpdate`, `WorkflowCompleted`, `WorkflowCancellationRequested` | `{ workflowId, workflowName, step?, status?, timestamp }` |
| server → client | `AgentResponse` | `{ correlationId, success, message, data, errorCode, suggestedActions, processingTimeMs }` |
| server → client | `Error` | `{ message }` |

The LMS relays these to and from the AI service's `/api/agents/*` routes and, when RabbitMQ or Redis Streams is configured, subscribes to the agent bus directly.

### 3.4 `/hubs/collaboration`

Document rooms with presence, cursor positions, change broadcasting and comment events; used by the content library's collaborative editing.

---

## 4. Agent message protocol (inside the AI service, relayed by the LMS)

```json
{ "id": "msg-…", "sourceAgentId": "tutor-agent", "targetAgentId": "content-agent | *", "messageType": "content.generate", "payload": "{…json…}", "timestamp": "ISO-8601", "correlationId": "req-…", "priority": 0, "metadata": { "studentId": "…", "sessionId": "…" } }
```

Message types follow `{domain}.{action}`: `content.generate|analyze|update`, `tutor.explain|answer|guide`, `assessment.create|grade|feedback`, `path.generate|recommend|update`, `engagement.notify|reward|analyze`, `h5p.generate|transform`, `system.status|health|config`. Responses use `AgentResponse` (`success, message, data, errorCode, suggestedActions, timestamp, processingTimeMs`). Rate limits: 100 per minute per agent, 500 per minute per user, 10 broadcasts per minute. Priority 0 to 10.

---

## 5. Webhooks (LMS to external systems)

**Organisation webhooks** (`/api/v1/Webhooks`): subscriptions carry `EndpointUrl`, `Secret`, event filters and `IsActive`. Delivery every two minutes; payload:

```json
{ "id": "evt-…", "eventType": "grade.posted", "entityType": "Grade", "entityId": "…", "organizationId": "…", "occurredAt": "ISO-8601", "data": { … } }
```

Headers: `X-Webhook-Event`, `X-Webhook-Id`, `X-Webhook-Signature` (`sha256=` HMAC of the raw body with the subscription secret), `X-Webhook-Timestamp`. Retries with exponential backoff (1, 2, 4, 8, 16 minutes) up to the subscription's retry limit; deliveries recorded with status, attempts, response code and next retry.

Event types: `student.enrolled`, `student.updated`, `assignment.created`, `assignment.submitted`, `assignment.completed`, `grade.posted`, `attendance.marked`, `achievement.unlocked`, `ai.intervention.triggered`, `user.created`, `user.updated`, `course.created`, `enrollment.changed`.

**Tenant webhooks** (`/api/TenantWebhook`) follow the same envelope with `tenantId` and tenant event subscriptions.

---

## 6. Domain events (in-process)

| Event | Emitted by | Handlers |
|---|---|---|
| `AssignmentCompleted` | submissions, H5P results | notification to teacher; perfect-score achievement; XP; webhook row |
| `GradePosted` | grades | notification to student and parents; XP; webhook row |
| `AchievementEarned` | gamification | notification; leaderboard cache invalidation; webhook row |
| `LearningPathUpdated` | learning path repository sync | completion achievement; 50 percent milestone |
| `ContentUpdated` | content library, H5P | cache invalidation; re-index request to the AI service (`/api/ai/embed/content`) |
| `AIContentGenerated` | AI bridge | telemetry (tokens, latency); usage counters for billing |

Transport is in-process (`EventEmitter2`); Redis pub/sub when `REDIS_URL` is set.

---

## 7. Scheduled jobs

See the architecture document section 4.4 for the table. Contract: each job is idempotent, takes a lock in `JobRuns`, logs start and end with counts, and never throws past its boundary (failures are recorded, not propagated).

---

## 8. External providers

| Provider | Used for | Configuration | Disabled behaviour |
|---|---|---|---|
| SMTP or SendGrid | password reset, scheduled reports, notifications | `SMTP_*` or `SENDGRID_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME` | logs the email, returns success to callers |
| Twilio | SMS notifications | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | logs "Simulated SMS" |
| Firebase Cloud Messaging | push notifications (FCM v1, service-account JWT signed in process, no SDK) | `FIREBASE_SERVICE_ACCOUNT_JSON` | logs "Simulated push" and records a `simulated` push log; the interface reports `configured: false` |
| Stripe | tenant billing, invoices, webhooks | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | billing endpoints return records without charges |
| Google reCAPTCHA v3 | registration bot protection | `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_MIN_SCORE` | validation passes |
| Ollama | all inference (AI service only) | `OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL`, `OLLAMA_TIMEOUT` | AI service reports unhealthy; LMS AI endpoints return 503 |

A provider is enabled when its credentials are present; there is no separate enabled flag.

---

## 9. Configuration keys that must agree between services

| Concern | LMS (`apps/api`) | AI service (`apps/ai`) | Must match |
|---|---|---|---|
| Database | `DATABASE_URL=mysql://user:pw@127.0.0.1:3306/smartschooldb` | `DATABASE_URL=mysql+pymysql://user:pw@127.0.0.1:3306/smartschooldb` | host, port, database, credentials |
| AI base URL | `AI_SERVICE_URL=http://localhost:8000` | `APP_PORT=8000` | port |
| LMS base URL | `PORT=5000` | `DOTNET_API_URL=http://localhost:5000` | port |
| API key | `AI_SERVICE_API_KEY` | `ALLOWED_API_KEYS` | value, if set |
| Callback token | `AI_CALLBACK_TOKEN` | `DOTNET_API_KEY` | value |
| CORS | `CORS_ORIGINS` | `CORS_ORIGINS` | include the web client origin in both |
| Redis | `REDIS_URL` | `REDIS_URL` | optional; same instance if both set |
| Models | none | `OLLAMA_MODEL=llama3.1:8b`, `OLLAMA_VISION_MODEL=llava` | the LMS never names models |

---

## 10. Contract tests

- `tools/contract-diff.ts` replays recorded requests for every LMS-to-AI call and asserts the JSON structure of the response; runs in CI with recorded completions and nightly against a live Ollama.
- Socket contract tests connect two clients and assert every server-to-client event listed above fires with the documented shape.
- Webhook tests stand up a local receiver and assert headers, signature and retry schedule.
- Callback tests run the AI service's `h5p_storage.py` against the LMS test instance.
