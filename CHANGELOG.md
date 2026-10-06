# Change log

Record meaningful project decisions and changes here, newest first. Include the date, what changed, and the reason or context.

## 2026-10-06 — General group-assignment wording

- Reframed the app and project description for general group assignment rather than accommodation-specific use.
- Replaced accommodation terminology in the interface, dialogs, validation messages, generated assignment labels, and project documentation with group terminology.
- Described size limits as people per group and renamed the browser engine namespace to PBGAT.
- Added a default-checked “Single-sex groupings only” option. When unticked, the engine allows mixed-sex groups while continuing to enforce vetoes, group capacity, and the no-singleton rule.
- Allowed cross-sex preference and veto references in the CSV, reporting them as warnings so the user can choose whether mixed-sex groups are permitted.

## 2026-10-06 — Basic and advanced display modes

- Basic mode now hides the validation continuation explanation, response preview, spare-capacity note, search seed, engine analysis, and expanded result details.
- Advanced mode retains those details; the engine analysis is shown directly without its former expand/collapse control.
- Kept validation and assignment behavior the same across both modes and made visibility respond to mode changes without resetting the current data.
- Fixed group-size fields respecting their hidden state, so the extra-size rows and “Add group size” button appear only when different-size groups are selected.
- Moved the Basic/Advanced selector into a compact fixed top-right control so it stays visible while scrolling.
- Changed CSV template links to trigger a browser download from a fetched blob, avoiding CSV preview/plugin navigation on click.

## 2026-10-06 — Simplified assignment results

- Made preference coverage the main result summary and kept the group list as the primary output.
- Show pupils without a preferred group member only when there are any.
- Moved rank counts, multiple-choice counts, and search seed details into a collapsed section.
- Moved engine planning signals into an optional collapsed section, opening it automatically when the basic feasibility check finds blockers.

## 2026-10-06 — PBGAT opening screen

- Renamed the app to PBGAT (Preference-based Group Assignment Tool), version 1, including its browser title and project heading.
- Replaced the separate CSV panel with a simpler start screen containing Basic/Advanced mode selection, a short CSV upload instruction, and a read-me dialog link.
- Added a placeholder in the read-me dialog for content to be written later.
- Added the requested creator credit: Fred Pollard, United Kingdom, 2026.

## 2026-10-06 — Split guide dialogs

- Replaced the single Read me link with separate “What is this tool?” and “User instructions” buttons.
- Added an overview of PBGAT’s purpose, hard rules, preference goal, review requirement, and browser-only CSV processing.
- Left the user-instructions dialog as a placeholder for its later content.
- Added a separate data-protection dialog describing in-browser processing and the school's continuing responsibilities.

## 2026-10-06 — CSV preparation options

- Added a downloadable CSV template with the required headers and one fictional example row.
- Added a start-page link to the supplied Google Drive form-template folder.
- Replaced the user-instructions placeholder with steps for both the Google Form workflow and the manually completed CSV template workflow.

## 2026-10-06 — Assignment priorities

- Recorded the ordered assignment priorities: vetoes, single-sex groups, no singleton groups, preference coverage, then preference rank.
- Documented the first three as validity constraints and the preference goals as optimisation objectives among valid assignments.
- Confirmed that preference coverage considers all five submitted choices.

## 2026-10-06 — group setup interface

- Added a second workflow step after a clean CSV validation report, requiring the teacher to confirm review before entering group data.
- Added regular-group entry (number of groups and places per group) and irregular-group entry (multiple group-count and place-capacity rows).
- Added live group and place totals, with feedback when capacity is below the number of children or when places are left over.

## 2026-10-06 — Assignment engine input model

- Added `assignment-engine.js` as a standalone browser module that accepts validated CSV pupil data and regular or irregular group configuration.
- The module prepares ranked preference records, symmetric prohibited group member pairs from vetoes, expanded group capacities, and a summary, with defensive input checks.
- Wired the group setup page to pass both inputs to the module and display the prepared model summary. group optimisation itself is not implemented yet.

## 2026-10-06 — Initial assignment analysis

- Added preference mention counts and a popularity ranking from the imported choices.
- Added detection of pupils with no incoming preferences and pupils whose choices are all veto-incompatible.
- Added strict mutual-choice group detection and provisional tricky-case pair suggestions that prefer more-mentioned available choices, then better rank.
- Displayed these signals in the group setup step, clearly labelled as provisional rather than assignments.

## 2026-10-06 — Feasibility and scoring foundation

- Added a necessary-condition precheck for place capacity, group availability, and single-sex group sizes; the interface explains that this does not prove veto feasibility.
- Added a hard-rule grouping validator and a lexicographic score evaluator for coverage, each pupil’s best preference rank, and multiple-choice outcomes.
- Added `ENGINE_DESIGN.md` with the initial score definition and hand-checkable comparison examples, ahead of implementing a search algorithm.
- Kept pupils with no submitted choices distinct from pupils whose submitted choices are all veto-incompatible in the tricky-case analysis.


## 2026-10-06 — First grouping search

- Added a bounded, seeded heuristic search that constructs veto-compatible groups within group capacities, then improves valid candidates with pupil moves and swaps.
- The search reports a valid candidate as heuristic rather than optimal, and reports search-incomplete instead of claiming infeasibility when its attempt budget finds no candidate.
- Connected the interface to show the proposed groups, preference coverage, best-match rank counts, multiple-choice count, uncovered pupils, and the reproducibility seed.
- Added an optional seed field so a reported heuristic run can be repeated.
- Strengthened candidate construction to favour newly covered pupils, added coordinated rebuilding of up to five groups and a cooling acceptance rule to escape local optima, and increased the default search budget.
- Added targeted repairs that try moving, transferring, or swapping uncovered pupils into groups with one of their choices.
- Added a 99% coverage target to the interface; below-target groupings are explicitly labelled not acceptable as final assignments.

## 2026-10-06 — Search iterable error

- Fixed group allocation to use the same normalized sex-category keys as the pupil grouping stage. This prevented candidate lists from being found for values such as `Boy`/`Girl`, causing the search to stop with “values is not iterable.”
- Added an explicit internal guard so a future missing candidate list produces a clearer error.

## 2026-10-06 — Realistic preference sample

- Added `sample_responses_realistic.csv` with 180 fictional pupils arranged into five- and six-person friendship clusters, producing 88.9% reciprocal preference nominations.
- Made exactly four pupils (two per sex category) have zero incoming preference nominations; they each still submit five same-sex choices. Veto fields are blank for teacher entry.

## 2026-10-06 — CSV importer and validator

- Added `sample_responses_with_issues.csv`, a separate validation exercise file with deliberate missing fields, a duplicate respondent, self/unknown/duplicate/cross-sex choices, self/unknown/cross-sex vetoes, and a short row.
- Updated CSV validation to recognize and silently ignore an optional `Timestamp` column, as included in Google Forms response exports.
- Added `sample_responses.csv`, containing 180 fictional respondents, five randomly selected same-sex choices per child, blank teacher-entered veto fields, and a Forms-style timestamp column for import review.
- Added a browser-only CSV checker with a file picker, response preview, and row/column-specific validation messages.
- Added checks for the required schema, required identity fields, duplicate respondent names, unknown names, repeated choices/vetoes, self-choices, self-vetoes, and cross-sex choices or vetoes.
- CSV parsing supports quoted fields, commas and line breaks inside quoted fields, escaped quotes, CRLF line endings, and a UTF-8 byte-order mark.
- The tool reports extra CSV columns as non-blocking warnings and ignores them, so exports that include fields such as a Forms timestamp can still be checked.

## 2026-10-06

- Created `PROJECT.md` to record the intended purpose, workflow, CSV schema, constraints, reporting goals, technical direction, and staged development approach.
- Created this change log to track future project decisions and implementation changes.
# 2026-10-06

- Replaced the 99% operational target with the project goal of 100% preference coverage wherever feasible.
- The assignment search stops early when it finds full coverage and reports it as a successful result.
- If full coverage is not found, the engine returns its best valid grouping as unresolved and explicitly avoids claiming that full coverage is impossible.
- The bounded heuristic still cannot prove infeasibility; an exact solver is needed for that guarantee.
