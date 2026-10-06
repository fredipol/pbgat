# Assignment engine design

## Current objective

Only groupings satisfying every hard rule are valid:

- Each pupil is assigned exactly once.
- A group is empty or contains at least two participants, and does not exceed its maximum size.
- Every assigned group contains one `Sex` category only when the single-sex option is enabled.
- No pair prohibited by either pupil’s veto is together.

Valid groupings are compared lexicographically with this score vector:

```text
[pupils with at least one of their five choices,
 participants whose best in-group choice is rank 1,
 participants whose best in-group choice is rank 2,
 participants whose best in-group choice is rank 3,
 participants whose best in-group choice is rank 4,
 participants whose best in-group choice is rank 5,
 participants with more than one preferred group member]
```

The first element implements preference coverage. With coverage tied, the engine favours more first-choice outcomes, then more second-choice outcomes, and so on. Multiple-choice outcomes are a tie-breaker after the rank distribution. The report can also show every matched choice link, but additional links do not outweigh a higher-ranked best match under this initial objective.

This is an initial, explicit scoring proposal that can be changed after comparisons on sample data.

The goal is 100% preference coverage whenever feasible. A full-coverage result is a valid witness that the goal can be achieved for the supplied data and group-size limits. A bounded heuristic result below 100% is unresolved; it does not prove that full coverage is impossible.

## Feasibility precheck

The current precheck finds definite blockers from total group capacity and the number of usable groups. When single-sex grouping is enabled, it also checks individual sex-category counts and the maximum capacity that could be allocated to each category without singleton groups. Passing the precheck is necessary, not sufficient: it does not prove that veto-compatible groups can be formed or that group sizes can be partitioned successfully among sex categories.

## Hand-check examples for the next implementation step

1. **Coverage outranks rank:** Grouping A covers 8 pupils and grouping B covers 7. A wins even if B has more first-choice matches.
2. **Rank breaks a coverage tie:** Both groupings cover 8 pupils. A has 3 pupils whose best match is first choice; B has 2. A wins before lower-rank counts are considered.
3. **Lower ranks break a tie in order:** If coverage and first-choice counts tie, compare second-choice counts, then third, fourth, and fifth.
4. **Multiple choices are a late tie-break:** If the coverage and best-rank distributions tie, prefer the grouping in which more participants have at least two choices in their group.
5. **Hard-rule rejection:** An assignment containing a veto pair, a mixed-sex group while the single-sex option is enabled, an over-capacity group, a singleton group, or an unassigned participant is invalid regardless of its preference score.
6. **Definite singleton obstruction:** If one sex category has exactly one pupil, no valid single-sex, no-singleton grouping exists for that input.

## Search strategy direction

Use the popularity counts, strict mutual-choice groups, and provisional tricky-case pairs as search hints only. Any completed candidate must pass the hard-rule validator before it is scored. The optimiser should compare multiple candidate groupings and retain the best valid score; it must not silently relax a hard rule.


## First search implementation

The current engine uses randomized construction attempts. It allocates whole groups to sex categories, chooses non-singleton group sizes, and builds veto-compatible groupings with new preference coverage as a strong guide. It applies targeted moves, pair transfers, and swaps to place uncovered participants with a listed choice; it also improves candidates through random participant moves and swaps, plus rebuilding several same-sex groups together. A seeded pseudo-random sequence makes a run reproducible when its seed is recorded. The search uses a cooling acceptance rule to sometimes retain a lower-scoring valid candidate early in a run, which can help it escape local optima; it always keeps the best candidate seen separately.

The search is heuristic and bounded. It now stops early if it finds full coverage, and otherwise returns the best hard-rule-valid grouping found with an explicit “search limit reached” status. That result is not a proof that full coverage is impossible. Attempts and improvement steps are configurable for later performance/quality comparisons. A complete proof of infeasibility still requires an exact constraint solver; the current browser-only heuristic does not provide that proof.
