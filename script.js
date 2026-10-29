let apData = [];
let deData = [];
let majorData = {};

let activeMajor = 'biology';
let activeSchedule = {}; // semesterName -> array of courseCodes
const collapsedCategories = new Set();

let activeProfileName = null;
let profiles = {};

const gtMajorSelect = document.getElementById('gt-major');
const rowsContainer = document.getElementById('semester-rows-container');
const catalogSearchInput = document.getElementById('catalog-search-input');
const loadSuggestedBtn = document.getElementById('load-suggested-btn');

const activeProfileIndicator = document.getElementById('active-profile-indicator');
const profileSaveBtn = document.getElementById('profile-save-btn');
const profileSaveAsBtn = document.getElementById('profile-save-as-btn');
const profileListContainer = document.getElementById('profile-list-container');

function loadDEData() {
    try {
        const savedDE = localStorage.getItem('gt_de_credits');
        if (savedDE !== null) {
            return JSON.parse(savedDE);
        }
    } catch (e) {
        console.error("Error reading Dual Enrollment credits:", e);
    }
    return [];
}

function formatMajorName(name) {
    if (!name) return '';
    let cleaned = name.replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"')
                      .replace(/&#039;/g, "'")
                      .replace(/&#8203;/g, '');
    
    cleaned = cleaned.replace(/^Bachelor\s+of\s+Science\s+in\s+/i, '')
                     .replace(/^Bachelor\s+of\s+Science\s+/i, '')
                     .replace(/\s*\(B\.S\.\)/i, '');
    
    cleaned = cleaned.replace(/-\s*Thread:\s*/i, '- ')
                     .replace(/Thread:\s*/i, '');
    
    return cleaned.trim();
}

function init() {
    // Populate data from data.js variables
    apData = AP_DATA.classes;
    deData = loadDEData();
    majorData = MAJOR_DATA.gt;

    // Dynamically populate major dropdown from MAJOR_DATA (alphabetized)
    if (gtMajorSelect && majorData) {
        gtMajorSelect.innerHTML = '';
        const sortedKeys = Object.keys(majorData).sort((a, b) => {
            const nameA = formatMajorName(majorData[a].name || a).toLowerCase();
            const nameB = formatMajorName(majorData[b].name || b).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        sortedKeys.forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = formatMajorName(majorData[key].name || key);
            gtMajorSelect.appendChild(opt);
        });
    }

    // Load saved major
    const savedMajor = localStorage.getItem('gt_planner_major');
    if (savedMajor && majorData[savedMajor]) {
        activeMajor = savedMajor;
        gtMajorSelect.value = savedMajor;
    }

    // Collapse all categories by default on load
    collapsedCategories.clear();
    const major = majorData[activeMajor];
    if (major && major.requirements) {
        for (let category in major.requirements) {
            collapsedCategories.add(category);
        }
        collapsedCategories.add("Legislative Requirements");
    }

    // Load active schedule from localStorage
    try {
        activeSchedule = JSON.parse(localStorage.getItem('gt_planner_active_schedule') || '{}');
    } catch (e) {
        console.error("Error reading schedule from localStorage:", e);
    }

    // Fallback if empty schedule: load default major curriculum
    if (Object.keys(activeSchedule).length === 0) {
        const major = majorData[activeMajor];
        activeSchedule = JSON.parse(JSON.stringify(major.suggested_semesters));
        
        // Clean up immediately to filter out AP/DE credits from default semesters
        const transferCodes = new Set(getTransferCredits().map(c => c.code));
        for (let semName in activeSchedule) {
            activeSchedule[semName] = activeSchedule[semName].filter(code => !transferCodes.has(code));
        }
    }

    // Sidebar Tab selection logic
    const tabChecklist = document.getElementById('tab-checklist');
    const tabSearch = document.getElementById('tab-search');
    const checklistView = document.getElementById('checklist-view');
    const searchView = document.getElementById('search-view');

    tabChecklist.addEventListener('click', () => {
        tabChecklist.classList.add('active');
        tabSearch.classList.remove('active');
        checklistView.classList.add('active');
        searchView.classList.remove('active');
    });

    tabSearch.addEventListener('click', () => {
        tabSearch.classList.add('active');
        tabChecklist.classList.remove('active');
        searchView.classList.add('active');
        checklistView.classList.remove('active');
    });

    // Event listeners for controls
    gtMajorSelect.addEventListener('change', () => {
        activeMajor = gtMajorSelect.value;
        localStorage.setItem('gt_planner_major', activeMajor);
        
        // Collapse all categories for the new major
        collapsedCategories.clear();
        const newMajor = majorData[activeMajor];
        if (newMajor && newMajor.requirements) {
            for (let category in newMajor.requirements) {
                collapsedCategories.add(category);
            }
            collapsedCategories.add("Legislative Requirements");
        }
        
        // Auto-load suggested plan of study if schedule is currently empty
        const plannedCourseCount = Object.values(activeSchedule).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        if (plannedCourseCount === 0 && newMajor && newMajor.suggested_semesters) {
            activeSchedule = JSON.parse(JSON.stringify(newMajor.suggested_semesters));
            localStorage.setItem('gt_planner_active_schedule', JSON.stringify(activeSchedule));
        }
        
        updatePlanner();
    });

    loadSuggestedBtn.addEventListener('click', () => {
        const majorName = majorData[activeMajor].name;
        if (confirm(`Are you sure you want to reset your schedule? This will replace all planned semester courses with the official suggested plan of study for ${majorName}. (Transfer credits will be preserved).`)) {
            const major = majorData[activeMajor];
            activeSchedule = JSON.parse(JSON.stringify(major.suggested_semesters));
            localStorage.setItem('gt_planner_active_schedule', JSON.stringify(activeSchedule));
            updatePlanner();
        }
    });

    catalogSearchInput.addEventListener('input', () => {
        renderSearchCatalog();
    });

    // Initialize searches, profiles and planner
    renderSearchCatalog();
    updatePlanner();
    initProfiles();
    initTutorial();
}

function saveState() {
    const currentSchedule = {};
    const seenCodes = new Set();
    
    // Add transfer credits to seenCodes so they cannot be planned in semesters
    const transferCredits = getTransferCredits();
    transferCredits.forEach(c => seenCodes.add(c.code));

    document.querySelectorAll('.semester-column').forEach(col => {
        const listEl = col.querySelector('.class-list');
        if (listEl && listEl.id !== 'ap-transfer-list' && listEl.id !== 'de-transfer-list') {
            const semName = listEl.dataset.semester;
            if (semName) {
                const courseCodes = [];
                listEl.querySelectorAll('[data-code]').forEach(card => {
                    if (card.dataset.code) {
                        const code = card.dataset.code;
                        const isPlaceholder = code.includes("ELECTIVE") || code.includes("DEPTH") || code.includes("BREADTH") || (COURSES_DB[code] && COURSES_DB[code].choices);
                        if (isPlaceholder || !seenCodes.has(code)) {
                            courseCodes.push(code);
                            if (!isPlaceholder) {
                                seenCodes.add(code);
                            }
                        }
                    }
                });
                currentSchedule[semName] = courseCodes;
            }
        }
    });

    activeSchedule = currentSchedule;
    localStorage.setItem('gt_planner_active_schedule', JSON.stringify(activeSchedule));
}

function getCourseHours(code) {
    if (COURSES_DB[code] && COURSES_DB[code].hours) {
        return COURSES_DB[code].hours;
    }
    return 3; // default fallback
}

function getAPCredits() {
    const list = [];
    let savedScores = {};
    let savedSelections = {};
    try {
        savedScores = JSON.parse(localStorage.getItem('gt_ap_scores') || '{}');
        savedSelections = JSON.parse(localStorage.getItem('gt_ap_selections') || '{}');
    } catch (e) {
        console.error(e);
    }

    apData.forEach(ap => {
        const score = savedScores[ap.name] || 0;
        const rule = ap.rules[score];
        if (rule) {
            const selection = rule.choices ? (savedSelections[ap.name] || rule.choices[0]) : rule.gt_credit;
            if (selection && selection !== 'None') {
                const parts = selection.split('&').map(p => p.trim());
                parts.forEach(partCode => {
                    const hours = getCourseHours(partCode);
                    list.push({
                        code: partCode,
                        name: `AP ${ap.name} Credit (Score: ${score})`,
                        hours: hours,
                        source: "AP Credit",
                        examName: ap.name,
                        description: ap.description || `Earned credit for ${partCode} via AP Exam.`
                    });
                });
            }
        }
    });
    return list;
}

function getDECredits() {
    const list = [];
    deData.forEach((de, deIndex) => {
        const code = de.gt_credit;
        if (code && code !== 'None') {
            const parts = code.split('&').map(p => p.trim());
            parts.forEach(partCode => {
                const hours = getCourseHours(partCode);
                list.push({
                    code: partCode,
                    name: de.name,
                    hours: hours,
                    source: "Dual Enrollment",
                    deIndex: deIndex,
                    description: de.description || `Earned credit for ${partCode} via Dual Enrollment.`
                });
            });
        }
    });
    return list;
}

function getTransferCredits() {
    const ap = getAPCredits();
    const de = getDECredits();
    return [...ap, ...de];
}

function getCourseCategory(code) {
    if (!code) return null;
    if (COURSES_DB[code] && COURSES_DB[code].category) {
        return COURSES_DB[code].category;
    }
    const humPrefixes = [
        "LMC", "PHIL", "LING", "MUSI", "ID", "ARCH", "COA", "HUM", "IAC", "CLL", "GMC", "ML",
        "SPAN", "FREN", "GRMN", "JAPN", "CHIN", "KOR", "RUSS", "ARBC", "LATN", "PORT", "PERS", "HEBW", "HIN", "SWAH", "WOLO"
    ];
    if (humPrefixes.some(p => code.startsWith(p + " ") || code === p)) {
        return "HUM";
    }
    if (code.startsWith("ENGL ") && code !== "ENGL 1101" && code !== "ENGL 1102") {
        return "HUM";
    }
    const ssPrefixes = [
        "ECON", "PSYC", "SOC", "HTS", "HIST", "POL", "INTA", "PUBP", "SS", "CP", "SLS"
    ];
    if (ssPrefixes.some(p => code.startsWith(p + " ") || code === p)) {
        return "SS";
    }
    return null;
}

function isElectivePlaceholderCode(code) {
    if (!code) return false;
    return code.includes("ELECTIVE") || code.includes("DEPTH") || code.includes("BREADTH") || code === "RESEARCH";
}

function doesCourseMatchElectiveSlot(courseCode, slotKey, hasAPBio5 = false) {
    if (!courseCode || !slotKey) return false;
    if (isElectivePlaceholderCode(courseCode)) return false;
    if (COURSES_DB[courseCode] && Array.isArray(COURSES_DB[courseCode].choices)) return false;

    const numMatch = courseCode.match(/(\d+)/);
    const rawNum = numMatch ? parseInt(numMatch[1], 10) : 0;
    const isGenericTransfer = courseCode.endsWith("XXX");
    const num = isGenericTransfer ? rawNum * 1000 : rawNum;
    const hours = getCourseHours(courseCode);

    if (hasAPBio5 && (slotKey === "BIOS 1208" || slotKey === "BIOS 1208L")) {
        const minHours = slotKey === "BIOS 1208L" ? 1 : 3;
        return courseCode.startsWith("BIOS ") && hours >= minHours;
    }

    // All standard 3-hour elective/breadth/depth/research slots require at least 3 credit hours
    // (prevents 0h recitations, 1h labs, and 1h support courses like MATH 1499 from hijacking 3h slots)
    if (hours < 3) return false;

    if (slotKey === "RESEARCH") {
        return courseCode === "BIOS 4590" || courseCode === "BIOS 4690" || courseCode === "BIOS 4699" || courseCode === "BIOS 2699";
    } else if (slotKey.startsWith("BIOS DEPTH")) {
        return courseCode.startsWith("BIOS ") && num >= 3000 && num < 5000;
    } else if (slotKey.startsWith("BIOS BREADTH")) {
        const sciencePrefixes = ["CHEM", "PHYS", "MATH", "CS", "NEUR", "BMED", "BIOS", "EAS", "PSYC"];
        return num >= 2000 && num < 5000 && sciencePrefixes.some(p => courseCode.startsWith(p + " "));
    } else if (slotKey.startsWith("BMED DEPTH")) {
        return courseCode.startsWith("BMED ") && num >= 3000 && num < 5000;
    } else if (slotKey.startsWith("BMED BREADTH")) {
        const engSciPrefixes = ["CHEM", "PHYS", "MATH", "CS", "BIOS", "MSE", "ECE", "COE", "ISYE", "BMED", "ME", "CHBE"];
        return num >= 2000 && num < 5000 && engSciPrefixes.some(p => courseCode.startsWith(p + " "));
    } else if (slotKey.startsWith("NEUR BREADTH")) {
        const neurPrefixes = ["NEUR", "PSYC", "BIOS", "BMED", "CS", "MATH", "CHEM", "PHYS"];
        return num >= 2000 && num < 5000 && neurPrefixes.some(p => courseCode.startsWith(p + " "));
    } else if (slotKey.startsWith("PSYC ELECTIVE")) {
        return courseCode.startsWith("PSYC ") && num >= 2000 && num < 5000;
    } else if (slotKey === "HUM ELECTIVE") {
        return getCourseCategory(courseCode) === "HUM";
    } else if (slotKey === "SS ELECTIVE") {
        return getCourseCategory(courseCode) === "SS";
    } else if (slotKey === "FREE ELECTIVE") {
        return true;
    }
    return false;
}

function getMatchingCoursesForElective(slotKey) {
    const results = [];
    for (const code in COURSES_DB) {
        if (code.endsWith("XXX")) continue;
        const numMatch = code.match(/(\d+)/);
        const num = numMatch ? parseInt(numMatch[1], 10) : 0;
        if (num >= 5000) continue;

        if (doesCourseMatchElectiveSlot(code, slotKey)) {
            const c = COURSES_DB[code];
            results.push({
                code: code,
                name: c.name,
                hours: c.hours,
                description: c.description
            });
        }
    }
    return results;
}

function auditRequirements(majorKey, schedule, transferCredits) {
    let planned = [];
    
    // Add transfer credits
    transferCredits.forEach(c => {
        planned.push({ code: c.code, source: c.source });
    });
    
    // Add semester courses
    for (let semName in schedule) {
        schedule[semName].forEach(code => {
            planned.push({ code: code, source: semName });
        });
    }
    
    const major = majorData[majorKey];
    const auditResults = {};
    
    // Detect AP Biology Score of 5 for Biology majors
    let apScores = {};
    try {
        apScores = JSON.parse(localStorage.getItem('gt_ap_scores') || '{}');
    } catch (e) {}
    const hasAPBio5 = (majorKey === 'biology' && apScores["Biology"] === 5);
    
    // Helper to find and consume a course from planned
    function consumeCourse(matchFn) {
        const idx = planned.findIndex(matchFn);
        if (idx !== -1) {
            const c = planned[idx];
            planned.splice(idx, 1);
            return c;
        }
        return null;
    }
    
    // 1. Audit specific course requirements first
    for (let category in major.requirements) {
        auditResults[category] = [];
        const slots = major.requirements[category];
        
        slots.forEach(slotKey => {
            let satisfiedBy = null;
            let displayName = slotKey;
            let isChoice = false;
            let choices = [];
            
            if (COURSES_DB[slotKey]) {
                const dbCourse = COURSES_DB[slotKey];
                displayName = dbCourse.name;
                if (dbCourse.choices) {
                    isChoice = true;
                    choices = dbCourse.choices;
                }
            }
            
            if (isChoice) {
                // Prefer a specific chosen course over the generic choice key
                satisfiedBy = consumeCourse(c => choices.includes(c.code)) || consumeCourse(c => c.code === slotKey);
            } else if (slotKey.includes("ELECTIVE") || slotKey.includes("DEPTH") || slotKey.includes("BREADTH")) {
                // Elective placeholders are skipped in the first specific pass
                satisfiedBy = null;
            } else if (hasAPBio5 && (slotKey === "BIOS 1208" || slotKey === "BIOS 1208L")) {
                // AP Biology 5 substitution: skip exact match in Pass 1 to treat as general biology electives
                satisfiedBy = null;
            } else {
                satisfiedBy = consumeCourse(c => c.code === slotKey);
            }
            
            auditResults[category].push({
                slotKey: slotKey,
                displayName: displayName,
                satisfiedBy: satisfiedBy,
                isChoice: isChoice,
                choices: choices
            });
        });
    }
    
    // 2. Audit elective placeholders next (non-FREE ELECTIVE first, then FREE ELECTIVE last)
    const auditElectiveSlots = (onlyFreeElectives) => {
        for (let category in auditResults) {
            auditResults[category].forEach(slot => {
                if (slot.satisfiedBy) return;
                
                const slotKey = slot.slotKey;
                const isFree = (slotKey === "FREE ELECTIVE");
                if (onlyFreeElectives !== isFree) return;

                if (slotKey.includes("ELECTIVE") || slotKey.includes("DEPTH") || slotKey.includes("BREADTH") || slotKey === "RESEARCH" || (hasAPBio5 && (slotKey === "BIOS 1208" || slotKey === "BIOS 1208L"))) {
                    if (hasAPBio5 && (slotKey === "BIOS 1208" || slotKey === "BIOS 1208L")) {
                        slot.displayName = slotKey === "BIOS 1208" ? "AP Bio 5 Sub Elective (3h)" : "AP Bio 5 Sub Elective (1h)";
                    }
                    // First try to match a specific planned course; fall back to the placeholder itself
                    const satisfiedBy = consumeCourse(c => doesCourseMatchElectiveSlot(c.code, slotKey, hasAPBio5))
                        || consumeCourse(c => c.code === slotKey);
                    if (satisfiedBy) {
                        slot.satisfiedBy = satisfiedBy;
                    }
                }
            });
        }
    };

    auditElectiveSlots(false);
    auditElectiveSlots(true);
    
    // Remaining planned courses go to Unused
    auditResults["Unused Courses"] = planned.map(c => ({
        slotKey: c.code,
        displayName: COURSES_DB[c.code] ? COURSES_DB[c.code].name : "Custom Course",
        satisfiedBy: c,
        isExtra: true
    }));
    
    // 3. Compute Legislative Requirements in parallel (they don't consume courses)
    const allPlannedCodes = new Set();
    transferCredits.forEach(c => allPlannedCodes.add(c.code));
    for (let semName in schedule) {
        schedule[semName].forEach(code => allPlannedCodes.add(code));
    }
    
    const hasHist = allPlannedCodes.has("HIST 2111") || allPlannedCodes.has("HIST 2112");
    const hasConst = allPlannedCodes.has("POL 1101") || allPlannedCodes.has("INTA 1200") || allPlannedCodes.has("PUBP 3000");
    
    auditResults["Legislative Requirements"] = [
        { 
            slotKey: "GLR_US_HIST", 
            displayName: "US History", 
            satisfiedBy: hasHist ? { code: Array.from(allPlannedCodes).find(c => c === "HIST 2111" || c === "HIST 2112"), source: "Course" } : null 
        },
        { 
            slotKey: "GLR_GA_HIST", 
            displayName: "GA History", 
            satisfiedBy: hasHist ? { code: Array.from(allPlannedCodes).find(c => c === "HIST 2111" || c === "HIST 2112"), source: "Course" } : null 
        },
        { 
            slotKey: "GLR_US_CONST", 
            displayName: "US Constitution", 
            satisfiedBy: hasConst ? { code: Array.from(allPlannedCodes).find(c => c === "POL 1101" || c === "INTA 1200" || c === "PUBP 3000"), source: "Course" } : null 
        },
        { 
            slotKey: "GLR_GA_CONST", 
            displayName: "GA Constitution", 
            satisfiedBy: hasConst ? { code: Array.from(allPlannedCodes).find(c => c === "POL 1101" || c === "INTA 1200" || c === "PUBP 3000"), source: "Course" } : null 
        }
    ];
    
    return auditResults;
}

function buildCourseToRequirementMap(auditResults) {
    const mapping = new Map();
    for (let category in auditResults) {
        if (category === "Unused Courses" || category === "Legislative Requirements") continue;
        auditResults[category].forEach(slot => {
            if (slot.satisfiedBy) {
                const key = `${slot.satisfiedBy.source}|${slot.satisfiedBy.code}`;
                mapping.set(key, {
                    category: category,
                    slotKey: slot.slotKey,
                    slotName: slot.displayName,
                    isChoice: slot.isChoice,
                    choices: slot.choices
                });
            }
        });
    }
    return mapping;
}

function removeCourseFromSemester(semName, courseCode) {
    const idSafeName = semName.replace(/\s+/g, '-');
    const listEl = document.getElementById(`list-${idSafeName}`);
    if (listEl) {
        const card = listEl.querySelector(`.class-card[data-code="${courseCode}"]`);
        if (card) {
            card.remove();
        }
    }
    saveState();
    updatePlanner();
}

function updateCatalogLinks() {
    const major = majorData[activeMajor];
    const headerLink = document.getElementById('major-catalog-link');
    const checklistLink = document.getElementById('checklist-catalog-link');
    let url = 'https://catalog.gatech.edu/programs/';
    if (major && major.url) {
        url = major.url;
    } else if (activeMajor) {
        url = `https://catalog.gatech.edu/programs/${activeMajor.replace(/_/g, '-')}-bs/`;
    }

    if (headerLink) {
        headerLink.href = url;
        headerLink.style.display = 'inline-flex';
    }
    if (checklistLink) {
        checklistLink.href = url;
        checklistLink.style.display = 'inline-flex';
    }
}

function updatePlanner() {
    updateCatalogLinks();
    const transferCredits = getTransferCredits();
    
    // 1. Collect all specific courses currently planned across all semesters
    const plannedSpecificCodes = new Set();
    for (let semName in activeSchedule) {
        activeSchedule[semName].forEach(code => {
            if (!code.includes("DEPTH") && !code.includes("BREADTH") && !code.includes("ELECTIVE") && !code.includes("ECOLOGY") && !code.includes("GENETICS") && !code.includes("RESEARCH")) {
                plannedSpecificCodes.add(code);
            }
        });
    }
    
    // Add transfer credits to specific planned courses
    transferCredits.forEach(c => {
        if (!c.code.includes("DEPTH") && !c.code.includes("BREADTH") && !c.code.includes("ELECTIVE")) {
            plannedSpecificCodes.add(c.code);
        }
    });

    // 2. Collect all active placeholder keys for current major
    const major = majorData[activeMajor];
    const placeholderKeys = new Set();
    if (major && major.requirements) {
        for (let category in major.requirements) {
            major.requirements[category].forEach(code => {
                if (COURSES_DB[code] && COURSES_DB[code].choices) {
                    placeholderKeys.add(code);
                }
            });
        }
    }
    
    // 3. Find placeholders that are satisfied by any of these planned specific courses
    const placeholdersToRemove = new Set();
    placeholderKeys.forEach(pKey => {
        const choices = COURSES_DB[pKey].choices;
        if (choices && choices.some(choiceCode => plannedSpecificCodes.has(choiceCode))) {
            placeholdersToRemove.add(pKey);
        }
    });
    
    // 4. Clean up schedule: remove transfer credits and satisfied placeholders
    let scheduleChanged = false;
    const transferCodes = new Set(transferCredits.map(c => c.code));
    
    for (let semName in activeSchedule) {
        const originalCount = activeSchedule[semName].length;
        activeSchedule[semName] = activeSchedule[semName].filter(code => {
            // Remove if covered by transfer credits
            if (transferCodes.has(code)) return false;
            // Remove if it is a placeholder that is now satisfied by a specific course
            if (placeholdersToRemove.has(code)) return false;
            return true;
        });
        
        if (activeSchedule[semName].length !== originalCount) {
            scheduleChanged = true;
        }
    }
    
    if (scheduleChanged) {
        localStorage.setItem('gt_planner_active_schedule', JSON.stringify(activeSchedule));
    }
    
    const auditResults = auditRequirements(activeMajor, activeSchedule, transferCredits);
    
    renderSemesters(auditResults);
    renderChecklist(auditResults);
    updateStats(auditResults);
}

function renderSemesters(auditResults) {
    const fulfilledMap = buildCourseToRequirementMap(auditResults);
    rowsContainer.innerHTML = '';

    const semesterPairs = [
        ["Transfer", "Summer 2026"],
        ["Fall 2026", "Spring 2027"],
        ["Fall 2027", "Spring 2028"],
        ["Fall 2028", "Spring 2029"],
        ["Fall 2029", "Spring 2030"]
    ];

    semesterPairs.forEach(pair => {
        const row = document.createElement('div');
        row.className = 'calendar-row';
        
        pair.forEach(semName => {
            row.appendChild(createSemesterCell(semName, fulfilledMap));
        });
        
        rowsContainer.appendChild(row);
    });
}

function createSemesterCell(semName, fulfilledMap) {
    const cell = document.createElement('div');
    cell.className = 'semester-column';

    if (semName === "Transfer") {
        const apCredits = getAPCredits();
        const deCredits = getDECredits();
        const apHours = apCredits.reduce((sum, c) => sum + c.hours, 0);
        const deHours = deCredits.reduce((sum, c) => sum + c.hours, 0);
        const totalHours = apHours + deHours;

        const semEl = document.createElement('div');
        semEl.className = 'semester transfer-block';
        semEl.innerHTML = `
            <h3>Transfer Credits <span class="semester-credits">${totalHours}h</span></h3>
            
            <div class="transfer-section">
                <div class="transfer-section-header clickable" id="ap-header" title="Click to manage AP exam scores">
                    <span>AP Credits <span class="semester-credits">(${apHours}h)</span></span>
                    <span class="edit-link">✏️ Edit</span>
                </div>
                <div class="class-list" id="ap-transfer-list"></div>
            </div>
            
            <div class="transfer-section" style="margin-top: 1rem;">
                <div class="transfer-section-header clickable" id="de-header" title="Click to manage Dual Enrollment credits">
                    <span>Dual Enrollment <span class="semester-credits">(${deHours}h)</span></span>
                    <span class="edit-link">✏️ Edit</span>
                </div>
                <div class="class-list" id="de-transfer-list"></div>
            </div>
        `;

        const apListEl = semEl.querySelector('#ap-transfer-list');
        apCredits.forEach(cls => {
            apListEl.appendChild(createClassCardForSemester(cls, true, fulfilledMap, "AP Credit"));
        });

        const deListEl = semEl.querySelector('#de-transfer-list');
        deCredits.forEach(cls => {
            deListEl.appendChild(createClassCardForSemester(cls, true, fulfilledMap, "Dual Enrollment"));
        });

        new Sortable(apListEl, {
            group: {
                name: 'shared',
                pull: false,
                put: true
            },
            animation: 150,
            filter: '.locked',
            ghostClass: 'sortable-ghost',
            onAdd: (evt) => {
                const itemEl = evt.item;
                const code = itemEl.dataset.code;
                itemEl.remove();
                // Restore UI before opening prompt so dragged item isn't lost if user cancels
                updatePlanner();
                if (code) {
                    promptAPDrop(code);
                }
            }
        });

        new Sortable(deListEl, {
            group: {
                name: 'shared',
                pull: false,
                put: true
            },
            animation: 150,
            filter: '.locked',
            ghostClass: 'sortable-ghost',
            onAdd: (evt) => {
                const itemEl = evt.item;
                const code = itemEl.dataset.code;
                itemEl.remove();
                // Restore UI before opening prompt so dragged item isn't lost if user cancels
                updatePlanner();
                if (code) {
                    promptDEDrop(code);
                }
            }
        });

        const apHeader = semEl.querySelector('#ap-header');
        apHeader.addEventListener('click', () => {
            window.location.href = 'ap-credits.html';
        });

        const deHeader = semEl.querySelector('#de-header');
        deHeader.addEventListener('click', () => {
            window.location.href = 'de-credits.html';
        });

        cell.appendChild(semEl);
        return cell;
    }

    const semEl = document.createElement('div');
    semEl.className = 'semester';
    
    const idSafeName = semName.replace(/\s+/g, '-');
    semEl.innerHTML = `
        <h3>${semName} <span class="semester-credits" id="total-${idSafeName}">0h</span></h3>
        <div class="class-list" id="list-${idSafeName}" data-semester="${semName}"></div>
    `;
    
    const listEl = semEl.querySelector('.class-list');
    const semCourses = activeSchedule[semName] || [];
    let semesterHours = 0;
    
    semCourses.forEach(code => {
        const c = COURSES_DB[code];
        const hours = getCourseHours(code);
        semesterHours += hours;
        
        const clsInfo = c ? {
            code: code,
            name: c.name,
            hours: hours,
            description: c.description
        } : {
            code: code,
            name: "Custom Course",
            hours: hours,
            description: "Planned course."
        };
        
        listEl.appendChild(createClassCardForSemester(clsInfo, false, fulfilledMap, semName));
    });
    
    semEl.querySelector('.semester-credits').textContent = `${semesterHours}h`;

    new Sortable(listEl, {
        group: 'shared',
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: () => {
            saveState();
            updatePlanner();
        },
        onAdd: (evt) => {
            const itemEl = evt.item;
            const code = itemEl.dataset.code;
            if (code) {
                // If this course is already scheduled in another semester, remove the old one to move it
                document.querySelectorAll('.semester-column .class-list').forEach(otherList => {
                    if (otherList !== listEl && otherList.id !== 'ap-transfer-list' && otherList.id !== 'de-transfer-list') {
                        const duplicateCard = otherList.querySelector(`[data-code="${code}"]`);
                        if (duplicateCard) {
                            duplicateCard.remove();
                        }
                    }
                });
            }
            saveState();
            updatePlanner();
        }
    });

    cell.appendChild(semEl);
    return cell;
}

function attachElectiveSearchControl(selectContainer, slotKey, slotTitle, onSelectCourse, startOpen = false) {
    const warningBtn = document.createElement('button');
    warningBtn.type = 'button';
    warningBtn.className = 'card-warning-btn';
    warningBtn.textContent = '⚠️ Select Course';
    if (startOpen) {
        warningBtn.style.display = 'none';
    }
    selectContainer.appendChild(warningBtn);

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'card-elective-search-wrapper';
    searchWrapper.style.display = startOpen ? 'flex' : 'none';

    const inputRow = document.createElement('div');
    inputRow.className = 'card-elective-input-row';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'card-elective-search-input';
    searchInput.placeholder = 'Search code or title (e.g. LMC)...';

    const closeSearchBtn = document.createElement('button');
    closeSearchBtn.type = 'button';
    closeSearchBtn.className = 'card-elective-close-btn';
    closeSearchBtn.title = 'Close search';
    closeSearchBtn.innerHTML = '&times;';

    inputRow.appendChild(searchInput);
    if (!startOpen) {
        inputRow.appendChild(closeSearchBtn);
    }

    const resultsList = document.createElement('div');
    resultsList.className = 'card-elective-results';

    searchWrapper.appendChild(inputRow);
    searchWrapper.appendChild(resultsList);
    selectContainer.appendChild(searchWrapper);

    let allMatching = null;

    const renderResults = (query) => {
        if (!allMatching) {
            allMatching = getMatchingCoursesForElective(slotKey);
        }
        const q = (query || '').trim().toLowerCase();
        const qNoSpace = q.replace(/\s+/g, '');

        let filtered = allMatching;
        if (q) {
            filtered = allMatching.filter(c => {
                const codeLow = c.code.toLowerCase();
                const codeNoSpace = codeLow.replace(/\s+/g, '');
                const nameLow = c.name.toLowerCase();
                return codeLow.includes(q) || codeNoSpace.includes(qNoSpace) || nameLow.includes(q);
            });

            filtered.sort((a, b) => {
                const aCode = a.code.toLowerCase();
                const bCode = b.code.toLowerCase();
                const aNoSpace = aCode.replace(/\s+/g, '');
                const bNoSpace = bCode.replace(/\s+/g, '');

                const aExact = aCode === q || aNoSpace === qNoSpace;
                const bExact = bCode === q || bNoSpace === qNoSpace;
                if (aExact !== bExact) return aExact ? -1 : 1;

                const aStarts = aCode.startsWith(q) || aNoSpace.startsWith(qNoSpace);
                const bStarts = bCode.startsWith(q) || bNoSpace.startsWith(qNoSpace);
                if (aStarts !== bStarts) return aStarts ? -1 : 1;

                const aInCode = aCode.includes(q) || aNoSpace.includes(qNoSpace);
                const bInCode = bCode.includes(q) || bNoSpace.includes(qNoSpace);
                if (aInCode !== bInCode) return aInCode ? -1 : 1;

                return a.code.localeCompare(b.code);
            });
        }

        resultsList.innerHTML = '';

        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'card-elective-empty';
            emptyEl.textContent = `No matching courses found for "${query}".`;
            resultsList.appendChild(emptyEl);
            return filtered;
        }

        const slice = filtered.slice(0, 40);
        slice.forEach(c => {
            const item = document.createElement('div');
            item.className = 'card-elective-result-item';
            item.title = c.description || c.name;
            item.innerHTML = `
                <span class="result-code">${c.code}</span>
                <span class="result-name">${c.name}</span>
                <span class="result-hours">${c.hours}h</span>
            `;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                onSelectCourse(c.code);
            });
            resultsList.appendChild(item);
        });

        if (filtered.length > slice.length) {
            const moreEl = document.createElement('div');
            moreEl.className = 'card-elective-more';
            moreEl.textContent = `+ ${filtered.length - slice.length} more — type to narrow results`;
            resultsList.appendChild(moreEl);
        }

        return filtered;
    };

    warningBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        warningBtn.style.display = 'none';
        searchWrapper.style.display = 'flex';
        renderResults(searchInput.value);
        searchInput.focus();
    });

    closeSearchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        searchWrapper.style.display = 'none';
        warningBtn.style.display = 'inline-flex';
    });

    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
    resultsList.addEventListener('click', (e) => e.stopPropagation());
    resultsList.addEventListener('mousedown', (e) => e.stopPropagation());

    searchInput.addEventListener('input', (e) => {
        renderResults(e.target.value);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !startOpen) {
            e.stopPropagation();
            searchWrapper.style.display = 'none';
            warningBtn.style.display = 'inline-flex';
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const matches = renderResults(searchInput.value);
            if (matches && matches.length > 0) {
                onSelectCourse(matches[0].code);
            }
        }
    });

    if (startOpen) {
        renderResults('');
    }
}

function createClassCardForSemester(cls, isLocked, fulfilledMap, semName) {
    const card = document.createElement('div');
    card.className = `class-card ${isLocked ? 'locked' : ''}`;
    card.dataset.code = cls.code;
    card.dataset.hours = cls.hours;
    
    const dbCourse = COURSES_DB[cls.code];
    const hasChoices = dbCourse && dbCourse.choices && dbCourse.choices.length > 0;
    const isGenericElective = cls.code.includes("DEPTH") || cls.code.includes("BREADTH") || cls.code.includes("ELECTIVE");
    
    if (!isLocked && (hasChoices || isGenericElective)) {
        card.classList.add('placeholder-card');
    }
    
    card.innerHTML = `
        <div class="class-card-header">
            <span class="code">${cls.code}</span>
            <span class="name">${cls.name}</span>
            <span class="hours-container" style="display: flex; align-items: center; gap: 6px;">
                ${(hasChoices || isGenericElective) ? `<span class="card-info-icon" title="View matching courses in catalog" style="cursor: pointer; font-size: 0.85rem;">ℹ️</span>` : ''}
                <span class="hours">${cls.hours}h</span>
            </span>
        </div>
        <div class="course-details">
            ${cls.description || "No description available."}
        </div>
    `;

    if (!isLocked && (hasChoices || isGenericElective)) {
        const selectContainer = document.createElement('div');
        selectContainer.className = 'card-select-container';
        
        if (hasChoices) {
            const warningBtn = document.createElement('button');
            warningBtn.className = 'card-warning-btn';
            warningBtn.textContent = '⚠️ Select Course';
            selectContainer.appendChild(warningBtn);
            
            const select = document.createElement('select');
            select.className = 'class-card-choice-select';
            select.style.display = 'none'; // hidden initially
            
            const defaultOpt = document.createElement('option');
            defaultOpt.value = '';
            defaultOpt.disabled = true;
            defaultOpt.selected = true;
            defaultOpt.textContent = 'Choose...';
            select.appendChild(defaultOpt);
            
            dbCourse.choices.forEach(choiceCode => {
                const c = COURSES_DB[choiceCode];
                if (c) {
                    const opt = document.createElement('option');
                    opt.value = choiceCode;
                    opt.textContent = `${choiceCode} (${c.hours}h)`;
                    select.appendChild(opt);
                }
            });
            
            warningBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                warningBtn.style.display = 'none';
                select.style.display = 'block';
                select.focus();
            });
            
            const infoIcon = card.querySelector('.card-info-icon');
            if (infoIcon) {
                infoIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showChoicesInCatalog(dbCourse.choices, cls.name);
                });
            }
            
            select.addEventListener('change', (e) => {
                const newCode = e.target.value;
                card.dataset.code = newCode;
                saveState();
                updatePlanner();
            });
            select.addEventListener('click', (e) => e.stopPropagation());
            selectContainer.appendChild(select);
        } else {
            const infoIcon = card.querySelector('.card-info-icon');
            if (infoIcon) {
                infoIcon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const matchingCodes = getMatchingCoursesForElective(cls.code).map(c => c.code);
                    showChoicesInCatalog(matchingCodes, cls.name);
                });
            }

            attachElectiveSearchControl(selectContainer, cls.code, cls.name, (chosenCode) => {
                card.dataset.code = chosenCode;
                saveState();
                updatePlanner();
            });
        }
        card.appendChild(selectContainer);
    }

    // Map requirement category badge
    const key = `${semName}|${cls.code}`;
    const reqInfo = fulfilledMap.get(key);
    
    const badge = document.createElement('div');
    if (reqInfo) {
        const reqCategory = typeof reqInfo === 'string' ? reqInfo : reqInfo.category;
        const slotKey = typeof reqInfo === 'object' ? reqInfo.slotKey : null;
        const slotName = typeof reqInfo === 'object' ? reqInfo.slotName : null;

        badge.className = 'class-badge';
        if (slotKey && slotKey !== cls.code && slotName) {
            badge.textContent = `${reqCategory} • ${slotName}`;
        } else {
            badge.textContent = reqCategory;
        }
        card.appendChild(badge);

        // If this is a specific course fulfilling an elective placeholder slot in a semester, allow changing/resetting right on the card
        if (!isLocked && slotKey && slotKey !== cls.code && isElectivePlaceholderCode(slotKey)) {
            const electiveActionRow = document.createElement('div');
            electiveActionRow.className = 'card-select-container';
            electiveActionRow.style.cssText = 'border-top: none; margin-top: 0.25rem; padding-top: 0;';

            attachElectiveSearchControl(electiveActionRow, slotKey, slotName || slotKey, (chosenCode) => {
                card.dataset.code = chosenCode;
                saveState();
                updatePlanner();
            });

            const btn = electiveActionRow.querySelector('.card-warning-btn');
            if (btn) {
                btn.textContent = '🔄 Change Course';
                btn.style.background = '#e8f5e9';
                btn.style.color = '#2e7d32';
                btn.style.borderColor = '#c8e6c9';

                const resetBtn = document.createElement('button');
                resetBtn.type = 'button';
                resetBtn.className = 'card-warning-btn';
                resetBtn.style.cssText = 'background: #fff3e0; color: #e65100; border-color: #ffe0b2; margin-left: 4px; flex: 1;';
                resetBtn.textContent = '↩️ Reset';
                resetBtn.title = `Reset back to ${slotKey}`;
                resetBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    card.dataset.code = slotKey;
                    saveState();
                    updatePlanner();
                });

                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display: flex; gap: 4px; width: 100%;';
                btn.parentElement.insertBefore(btnRow, btn);
                btnRow.appendChild(btn);
                btnRow.appendChild(resetBtn);
            }
            card.appendChild(electiveActionRow);
        }
    } else if (!isLocked) {
        badge.className = 'class-badge unused';
        badge.textContent = 'Unused / Extra';
        card.appendChild(badge);
    }

    if (!isLocked) {
        // Render deletion button
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Remove course from semester';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCourseFromSemester(semName, cls.code);
        });
        card.appendChild(deleteBtn);
    } else if (semName === "AP Credit" || semName === "Dual Enrollment") {
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = semName === "AP Credit" ? `Remove AP ${cls.examName || ''} credit` : `Remove Dual Enrollment credit`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTransferCredit(cls);
        });
        card.appendChild(deleteBtn);
    }

    card.addEventListener('click', () => {
        if (!card.classList.contains('sortable-chosen')) {
            card.classList.toggle('expanded');
        }
    });

    return card;
}

function renderChecklist(auditResults) {
    const checklistContainer = document.getElementById('checklist-categories');
    checklistContainer.innerHTML = '';

    for (let category in auditResults) {
        if (category === "Unused Courses") continue;
        
        const categoryData = [...auditResults[category]];
        categoryData.sort((a, b) => {
            const nameA = a.displayName || a.slotKey || '';
            const nameB = b.displayName || b.slotKey || '';
            return nameA.localeCompare(nameB);
        });
        
        // Calculate satisfied and required hours
        let satisfiedHours = 0;
        let requiredHours = 0;
        
        categoryData.forEach(slot => {
            if (slot.slotKey.startsWith("GLR_")) return; // GLR slots have 0 hours for graduation audits
            let slotHours = 3; // default fallback
            if (COURSES_DB[slot.slotKey]) {
                slotHours = COURSES_DB[slot.slotKey].hours || 3;
            } else if (slot.slotKey.includes("DEPTH") || slot.slotKey.includes("BREADTH") || slot.slotKey.includes("ELECTIVE")) {
                slotHours = 3;
            }
            requiredHours += slotHours;
            
            if (slot.satisfiedBy) {
                satisfiedHours += getCourseHours(slot.satisfiedBy.code);
            }
        });
        
        const isCollapsed = collapsedCategories.has(category);
        const catEl = document.createElement('div');
        catEl.className = `checklist-category ${isCollapsed ? 'collapsed' : ''}`;
        
        const progressText = category === "Legislative Requirements"
            ? `${categoryData.filter(s => s.satisfiedBy).length}/4 Met`
            : `${satisfiedHours}/${requiredHours}h`;
            
        catEl.innerHTML = `
            <div class="category-header">
                <span class="category-title"><span class="collapse-arrow">▼</span>${category}</span>
                <span class="category-progress">${progressText}</span>
            </div>
            <div class="checklist-category-list class-list" data-category="${category}">
                <!-- Slots will be injected here -->
            </div>
        `;
        
        // Click listener to toggle collapse
        const header = catEl.querySelector('.category-header');
        header.addEventListener('click', () => {
            if (collapsedCategories.has(category)) {
                collapsedCategories.delete(category);
                catEl.classList.remove('collapsed');
            } else {
                collapsedCategories.add(category);
                catEl.classList.add('collapsed');
            }
        });
        
        const listEl = catEl.querySelector('.checklist-category-list');
        const unscheduledSlotCounts = {};
        
        categoryData.forEach(slot => {
            if (slot.satisfiedBy) {
                const code = slot.satisfiedBy.code;
                const hours = getCourseHours(code);
                const source = slot.satisfiedBy.source;
                
                const satisfiedSlot = document.createElement('div');
                const isTransfer = source === "AP Credit" || source === "Dual Enrollment" || source === "Transfer";
                if (isTransfer) {
                    satisfiedSlot.className = 'requirement-slot satisfied transfer-satisfied';
                } else {
                    satisfiedSlot.className = 'requirement-slot satisfied';
                    satisfiedSlot.dataset.code = code;
                    satisfiedSlot.dataset.hours = hours;
                }
                
                // If this is a choice requirement and it was planned in a semester (not a transfer credit), let them modify it directly!
                if (slot.isChoice && !isTransfer) {
                    const isPlaceholder = !slot.choices.includes(code);
                    let optionsHtml = '';
                    if (isPlaceholder) {
                        optionsHtml += `<option value="" disabled selected>Choose a class...</option>`;
                    }
                    optionsHtml += slot.choices.map(cCode => {
                        const c = COURSES_DB[cCode];
                        return `<option value="${cCode}" ${cCode === code ? 'selected' : ''}>${cCode} - ${c.name} (${c.hours}h)</option>`;
                    }).join('');
                    
                    satisfiedSlot.innerHTML = `
                        <div class="satisfied-details" style="width: 100%;">
                            <div class="satisfied-title-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span class="satisfied-title">${slot.displayName}</span>
                                <span class="satisfied-info-btn" title="View option details" style="cursor: pointer; font-size: 0.85rem; color: var(--gt-link-blue);">ℹ️</span>
                            </div>
                            <div class="satisfied-row">
                                <select class="satisfied-choice-select">
                                    ${optionsHtml}
                                </select>
                                <span class="satisfied-source-span">in ${source}</span>
                            </div>
                        </div>
                        <span class="satisfied-icon">✓</span>
                    `;
                    
                    const infoBtn = satisfiedSlot.querySelector('.satisfied-info-btn');
                    infoBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showChoicesInCatalog(slot.choices, slot.displayName);
                    });
                    
                    const select = satisfiedSlot.querySelector('.satisfied-choice-select');
                    select.addEventListener('change', (e) => {
                        const newCode = e.target.value;
                        
                        // Update the DOM element first so saveState() reads the new value!
                        const idSafeName = source.replace(/\s+/g, '-');
                        const listEl = document.getElementById(`list-${idSafeName}`);
                        if (listEl) {
                            const card = listEl.querySelector(`.class-card[data-code="${code}"]`);
                            if (card) {
                                card.dataset.code = newCode;
                            }
                        }
                        
                        saveState();
                        updatePlanner();
                    });
                } else if (isElectivePlaceholderCode(slot.slotKey) && !isTransfer) {
                    const isStillPlaceholder = (code === slot.slotKey);
                    const courseObj = COURSES_DB[code];
                    const courseLabel = (!isStillPlaceholder && courseObj)
                        ? `${code} — ${courseObj.name} (${hours}h) - ${source}`
                        : `${code} (${hours}h) - ${source}`;

                    satisfiedSlot.innerHTML = `
                        <div class="satisfied-details" style="width: 100%;">
                            <div class="satisfied-title-row" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                                <span class="satisfied-title">${slot.displayName}</span>
                                <span class="satisfied-info-btn" title="View matching courses in catalog" style="cursor: pointer; font-size: 0.85rem; color: var(--gt-link-blue);">ℹ️</span>
                            </div>
                            <span class="satisfied-source">${courseLabel}</span>
                            <div class="satisfied-elective-control" style="margin-top: 0.35rem;"></div>
                        </div>
                        <span class="satisfied-icon">${isStillPlaceholder ? '⚠️' : '✓'}</span>
                    `;

                    const infoBtn = satisfiedSlot.querySelector('.satisfied-info-btn');
                    infoBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const matchingCodes = getMatchingCoursesForElective(slot.slotKey).map(c => c.code);
                        showChoicesInCatalog(matchingCodes, slot.displayName);
                    });

                    const controlDiv = satisfiedSlot.querySelector('.satisfied-elective-control');
                    attachElectiveSearchControl(controlDiv, slot.slotKey, slot.displayName, (newCode) => {
                        const idSafeName = source.replace(/\s+/g, '-');
                        const semListEl = document.getElementById(`list-${idSafeName}`);
                        if (semListEl) {
                            const card = semListEl.querySelector(`.class-card[data-code="${code}"]`);
                            if (card) {
                                card.dataset.code = newCode;
                            }
                        }
                        saveState();
                        updatePlanner();
                    });
                    const btn = controlDiv.querySelector('.card-warning-btn');
                    if (btn && !isStillPlaceholder) {
                        btn.textContent = '🔄 Change Course';
                        btn.style.background = '#e8f5e9';
                        btn.style.color = '#2e7d32';
                        btn.style.borderColor = '#c8e6c9';

                        const resetBtn = document.createElement('button');
                        resetBtn.type = 'button';
                        resetBtn.className = 'card-warning-btn';
                        resetBtn.style.cssText = 'background: #fff3e0; color: #e65100; border-color: #ffe0b2; margin-left: 4px;';
                        resetBtn.textContent = '↩️ Reset';
                        resetBtn.title = `Reset this card back to ${slot.slotKey}`;
                        resetBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const idSafeName = source.replace(/\s+/g, '-');
                            const semListEl = document.getElementById(`list-${idSafeName}`);
                            if (semListEl) {
                                const card = semListEl.querySelector(`.class-card[data-code="${code}"]`);
                                if (card) {
                                    card.dataset.code = slot.slotKey;
                                }
                            }
                            saveState();
                            updatePlanner();
                        });
                        btn.parentElement.insertBefore(resetBtn, btn.nextSibling);
                    }
                } else {
                    // Regular or transfer-satisfied slot
                    const courseObj = COURSES_DB[code];
                    const courseTitleNote = (code !== slot.slotKey && courseObj && courseObj.name !== slot.displayName)
                        ? `${code} — ${courseObj.name} (${hours}h) - ${source}`
                        : `${code} (${hours}h) - ${source}`;
                    satisfiedSlot.innerHTML = `
                        <div class="satisfied-details">
                            <span class="satisfied-title">${slot.displayName}</span>
                            <span class="satisfied-source">${courseTitleNote}</span>
                        </div>
                        <span class="satisfied-icon">✓</span>
                    `;
                }
                
                listEl.appendChild(satisfiedSlot);
            } else {
                // Render remaining draggable card
                if (slot.slotKey.startsWith("GLR_")) {
                    const glrItem = document.createElement('div');
                    glrItem.className = 'requirement-slot unsatisfied glr-slot';
                    glrItem.style.background = '#fafafa';
                    glrItem.style.borderStyle = 'dashed';
                    glrItem.style.cursor = 'default';
                    glrItem.style.display = 'flex';
                    glrItem.style.justifyContent = 'space-between';
                    glrItem.style.alignItems = 'center';
                    glrItem.style.padding = '0.5rem';
                    glrItem.style.borderWidth = '1px';
                    glrItem.style.borderColor = '#ccc';
                    glrItem.style.borderRadius = '6px';
                    glrItem.style.marginBottom = '0.5rem';
                    glrItem.innerHTML = `
                        <div class="satisfied-details">
                            <span class="satisfied-title" style="color: #666; font-size: 0.9rem; font-weight: 500;">${slot.displayName}</span>
                            <span class="satisfied-source" style="font-size: 0.72rem; color: #888; display: block; margin-top: 0.15rem;">Unmet (Take exam or plan HIST/POL course)</span>
                        </div>
                        <span class="satisfied-icon" style="color: #ccc; font-weight: bold; font-size: 1rem;">○</span>
                    `;
                    listEl.appendChild(glrItem);
                    return;
                }
                
                unscheduledSlotCounts[slot.slotKey] = (unscheduledSlotCounts[slot.slotKey] || 0) + 1;
                const occIdx = unscheduledSlotCounts[slot.slotKey];

                let card;
                if (slot.isChoice) {
                    card = createChoiceCard(slot);
                } else if (slot.slotKey.includes("ELECTIVE") || slot.slotKey.includes("DEPTH") || slot.slotKey.includes("BREADTH") || slot.slotKey === "RESEARCH") {
                    card = createElectiveCard(slot, occIdx);
                } else {
                    const courseInfo = COURSES_DB[slot.slotKey] || {
                        name: slot.displayName,
                        hours: 3,
                        description: "Course requirement."
                    };
                    card = createDraggableCard({
                        code: slot.slotKey,
                        name: courseInfo.name,
                        hours: courseInfo.hours || 3,
                        description: courseInfo.description
                    });
                }
                listEl.appendChild(card);
            }
        });
        
        // Bind Sortable list (dragging remaining cards out)
        new Sortable(listEl, {
            group: {
                name: 'shared',
                pull: true,
                put: false // Disable dropping cards back into requirements
            },
            animation: 150,
            filter: '.transfer-satisfied',
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                saveState();
                updatePlanner();
            }
        });

        checklistContainer.appendChild(catEl);
    }
}

function createChoiceCard(slot) {
    const card = document.createElement('div');
    card.className = 'class-card choice-card';
    
    const defaultChoiceCode = slot.choices[0];
    const defaultChoice = COURSES_DB[defaultChoiceCode];
    
    card.dataset.code = defaultChoiceCode;
    card.dataset.hours = slot.choices.length > 0 ? COURSES_DB[defaultChoiceCode].hours : 3;
    card.dataset.type = 'choice';
    
    let optionsHtml = slot.choices.map(cCode => {
        const c = COURSES_DB[cCode];
        return `<option value="${cCode}">${cCode} - ${c.name} (${c.hours}h)</option>`;
    }).join('');
    
    card.innerHTML = `
        <div class="class-card-header">
            <span class="code" style="color: var(--gt-link-blue);">${slot.slotKey}</span>
            <span class="name">${slot.displayName}</span>
            <span class="hours-container" style="display: flex; align-items: center; gap: 6px;">
                <span class="choice-info-link" title="Compare options in catalog" style="cursor: pointer; font-size: 0.85rem;">ℹ️</span>
                <span class="hours">${card.dataset.hours}h</span>
            </span>
        </div>
        <div class="course-details" style="display: block; max-height: none; border-top: 1px solid #eee; margin-top: 0.5rem; padding-top: 0.5rem;">
            <label style="font-size: 0.7rem; font-weight: bold; color: #666; margin-bottom: 0.25rem; display: block;">Select Option:</label>
            <select class="class-card-choice-select">
                ${optionsHtml}
            </select>
            <div class="choice-desc" style="font-size: 0.75rem; color: #555; margin-top: 0.25rem;">
                ${defaultChoice ? defaultChoice.description : ''}
            </div>
        </div>
    `;
    
    const infoLink = card.querySelector('.choice-info-link');
    infoLink.addEventListener('click', (e) => {
        e.stopPropagation();
        showChoicesInCatalog(slot.choices, slot.displayName);
    });
    
    const select = card.querySelector('.class-card-choice-select');
    select.addEventListener('change', (e) => {
        const chosenCode = e.target.value;
        const chosenCourse = COURSES_DB[chosenCode];
        card.dataset.code = chosenCode;
        card.dataset.hours = chosenCourse.hours;
        card.querySelector('.hours').textContent = `${chosenCourse.hours}h`;
        card.querySelector('.choice-desc').textContent = chosenCourse.description || '';
    });
    
    select.addEventListener('click', (e) => e.stopPropagation());
    
    return card;
}

function createElectiveCard(slot, occIdx = 1) {
    const storageKey = `${activeMajor}|${slot.slotKey}|${occIdx}`;
    let savedUnscheduled = {};
    try {
        savedUnscheduled = JSON.parse(localStorage.getItem('gt_planner_unscheduled_selections') || '{}');
    } catch (e) {}

    const initialCode = (savedUnscheduled[storageKey] && COURSES_DB[savedUnscheduled[storageKey]])
        ? savedUnscheduled[storageKey]
        : slot.slotKey;
    const initialCourse = (initialCode !== slot.slotKey) ? COURSES_DB[initialCode] : null;

    const card = document.createElement('div');
    card.className = 'class-card elective-card';
    card.dataset.code = initialCode;
    card.dataset.hours = initialCourse ? initialCourse.hours : 3;
    card.dataset.type = 'elective';
    
    card.innerHTML = `
        <div class="class-card-header">
            <span class="code" style="color: #e65100;">${initialCode}</span>
            <span class="name">${initialCourse ? `${slot.displayName}: ${initialCourse.name}` : slot.displayName}</span>
            <span class="hours-container" style="display: flex; align-items: center; gap: 6px;">
                <span class="choice-info-link" title="View matching courses in catalog" style="cursor: pointer; font-size: 0.85rem;">ℹ️</span>
                <span class="hours">${card.dataset.hours}h</span>
            </span>
        </div>
        <div class="course-details">
            ${initialCourse ? (initialCourse.description || '') : 'Drag this placeholder to a semester, or select a specific course below.'}
        </div>
    `;

    const infoLink = card.querySelector('.choice-info-link');
    if (infoLink) {
        infoLink.addEventListener('click', (e) => {
            e.stopPropagation();
            const matchingCodes = getMatchingCoursesForElective(slot.slotKey).map(c => c.code);
            showChoicesInCatalog(matchingCodes, slot.displayName);
        });
    }

    const selectContainer = document.createElement('div');
    selectContainer.className = 'card-select-container';

    const applyChosenCourse = (chosenCode) => {
        const chosenCourse = COURSES_DB[chosenCode];
        if (!chosenCourse) return;
        try {
            const map = JSON.parse(localStorage.getItem('gt_planner_unscheduled_selections') || '{}');
            map[storageKey] = chosenCode;
            localStorage.setItem('gt_planner_unscheduled_selections', JSON.stringify(map));
        } catch (e) {}

        card.dataset.code = chosenCode;
        card.dataset.hours = chosenCourse.hours;
        card.querySelector('.code').textContent = chosenCode;
        card.querySelector('.name').textContent = `${slot.displayName}: ${chosenCourse.name}`;
        card.querySelector('.hours').textContent = `${chosenCourse.hours}h`;
        card.querySelector('.course-details').textContent = chosenCourse.description || '';
        renderSelectedState();
    };

    const renderSelectedState = () => {
        selectContainer.innerHTML = '';
        const dragHint = document.createElement('div');
        dragHint.style.cssText = 'font-size: 0.72rem; color: var(--gt-navy); font-weight: 600; margin-bottom: 0.25rem;';
        dragHint.textContent = '✋ Drag this card into a semester to schedule';
        selectContainer.appendChild(dragHint);

        const changeBtn = document.createElement('button');
        changeBtn.type = 'button';
        changeBtn.className = 'card-warning-btn';
        changeBtn.textContent = '🔄 Change Course';
        changeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectContainer.innerHTML = '';
            attachElectiveSearchControl(selectContainer, slot.slotKey, slot.displayName, applyChosenCourse, true);
        });
        selectContainer.appendChild(changeBtn);
    };

    if (initialCourse) {
        renderSelectedState();
    } else {
        attachElectiveSearchControl(selectContainer, slot.slotKey, slot.displayName, applyChosenCourse);
    }

    card.appendChild(selectContainer);
    
    card.addEventListener('click', () => {
        card.classList.toggle('expanded');
    });
    
    return card;
}

function createDraggableCard(cls) {
    const card = document.createElement('div');
    card.className = 'class-card';
    card.dataset.code = cls.code;
    card.dataset.hours = cls.hours;
    card.dataset.type = 'catalog';
    
    card.innerHTML = `
        <div class="class-card-header">
            <span class="code">${cls.code}</span>
            <span class="name">${cls.name}</span>
            <span class="hours">${cls.hours}h</span>
        </div>
        <div class="course-details">
            ${cls.description || "No description available."}
        </div>
    `;
    
    card.addEventListener('click', () => {
        if (!card.classList.contains('sortable-chosen')) {
            card.classList.toggle('expanded');
        }
    });
    
    return card;
}

function renderSearchCatalog() {
    const container = document.getElementById('catalog-search-results');
    const query = catalogSearchInput.value.toLowerCase().trim();
    container.innerHTML = '';
    
    let matches = [];
    const keys = Object.keys(COURSES_DB);
    
    // Filter out placeholders from catalog searches
    const filteredKeys = keys.filter(code => {
        const c = COURSES_DB[code];
        if (c.choices) return false;
        if (code.includes("ELECTIVE") || code.includes("DEPTH") || code.includes("BREADTH") || code === "RESEARCH") return false;
        return true;
    });
    
    // Dynamically update placeholder with exact course count
    catalogSearchInput.placeholder = `Search ${filteredKeys.length} courses...`;
    
    if (query === '') {
        matches = filteredKeys.slice(0, 30); // show popular courses initially
        document.getElementById('search-results-count').textContent = `Showing popular courses`;
    } else {
        matches = filteredKeys.filter(code => {
            const c = COURSES_DB[code];
            return code.toLowerCase().includes(query) || 
                   c.name.toLowerCase().includes(query) || 
                   (c.description && c.description.toLowerCase().includes(query));
        });
        document.getElementById('search-results-count').textContent = `Found ${matches.length} courses`;
    }
    
    matches.forEach(code => {
        const c = COURSES_DB[code];
        const card = createDraggableCard({
            code: code,
            name: c.name,
            hours: c.hours,
            description: c.description
        });
        container.appendChild(card);
    });
    
    // Bind Sortable with clone pull
    new Sortable(container, {
        group: {
            name: 'shared',
            pull: 'clone',
            put: false
        },
        animation: 150,
        sort: false, // disable sorting inside search catalog
        ghostClass: 'sortable-ghost'
    });
}

function isUpperDivision(code) {
    if (code.includes("DEPTH") || code.startsWith("PSYC CORE A") || code === "PSYC CAPSTONE" || code.startsWith("PSYC ELECTIVE") || code === "RESEARCH" || code === "BIOS 4460" || code === "QUANT/BIO" || code === "BIOS 3450" || code === "BIOS 3600") {
        return true;
    }
    const match = code.match(/\d{4}/);
    if (match) {
        const num = parseInt(match[0], 10);
        return num >= 3000;
    }
    return false;
}

function updateStats(auditResults) {
    const major = majorData[activeMajor];
    const transferCredits = getTransferCredits();
    
    let totalSatisfiedHours = transferCredits.reduce((sum, c) => sum + c.hours, 0);
    let upperHours = 0;
    
    transferCredits.forEach(c => {
        if (isUpperDivision(c.code)) {
            upperHours += c.hours;
        }
    });
    
    for (let semName in activeSchedule) {
        activeSchedule[semName].forEach(code => {
            const hrs = getCourseHours(code);
            totalSatisfiedHours += hrs;
            if (isUpperDivision(code)) {
                upperHours += hrs;
            }
        });
    }

    let targetHours = 0;
    if (major && major.requirements) {
        for (let category in major.requirements) {
            major.requirements[category].forEach(slotKey => {
                let slotHours = 3;
                if (COURSES_DB[slotKey]) {
                    slotHours = COURSES_DB[slotKey].hours || 3;
                } else if (slotKey.includes("DEPTH") || slotKey.includes("BREADTH") || slotKey.includes("ELECTIVE")) {
                    slotHours = 3;
                }
                targetHours += slotHours;
            });
        }
    }
    if (targetHours === 0) {
        targetHours = major.target_hours || 122;
    }
    const progressPercent = Math.min(100, (totalSatisfiedHours / targetHours) * 100);
    
    // Update progress audit bar
    document.getElementById('audit-progress-fill').style.width = `${progressPercent}%`;
    document.getElementById('audit-progress-text').textContent = `${totalSatisfiedHours} / ${targetHours} Credit Hours Satisfied`;
    
    // Update main stats panel
    document.getElementById('gt-total-credits').textContent = `Total: ${totalSatisfiedHours}/${targetHours}h`;
    
    const remaining = Math.max(0, targetHours - totalSatisfiedHours);
    document.getElementById('gt-core-remaining').textContent = `Remaining: ${remaining}h left`;
    
    // Update upper division stats
    const upperEl = document.getElementById('gt-upper-division');
    if (upperEl) {
        upperEl.textContent = `Upper-Div: ${upperHours}/39h`;
        if (upperHours >= 39) {
            upperEl.style.color = '#2e7d32'; // var(--success-green)
            upperEl.style.fontWeight = 'bold';
            upperEl.title = 'Satisfied 39-hour upper-division requirement!';
        } else {
            upperEl.style.color = '#f57c00'; // var(--warning-amber)
            upperEl.style.fontWeight = 'normal';
            upperEl.title = 'Need at least 39 credit hours at 3000-level or higher.';
        }
    }
}

// Utilities Modal Logic
const utilitiesModal = document.getElementById('utilities-modal');
const openUtilitiesBtn = document.getElementById('open-utilities-btn');
const closeUtilitiesBtn = document.getElementById('close-utilities-btn');
const fetchSubjectInput = document.getElementById('fetch-subject-input');
const fetchSubjectBtn = document.getElementById('fetch-subject-btn');
const fetchStatusContainer = document.getElementById('fetch-status-container');
const fetchStatusText = document.getElementById('fetch-status-text');

const modalTabProfiles = document.getElementById('modal-tab-profiles');
const modalTabSuggested = document.getElementById('modal-tab-suggested');
const modalTabFetch = document.getElementById('modal-tab-fetch');
const panelProfiles = document.getElementById('modal-panel-profiles');
const panelSuggested = document.getElementById('modal-panel-suggested');
const panelFetch = document.getElementById('modal-panel-fetch');

if (openUtilitiesBtn && utilitiesModal && closeUtilitiesBtn) {
    const openModalFn = () => {
        utilitiesModal.classList.add('active');
        fetchSubjectInput.value = '';
        fetchStatusContainer.className = 'status-container hidden';
        
        // Reset to Saved Profiles tab by default when opening
        if (modalTabProfiles && panelProfiles) {
            [modalTabProfiles, modalTabSuggested, modalTabFetch].forEach(tab => {
                if (tab) tab.classList.remove('active');
            });
            [panelProfiles, panelSuggested, panelFetch].forEach(panel => {
                if (panel) panel.classList.remove('active');
            });
            modalTabProfiles.classList.add('active');
            panelProfiles.classList.add('active');
        }
    };

    openUtilitiesBtn.addEventListener('click', () => {
        openModalFn();
    });

    if (activeProfileIndicator) {
        activeProfileIndicator.style.cursor = 'pointer';
        activeProfileIndicator.addEventListener('click', openModalFn);
    }

    closeUtilitiesBtn.addEventListener('click', () => {
        utilitiesModal.classList.remove('active');
    });

    // Close when clicking outside content
    utilitiesModal.addEventListener('click', (e) => {
        if (e.target === utilitiesModal) {
            utilitiesModal.classList.remove('active');
        }
    });

    // Modal Tab switching
    if (modalTabProfiles && modalTabSuggested && modalTabFetch) {
        const switchModalTab = (activeTab, activePanel) => {
            [modalTabProfiles, modalTabSuggested, modalTabFetch].forEach(tab => {
                if (tab) tab.classList.remove('active');
            });
            [panelProfiles, panelSuggested, panelFetch].forEach(panel => {
                if (panel) panel.classList.remove('active');
            });
            activeTab.classList.add('active');
            activePanel.classList.add('active');
        };

        modalTabProfiles.addEventListener('click', () => switchModalTab(modalTabProfiles, panelProfiles));
        modalTabSuggested.addEventListener('click', () => switchModalTab(modalTabSuggested, panelSuggested));
        modalTabFetch.addEventListener('click', () => {
            switchModalTab(modalTabFetch, panelFetch);
            setTimeout(() => {
                if (fetchSubjectInput) fetchSubjectInput.focus();
            }, 50);
        });
    }
}

if (fetchSubjectBtn && fetchSubjectInput) {
    fetchSubjectInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            fetchSubjectBtn.click();
        }
    });

    fetchSubjectBtn.addEventListener('click', async () => {
        const subject = fetchSubjectInput.value.trim().toLowerCase();
        if (!subject) {
            showFetchStatus("Please enter a subject code.", "error");
            return;
        }

        showFetchStatus("Connecting to Georgia Tech catalog & merging courses...", "loading");
        fetchSubjectBtn.disabled = true;

        try {
            const response = await fetch(`/api/fetch-subject?subject=${encodeURIComponent(subject)}`);
            const data = await response.json();

            if (data.success) {
                showFetchStatus(`Successfully imported ${subject.toUpperCase()} catalog! Reloading database...`, "success");
                
                // Dynamically reload data.js by appending a script tag
                const oldScript = document.querySelector('script[src^="data.js"]');
                if (oldScript) {
                    oldScript.remove();
                }
                
                const newScript = document.createElement('script');
                newScript.src = `data.js?t=${Date.now()}`;
                newScript.onload = () => {
                    initDataAndRefresh();
                    setTimeout(() => {
                        let stats = data.stats;
                        if (!stats && data.stdout) {
                            const match = data.stdout.match(/JSON_STATS:\s*({.+})/);
                            if (match) {
                                try {
                                    stats = JSON.parse(match[1]);
                                } catch (e) {
                                    console.error("Failed to parse JSON_STATS from stdout:", e);
                                }
                            }
                        }
                        if (!stats) {
                            stats = { fetched: 0, added: 0, updated: 0, deleted: 0 };
                        }
                        
                        const fetchedCount = stats.fetched || 0;
                        const addedCount = stats.added || 0;
                        const updatedCount = stats.updated || 0;
                        const deletedCount = stats.deleted || 0;
                        
                        const fetchedText = `${fetchedCount} classes fetched`;
                        let finalMsg = "";
                        
                        if (addedCount === 0 && deletedCount === 0 && updatedCount === 0) {
                            finalMsg = `${fetchedText}, 0 updated.`;
                        } else {
                            const details = [];
                            if (updatedCount > 0) {
                                details.push(`${updatedCount} classes updated`);
                            }
                            if (addedCount > 0) {
                                details.push(`${addedCount} classes added`);
                            }
                            if (deletedCount > 0) {
                                details.push(`${deletedCount} classes deleted`);
                            }
                            finalMsg = `${fetchedText}. ${details.join(", ")}.`;
                        }
                        
                        showFetchStatus(finalMsg, "success");
                        fetchSubjectBtn.disabled = false;
                    }, 1000);
                };
                document.body.appendChild(newScript);
            } else {
                showFetchStatus(`Failed: ${data.error}`, "error");
                fetchSubjectBtn.disabled = false;
            }
        } catch (error) {
            showFetchStatus(`Server connection failed. Make sure the custom server is running.`, "error");
            fetchSubjectBtn.disabled = false;
            console.error(error);
        }
    });
}

function showFetchStatus(message, type) {
    fetchStatusContainer.className = 'status-container';
    fetchStatusText.textContent = message;
    
    if (type === "loading") {
        // Keeps spinner visible
    } else if (type === "success") {
        fetchStatusContainer.classList.add('success');
    } else if (type === "error") {
        fetchStatusContainer.classList.add('error');
    }
}

function initDataAndRefresh() {
    // Re-populate global data variables
    apData = AP_DATA.classes;
    deData = loadDEData();
    majorData = MAJOR_DATA.gt;
    
    // Refresh UI
    renderSearchCatalog();
    updatePlanner();
}

function showChoicesInCatalog(choices, title) {
    // 1. Switch to the Search Catalog tab
    const tabSearch = document.getElementById('tab-search');
    const tabChecklist = document.getElementById('tab-checklist');
    const searchView = document.getElementById('search-view');
    const checklistView = document.getElementById('checklist-view');

    tabSearch.classList.add('active');
    tabChecklist.classList.remove('active');
    searchView.classList.add('active');
    checklistView.classList.remove('active');

    // 2. Set search input placeholder
    catalogSearchInput.value = '';
    catalogSearchInput.placeholder = `Showing choices for: ${title}`;

    // 3. Render only the matching choices
    const container = document.getElementById('catalog-search-results');
    container.innerHTML = '';
    document.getElementById('search-results-count').textContent = `Showing choices for ${title}`;

    choices.forEach(code => {
        const c = COURSES_DB[code];
        if (c) {
            const card = createDraggableCard({
                code: code,
                name: c.name,
                hours: c.hours,
                description: c.description
            });
            if (choices.length <= 25) {
                card.classList.add('expanded');
            }
            container.appendChild(card);
        }
    });

    // Bind Sortable with clone pull
    new Sortable(container, {
        group: {
            name: 'shared',
            pull: 'clone',
            put: false
        },
        animation: 150,
        sort: false,
        ghostClass: 'sortable-ghost'
    });
}

// Profile Management Logic
async function initProfiles() {
    activeProfileName = localStorage.getItem('gt_planner_active_profile_name') || null;
    
    // Update indicator
    updateProfileIndicator();
    
    // Fetch profiles
    await fetchProfiles();
    
    // Set up save and save as event listeners
    if (profileSaveBtn) {
        profileSaveBtn.addEventListener('click', async () => {
            if (activeProfileName) {
                await saveProfile(activeProfileName, true);
            }
        });
    }
    
    if (profileSaveAsBtn) {
        profileSaveAsBtn.addEventListener('click', async () => {
            const defaultName = activeProfileName ? `${activeProfileName} (Copy)` : '';
            const name = prompt("Enter a name for the new profile:", defaultName);
            if (name && name.trim()) {
                await saveProfile(name.trim(), false);
            }
        });
    }
}

async function fetchProfiles() {
    try {
        const response = await fetch('/api/profiles');
        const data = await response.json();
        if (data.success && data.profiles) {
            profiles = data.profiles;
            // Backup to local storage
            localStorage.setItem('gt_planner_profiles', JSON.stringify(profiles));
        } else {
            throw new Error("API failed");
        }
    } catch (e) {
        console.warn("Could not fetch profiles from server, falling back to local storage:", e);
        try {
            profiles = JSON.parse(localStorage.getItem('gt_planner_profiles') || '{}');
        } catch (err) {
            profiles = {};
        }
    }
    renderProfileList();
}

async function saveProfile(name, overwriteActive = false) {
    const data = {
        name: name,
        major: activeMajor,
        schedule: activeSchedule,
        apScores: JSON.parse(localStorage.getItem('gt_ap_scores') || '{}'),
        apSelections: JSON.parse(localStorage.getItem('gt_ap_selections') || '{}'),
        deCredits: JSON.parse(localStorage.getItem('gt_de_credits') || 'null')
    };
    
    profiles[name] = data;
    localStorage.setItem('gt_planner_profiles', JSON.stringify(profiles));
    
    activeProfileName = name;
    localStorage.setItem('gt_planner_active_profile_name', name);
    
    updateProfileIndicator();
    renderProfileList();
    
    try {
        const response = await fetch('/api/save-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const resData = await response.json();
        if (resData.success) {
            showProfileFeedback(`Profile "${name}" saved successfully!`);
        } else {
            showProfileFeedback(`Saved locally, server error: ${resData.error}`, true);
        }
    } catch (e) {
        console.warn("Failed to sync profile to server:", e);
        showProfileFeedback(`Profile "${name}" saved locally.`);
    }
}

async function deleteProfile(name) {
    if (confirm(`Are you sure you want to delete the profile "${name}"?`)) {
        if (activeProfileName === name) {
            activeProfileName = null;
            localStorage.removeItem('gt_planner_active_profile_name');
        }
        
        delete profiles[name];
        localStorage.setItem('gt_planner_profiles', JSON.stringify(profiles));
        
        updateProfileIndicator();
        renderProfileList();
        
        try {
            const response = await fetch('/api/delete-profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: name })
            });
            const resData = await response.json();
            if (resData.success) {
                showProfileFeedback(`Profile "${name}" deleted.`);
            } else {
                showProfileFeedback(`Deleted locally, server error: ${resData.error}`, true);
            }
        } catch (e) {
            console.warn("Failed to delete profile from server:", e);
            showProfileFeedback(`Profile "${name}" deleted locally.`);
        }
    }
}

function showProfileFeedback(message, isError = false) {
    const el = document.getElementById('profile-status-message');
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#c62828' : 'var(--success-green)';
    el.style.opacity = '1';
    
    if (window.profileFeedbackTimeout) {
        clearTimeout(window.profileFeedbackTimeout);
    }
    
    window.profileFeedbackTimeout = setTimeout(() => {
        el.style.opacity = '0';
    }, 2500);
}

function loadProfile(name) {
    const profile = profiles[name];
    if (!profile) {
        alert(`Profile "${name}" not found.`);
        return;
    }
    
    activeMajor = profile.major || 'biology';
    activeSchedule = profile.schedule || {};
    
    localStorage.setItem('gt_planner_major', activeMajor);
    localStorage.setItem('gt_planner_active_schedule', JSON.stringify(activeSchedule));
    localStorage.setItem('gt_ap_scores', JSON.stringify(profile.apScores || {}));
    localStorage.setItem('gt_ap_selections', JSON.stringify(profile.apSelections || {}));
    if (profile.deCredits !== undefined && profile.deCredits !== null) {
        localStorage.setItem('gt_de_credits', JSON.stringify(profile.deCredits));
    } else {
        localStorage.removeItem('gt_de_credits');
    }
    
    gtMajorSelect.value = activeMajor;
    
    activeProfileName = name;
    localStorage.setItem('gt_planner_active_profile_name', name);
    
    updateProfileIndicator();
    renderProfileList();
    
    // Fully refresh the planner view and credit mappings
    initDataAndRefresh();
    
    // Close the utilities modal after loading
    const utilitiesModal = document.getElementById('utilities-modal');
    if (utilitiesModal) {
        utilitiesModal.classList.remove('active');
    }
}

function updateProfileIndicator() {
    if (activeProfileIndicator) {
        if (activeProfileName) {
            activeProfileIndicator.textContent = `Profile: ${activeProfileName}`;
            activeProfileIndicator.classList.add('active');
        } else {
            activeProfileIndicator.textContent = `Profile: None`;
            activeProfileIndicator.classList.remove('active');
        }
    }
    
    if (profileSaveBtn) {
        if (activeProfileName) {
            profileSaveBtn.removeAttribute('disabled');
            profileSaveBtn.title = `Overwrite changes to "${activeProfileName}"`;
        } else {
            profileSaveBtn.setAttribute('disabled', 'true');
            profileSaveBtn.title = "No profile currently loaded. Use 'Save as New...' to create one.";
        }
    }
}

function renderProfileList() {
    if (!profileListContainer) return;
    
    const names = Object.keys(profiles);
    if (names.length === 0) {
        profileListContainer.innerHTML = `<p style="font-size: 0.85rem; color: #666; font-style: italic; text-align: center; margin: 0.5rem 0;">No profiles saved yet.</p>`;
        return;
    }
    
    profileListContainer.innerHTML = '';
    names.forEach(name => {
        const item = document.createElement('div');
        item.className = 'profile-item';
        if (activeProfileName === name) {
            item.style.borderColor = 'var(--gt-link-blue)';
            item.style.backgroundColor = 'rgba(0, 79, 159, 0.02)';
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'profile-item-name';
        nameSpan.textContent = name;
        if (activeProfileName === name) {
            nameSpan.textContent += ' (active)';
            nameSpan.style.color = 'var(--gt-link-blue)';
        }
        nameSpan.addEventListener('click', () => loadProfile(name));
        
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'profile-item-actions';
        
        const loadBtn = document.createElement('button');
        loadBtn.className = 'profile-action-icon';
        loadBtn.title = 'Load Profile';
        loadBtn.innerHTML = '📁';
        loadBtn.addEventListener('click', () => loadProfile(name));
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'profile-action-icon profile-action-delete';
        deleteBtn.title = 'Delete Profile';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteProfile(name);
        });
        
        actionsDiv.appendChild(loadBtn);
        actionsDiv.appendChild(deleteBtn);
        item.appendChild(nameSpan);
        item.appendChild(actionsDiv);
        profileListContainer.appendChild(item);
    });
}

// Tutorial Modal Event Logic
function initTutorial() {
    const tutorialModal = document.getElementById('tutorial-modal');
    const openTutorialBtn = document.getElementById('open-tutorial-btn');
    const closeTutorialBtn = document.getElementById('close-tutorial-btn');
    const tutorialStartBtn = document.getElementById('tutorial-start-btn');
    const dontShowCheckbox = document.getElementById('tutorial-dont-show-checkbox');

    if (tutorialModal) {
        // Show tutorial modal on load if preference is not set
        const hideTutorial = localStorage.getItem('gt_planner_hide_tutorial');
        if (!hideTutorial) {
            tutorialModal.classList.add('active');
        }

        const handleClose = () => {
            tutorialModal.classList.remove('active');
            if (dontShowCheckbox && dontShowCheckbox.checked) {
                localStorage.setItem('gt_planner_hide_tutorial', 'true');
            }
        };

        if (closeTutorialBtn) {
            closeTutorialBtn.addEventListener('click', handleClose);
        }

        if (tutorialStartBtn) {
            tutorialStartBtn.addEventListener('click', handleClose);
        }

        if (openTutorialBtn) {
            openTutorialBtn.addEventListener('click', () => {
                // Reset checkbox state when manually requested
                if (dontShowCheckbox) {
                    dontShowCheckbox.checked = false;
                }
                tutorialModal.classList.add('active');
            });
        }

        // Close when clicking outside content area
        tutorialModal.addEventListener('click', (e) => {
            if (e.target === tutorialModal) {
                handleClose();
            }
        });
    }
}

// Transfer Credit Drag-and-Drop & Removal Logic
function findMatchingAPExams(courseCode) {
    const targetCodes = new Set([courseCode]);
    if (COURSES_DB[courseCode] && Array.isArray(COURSES_DB[courseCode].choices)) {
        COURSES_DB[courseCode].choices.forEach(c => targetCodes.add(c));
    }
    if (courseCode.endsWith("L")) {
        targetCodes.add(courseCode.slice(0, -1));
    }

    const matches = [];
    apData.forEach(ap => {
        const validScores = [];
        for (let scoreStr in ap.rules) {
            const rule = ap.rules[scoreStr];
            const creditOptions = rule.choices ? rule.choices : [rule.gt_credit];
            for (const opt of creditOptions) {
                if (!opt || opt === 'None') continue;
                const parts = opt.split('&').map(p => p.trim());
                if (parts.some(p => targetCodes.has(p))) {
                    validScores.push({
                        score: parseInt(scoreStr, 10),
                        credit: opt,
                        hours: rule.gt_hours
                    });
                }
            }
        }
        if (validScores.length > 0) {
            matches.push({
                exam: ap,
                validScores: validScores
            });
        }
    });
    return matches;
}

function openTransferDropModal(title, subtitle, bodyHtml) {
    const modal = document.getElementById('transfer-drop-modal');
    const titleEl = document.getElementById('transfer-drop-title');
    const subtitleEl = document.getElementById('transfer-drop-subtitle');
    const bodyEl = document.getElementById('transfer-drop-body');
    const closeBtn = document.getElementById('close-transfer-drop-btn');

    if (!modal || !bodyEl) return null;

    titleEl.textContent = title;
    subtitleEl.textContent = subtitle;
    bodyEl.innerHTML = bodyHtml;
    modal.classList.add('active');

    const closeModal = () => {
        modal.classList.remove('active');
    };

    if (closeBtn) {
        closeBtn.onclick = closeModal;
    }
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    return { modal, bodyEl, closeModal };
}

function promptAPDrop(courseCode) {
    const courseObj = COURSES_DB[courseCode];
    const courseTitle = courseObj ? `${courseCode} — ${courseObj.name}` : courseCode;
    const matches = findMatchingAPExams(courseCode);

    let savedScores = {};
    let savedSelections = {};
    try {
        savedScores = JSON.parse(localStorage.getItem('gt_ap_scores') || '{}');
        savedSelections = JSON.parse(localStorage.getItem('gt_ap_selections') || '{}');
    } catch (e) {}

    // Build exam options: matched exams first, or all exams with credit rules if no direct match
    const examList = matches.length > 0 ? matches.map(m => m.exam) : apData.filter(ap => Object.keys(ap.rules).length > 0);
    const hasDirectMatch = matches.length > 0;

    const examOptionsHtml = examList.map((ap, idx) => {
        return `<option value="${ap.name}" ${idx === 0 ? 'selected' : ''}>AP ${ap.name}</option>`;
    }).join('');

    const noticeHtml = !hasDirectMatch ? `
        <div style="background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; padding: 0.6rem 0.75rem; border-radius: 6px; font-size: 0.8rem; margin-bottom: 1rem; line-height: 1.4;">
            ⚠️ <strong>${courseCode}</strong> does not have a direct AP exam equivalency in the GT catalog. You can select an AP exam below or switch to Dual Enrollment.
        </div>
    ` : '';

    const bodyHtml = `
        ${noticeHtml}
        <form id="ap-drop-form" style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
                <label style="display: block; font-weight: 700; font-size: 0.85rem; color: var(--gt-navy); margin-bottom: 0.35rem;">AP Exam</label>
                <select id="ap-drop-exam-select" style="width: 100%; padding: 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.92rem; background: white;">
                    ${examOptionsHtml}
                </select>
            </div>
            <div>
                <label style="display: block; font-weight: 700; font-size: 0.85rem; color: var(--gt-navy); margin-bottom: 0.35rem;">What AP Score did you earn?</label>
                <div id="ap-drop-score-options" style="display: flex; flex-direction: column; gap: 0.45rem;"></div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                ${!hasDirectMatch ? `<button type="button" id="ap-switch-to-de-btn" class="modal-btn" style="background: #555; margin-right: auto;">Use Dual Enrollment Instead</button>` : ''}
                <button type="button" id="ap-drop-cancel-btn" class="modal-btn" style="background: #e0e0e0; color: #333;">Cancel</button>
                <button type="submit" class="modal-btn" style="background: var(--gt-navy);">Save AP Credit</button>
            </div>
        </form>
    `;

    const ctx = openTransferDropModal(
        "Add AP Credit",
        `Grant credit for ${courseTitle} via AP Exam score.`,
        bodyHtml
    );
    if (!ctx) return;

    const examSelect = ctx.bodyEl.querySelector('#ap-drop-exam-select');
    const scoreContainer = ctx.bodyEl.querySelector('#ap-drop-score-options');
    const cancelBtn = ctx.bodyEl.querySelector('#ap-drop-cancel-btn');
    const switchDeBtn = ctx.bodyEl.querySelector('#ap-switch-to-de-btn');
    const form = ctx.bodyEl.querySelector('#ap-drop-form');

    const renderScoreRadios = (examName) => {
        const ap = apData.find(a => a.name === examName);
        if (!ap) return;
        scoreContainer.innerHTML = '';

        const scores = Object.keys(ap.rules).map(Number).sort((a, b) => a - b);
        const currentSavedScore = savedScores[examName];

        // Build radio options for each credit-granting score (and choice if applicable)
        const radioItems = [];
        scores.forEach(s => {
            const rule = ap.rules[s];
            if (rule.choices && rule.choices.length > 0) {
                rule.choices.forEach(ch => {
                    radioItems.push({
                        score: s,
                        credit: ch,
                        hours: rule.gt_hours,
                        hasChoice: true
                    });
                });
            } else {
                radioItems.push({
                    score: s,
                    credit: rule.gt_credit,
                    hours: rule.gt_hours,
                    hasChoice: false
                });
            }
        });

        // Pre-select the option that matches courseCode or currentSavedScore, or highest score
        let defaultIdx = radioItems.length - 1;
        const exactIdx = radioItems.findIndex(item => {
            const parts = item.credit.split('&').map(p => p.trim());
            return parts.includes(courseCode) && (currentSavedScore ? item.score === currentSavedScore : true);
        });
        if (exactIdx !== -1) {
            defaultIdx = exactIdx;
        } else if (currentSavedScore) {
            const savedIdx = radioItems.findIndex(item => item.score === currentSavedScore);
            if (savedIdx !== -1) defaultIdx = savedIdx;
        }

        radioItems.forEach((item, idx) => {
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0.8rem; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; background: #fafafa; font-size: 0.88rem;';
            label.innerHTML = `
                <span style="display: flex; align-items: center; gap: 0.5rem; font-weight: 600; color: var(--gt-navy);">
                    <input type="radio" name="ap_drop_score" value="${item.score}" data-credit="${item.credit}" data-has-choice="${item.hasChoice}" ${idx === defaultIdx ? 'checked' : ''} style="accent-color: var(--gt-navy); cursor: pointer;">
                    Score of ${item.score}
                </span>
                <span style="font-size: 0.8rem; color: #2e7d32; font-weight: 700; background: #e8f5e9; padding: 0.2rem 0.5rem; border-radius: 4px; border: 1px solid #c8e6c9;">
                    Grants ${item.credit} (${item.hours}h)
                </span>
            `;
            scoreContainer.appendChild(label);
        });
    };

    renderScoreRadios(examSelect.value);
    examSelect.addEventListener('change', () => renderScoreRadios(examSelect.value));

    if (cancelBtn) cancelBtn.addEventListener('click', ctx.closeModal);
    if (switchDeBtn) {
        switchDeBtn.addEventListener('click', () => {
            ctx.closeModal();
            promptDEDrop(courseCode);
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const examName = examSelect.value;
        const checked = scoreContainer.querySelector('input[name="ap_drop_score"]:checked');
        if (!examName || !checked) return;

        const chosenScore = parseInt(checked.value, 10);
        const chosenCredit = checked.dataset.credit;
        const hasChoice = checked.dataset.hasChoice === 'true';

        savedScores[examName] = chosenScore;
        if (hasChoice) {
            savedSelections[examName] = chosenCredit;
        } else {
            delete savedSelections[examName];
        }

        localStorage.setItem('gt_ap_scores', JSON.stringify(savedScores));
        localStorage.setItem('gt_ap_selections', JSON.stringify(savedSelections));

        ctx.closeModal();
        initDataAndRefresh();
    });
}

function promptDEDrop(courseCode) {
    const courseObj = COURSES_DB[courseCode];
    const isPlaceholder = !courseObj || (courseObj.choices && courseObj.choices.length > 0) || courseCode.includes("ELECTIVE") || courseCode.includes("DEPTH") || courseCode.includes("BREADTH");

    let gtEquivalentControlHtml = '';
    if (courseObj && Array.isArray(courseObj.choices) && courseObj.choices.length > 0) {
        const opts = courseObj.choices.map(c => {
            const cInfo = COURSES_DB[c];
            return `<option value="${c}">${c}${cInfo ? ` — ${cInfo.name} (${cInfo.hours}h)` : ''}</option>`;
        }).join('');
        gtEquivalentControlHtml = `
            <select id="de-drop-gt-code" style="width: 100%; padding: 0.6rem; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.92rem; background: white;">
                ${opts}
            </select>
        `;
    } else {
        const defaultVal = isPlaceholder ? '' : courseCode;
        gtEquivalentControlHtml = `
            <input type="text" id="de-drop-gt-code" value="${defaultVal}" placeholder="e.g. ${courseCode === 'HUM ELECTIVE' ? 'ENGL 2130' : 'MATH 1551 & MATH 1552'}" required style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.92rem; box-sizing: border-box;">
        `;
    }

    const defaultTransferCode = !isPlaceholder ? courseCode : (courseObj && courseObj.choices ? courseObj.choices[0] : '');

    const bodyHtml = `
        <form id="de-drop-form" style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
                <label for="de-drop-institution" style="display: block; font-weight: 700; font-size: 0.85rem; color: var(--gt-navy); margin-bottom: 0.35rem;">What institution grants this credit?</label>
                <input type="text" id="de-drop-institution" placeholder="e.g. Georgia State University, GSU, UGA" required style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.92rem; box-sizing: border-box;">
                <span style="font-size: 0.75rem; color: #666; display: block; margin-top: 0.25rem;">Enter the college or university where you took the course.</span>
            </div>
            <div>
                <label for="de-drop-transfer-code" style="display: block; font-weight: 700; font-size: 0.85rem; color: var(--gt-navy); margin-bottom: 0.35rem;">Course Code Taken at Institution</label>
                <input type="text" id="de-drop-transfer-code" value="${defaultTransferCode}" placeholder="e.g. MATH 2211, ENGL 1101" required style="width: 100%; padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid var(--border-color); font-size: 0.92rem; box-sizing: border-box;">
            </div>
            <div>
                <label for="de-drop-gt-code" style="display: block; font-weight: 700; font-size: 0.85rem; color: var(--gt-navy); margin-bottom: 0.35rem;">GT Equivalent Course Code(s)</label>
                ${gtEquivalentControlHtml}
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
                <button type="button" id="de-drop-cancel-btn" class="modal-btn" style="background: #e0e0e0; color: #333;">Cancel</button>
                <button type="submit" class="modal-btn" style="background: var(--gt-navy);">Save Dual Enrollment Credit</button>
            </div>
        </form>
    `;

    const courseTitle = courseObj ? `${courseCode} — ${courseObj.name}` : courseCode;
    const ctx = openTransferDropModal(
        "Add Dual Enrollment Credit",
        `Grant transfer credit for ${courseTitle}.`,
        bodyHtml
    );
    if (!ctx) return;

    const instInput = ctx.bodyEl.querySelector('#de-drop-institution');
    const transferCodeInput = ctx.bodyEl.querySelector('#de-drop-transfer-code');
    const gtCodeInput = ctx.bodyEl.querySelector('#de-drop-gt-code');
    const cancelBtn = ctx.bodyEl.querySelector('#de-drop-cancel-btn');
    const form = ctx.bodyEl.querySelector('#de-drop-form');

    if (gtCodeInput && gtCodeInput.tagName === 'SELECT') {
        gtCodeInput.addEventListener('change', () => {
            transferCodeInput.value = gtCodeInput.value;
        });
    }

    setTimeout(() => {
        if (instInput) instInput.focus();
    }, 50);

    if (cancelBtn) cancelBtn.addEventListener('click', ctx.closeModal);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const institution = instInput.value.trim();
        const classTaken = transferCodeInput.value.trim() || gtCodeInput.value.trim();
        const gtCreditRaw = gtCodeInput.value.trim();

        if (!institution || !gtCreditRaw) return;

        const cleanGtCredit = gtCreditRaw.split('&').map(p => p.trim().toUpperCase()).join(' & ');
        const parts = cleanGtCredit.split('&').map(p => p.trim());
        const totalHours = parts.reduce((sum, p) => sum + getCourseHours(p), 0);

        const currentDE = loadDEData();
        currentDE.push({
            code: classTaken,
            name: `${classTaken} at ${institution}`,
            gt_credit: cleanGtCredit,
            gt_hours: totalHours,
            institution: institution,
            description: `Transfer credit for ${cleanGtCredit} from ${institution} (${classTaken}) via Dual Enrollment.`
        });

        localStorage.setItem('gt_de_credits', JSON.stringify(currentDE));
        ctx.closeModal();
        initDataAndRefresh();
    });
}

function removeTransferCredit(cls) {
    if (cls.source === "AP Credit" && cls.examName) {
        if (confirm(`Remove AP ${cls.examName} credit (${cls.code})?`)) {
            let savedScores = {};
            let savedSelections = {};
            try {
                savedScores = JSON.parse(localStorage.getItem('gt_ap_scores') || '{}');
                savedSelections = JSON.parse(localStorage.getItem('gt_ap_selections') || '{}');
            } catch (e) {}
            delete savedScores[cls.examName];
            delete savedSelections[cls.examName];
            localStorage.setItem('gt_ap_scores', JSON.stringify(savedScores));
            localStorage.setItem('gt_ap_selections', JSON.stringify(savedSelections));
            initDataAndRefresh();
        }
    } else if (cls.source === "Dual Enrollment" && cls.deIndex !== undefined) {
        if (confirm(`Remove Dual Enrollment credit "${cls.name}" (${cls.code})?`)) {
            const currentDE = loadDEData();
            if (cls.deIndex >= 0 && cls.deIndex < currentDE.length) {
                currentDE.splice(cls.deIndex, 1);
                localStorage.setItem('gt_de_credits', JSON.stringify(currentDE));
                initDataAndRefresh();
            }
        }
    }
}

// Kick off planner init
init();

