# Goal: Build a precise, lore-aware writing workspace on AugmentedQuill

Set a persistent goal to deliver a working first version of my writing workspace by forking AugmentedQuill. Carry the work through implementation, tests, and a usable local launch. Make normal engineering decisions independently; ask only when a missing decision or access requirement materially blocks progress.

## The experience I want

I am writing a novel. Antigravity has been too buggy and frustrating, and SillyTavern's interface does not provide the editing precision I need. I want to leave my cursor in a sentence or select a passage, say “I don't like this line; let's workshop it,” discuss alternatives with the AI while it understands the surrounding prose and relevant world lore, and apply my chosen wording to that exact passage.

The manuscript remains the central document. Conversation supports editing it. Lore, character knowledge, and continuity must be integrated into that same workflow.

## Starting point and authorized scope

- Upstream: https://github.com/StableLlamaAI/AugmentedQuill
- Reviewed base: develop commit e9e272f7446afdd0dd31652d5aec32714929c73a. Verify that commit and record the actual starting revision. Inspect newer upstream changes before adopting them; do not silently change the baseline.
- Relevant open requests at the time of review: https://github.com/StableLlamaAI/AugmentedQuill/issues/263 and https://github.com/StableLlamaAI/AugmentedQuill/issues/258.
- Create the fork using my existing authenticated GitHub account when the destination is unambiguous. Work in a dedicated project directory under /home/william/projects, inspecting any existing directory before reusing it. This goal authorizes the fork, development branches, and focused commits needed for this work. Use the codex/ branch prefix. If remote access is unavailable, prepare the local development checkout and continue independent work while resolving that specific access requirement.
- Read the repository's AGENTS.md and relevant nested instructions. Keep an upstream remote and retain license and attribution notices.
- Reuse AugmentedQuill's React/TypeScript frontend, CodeMirror editor, FastAPI backend, Sourcebook, project storage, and existing history facilities wherever they fit. Begin with the existing writing interface and improve the missing behaviour.
- Preserve the existing SillyTavern installation at http://127.0.0.1:8000/. Use separate loopback ports and isolated runtime data for this project.
- My manuscript repository is /home/william/Nextcloud/Book/The Serpentine Path. Treat its originals, draft variants, author notes, and unsaved editor buffers as protected. Build and test with synthetic projects. A book trial must use separate copies and must not modify or publish the originals.

## Required behaviour

### 1. Precise passage context

Capture a fresh context snapshot when I send a workshop request: project and document identity, chapter and scene, caret or selection range, exact original text, surrounding prose, and a document revision or content fingerprint.

For a caret without a selection, resolve the sentence at the caret, with an explicit paragraph fallback when sentence boundaries are ambiguous. Show the targeted text so I can see and adjust what “this line” means. Preserve the last manuscript position when focus moves to chat. Changing chapters must never redirect an outstanding proposal to another document.

Keep the target attached throughout the conversation. Make it possible to discuss several alternatives and refine one without repeatedly copying text into chat. Use a documented offset convention across JavaScript and Python, including Unicode and scene/annotation markers. Raw, Markdown, and visual modes must refer to the same underlying manuscript range.

### 2. Workshop, proposal, and application

Provide a workshop mode that discusses and proposes wording without mutating prose or canon. Enforce this boundary through application/tool permissions, not only through an LLM instruction.

Show alternative wording and a focused comparison with the original. Let me apply a chosen proposal, reject it, or continue discussing it. Application must change only the intended passage, preserve surrounding content and structural markers, and participate in undo/redo and recovery history.

Handle intervening edits explicitly. Rebase a target only when its identity and original text remain provably correct; otherwise keep the proposal and explain the conflict. Never fall back to replacing the first matching sentence, rewriting the chapter, or overwriting a newer editor buffer or disk file.

### 3. Lore that participates in writing

Keep and extend the Sourcebook for characters, locations, organizations, objects, events, and world rules, including aliases, relationships, and source references.

Distinguish accepted canon, character beliefs or rumours, and proposed additions. Generated lore starts as a proposal unless I explicitly request a canon change. Support scene/chapter, viewpoint, and timeline scope so a character does not receive knowledge they should not yet have. This is explicit metadata and context selection; do not claim the system can automatically determine fictional truth.

Build a testable context-selection layer that combines the anchored passage, nearby prose, applicable story guidance, and relevant lore within the configured model's context budget. Include a context inspector showing what was sent, what was excluded, why each entry was selected, and how budget limits affected the result. Identify estimated token counts as estimates.

### 4. SillyTavern lorebook compatibility

Use SillyTavern World Info as a compatibility reference: https://github.com/SillyTavern/SillyTavern. The reviewed release commit was 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8.

Its important lore activation and prompt-building logic lives in public/scripts/world-info.js and depends on browser state. Its server's World Info endpoints mainly manage stored files. Do not assume that calling the existing server gives us a complete headless lore engine.

Inspect the dependency and license implications, then choose a maintainable implementation or adaptation behind a small, explicit interface. Avoid making the writing workflow depend on automating a hidden SillyTavern browser tab.

Implement import and export of SillyTavern World Info JSON, preserving original IDs, metadata, activation fields, and unknown fields through round trips. V1 must support enabled/disabled and always-included entries, keyword/alias activation, primary and secondary matching conditions, inclusion/exclusion, priorities, bounded recursion, and a lore token budget. Document and test the exact supported semantics against a pinned upstream reference.

Preserve and visibly identify any advanced behaviour that is not yet implemented, such as particular probability, timing, macro, or insertion-placement options. Do not silently discard those settings or claim full compatibility. Record unsupported features as follow-up work; if a trial lorebook relies on them, make the limitation visible before use.

### 5. Local models and durable projects

Discover existing suitable local-model endpoints read-only and support their OpenAI-compatible connections. Make model roles and connection errors understandable. Do not assume the SillyTavern frontend port is the model endpoint. Avoid downloading model weights or restarting/reconfiguring existing inference services as a routine setup step.

Keep projects understandable on disk with Markdown prose and explicit metadata. Preserve recovery checkpoints and handle failed saves and external modifications. Any schema change must include a tested migration. Provide a copy-based manuscript import path that keeps originals intact.

## Execution approach

First write a concise implementation plan and establish the baseline in the dedicated checkout. The earlier review passed 84 focused frontend tests, 135 backend tests, and three browser smoke tests using a mock model. Those are historical baseline results, not proof that new work passes or that a real local model works.

Deliver the first complete workflow early: caret or selection -> captured passage and relevant lore -> workshop conversation -> proposed wording -> explicit application -> undo. Then complete the lorebook compatibility, scope controls, context inspector, and persistence work. Keep changes small enough to review and maintain a short implementation/status document with decisions, completed checks, and remaining gaps.

Use meaningful tests for the editing and lore invariants. Run the repository's required checks for the resulting changes. Use headed browser inspection for the actual writing flow; API tests and screenshots of the upstream documentation do not establish usability.

## Acceptance criteria

The goal is complete when all of the following are demonstrated:

1. From a fresh local launch, I can open a sample project, leave the caret in a sentence, move to chat, and ask to workshop “this line” with the correct target visibly attached.
2. Explicit selections, caret-only targets, repeated identical sentences, Unicode, visual/Markdown modes, and scene/annotation markers all resolve to the intended underlying text.
3. Workshop discussion and regeneration leave manuscript and canon unchanged. Applying an alternative changes only the target passage; undo and redo work correctly.
4. Editing while generation is running, changing chapters, and modifying the file externally cannot cause stale or misdirected replacement. Conflicting proposals remain available for review.
5. Relevant lore is included, out-of-scope knowledge is excluded according to explicit rules, and the context inspector explains the decision and budget usage. Proposed lore is not silently promoted to canon.
6. Supported SillyTavern activation rules pass fixture-based tests. Import/export preserves unsupported fields, and unsupported behaviour is clearly surfaced.
7. Saving, reopening, recovery, and migrations preserve prose, lore, and document structure. A copy-based import leaves source manuscript files unchanged.
8. The complete workshop-and-apply flow works in a headed browser with an actual configured local model, including useful error/cancellation behaviour. Keep mock-based checks and real-model evidence separate. If model access is missing, finish independent work and request the specific missing input; do not report the goal complete on mocks alone.
9. Relevant automated checks pass, material failures are resolved or explicitly accepted by me, and the deliverable includes the fork/branch/commit, reproducible launch instructions, exact tested runtime, and a concise list of remaining limitations.

Deliver a usable local first version and a clean handoff. Do not stop at a plan, a visual mockup, disconnected UI controls, or an untested prototype. Keep me informed at meaningful milestones and surface failures promptly.
