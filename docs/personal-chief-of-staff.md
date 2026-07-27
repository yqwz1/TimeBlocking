# Personal chief of staff

The advanced Second Brain is a local-first intelligence layer over the existing TimeBlocking database and Markdown vault. Markdown remains the note source of truth. Existing note concepts, graph edges, communities, and embeddings remain rebuildable indexes.

## Safety model

- Retrieved notes and communication excerpts are untrusted data. They are delimited in the assistant prompt and cannot grant permission or execute tools.
- Confirmed memories may support factual answers. Candidates are labelled as unconfirmed and cannot drive important actions.
- Every assistant source is a stable `knowledge_record`; answers return accessible citations, memories used, uncertainties, and proposed actions.
- Mutations are persisted as `action_proposals`. Execution requires an explicit approval request, validates source freshness, and uses an idempotency key.
- Communication sending is critical-risk and requires final-preview confirmation. An unavailable provider fails closed.
- Connector records store metadata, hashes, summaries, and bounded evidence excerpts—not a permanent full-message mirror.

## Main modules

- `assistant/foundation.ts`: source normalization, durable entities, explainable memory, evidence, contradiction, expiry, and forgetting.
- `assistant/retrieval.ts`: cross-domain lexical, semantic, recency, validity, confidence, and source-diversity ranking.
- `assistant/runtime.ts`: durable threads, bounded conversation context, cited answers, explicit remember/forget commands, and proposal persistence.
- `assistant/modelGateway.ts`: structured output validation, retries, caching, prompt versions, model selection, and AI-run telemetry.
- `assistant/jobs.ts`: leased durable jobs with retries, checkpoints, deduplication, progress, and visible failures.
- `assistant/actions.ts`: proposal lifecycle, freshness checks, approval, and at-most-once local execution.
- `assistant/connectors.ts`: shared Gmail, Outlook, Slack, and Teams adapter contract with opt-in scopes and deletion controls.
- `assistant/briefings.ts`: daily command brief, weekly review, commitment risks, calendar conflicts, quiet hours, cooldowns, and notification budget.
- `assistant/indexing.ts`: build-then-activate embedding versions so a model change never replaces the active index mid-build.

## Feature flags and rollback

The settings `assistantEnabled`, `assistantMemoryEnabled`, `assistantActionsEnabled`, `assistantProactiveEnabled`, and `assistantConnectorsEnabled` independently control rollout. If `assistantEnabled` is off, `/notes/chat` continues to use the legacy Vault Chat implementation.

## API groups

- `/api/assistant/threads`, `/api/assistant/chat`, and message feedback
- `/api/assistant/memories`, source inspection, onboarding, entities, and relations
- `/api/assistant/proposals` approval and rejection
- `/api/assistant/commitments` and `/api/assistant/decisions`
- `/api/assistant/connectors` configuration, sync, disconnect, and imported-knowledge deletion
- `/api/assistant/briefings/daily`, `/api/assistant/briefings/weekly`, and `/api/assistant/insights`
- `/api/assistant/jobs` and `/api/assistant/indexes`

Provider-specific OAuth and transport code plugs into `ConnectorAdapter`. Until a provider adapter is configured, authentication, sync, drafting, and sending fail closed while all local intelligence features continue to work.
