# Writer workspace discovery

Date: 2026-09-12

The authoritative scope is `augmentedquill-writer-goal.md`. The author has chosen `/home/william/projects/AugmentedQuill_fork/` and requested consolidation of any prior work here. At admission the folder contains only the goal file. The earlier source review checkout at `/tmp/writing-ide-review-20260912/AugmentedQuill` is clean; it contains no unpublished implementation to migrate. The former Documents goal file is absent; the destination goal file is present.

Build an AugmentedQuill fork that connects exact manuscript caret/selection context to non-mutating workshop discussion, explicit checked application, undo/recovery, scoped canon/lore, and tested SillyTavern World Info compatibility. Preserve the full nine-item acceptance criteria, including a headed real-local-model session, required checks, imports, migration/recovery and maintainable handoff.

Baseline: reviewed develop commit `e9e272f7446afdd0dd31652d5aec32714929c73a`. Verify actual checkout before edits. Preserve book originals, existing inference processes, and SillyTavern at port 8000. All test projects and model fixtures isolated. New local ports selected after inspecting listeners. GitHub account `sillyWillieBilly` is authenticated; the intended named fork does not yet exist. Goal explicitly authorizes fork, development branches and focused commits.

Discovery questions for source review: editor raw/visual range mapping and focus persistence; chapter load/save/version/undo paths; strict read-only tool permissions; streamed proposal transport; Sourcebook persistence/schema extension; supported SillyTavern match/recursion semantics and lossless JSON round trip; context inspector with scope/budget reasons.

Validation: write invariant tests before implementation, run focused tests per change, then repository mandatory validation and browser acceptance. A fake-model smoke test is distinct from real-model evidence. Obtain source-grounded plan review before implementation and final independent review before completion. Apply this environment's available agent roles to the review responsibilities.

Author steering: use the OpenAI article on rethinking prompts and skills for GPT-6 Astra to streamline project AGENTS.md, and prepare Git plus useful development conveniences. The scoped project guide now replaces generic fixed review cascades with independent reviews for consequential changes while retaining full acceptance. Setup, local launch, generated types and check commands are documented in `docs/DEVELOPMENT.md`.
