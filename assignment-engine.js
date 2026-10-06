(() => {
  "use strict";

  const CHOICE_COLUMNS = ["1st Choice", "2nd Choice", "3rd Choice", "4th Choice", "5th Choice"];
  const VETO_COLUMNS = ["Veto 1", "Veto 2"];

  function normalizeName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`${label} must be a positive whole number.`);
    }
    return number;
  }

  function expandRooms(roomConfiguration) {
    if (!roomConfiguration || !["regular", "irregular"].includes(roomConfiguration.type)) {
      throw new Error("Group information is missing or has an unrecognised format.");
    }
    const rooms = [];
    if (roomConfiguration.type === "regular") {
      const count = positiveInteger(roomConfiguration.roomCount, "Number of groups");
      const beds = positiveInteger(roomConfiguration.bedsPerRoom, "Maximum group size");
      for (let index = 0; index < count; index += 1) rooms.push({ id: `Group ${index + 1}`, capacity: beds });
    } else {
      if (!Array.isArray(roomConfiguration.sizes) || roomConfiguration.sizes.length === 0) {
        throw new Error("Add at least one group size.");
      }
      roomConfiguration.sizes.forEach((size, index) => {
        const count = positiveInteger(size.roomCount, `Number of groups in size row ${index + 1}`);
        const beds = positiveInteger(size.bedsPerRoom, `Maximum group size in size row ${index + 1}`);
        for (let room = 0; room < count; room += 1) {
          rooms.push({ id: `Group ${rooms.length + 1}`, capacity: beds });
        }
      });
    }
    if (rooms.some(room => room.capacity < 2)) {
      throw new Error("Every group must have capacity for at least two pupils because singleton groups are not allowed.");
    }
    return rooms;
  }

  /**
   * Convert validated CSV rows and the group form into the optimisation model.
   * This function prepares inputs only; it does not choose group assignments.
   */
  function createAssignmentProblem({ people, roomConfiguration }) {
    if (!Array.isArray(people) || people.length === 0) throw new Error("No validated pupil data was provided.");
    const pupils = people.map((person, index) => {
      const name = String(person["Respondent Name"] ?? "").trim().replace(/\s+/g, " ");
      const sex = String(person.Sex ?? "").trim();
      if (!name || !sex) throw new Error(`Pupil row ${index + 1} is missing a name or sex value.`);
      return {
        name,
        nameKey: normalizeName(name),
        className: String(person.Class ?? "").trim(),
        sex,
        preferences: CHOICE_COLUMNS.flatMap((column, rank) => {
          const targetName = String(person[column] ?? "").trim();
          return targetName ? [{ name: targetName, nameKey: normalizeName(targetName), rank: rank + 1 }] : [];
        }),
        vetoes: VETO_COLUMNS.flatMap(column => {
          const targetName = String(person[column] ?? "").trim();
          return targetName ? [{ name: targetName, nameKey: normalizeName(targetName) }] : [];
        })
      };
    });

    const pupilByName = new Map();
    pupils.forEach(pupil => {
      if (pupilByName.has(pupil.nameKey)) throw new Error(`Duplicate pupil name: ${pupil.name}.`);
      pupilByName.set(pupil.nameKey, pupil);
    });
    const vetoPairs = new Map();
    pupils.forEach(pupil => pupil.vetoes.forEach(veto => {
      const target = pupilByName.get(veto.nameKey);
      if (!target) throw new Error(`Veto name “${veto.name}” does not match a pupil.`);
      if (target.nameKey === pupil.nameKey) throw new Error(`${pupil.name} cannot veto themselves.`);
      const pair = [pupil.nameKey, target.nameKey].sort();
      vetoPairs.set(pair.join("\u0000"), { pupils: pair });
    }));

    pupils.forEach(pupil => pupil.preferences.forEach(preference => {
      const target = pupilByName.get(preference.nameKey);
      if (!target) throw new Error(`Choice “${preference.name}” does not match a pupil.`);
      if (target.nameKey === pupil.nameKey) throw new Error(`${pupil.name} cannot choose themselves.`);
    }));

    const rooms = expandRooms(roomConfiguration);
    const totalBeds = rooms.reduce((sum, room) => sum + room.capacity, 0);
    if (totalBeds < pupils.length) {
      throw new Error(`Group capacity is ${totalBeds} places for ${pupils.length} pupils.`);
    }
    return {
      pupils,
      rooms,
      singleSexGroups: roomConfiguration.singleSexGroups !== false,
      forbiddenPairs: [...vetoPairs.values()],
      summary: {
        pupilCount: pupils.length,
        roomCount: rooms.length,
        totalBeds,
        spareBeds: totalBeds - pupils.length,
        sexCategories: [...new Set(pupils.map(pupil => pupil.sex))],
        vetoPairCount: vetoPairs.size
      }
    };
  }

  function pairKey(firstNameKey, secondNameKey) {
    return [firstNameKey, secondNameKey].sort().join("\u0000");
  }

  function maximalCliques(graph) {
    const cliques = [];
    function visit(current, possible, excluded) {
      if (possible.size === 0 && excluded.size === 0) {
        if (current.length > 1) cliques.push([...current]);
        return;
      }
      const pivot = [...possible, ...excluded].sort((a, b) => graph.get(b).size - graph.get(a).size)[0];
      const candidates = [...possible].filter(vertex => !pivot || !graph.get(pivot).has(vertex));
      for (const vertex of candidates) {
        const neighbors = graph.get(vertex);
        visit(
          [...current, vertex],
          new Set([...possible].filter(candidate => neighbors.has(candidate))),
          new Set([...excluded].filter(candidate => neighbors.has(candidate)))
        );
        possible.delete(vertex);
        excluded.add(vertex);
      }
    }
    visit([], new Set(graph.keys()), new Set());
    return cliques;
  }

  /** Analyse support, constrained pupils, mutual-choice groups and provisional pair candidates. */
  function analyzeAssignmentProblem(problem) {
    if (!problem || !Array.isArray(problem.pupils) || !Array.isArray(problem.forbiddenPairs)) {
      throw new Error("A prepared assignment problem is required for analysis.");
    }
    const pupilsByName = new Map(problem.pupils.map(pupil => [pupil.nameKey, pupil]));
    const popularity = new Map(problem.pupils.map(pupil => [pupil.nameKey, { mentions: 0, rankWeight: 0 }]));
    problem.pupils.forEach(pupil => pupil.preferences.forEach(preference => {
      const score = popularity.get(preference.nameKey);
      if (score) { score.mentions += 1; score.rankWeight += 6 - preference.rank; }
    }));

    const forbidden = new Set(problem.forbiddenPairs.map(pair => pairKey(pair.pupils[0], pair.pupils[1])));
    const preparedPupils = problem.pupils.map(pupil => ({
      ...pupil,
      popularity: { ...popularity.get(pupil.nameKey) },
      availablePreferences: pupil.preferences.filter(preference => !forbidden.has(pairKey(pupil.nameKey, preference.nameKey)))
    }));
    const trickyCases = preparedPupils.filter(pupil => pupil.popularity.mentions === 0 ||
      (pupil.preferences.length > 0 && pupil.availablePreferences.length === 0)).map(pupil => ({
      name: pupil.name,
      mentions: pupil.popularity.mentions,
      availablePreferenceCount: pupil.availablePreferences.length,
      reasons: [
        ...(pupil.popularity.mentions === 0 ? ["Not named in anyone’s preferences"] : []),
        ...(pupil.preferences.length > 0 && pupil.availablePreferences.length === 0 ? ["All listed choices are veto-incompatible"] : [])
      ],
      availablePreferences: pupil.availablePreferences.map(preference => ({ ...preference }))
    }));

    // An edge exists only when two pupils selected one another. Maximal cliques
    // are strict mutual-choice groups; the groups are signals, not locked allocations.
    const graph = new Map(problem.pupils.map(pupil => [pupil.nameKey, new Set()]));
    problem.pupils.forEach(pupil => pupil.preferences.forEach(preference => {
      const other = pupilsByName.get(preference.nameKey);
      if (!other || forbidden.has(pairKey(pupil.nameKey, other.nameKey))) return;
      if (other.preferences.some(choice => choice.nameKey === pupil.nameKey)) {
        graph.get(pupil.nameKey).add(other.nameKey);
        graph.get(other.nameKey).add(pupil.nameKey);
      }
    }));
    const mutualChoiceGroups = maximalCliques(graph).map(clique => clique
      .map(nameKey => pupilsByName.get(nameKey).name)
      .sort((a, b) => a.localeCompare(b))
    ).sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

    // Form tentative pairs for constrained pupils. Resolve collisions in favour
    // of pupils with fewer viable choices, then choose the most-mentioned
    // available partner and use the preference rank as a tie-breaker.
    const casesForPairing = preparedPupils
      .filter(pupil => trickyCases.some(item => item.name === pupil.name) && pupil.availablePreferences.length > 0)
      .sort((a, b) => a.availablePreferences.length - b.availablePreferences.length ||
        a.popularity.mentions - b.popularity.mentions || a.name.localeCompare(b.name));
    const used = new Set();
    const suggestedPairs = [];
    casesForPairing.forEach(pupil => {
      if (used.has(pupil.nameKey)) return;
      const possible = [...pupil.availablePreferences]
        .filter(preference => !used.has(preference.nameKey))
        .sort((a, b) => popularity.get(b.nameKey).mentions - popularity.get(a.nameKey).mentions ||
          a.rank - b.rank || a.name.localeCompare(b.name));
      const chosen = possible[0];
      if (!chosen) return;
      const partnerPopularity = popularity.get(chosen.nameKey).mentions;
      suggestedPairs.push({
        pupil: pupil.name,
        partner: pupilsByName.get(chosen.nameKey).name,
        preferenceRank: chosen.rank,
        partnerPopularity,
        reason: `${pupilsByName.get(chosen.nameKey).name} is named by ${partnerPopularity} pupil${partnerPopularity === 1 ? "" : "s"}; this provisional partner also appears as choice ${chosen.rank}.`
      });
      used.add(pupil.nameKey);
      used.add(chosen.nameKey);
    });

    const popularityRanking = preparedPupils
      .map(pupil => ({ name: pupil.name, mentions: pupil.popularity.mentions, rankWeight: pupil.popularity.rankWeight }))
      .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
    return { popularity: popularityRanking, trickyCases, mutualChoiceGroups, suggestedPairs };
  }

  /** Return definite capacity/sex blockers; a clean result is necessary, not sufficient, for feasibility. */
  function checkNecessaryFeasibility(problem) {
    const issues = [];
    const pupilsBySex = new Map();
    problem.pupils.forEach(pupil => {
      const sex = normalizeName(pupil.sex);
      pupilsBySex.set(sex, (pupilsBySex.get(sex) || 0) + 1);
    });
    const totalBeds = problem.rooms.reduce((sum, room) => sum + room.capacity, 0);
    if (problem.pupils.length < 2) issues.push("At least two pupils are needed because single-person groups are not allowed.");
    if (totalBeds < problem.pupils.length) issues.push(`There is capacity for ${totalBeds} pupils, but there are ${problem.pupils.length} pupils.`);
    const usableRooms = problem.rooms.filter(room => room.capacity >= 2).sort((a, b) => b.capacity - a.capacity);
    if (!usableRooms.length && problem.pupils.length >= 2) {
      issues.push("There are no groups with capacity for at least two pupils.");
    }
    if (problem.singleSexGroups && usableRooms.length < pupilsBySex.size) {
      issues.push(`There are ${pupilsBySex.size} sex categories with pupils but only ${usableRooms.length} available groups that can hold at least two pupils.`);
    }
    for (const [sex, count] of problem.singleSexGroups ? pupilsBySex : []) {
      if (count === 1) {
        issues.push(`The ${sex} category has one pupil; a single-sex group with no singleton cannot be formed for them.`);
        continue;
      }
      const maxRooms = Math.floor(count / 2);
      const availableCapacity = usableRooms.slice(0, maxRooms).reduce((sum, room) => sum + room.capacity, 0);
      if (availableCapacity < count) {
        issues.push(`The largest ${maxRooms} available group capacities total ${availableCapacity}, which is not enough for the ${count} pupils in the ${sex} category without a singleton group.`);
      }
    }
    return {
      necessaryConditionsPass: issues.length === 0,
      issues,
      note: "Passing these checks does not guarantee that all veto constraints can be satisfied in a complete grouping."
    };
  }

  function evaluateGrouping(problem, assignedRooms) {
    if (!problem || !Array.isArray(problem.pupils) || !Array.isArray(problem.rooms)) {
      throw new Error("A prepared assignment problem is required.");
    }
    if (!Array.isArray(assignedRooms)) throw new Error("Group assignments must be provided as an array.");
    const issues = [];
    const pupilsByName = new Map(problem.pupils.map(pupil => [pupil.nameKey, pupil]));
    const roomsById = new Map(problem.rooms.map(room => [room.id, room]));
    const forbidden = new Set(problem.forbiddenPairs.map(pair => pairKey(pair.pupils[0], pair.pupils[1])));
    const seenRooms = new Set();
    const roomForPupil = new Map();
    const assignedRoomsById = new Map();

    assignedRooms.forEach((room, index) => {
      const roomId = String(room?.id ?? "");
      const inventoryRoom = roomsById.get(roomId);
      const label = roomId || `assignment row ${index + 1}`;
      if (!inventoryRoom) issues.push(`${label}: group is not in the supplied group list.`);
      if (seenRooms.has(roomId)) issues.push(`${label}: group is assigned more than once.`);
      seenRooms.add(roomId);
      assignedRoomsById.set(roomId, room);
      if (!Array.isArray(room?.occupants)) {
        issues.push(`${label}: occupants must be a list of pupil names.`);
        return;
      }
      if (room.occupants.length === 1) issues.push(`${label}: singleton groups are not allowed.`);
      if (inventoryRoom && room.occupants.length > inventoryRoom.capacity) {
        issues.push(`${label}: ${room.occupants.length} pupils exceed its capacity of ${inventoryRoom.capacity}.`);
      }
      const occupants = [];
      room.occupants.forEach(name => {
        const nameKey = normalizeName(name);
        const pupil = pupilsByName.get(nameKey);
        if (!pupil) { issues.push(`${label}: “${name}” is not in the pupil data.`); return; }
        if (roomForPupil.has(nameKey)) issues.push(`${pupil.name} is assigned to more than one group.`);
        roomForPupil.set(nameKey, roomId);
        occupants.push(pupil);
      });
      const sexes = new Set(occupants.map(pupil => normalizeName(pupil.sex)));
      if (problem.singleSexGroups && sexes.size > 1) issues.push(`${label}: mixed-sex groups are not allowed.`);
      for (let i = 0; i < occupants.length; i += 1) {
        for (let j = i + 1; j < occupants.length; j += 1) {
          if (forbidden.has(pairKey(occupants[i].nameKey, occupants[j].nameKey))) {
            issues.push(`${label}: vetoed pupils ${occupants[i].name} and ${occupants[j].name} are in the same group.`);
          }
        }
      }
    });

    problem.pupils.forEach(pupil => {
      if (!roomForPupil.has(pupil.nameKey)) issues.push(`${pupil.name} is not assigned to a group.`);
    });
    if (issues.length) {
      const error = new Error(`Grouping violates ${issues.length} hard rule${issues.length === 1 ? "" : "s"}: ${issues.join(" ")}`);
      error.issues = issues;
      throw error;
    }

    const rankCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let coveredPupils = 0;
    let multipleChoicePupils = 0;
    let matchedChoiceLinks = 0;
    const pupilOutcomes = problem.pupils.map(pupil => {
      const room = assignedRoomsById.get(roomForPupil.get(pupil.nameKey));
      const occupants = new Set(room.occupants.map(normalizeName));
      const matched = pupil.preferences.filter(preference => occupants.has(preference.nameKey));
      const bestRank = matched.length ? Math.min(...matched.map(preference => preference.rank)) : null;
      if (bestRank !== null) { coveredPupils += 1; rankCounts[bestRank] += 1; }
      if (matched.length > 1) multipleChoicePupils += 1;
      matchedChoiceLinks += matched.length;
      return { name: pupil.name, bestRank, matchedChoices: matched.map(preference => ({ name: preference.name, rank: preference.rank })) };
    });
    const scoreVector = [coveredPupils, rankCounts[1], rankCounts[2], rankCounts[3], rankCounts[4], rankCounts[5], multipleChoicePupils];
    return {
      valid: true,
      score: {
        coveredPupils,
        rankCounts,
        multipleChoicePupils,
        matchedChoiceLinks,
        scoreVector
      },
      pupilOutcomes
    };
  }

  /** Positive means firstScore is preferred; zero means equal under the current objective. */
  function compareScores(firstScore, secondScore) {
    const first = firstScore.scoreVector;
    const second = secondScore.scoreVector;
    for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
      const difference = (first[index] || 0) - (second[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  }

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(values, random) {
    if (!Array.isArray(values)) throw new Error("Internal assignment search error: expected a list of candidates.");
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function allocateRooms(problem, random) {
    const counts = new Map();
    problem.pupils.forEach(pupil => {
      const sex = problem.singleSexGroups ? normalizeName(pupil.sex) : "__mixed_groups__";
      counts.set(sex, (counts.get(sex) || 0) + 1);
    });
    const categories = [...counts.entries()].sort((a, b) => a[1] - b[1]);
    const initialRooms = problem.rooms.filter(room => room.capacity >= 2);
    const futureCanFit = (remainingRooms, startIndex) => {
      const future = categories.slice(startIndex);
      if (remainingRooms.length < future.length) return false;
      const totalDemand = future.reduce((sum, [, count]) => sum + count, 0);
      if (remainingRooms.reduce((sum, room) => sum + room.capacity, 0) < totalDemand) return false;
      for (const [, count] of future) {
        const maximumRoomCount = Math.floor(count / 2);
        const maximumCapacity = [...remainingRooms].sort((a, b) => b.capacity - a.capacity)
          .slice(0, maximumRoomCount).reduce((sum, room) => sum + room.capacity, 0);
        if (count < 2 || maximumCapacity < count) return false;
      }
      return true;
    };

    function subsetsOfSize(rooms, size, requiredCapacity, limit = 80) {
      const ordered = [...rooms].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
      const results = [];
      const chosen = [];
      function visit(start, capacity) {
        if (results.length >= limit) return;
        if (chosen.length === size) {
          if (capacity >= requiredCapacity) results.push([...chosen]);
          return;
        }
        const needed = size - chosen.length;
        if (ordered.length - start < needed) return;
        const bestRemaining = ordered.slice(ordered.length - needed).reduce((sum, room) => sum + room.capacity, 0);
        if (capacity + bestRemaining < requiredCapacity) return;
        for (let index = start; index <= ordered.length - needed; index += 1) {
          chosen.push(ordered[index]);
          visit(index + 1, capacity + ordered[index].capacity);
          chosen.pop();
          if (results.length >= limit) return;
        }
      }
      visit(0, 0);
      results.sort((a, b) => a.reduce((sum, room) => sum + room.capacity, 0) -
        b.reduce((sum, room) => sum + room.capacity, 0));
      return results;
    }

    function allocate(index, remainingRooms, allocation) {
      if (index === categories.length) return allocation;
      const [sex, pupilCount] = categories[index];
      const futureCategories = categories.length - index - 1;
      const maxRooms = Math.min(Math.floor(pupilCount / 2), remainingRooms.length - futureCategories);
      const possibleCounts = [];
      for (let count = 1; count <= maxRooms; count += 1) possibleCounts.push(count);
      for (const numberOfRooms of shuffle(possibleCounts, random)) {
        const subsets = shuffle(subsetsOfSize(remainingRooms, numberOfRooms, pupilCount), random);
        for (const subset of subsets) {
          const selectedIds = new Set(subset.map(room => room.id));
          const rest = remainingRooms.filter(room => !selectedIds.has(room.id));
          if (!futureCanFit(rest, index + 1)) continue;
          const next = new Map(allocation);
          next.set(sex, subset);
          const result = allocate(index + 1, rest, next);
          if (result) return result;
        }
      }
      return null;
    }

    return allocate(0, initialRooms, new Map());
  }

  function occupancyTargets(rooms, pupilCount, random) {
    if (pupilCount < rooms.length * 2 || rooms.reduce((sum, room) => sum + room.capacity, 0) < pupilCount) return null;
    const targets = rooms.map(room => ({ room, size: 2 }));
    let extra = pupilCount - targets.length * 2;
    const order = shuffle(targets, random);
    while (extra > 0) {
      let progressed = false;
      for (const target of order) {
        if (target.size < target.room.capacity && extra > 0) {
          target.size += 1;
          extra -= 1;
          progressed = true;
      }
      }
      if (!progressed) return null;
      shuffle(order, random);
    }
    return targets;
  }

  function buildSearchContext(problem) {
    const pupilsByName = new Map(problem.pupils.map(pupil => [pupil.nameKey, pupil]));
    const forbidden = new Set(problem.forbiddenPairs.map(pair => pairKey(pair.pupils[0], pair.pupils[1])));
    const popularity = new Map(problem.pupils.map(pupil => [pupil.nameKey, 0]));
    const affinity = new Map();
    const mutualEdges = new Set();
    problem.pupils.forEach(pupil => pupil.preferences.forEach(preference => {
      popularity.set(preference.nameKey, (popularity.get(preference.nameKey) || 0) + 1);
      affinity.set(`${pupil.nameKey}\u0001${preference.nameKey}`, 6 - preference.rank);
      const other = pupilsByName.get(preference.nameKey);
      if (other && other.preferences.some(choice => choice.nameKey === pupil.nameKey)) mutualEdges.add(pairKey(pupil.nameKey, other.nameKey));
    }));
    const signals = analyzeAssignmentProblem(problem);
    const suggestedPairs = new Set(signals.suggestedPairs.map(pair => pairKey(normalizeName(pair.pupil), normalizeName(pair.partner))));
    return { pupilsByName, forbidden, popularity, affinity, mutualEdges, suggestedPairs };
  }

  function pairBenefit(firstNameKey, secondNameKey, context) {
    let value = (context.affinity.get(`${firstNameKey}\u0001${secondNameKey}`) || 0) +
      (context.affinity.get(`${secondNameKey}\u0001${firstNameKey}`) || 0);
    const key = pairKey(firstNameKey, secondNameKey);
    if (context.mutualEdges.has(key)) value += 3;
    if (context.suggestedPairs.has(key)) value += 7;
    return value;
  }

  function groupMarginalBenefit(group, candidate, context) {
    let benefit = 0;
    const candidatePreference = new Map(candidate.preferences.map(preference => [preference.nameKey, preference.rank]));
    const groupKeys = new Set(group.map(pupil => pupil.nameKey));
    const candidateRank = candidate.preferences
      .filter(preference => groupKeys.has(preference.nameKey))
      .reduce((best, preference) => Math.min(best, preference.rank), Infinity);
    if (Number.isFinite(candidateRank)) benefit += 12 + (6 - candidateRank);
    group.forEach(member => {
      const alreadyCovered = member.preferences.some(preference => groupKeys.has(preference.nameKey));
      const rank = candidatePreference.get(member.nameKey);
      if (!alreadyCovered && rank) benefit += 12 + (6 - rank);
      benefit += pairBenefit(member.nameKey, candidate.nameKey, context) * 0.15;
    });
    return benefit;
  }

  function compatible(firstNameKey, secondNameKey, context) {
    return !context.forbidden.has(pairKey(firstNameKey, secondNameKey));
  }

  function findCompatibleGroup(remaining, targetSize, context, random) {
    const pool = [...remaining];
    const compatibilityCounts = new Map(pool.map(pupil => [pupil.nameKey,
      pool.reduce((count, other) => count + (other.nameKey !== pupil.nameKey && compatible(pupil.nameKey, other.nameKey, context) ? 1 : 0), 0)]));
    const seeds = shuffle(pool, random).sort((a, b) =>
      compatibilityCounts.get(a.nameKey) - compatibilityCounts.get(b.nameKey) ||
      context.popularity.get(a.nameKey) - context.popularity.get(b.nameKey));
    const seedOptions = seeds.slice(0, Math.min(12, seeds.length));
    let nodes = 0;
    const nodeLimit = 450;

    function grow(group, candidates) {
      nodes += 1;
      if (group.length === targetSize) return group;
      if (nodes > nodeLimit) return null;
      const chosen = new Set(group.map(pupil => pupil.nameKey));
      const eligible = candidates.filter(candidate => !chosen.has(candidate.nameKey) &&
        group.every(member => compatible(member.nameKey, candidate.nameKey, context)));
      if (eligible.length < targetSize - group.length) return null;
      const scored = shuffle(eligible, random).map(candidate => ({
        candidate,
        benefit: groupMarginalBenefit(group, candidate, context),
        options: compatibilityCounts.get(candidate.nameKey) || 0
      })).sort((a, b) => b.benefit - a.benefit || a.options - b.options);
      for (const item of scored.slice(0, 10)) {
        const next = grow([...group, item.candidate], candidates);
        if (next) return next;
      }
      return null;
    }

    for (const seed of seedOptions) {
      const result = grow([seed], pool);
      if (result) return result;
      if (nodes > nodeLimit) break;
    }
    return null;
  }

  function constructGrouping(problem, context, random) {
    const allocation = allocateRooms(problem, random);
    if (!allocation) return null;
    const groups = [];
    const pupilsBySex = new Map();
    problem.pupils.forEach(pupil => {
      const sex = problem.singleSexGroups ? normalizeName(pupil.sex) : "__mixed_groups__";
      if (!pupilsBySex.has(sex)) pupilsBySex.set(sex, []);
      pupilsBySex.get(sex).push(pupil);
    });
    for (const [sex, rooms] of allocation) {
      let remaining = shuffle(pupilsBySex.get(sex), random);
      const targets = occupancyTargets(rooms, remaining.length, random);
      if (!targets) return null;
      const orderedTargets = targets.sort((a, b) => b.size - a.size);
      for (const target of orderedTargets) {
        const group = findCompatibleGroup(remaining, target.size, context, random);
        if (!group) return null;
        const selected = new Set(group.map(pupil => pupil.nameKey));
        remaining = remaining.filter(pupil => !selected.has(pupil.nameKey));
        groups.push({ id: target.room.id, occupants: group.map(pupil => pupil.name) });
      }
      if (remaining.length) return null;
    }
    return groups;
  }

  function roomIsCompatible(occupants, context) {
    for (let first = 0; first < occupants.length; first += 1) {
      for (let second = first + 1; second < occupants.length; second += 1) {
        if (!compatible(normalizeName(occupants[first]), normalizeName(occupants[second]), context)) return false;
      }
    }
    return true;
  }

  function rebuildNeighborhood(problem, current, roomSex, context, random) {
    if (current.length < 2) return null;
    const firstIndex = Math.floor(random() * current.length);
    const sex = roomSex.get(current[firstIndex].id);
    const eligibleGroups = current.map((room, index) => ({ room, index }))
      .filter(item => (!problem.singleSexGroups || roomSex.get(item.room.id) === sex) && item.index !== firstIndex);
    if (!eligibleGroups.length) return null;
    const maxNeighborhood = Math.min(5, eligibleGroups.length + 1);
    const neighborhoodSize = 2 + Math.floor(random() * (maxNeighborhood - 1));
    const selected = [{ room: current[firstIndex], index: firstIndex }, ...shuffle(eligibleGroups, random).slice(0, neighborhoodSize - 1)];
    const pupilsByName = new Map(problem.pupils.map(pupil => [pupil.nameKey, pupil]));
    let remaining = selected.flatMap(item => item.room.occupants.map(name => pupilsByName.get(normalizeName(name))));
    if (remaining.some(pupil => !pupil)) return null;
    const targetSizes = selected.map(item => ({ index: item.index, size: item.room.occupants.length }))
      .sort((a, b) => b.size - a.size);
    const replacements = new Map();
    for (const target of targetSizes) {
      const group = findCompatibleGroup(remaining, target.size, context, random);
      if (!group) return null;
      replacements.set(target.index, group.map(pupil => pupil.name));
      const selectedKeys = new Set(group.map(pupil => pupil.nameKey));
      remaining = remaining.filter(pupil => !selectedKeys.has(pupil.nameKey));
    }
    if (remaining.length) return null;
    const candidate = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
    replacements.forEach((occupants, index) => { candidate[index].occupants = occupants; });
    return candidate;
  }

  function repairCoverage(problem, grouping, context) {
    let current = grouping.map(room => ({ id: room.id, occupants: [...room.occupants] }));
    let currentEvaluation = evaluateGrouping(problem, current);
    const roomInventory = new Map(problem.rooms.map(room => [room.id, room]));
    const pupilByName = context.pupilsByName;

    for (let iteration = 0; iteration < problem.pupils.length; iteration += 1) {
      const uncovered = currentEvaluation.pupilOutcomes
        .filter(outcome => outcome.bestRank === null)
        .map(outcome => pupilByName.get(normalizeName(outcome.name)))
        .sort((a, b) => a.preferences.length - b.preferences.length ||
          context.popularity.get(a.nameKey) - context.popularity.get(b.nameKey));
      if (!uncovered.length) break;
      const location = new Map();
      current.forEach((room, index) => room.occupants.forEach(name => location.set(normalizeName(name), index)));
      let nextCandidate = null;
      let nextEvaluation = null;
      let candidateChecks = 0;

      for (const pupil of uncovered) {
        const sourceIndex = location.get(pupil.nameKey);
        const source = current[sourceIndex];
        if (!source) continue;
        for (const preference of pupil.preferences) {
          const destinationIndex = location.get(preference.nameKey);
          if (destinationIndex === undefined || destinationIndex === sourceIndex) continue;
          const destination = current[destinationIndex];
          const candidates = [];

          if (source.occupants.length > 2 && destination.occupants.length < roomInventory.get(destination.id).capacity &&
              roomIsCompatible([...destination.occupants, pupil.name], context)) {
            const candidate = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
            candidate[sourceIndex].occupants = candidate[sourceIndex].occupants.filter(name => normalizeName(name) !== pupil.nameKey);
            candidate[destinationIndex].occupants.push(pupil.name);
            candidates.push(candidate);
          }

          if (source.occupants.length === 2 && destination.occupants.length + 2 <= roomInventory.get(destination.id).capacity &&
              roomIsCompatible([...destination.occupants, ...source.occupants], context)) {
            const candidate = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
            candidate[destinationIndex].occupants.push(...candidate[sourceIndex].occupants);
            candidate[sourceIndex].occupants = [];
            candidates.push(candidate);
          }

          for (const swappedName of destination.occupants) {
            const sourceGroup = source.occupants.filter(name => normalizeName(name) !== pupil.nameKey).concat(swappedName);
            const destinationGroup = destination.occupants.filter(name => normalizeName(name) !== normalizeName(swappedName)).concat(pupil.name);
            if (!roomIsCompatible(sourceGroup, context) || !roomIsCompatible(destinationGroup, context)) continue;
            const candidate = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
            candidate[sourceIndex].occupants = sourceGroup;
            candidate[destinationIndex].occupants = destinationGroup;
            candidates.push(candidate);
          }

          for (const candidate of candidates) {
            candidateChecks += 1;
            let evaluation;
            try { evaluation = evaluateGrouping(problem, candidate); }
            catch { continue; }
            if (evaluation.score.coveredPupils > currentEvaluation.score.coveredPupils) {
              nextCandidate = candidate;
              nextEvaluation = evaluation;
              break;
            }
            if (candidateChecks >= 500) break;
          }
          if (nextCandidate || candidateChecks >= 500) break;
        }
        if (nextCandidate || candidateChecks >= 500) break;
      }
      if (!nextCandidate) break;
      current = nextCandidate;
      currentEvaluation = nextEvaluation;
    }
    return { rooms: current, evaluation: currentEvaluation };
  }

  function improveGrouping(problem, grouping, context, random, steps) {
    let current = grouping.map(room => ({ id: room.id, occupants: [...room.occupants] }));
    let currentScore = evaluateGrouping(problem, current);
    let best = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
    let bestScore = currentScore;
    const roomInventory = new Map(problem.rooms.map(room => [room.id, room]));
    const roomSex = new Map(current.map(room => [room.id,
      normalizeName(context.pupilsByName.get(normalizeName(room.occupants[0])).sex)]));
    const base = problem.pupils.length + 1;
    const scoreValue = score => score.scoreVector.reduce((value, component) => value * base + component, 0);
    const initialTemperature = Math.pow(base, currentScore.score.scoreVector.length - 1) * 0.35;
    const finalTemperature = Math.pow(base, currentScore.score.scoreVector.length - 2) * 0.02;

    for (let step = 0; step < steps; step += 1) {
      let candidate = null;
      const operation = random();
      if (operation < 0.2) {
        if (current.length < 2) continue;
        const sourceIndex = Math.floor(random() * current.length);
        const destinationIndex = Math.floor(random() * current.length);
        if (sourceIndex === destinationIndex) continue;
        const source = current[sourceIndex], destination = current[destinationIndex];
        if (problem.singleSexGroups && roomSex.get(source.id) !== roomSex.get(destination.id)) continue;
        candidate = current.map(room => ({ id: room.id, occupants: [...room.occupants] }));
        const from = candidate[sourceIndex], to = candidate[destinationIndex];
        if (operation < 0.1) {
          if (from.occupants.length <= 2 || to.occupants.length >= roomInventory.get(to.id).capacity) continue;
          const moved = from.occupants.splice(Math.floor(random() * from.occupants.length), 1)[0];
          to.occupants.push(moved);
          if (!roomIsCompatible(to.occupants, context)) continue;
        } else {
          const fromIndex = Math.floor(random() * from.occupants.length);
          const toIndex = Math.floor(random() * to.occupants.length);
          [from.occupants[fromIndex], to.occupants[toIndex]] = [to.occupants[toIndex], from.occupants[fromIndex]];
          if (!roomIsCompatible(from.occupants, context) || !roomIsCompatible(to.occupants, context)) continue;
        }
      } else {
        candidate = rebuildNeighborhood(problem, current, roomSex, context, random);
        if (!candidate) continue;
      }
      let nextScore;
      try { nextScore = evaluateGrouping(problem, candidate); }
      catch { continue; }
      const comparison = compareScores(nextScore.score, currentScore.score);
      const progress = steps > 1 ? step / (steps - 1) : 1;
      const temperature = initialTemperature * (1 - progress) + finalTemperature * progress;
      const delta = scoreValue(nextScore.score) - scoreValue(currentScore.score);
      const accept = comparison >= 0 || random() < Math.exp(delta / temperature);
      if (accept) {
        current = candidate;
        currentScore = nextScore;
      }
      if (compareScores(nextScore.score, bestScore.score) > 0) {
        best = candidate.map(room => ({ id: room.id, occupants: [...room.occupants] }));
        bestScore = nextScore;
      }
    }
    return { rooms: best, evaluation: bestScore };
  }

  async function generateAssignments(problem, options = {}) {
    const feasibility = checkNecessaryFeasibility(problem);
    if (!feasibility.necessaryConditionsPass) {
      return { status: "infeasible_basic_constraints", issues: feasibility.issues, feasibility };
    }
    const attempts = Math.max(1, Number.isInteger(options.attempts) ? options.attempts : 48);
    const improvementSteps = Math.max(0, Number.isInteger(options.improvementSteps) ? options.improvementSteps : 800);
    const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : Math.floor(Math.random() * 4294967296);
    const random = seededRandom(seed);
    const context = buildSearchContext(problem);
    let best = null;
    let bestEvaluation = null;
    let completedAttempts = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      completedAttempts = attempt + 1;
      const candidate = constructGrouping(problem, context, random);
      if (candidate) {
        const repaired = repairCoverage(problem, candidate, context);
        const improved = improveGrouping(problem, repaired.rooms, context, random, improvementSteps);
        const finalCandidate = repairCoverage(problem, improved.rooms, context);
        if (!bestEvaluation || compareScores(finalCandidate.evaluation.score, bestEvaluation.score) > 0) {
          best = finalCandidate.rooms;
          bestEvaluation = finalCandidate.evaluation;
        }
      }
      const fullCoverageFound = Boolean(bestEvaluation && bestEvaluation.score.coveredPupils === problem.pupils.length);
      if (typeof options.onProgress === "function") options.onProgress({
        attempt: attempt + 1,
        attempts,
        found: Boolean(best),
        coveredPupils: bestEvaluation?.score.coveredPupils ?? 0,
        pupilCount: problem.pupils.length,
        fullCoverageFound
      });
      if (attempt % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
      if (fullCoverageFound) break;
    }
    if (!best) {
      return {
        status: "search_incomplete",
        seed,
        attempts: completedAttempts,
        feasibility,
        message: "The search limit was reached without finding a valid grouping. This does not prove that no valid grouping exists."
      };
    }
    const fullCoverageFound = bestEvaluation.score.coveredPupils === problem.pupils.length;
    return {
      status: fullCoverageFound ? "full_coverage_found" : "search_limit_reached",
      seed,
      attempts: completedAttempts,
      rooms: best,
      evaluation: bestEvaluation,
      feasibility,
      message: fullCoverageFound
        ? "A valid grouping covering every pupil’s preferences was found."
        : "The search limit was reached with a valid partial-coverage grouping. This does not prove that full coverage is impossible."
    };
  }

  window.PBGATAssignmentEngine = Object.freeze({
    createAssignmentProblem,
    analyzeAssignmentProblem,
    checkNecessaryFeasibility,
    evaluateGrouping,
    compareScores,
    generateAssignments
  });
})();
