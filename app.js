(() => {
  const HEADERS = [
    "Respondent Name", "Class", "Sex", "1st Choice", "2nd Choice", "3rd Choice",
    "4th Choice", "5th Choice", "Veto 1", "Veto 2"
  ];
  const CHOICES = HEADERS.slice(3, 8);
  const VETOES = HEADERS.slice(8);
  const IGNORED_HEADERS = ["Timestamp"];
  const fileInput = document.querySelector("#csv-file");
  const aboutDialog = document.querySelector("#about-dialog");
  const instructionsDialog = document.querySelector("#instructions-dialog");
  const dataProtectionDialog = document.querySelector("#data-protection-dialog");
  const results = document.querySelector("#results");
  const summary = document.querySelector("#summary");
  const issuesSection = document.querySelector("#issues-section");
  const issuesList = document.querySelector("#issues");
  const previewSection = document.querySelector("#preview-section");
  const preview = document.querySelector("#preview");
  const previewNote = document.querySelector("#preview-note");
  const continueSection = document.querySelector("#continue-section");
  const continueNote = document.querySelector("#continue-note");
  const continueButton = document.querySelector("#continue-button");
  const roomSetup = document.querySelector("#group-setup");
  const regularFields = document.querySelector("#regular-fields");
  const irregularFields = document.querySelector("#irregular-fields");
  const regularCount = document.querySelector("#regular-count");
  const regularBeds = document.querySelector("#regular-beds");
  const roomSizes = document.querySelector("#group-sizes");
  const singleSexGroupsInput = document.querySelector("#single-sex-groups");
  const capacitySummary = document.querySelector("#capacity-summary");
  const capacityError = document.querySelector("#capacity-error");
  const searchSeedInput = document.querySelector("#search-seed");
  const prepareAssignmentButton = document.querySelector("#prepare-assignment");
  const assignmentStatus = document.querySelector("#assignment-status");
  const assignmentAnalysis = document.querySelector("#assignment-analysis");
  const assignmentResults = document.querySelector("#assignment-results");
  const resultDetails = document.querySelector("#result-details");
  const searchSettings = document.querySelector("#search-settings");
  let validatedPeople = [];
  let assignmentProblem = null;
  let currentAssignment = null;
  let currentMode = "basic";
  let previewAvailable = false;
  let analysisAvailable = false;

  function applyMode(mode) {
    currentMode = mode;
    const basic = mode === "basic";
    document.documentElement.dataset.appMode = mode;
    continueNote.hidden = basic;
    previewSection.hidden = basic || !previewAvailable;
    searchSettings.hidden = basic;
    assignmentAnalysis.hidden = basic || !analysisAvailable;
    resultDetails.hidden = basic;
    if (capacityError.classList.contains("info-message")) capacityError.hidden = basic;
  }

  document.querySelectorAll('input[name="app-mode"]').forEach(input => input.addEventListener("change", event => {
    applyMode(event.target.value);
  }));
  applyMode("basic");
  [aboutDialog, instructionsDialog, dataProtectionDialog].forEach(dialog => {
    dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
  document.querySelector("#about-open").addEventListener("click", () => aboutDialog.showModal());
  document.querySelector("#instructions-open").addEventListener("click", () => instructionsDialog.showModal());
  document.querySelector("#data-protection-open").addEventListener("click", () => dataProtectionDialog.showModal());
  document.querySelectorAll(".csv-template-download").forEach(link => link.addEventListener("click", async event => {
    event.preventDefault();
    const note = document.querySelector("#csv-template-download-note");
    try {
      const response = await fetch(link.href);
      if (!response.ok) throw new Error("The template file could not be retrieved.");
      const fileUrl = URL.createObjectURL(await response.blob());
      const downloadLink = document.createElement("a");
      downloadLink.href = fileUrl;
      downloadLink.download = link.download || "PBGAT-response-template.csv";
      document.body.append(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    } catch {
      note.textContent = "Automatic download could not start. Right-click “Download CSV template” and choose “Save link as…”.";
    }
  }));

  function parseCsv(source) {
    const text = source.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field.length === 0) quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += char;
    }
    row.push(field);
    if (row.some(value => value.trim() !== "")) rows.push(row);
    return { rows, unterminatedQuote: quoted };
  }

  function key(value) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }

  function addIssue(list, line, column, message, severity = "error") {
    list.push({ line, column, message, severity });
  }

  function validate(parsed) {
    const issues = [];
    const { rows } = parsed;
    if (parsed.unterminatedQuote) addIssue(issues, "—", "CSV", "A quoted field was not closed.");
    if (!rows.length) {
      addIssue(issues, "—", "CSV", "The file is empty.");
      return { people: [], issues };
    }

    const header = rows[0].map(value => value.trim().replace(/^\uFEFF/, ""));
    const positions = new Map();
    header.forEach((name, index) => {
      const normalized = key(name);
      if (positions.has(normalized)) addIssue(issues, 1, name || `Column ${index + 1}`, "This column header appears more than once.");
      else positions.set(normalized, index);
    });
    HEADERS.forEach(name => {
      if (!positions.has(key(name))) addIssue(issues, 1, name, "Required column is missing.");
    });
    header.forEach((name, index) => {
      if (!HEADERS.some(expected => key(expected) === key(name)) && !IGNORED_HEADERS.some(ignored => key(ignored) === key(name))) {
        addIssue(issues, 1, name || `Column ${index + 1}`, "Unexpected column; it will be ignored.", "warning");
      }
    });
    if (HEADERS.some(name => !positions.has(key(name)))) return { people: [], issues };

    const people = [];
    rows.slice(1).forEach((cells, offset) => {
      const line = offset + 2;
      if (cells.every(value => value.trim() === "")) return;
      if (cells.length !== header.length) {
        addIssue(issues, line, "Row", `Expected ${header.length} columns, found ${cells.length}.`);
      }
      const person = {};
      HEADERS.forEach(name => { person[name] = (cells[positions.get(key(name))] || "").trim(); });
      person.line = line;
      ["Respondent Name", "Class", "Sex"].forEach(name => {
        if (!person[name]) addIssue(issues, line, name, "This field is required.");
      });
      CHOICES.forEach(name => {
        if (!person[name]) return;
        if (key(person[name]) === key(person["Respondent Name"])) addIssue(issues, line, name, "A child cannot choose themselves.");
      });
      people.push(person);
    });

    const byName = new Map();
    people.forEach(person => {
      const normalized = key(person["Respondent Name"]);
      if (!normalized) return;
      if (!byName.has(normalized)) byName.set(normalized, []);
      byName.get(normalized).push(person);
    });
    byName.forEach(matches => {
      if (matches.length > 1) matches.forEach(person => addIssue(issues, person.line, "Respondent Name", "This name is duplicated; names must identify one child uniquely."));
    });

    people.forEach(person => {
      const seen = new Map();
      [...CHOICES, ...VETOES].forEach(column => {
        const targetName = person[column];
        if (!targetName) return;
        const normalized = key(targetName);
        if (seen.has(normalized)) addIssue(issues, person.line, column, `This name is already listed in ${seen.get(normalized)}.`);
        else seen.set(normalized, column);
        if (normalized === key(person["Respondent Name"])) {
          if (VETOES.includes(column)) addIssue(issues, person.line, column, "A child cannot veto themselves.");
          return;
        }
        const matches = byName.get(normalized) || [];
        if (matches.length === 0) addIssue(issues, person.line, column, `“${targetName}” does not match a respondent name.`);
        else if (matches.length === 1 && key(matches[0].Sex) !== key(person.Sex)) {
          const message = VETOES.includes(column)
            ? `“${targetName}” has a different Sex value. This veto only affects assignments when mixed-sex groups are allowed.`
            : `“${targetName}” has a different Sex value. This choice can only be satisfied if mixed-sex groups are allowed.`;
          addIssue(issues, person.line, column, message, "warning");
        }
      });
    });

    return { people, issues };
  }

  function showTable(people) {
    preview.replaceChildren();
    const thead = document.createElement("thead");
    const headingRow = document.createElement("tr");
    HEADERS.forEach(label => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = label; headingRow.append(th);
    });
    thead.append(headingRow);
    const tbody = document.createElement("tbody");
    people.slice(0, 20).forEach(person => {
      const tr = document.createElement("tr");
      HEADERS.forEach(label => { const td = document.createElement("td"); td.textContent = person[label]; tr.append(td); });
      tbody.append(tr);
    });
    preview.append(thead, tbody);
    previewNote.textContent = people.length > 20 ? `Showing the first 20 of ${people.length} responses.` : `${people.length} response${people.length === 1 ? "" : "s"}.`;
    previewAvailable = people.length > 0;
    applyMode(currentMode);
  }

  function showResult(data) {
    validatedPeople = data.issues.some(issue => issue.severity !== "warning") ? [] : data.people;
    results.hidden = false;
    const errors = data.issues.filter(issue => issue.severity === "error");
    const warnings = data.issues.length - errors.length;
    summary.classList.toggle("error", errors.length > 0);
    summary.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = errors.length ? `Found ${errors.length} issue${errors.length === 1 ? "" : "s"}` : "CSV looks ready";
    const note = document.createElement("span");
    note.textContent = `${data.people.length} response${data.people.length === 1 ? "" : "s"} read${warnings ? `; ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}.${currentMode === "basic" ? " Continue to group setup when ready." : " Review the preview before proceeding."}`;
    summary.append(strong, note);
    issuesList.replaceChildren();
    data.issues.forEach(issue => {
      const li = document.createElement("li");
      li.textContent = `Row ${issue.line}, ${issue.column}: ${issue.message}`;
      issuesList.append(li);
    });
    issuesSection.hidden = data.issues.length === 0;
    continueSection.hidden = validatedPeople.length === 0;
    roomSetup.hidden = true;
    analysisAvailable = false;
    assignmentAnalysis.hidden = true;
    assignmentStatus.hidden = true;
    showTable(data.people);
  }

  function currentRoomType() {
    return document.querySelector('input[name="group-type"]:checked').value;
  }

  function addRoomSizeRow() {
    const row = document.createElement("div");
    row.className = "group-size-row";
    const countLabel = document.createElement("label");
    countLabel.textContent = "Number of groups ";
    const count = document.createElement("input");
    count.type = "number"; count.min = "1"; count.step = "1"; count.inputMode = "numeric"; count.setAttribute("aria-label", "Number of groups of this size");
    countLabel.append(count);
    const bedsLabel = document.createElement("label");
    bedsLabel.textContent = "Maximum people in each group ";
    const beds = document.createElement("input");
    beds.type = "number"; beds.min = "1"; beds.step = "1"; beds.inputMode = "numeric"; beds.setAttribute("aria-label", "Maximum people per group of this size");
    bedsLabel.append(beds);
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "secondary"; remove.textContent = "Remove";
    remove.addEventListener("click", () => { row.remove(); updateCapacity(); });
    row.append(countLabel, bedsLabel, remove);
    roomSizes.append(row);
    count.addEventListener("input", updateCapacity);
    beds.addEventListener("input", updateCapacity);
    updateCapacity();
  }

  function positiveInteger(input) {
    const value = Number(input.value);
    return input.value.trim() !== "" && Number.isInteger(value) && value > 0 ? value : null;
  }

  function updateCapacity() {
    assignmentProblem = null;
    analysisAvailable = false;
    assignmentStatus.hidden = true;
    assignmentAnalysis.hidden = true;
    assignmentResults.hidden = true;
    let roomCount = 0, totalBeds = 0, incomplete = false;
    capacityError.classList.remove("info-message");
    if (currentRoomType() === "regular") {
      const count = positiveInteger(regularCount), beds = positiveInteger(regularBeds);
      incomplete = count === null || beds === null;
      if (!incomplete) { roomCount = count; totalBeds = count * beds; }
    } else {
      const rows = [...roomSizes.querySelectorAll(".group-size-row")];
      incomplete = rows.length === 0;
      rows.forEach(row => {
        const inputs = row.querySelectorAll("input");
        const count = positiveInteger(inputs[0]), beds = positiveInteger(inputs[1]);
        if (count === null || beds === null) incomplete = true;
        else { roomCount += count; totalBeds += count * beds; }
      });
    }
    capacityError.hidden = true;
    if (incomplete) {
      capacitySummary.textContent = "Enter a positive whole number for each group count and maximum group size.";
      return;
    }
    capacitySummary.textContent = `${roomCount} groups · ${totalBeds} places total · ${validatedPeople.length} children`;
    if (totalBeds < validatedPeople.length) {
      capacityError.textContent = `There are ${validatedPeople.length - totalBeds} fewer places than children. Increase the total group capacity before continuing.`;
      capacityError.hidden = false;
    } else if (totalBeds > validatedPeople.length) {
      capacityError.textContent = `${totalBeds - validatedPeople.length} extra places across the groups.`;
      capacityError.classList.add("info-message");
      capacityError.hidden = currentMode === "basic";
    }
  }

  function getRoomConfiguration() {
    if (currentRoomType() === "regular") {
      return {
        type: "regular",
        roomCount: regularCount.value,
        bedsPerRoom: regularBeds.value,
        singleSexGroups: singleSexGroupsInput.checked
      };
    }
    return {
      type: "irregular",
      singleSexGroups: singleSexGroupsInput.checked,
      sizes: [...roomSizes.querySelectorAll(".group-size-row")].map(row => {
        const inputs = row.querySelectorAll("input");
        return { roomCount: inputs[0].value, bedsPerRoom: inputs[1].value };
      })
    };
  }

  function renderList(id, items, format, emptyText) {
    const list = document.querySelector(`#${id}`);
    list.replaceChildren();
    if (items.length === 0) {
      const li = document.createElement("li"); li.textContent = emptyText; list.append(li); return;
    }
    items.forEach(item => { const li = document.createElement("li"); li.textContent = format(item); list.append(li); });
  }

  function showPlanningSignals(signals) {
    analysisAvailable = true;
    applyMode(currentMode);
    renderList("tricky-cases", signals.trickyCases,
      item => `${item.name}: ${item.reasons.join("; ")}. ${item.availablePreferenceCount} veto-compatible choice${item.availablePreferenceCount === 1 ? "" : "s"}.`,
      "No pupils meet the current tricky-case criteria.");
    renderList("suggested-pairs", signals.suggestedPairs,
      pair => `${pair.pupil} → ${pair.partner} (choice ${pair.preferenceRank}; named by ${pair.partnerPopularity} pupil${pair.partnerPopularity === 1 ? "" : "s"}). Provisional suggestion.`,
      "No preference-based pair suggestions can be made for the identified tricky cases.");
    renderList("mutual-groups", signals.mutualChoiceGroups,
      group => group.join(", "),
      "No strict mutual-choice groups were found.");
    renderList("popularity-list", signals.popularity.slice(0, 20),
      pupil => `${pupil.name} — ${pupil.mentions} mention${pupil.mentions === 1 ? "" : "s"}`,
      "No popularity data.");
  }

  function showFeasibility(feasibility) {
    document.querySelector("#feasibility-note").textContent = feasibility.necessaryConditionsPass
      ? "The basic capacity and group-composition checks pass. Veto compatibility still needs to be checked against a complete grouping."
      : "The current group-size data has definite blockers for a valid grouping.";
    renderList("feasibility-issues", feasibility.issues, issue => issue, "No definite blockers found.");
  }

  function showAssignmentResult(result, problem) {
    currentAssignment = result;
    assignmentResults.hidden = false;
    const capacityById = new Map(problem.rooms.map(room => [room.id, room.capacity]));
    const roomOrder = (a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, ""));
    renderList("group-assignments", [...result.rooms].sort(roomOrder), room =>
      `${room.id} (${room.occupants.length}/${capacityById.get(room.id)} people): ${room.occupants.join(", ")}`,
      "No groups assigned.");
    const score = result.evaluation.score;
    const percent = Math.round(score.coveredPupils / problem.pupils.length * 1000) / 10;
    const uncovered = result.evaluation.pupilOutcomes.filter(pupil => pupil.bestRank === null).map(pupil => pupil.name);
    const coverageSummary = document.querySelector("#coverage-summary");
    coverageSummary.classList.toggle("partial", result.status !== "full_coverage_found");
    coverageSummary.textContent = result.status === "full_coverage_found"
      ? `All ${problem.pupils.length} pupils are with at least one of their choices (100%).`
      : `${score.coveredPupils} of ${problem.pupils.length} pupils are with at least one of their choices (${percent}%). Full coverage was not found in this search; this does not prove it is impossible.`;
    const uncoveredSection = document.querySelector("#uncovered-section");
    uncoveredSection.hidden = uncovered.length === 0;
    renderList("uncovered-pupils", uncovered, name => name, "");
    const report = [
      `Choice ranks: 1st ${score.rankCounts[1]}, 2nd ${score.rankCounts[2]}, 3rd ${score.rankCounts[3]}, 4th ${score.rankCounts[4]}, 5th ${score.rankCounts[5]}.`,
      `${score.multipleChoicePupils} pupils have more than one preferred group member in their group.`,
      `Search details: ${result.attempts} attempts; seed ${result.seed}.`
    ];
    renderList("success-report", report, item => item, "No report available.");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportAssignmentCsv() {
    if (!currentAssignment || !assignmentProblem) return;
    const pupilsByName = new Map(assignmentProblem.pupils.map(pupil => [pupil.name, pupil]));
    const outcomesByName = new Map(currentAssignment.evaluation.pupilOutcomes.map(outcome => [outcome.name, outcome]));
    const roomOrder = (a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, ""));
    const capacityById = new Map(assignmentProblem.rooms.map(room => [room.id, room.capacity]));
    const rows = [["Group", "Group size", "Group maximum size", "Respondent Name", "Class", "Sex", "Best choice rank", "Choices in group"]];
    [...currentAssignment.rooms].sort(roomOrder).forEach(group => {
      group.occupants.forEach(name => {
        const pupil = pupilsByName.get(name);
        const outcome = outcomesByName.get(name);
        const choicesInGroup = outcome?.matchedChoices.map(choice => choice.name).join("; ") || "";
        rows.push([group.id, group.occupants.length, capacityById.get(group.id) ?? "", name, pupil?.className || "", pupil?.sex || "", outcome?.bestRank ?? "", choicesInGroup]);
      });
    });
    const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "PBGAT-group-assignments.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  continueButton.addEventListener("click", () => {
    if (!validatedPeople.length) return;
    roomSetup.hidden = false;
    roomSetup.scrollIntoView({ behavior: "smooth", block: "start" });
    updateCapacity();
  });
  document.querySelectorAll('input[name="group-type"]').forEach(input => input.addEventListener("change", () => {
    regularFields.hidden = currentRoomType() !== "regular";
    irregularFields.hidden = currentRoomType() !== "irregular";
    capacityError.classList.remove("info-message");
    updateCapacity();
  }));
  regularCount.addEventListener("input", updateCapacity);
  regularBeds.addEventListener("input", updateCapacity);
  searchSeedInput.addEventListener("input", updateCapacity);
  document.querySelector("#add-group-size").addEventListener("click", addRoomSizeRow);
  async function runAssignment({ retry = false } = {}) {
    prepareAssignmentButton.disabled = true;
    document.querySelector("#retry-assignment").disabled = true;
    roomSetup.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
    assignmentStatus.hidden = false;
    assignmentStatus.classList.remove("error");
    assignmentResults.hidden = true;
    try {
      if (!retry) {
        assignmentProblem = window.PBGATAssignmentEngine.createAssignmentProblem({
          people: validatedPeople,
          roomConfiguration: getRoomConfiguration()
        });
        const planningSignals = window.PBGATAssignmentEngine.analyzeAssignmentProblem(assignmentProblem);
        const feasibility = window.PBGATAssignmentEngine.checkNecessaryFeasibility(assignmentProblem);
        const { pupilCount, roomCount, totalBeds, vetoPairCount } = assignmentProblem.summary;
        showPlanningSignals(planningSignals);
        showFeasibility(feasibility);
        if (!feasibility.necessaryConditionsPass) {
          assignmentStatus.classList.add("error");
          assignmentStatus.textContent = `Cannot start: the basic feasibility precheck found blockers. ${pupilCount} pupils, ${roomCount} groups, capacity for ${totalBeds}, ${vetoPairCount} prohibited pair${vetoPairCount === 1 ? "" : "s"}.`;
          return;
        }
      }
      const { pupilCount, roomCount, vetoPairCount } = assignmentProblem.summary;
      assignmentStatus.textContent = `Preparing groups for ${pupilCount} pupils across ${roomCount} groups (${vetoPairCount} prohibited pairs)…`;
      const searchOptions = {};
      if (retry && currentAssignment) {
        searchOptions.seed = (currentAssignment.seed + 1) >>> 0;
        searchSeedInput.value = String(searchOptions.seed);
      } else if (searchSeedInput.value.trim() !== "") {
        const seed = Number(searchSeedInput.value);
        if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error("Search seed must be a whole number between 0 and 4294967295.");
        searchOptions.seed = seed;
      }
      const result = await window.PBGATAssignmentEngine.generateAssignments(assignmentProblem, {
        ...searchOptions,
        onProgress: progress => {
          assignmentStatus.textContent = `Search attempt ${progress.attempt} of ${progress.attempts}; best coverage so far: ${progress.coveredPupils}/${progress.pupilCount}${progress.fullCoverageFound ? " — full coverage found." : "…"}`;
        }
      });
      if (result.rooms) {
        assignmentStatus.hidden = true;
        showAssignmentResult(result, assignmentProblem);
      } else {
        assignmentStatus.classList.add("error");
        assignmentStatus.textContent = result.message || result.issues.join(" ");
      }
    } catch (error) {
      assignmentProblem = null;
      assignmentAnalysis.hidden = true;
      assignmentResults.hidden = true;
      assignmentStatus.classList.add("error");
      assignmentStatus.textContent = error.message;
    } finally {
      roomSetup.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
      prepareAssignmentButton.disabled = false;
      document.querySelector("#retry-assignment").disabled = false;
    }
  }

  prepareAssignmentButton.addEventListener("click", () => runAssignment());
  document.querySelector("#retry-assignment").addEventListener("click", () => runAssignment({ retry: true }));
  document.querySelector("#export-assignments").addEventListener("click", exportAssignmentCsv);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    roomSetup.hidden = true;
    assignmentProblem = null;
    currentAssignment = null;
    previewAvailable = false;
    analysisAvailable = false;
    assignmentStatus.hidden = true;
    assignmentResults.hidden = true;
    assignmentAnalysis.hidden = true;
    if (!file) { results.hidden = true; continueSection.hidden = true; assignmentAnalysis.hidden = true; previewSection.hidden = true; return; }
    try {
      showResult(validate(parseCsv(await file.text())));
    } catch {
      showResult({ people: [], issues: [{ line: "—", column: "CSV", message: "The file could not be read. Please choose a valid CSV file." }] });
    }
  });
})();
