# PBGAT — Preference-based Group Assignment Tool

## Purpose

Build a simple browser-based tool to help users assign people to groups using ranked group-member preferences. The tool should respect group-size limits, a user-selectable single-sex grouping rule (on by default), and user-entered vetoes. It should produce group assignments and a clear report on how well they met preferences.

The tool supports staff decision-making. Its result should be reviewable and adjustable before it is used; it must not imply that every preference can always be satisfied.

## Intended users and workflow

Users collect responses with Google Forms and review them in Google Sheets. They export the response sheet as a CSV, open the app from its hosted web link, upload the CSV, review validation feedback, confirm the report, supply group counts and size limits in a second step, run the assignment, review the groups and success report, and download the results.

The initial design should not require a teacher account, server-side database, or local files beyond the CSV export and any downloaded results. Preference data should be processed in the browser and not sent to a server.

## Input data

The initial CSV columns are:

```csv
Respondent Name,Class,Sex,1st Choice,2nd Choice,3rd Choice,4th Choice,5th Choice,Veto 1,Veto 2
```

- `Respondent Name`: child’s name, used to identify them and match preference entries.
- `Class`: participant’s class; retain for checks and reporting. Whether classes may be mixed in groups remains to be decided.
- `Sex`: used to validate the single-sex grouping option. Accepted values and handling of exceptions remain to be agreed.
- `1st Choice` through `5th Choice`: preferred group members in rank order.
- `Veto 1` and `Veto 2`: user-entered names of participants who must not be assigned to the same group as this respondent. A veto is an absolute constraint; if either participant vetoes the other, they must not be grouped together.

Group counts and maximum sizes are entered after the CSV passes validation. The user chooses same-size groups (group count and maximum group size) or different-size groups (counts grouped by size). The app displays the resulting number of groups and total capacity and flags when capacity is below the number of participants.

## Validation expectations

Before assigning groups, the app should identify data issues for users to correct, including missing or duplicate respondent names, choice or veto names that do not match a respondent, duplicate choices, self-choices, and choices across sex categories. It should explain issues with enough row/field context to locate them. A veto conflict with any other constraint must be surfaced; the app must never silently break a veto.

## Assignment and reporting

The assignment engine should be separate from the interface, with scoring rules that can be changed and compared during development. Apply the priorities in this order:

1. **Never break a veto.** Participants named in a veto relationship must not share a group. A veto is absolute; one participant naming the other is sufficient to prohibit the pairing.
2. **Respect the single-sex setting.** When “Single-sex groupings only” is checked (the default), each group must contain participants with the same `Sex` value. When unchecked, mixed-sex groups are allowed.
3. **Do not create singleton groups.** Every assigned group must contain at least two participants. If constraints or capacities make this impossible, report that no valid assignment was found rather than silently breaking a higher priority.
4. **Maximise preference coverage.** Maximise the number of participants who have at least one of their five selected preferred group members in their group.
5. **Prefer higher-ranked choices.** After optimising coverage, favour assignments that satisfy higher-ranked choices.

Priorities 1–3 define validity. Priorities 4–5 define the objective among valid assignments, so the engine may return a valid grouping where some participants receive none of their selected choices. The exact scoring for priority 5, and how ties or fairness are handled, remain to be decided. Group-size limits are also mandatory constraints; the exact input format remains open.

The preference goal is 100% coverage wherever a valid grouping can achieve it. A heuristic search that returns less than 100% must report its best grouping as unresolved: it has not proved full coverage impossible. Hard rules remain absolute.

The engine’s initial analysis pass counts how often each participant is named in the five preference fields, flags participants with no incoming nominations or no veto-compatible choices, and identifies strict mutual-choice groups (every pair in a group selected one another). It may suggest provisional pairs for tricky cases, preferring available choices named by more participants and using the tricky participant’s rank as a tie-breaker. Popularity counts and mutual groups are planning signals only: they do not override vetoes or lock participants into groups.

The initial grouping score, feasibility precheck, and bounded heuristic search are specified in [ENGINE_DESIGN.md](ENGINE_DESIGN.md). A passing precheck is not proof that veto-compatible groups exist. The engine validates hard rules before scoring completed groupings.

Each run should provide:

1. Group assignments that users can review and adjust.
2. A success report describing the result, including how many participants received at least one preferred group member, how many received multiple choices, the ranks of satisfied choices, and participants who received none. The scoring method and relevant counts should be visible and understandable.

The precise objective, tie-breaking, manual adjustment workflow, and export formats remain open design decisions and should be settled with examples before the assignment engine is finalised.

## Technical direction

Start with a static web app hosted on GitHub Pages. Use JavaScript or TypeScript for the browser interface, CSV handling, validation, assignment engine, and report. Keep the assignment engine in its own module, separate from the interface. The engine receives validated participant rows and normalized group configuration, and prepares a model of participants, ranked choices, prohibited pairings, and group-size limits. Keep input data in the browser session; do not add a backend or direct Google integration unless the project requirements later call for it.

## Development approach

1. Agree on rules, edge cases, and sample inputs.
2. Implement and check CSV parsing and validation.
3. Implement the assignment engine independently and compare outcomes on hand-worked examples.
4. Implement the success report and verify its counts against known assignments.
5. Build the upload, group-size, assignment review, and download interface.
6. Evaluate with representative past or dummy data and refine the scoring with staff.

Test small, hand-verifiable cases as each element is built, then use representative larger data to assess performance and practical usefulness. Do not treat a high preference score as proof of a suitable result; staff review remains part of the workflow.
