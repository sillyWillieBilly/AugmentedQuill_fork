# Lore and SillyTavern compatibility

The writing workspace has two lore stores:

- Native Sourcebook entries remain in `story.json`. The optional `_lore`
  object attached to an entry carries a stable `entry_id`, `status`, explicit
  `scope`, activation settings, sources, and an optional belief actor. It is an
  additive extension, so an older project can still read and edit the ordinary
  Sourcebook fields. Existing Sourcebook rename code moves the entry object,
  which keeps `_lore.entry_id` attached to the renamed entry.
  No story schema version bump is needed: the existing entry schema accepts
  additional properties and the disk cleaner preserves `_lore` (including its
  `entry_id`). The focused rename and save tests cover that compatibility path.
- Imported SillyTavern World Info objects are copied into
  `lore/world-info/`. `index.json` maps the user-visible book name to a safe
  filename. The imported JSON object is retained as a raw envelope and is not
  passed through the story cleaner or the known-field Sourcebook response
  model.

The raw World Info API uses the format from the pinned SillyTavern release
`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`. General books use an `entries`
object keyed by UID; embedded Character Books can use an `entries` array. The
workspace preserves the complete top-level object, each entry's original UID,
extension values, and unknown fields. Export is semantic JSON round-trip
compatible. JSON whitespace and formatting are regenerated when a file is
written, so byte-identical formatting is not promised.

## Deterministic activation subset

`select_project_lore()` in
`src/augmentedquill/services/lore/activation.py` is the service contract used by
the Workshop:

```python
select_project_lore(
    project_dir,
    scan_text,
    scope=None,
    budget_tokens=None,
    include_beliefs=True,
    include_proposals=False,
    recursive=False,
    max_recursion_steps=0,
)
```

The result contains the selected entries, a decision record for every candidate,
the prompt context, estimated and configured token counts, warnings, and
unsupported-option notices. Selection is read-only and deterministic:

1. Enabled state, status, explicit book/chapter/scene/viewpoint/timeline scope,
   inclusive chapter/scene ranges, and inclusive timeline-position bounds are
   checked in a fixed order. A bounded timeline entry requires the target
   scope to provide `timeline_position`.
2. Constant entries are eligible without keywords. Other entries require a
   primary key or alias match.
3. Case sensitivity and whole-word behavior are applied per entry. A
   multi-word whole-word key follows SillyTavern's substring behavior; a
   single-word key uses non-word boundaries.
4. Secondary keys use SillyTavern's four conditions: `AND_ANY`, `NOT_ALL`,
   `NOT_ANY`, and `AND_ALL`.
5. Entries are ordered by descending `order`, then book name and stable ID.
   Random probability and weighted group choices are not used.
6. Recursive passes are opt-in and bounded by `max_recursion_steps`. A visited
   set keyed by stable entry ID prevents cycles and duplicate activation. The
   current V1 selector applies recursion only when the request enables it; the
   SillyTavern per-entry `recursive` flag is retained and reported as
   unsupported until its pinned upstream semantics are verified.
7. Non-constant entries that would exceed the configured budget are excluded
   with a `budget_exceeded` decision. Constant entries remain included and
   produce a budget warning so “always included” remains visible.

Token values from this pure service are estimates. They use a stable character
heuristic because an exact model tokenizer is not guaranteed to be available at
selection time. The UI should label them as estimates and reserve space for
the anchored passage, nearby prose, story guidance, history, and model output
before assigning a lore budget.

New native entries default to proposal status and require an explicit author
promotion to become canon. Legacy native entries without `_lore.status` retain
the canon interpretation. Beliefs and rumours are included only when
`include_beliefs` is true and their explicit scope matches. Proposals are
excluded unless `include_proposals` is explicitly requested. This metadata is a
selection rule; the application does not infer whether a fictional assertion is
true.

## Preserved but unsupported World Info options

The importer retains advanced fields and reports them before use. V1 supports
enabled/disabled state, constant entries, primary keys, aliases, secondary
conditions, order/priority, bounded recursion, case/whole-word matching, and a
bounded lore budget. The following options are retained but are not executed:

- probability and `useProbability`;
- per-entry `recursive` activation (request-level bounded recursion is the only
  V1 recursion control);
- sticky, cooldown, delay, and delayed-recursion timing;
- weighted inclusion groups and group scoring;
- regex keys, macro substitution, and decorators;
- persona, character, scenario, creator-note, trigger, and character-filter
  scans;
- prompt placement, depth, role, outlet, AN, and EM insertion settings;
- vectorized activation, automation IDs, and `ignoreBudget`.

The warning contains the book, UID, and field, for example
`Pinned:17:probability`. This prevents an imported lorebook from silently
appearing to have full SillyTavern behavior.

## Reference and licensing

SillyTavern's behavior reference is `public/scripts/world-info.js` at the pinned
commit above. That file is browser-state dependent and is licensed under the
GNU Affero General Public License version 3. AugmentedQuill is licensed under
the GNU General Public License version 3. This workspace implements an
independent small selector from the observable behavior and uses the World Info
JSON format as an interchange format; it does not copy SillyTavern's source.
The pinned revision and license are recorded here for attribution and audit. If
future work adapts source code rather than behavior, preserve its notices and
obtain a combined-license review before distribution.
