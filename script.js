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

function init() {
    // Populate data from data.js variables
    apData = AP_DATA.classes;
    deData = loadDEData();
    majorData = MAJOR_DATA.gt;

    // Load saved major
    const savedMajor = localStorage.getItem('gt_planner_major');
    if (savedMajor && majorData[savedMajor]) {
        activeMajor = savedMajor;
        gtMajorSelect.value = savedMajor;
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
    deData.forEach(de => {
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
    if (COURSES_DB[code] && COURSES_DB[code].category) {
        return COURSES_DB[code].category;
    }
    if (code.startsWith("SPAN") || code.startsWith("FREN") || code.startsWith("GRMN") || code.startsWith("JAPN") || code.startsWith("CHIN") || code.startsWith("LATN") || code === "ID 2242" || code === "MUSI 2700" || code.startsWith("HUM") || code.startsWith("ARCH")) {
        return "HUM";
    }
    if (code.startsWith("ECON") || code.startsWith("PSYC") || code.startsWith("SOCI") || code.startsWith("HTS") || code.startsWith("POL") || code.startsWith("INTA") || code.startsWith("SS") || code === "PUBP 3000") {
        return "SS";
    }
    return null;
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
                satisfiedBy = consumeCourse(c => choices.includes(c.code) || c.code === slotKey);
            } else if (slotKey.includes("ELECTIVE") || slotKey.includes("DEPTH") || slotKey.includes("BREADTH")) {
                // Elective placeholders are skipped in the first specific pass
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
    
    // 2. Audit elective placeholders next
    for (let category in auditResults) {
        auditResults[category].forEach(slot => {
            if (slot.satisfiedBy) return;
            
            const slotKey = slot.slotKey;
            if (slotKey.includes("ELECTIVE") || slotKey.includes("DEPTH") || slotKey.includes("BREADTH") || slotKey === "RESEARCH") {
                let matchFn = null;
                
                if (slotKey === "RESEARCH") {
                    matchFn = c => c.code === slotKey || c.code === "BIOS 4590" || c.code === "BIOS 4690";
                } else if (slotKey.startsWith("BIOS DEPTH")) {
                    matchFn = c => {
                        if (c.code === slotKey) return true;
                        if (!c.code.startsWith("BIOS")) return false;
                        const num = parseInt(c.code.replace(/\D/g, ''));
                        return num >= 3000 && num < 5000;
                    };
                } else if (slotKey.startsWith("BIOS BREADTH")) {
                    const sciencePrefixes = ["CHEM", "PHYS", "MATH", "CS", "NEUR", "BMED", "BIOS"];
                    matchFn = c => c.code === slotKey || sciencePrefixes.some(p => c.code.startsWith(p));
                } else if (slotKey.startsWith("BMED DEPTH")) {
                    matchFn = c => {
                        if (c.code === slotKey) return true;
                        if (!c.code.startsWith("BMED")) return false;
                        const num = parseInt(c.code.replace(/\D/g, ''));
                        return num >= 3000 && num < 5000;
                    };
                } else if (slotKey.startsWith("BMED BREADTH")) {
                    const engSciPrefixes = ["CHEM", "PHYS", "MATH", "CS", "BIOS", "MSE", "ECE", "COE", "ISYE", "BMED"];
                    matchFn = c => c.code === slotKey || engSciPrefixes.some(p => c.code.startsWith(p));
                } else if (slotKey.startsWith("NEUR BREADTH")) {
                    const neurPrefixes = ["NEUR", "PSYC", "BIOS", "BMED", "CS", "MATH"];
                    matchFn = c => c.code === slotKey || neurPrefixes.some(p => c.code.startsWith(p));
                } else if (slotKey === "HUM ELECTIVE") {
                    matchFn = c => c.code === slotKey || getCourseCategory(c.code) === "HUM";
                } else if (slotKey === "SS ELECTIVE") {
                    matchFn = c => c.code === slotKey || getCourseCategory(c.code) === "SS";
                } else if (slotKey === "FREE ELECTIVE") {
                    matchFn = c => c.code === slotKey || true;
                }
                
                if (matchFn) {
                    const satisfiedBy = consumeCourse(matchFn);
                    if (satisfiedBy) {
                        slot.satisfiedBy = satisfiedBy;
                        if (COURSES_DB[satisfiedBy.code]) {
                            slot.displayName = COURSES_DB[satisfiedBy.code].name;
                        }
                    }
                }
            }
        });
    }
    
    // Remaining planned courses go to Unused
    auditResults["Unused Courses"] = planned.map(c => ({
        slotKey: c.code,
        displayName: COURSES_DB[c.code] ? COURSES_DB[c.code].name : "Custom Course",
        satisfiedBy: c,
        isExtra: true
    }));
    
    return auditResults;
}

function buildCourseToRequirementMap(auditResults) {
    const mapping = new Map();
    for (let category in auditResults) {
        if (category === "Unused Courses") continue;
        auditResults[category].forEach(slot => {
            if (slot.satisfiedBy) {
                const key = `${slot.satisfiedBy.source}|${slot.satisfiedBy.code}`;
                mapping.set(key, category);
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

function updatePlanner() {
    const transferCredits = getTransferCredits();
    
    // 1. Identify all placeholder codes (keys in COURSES_DB with a choices array)
    const placeholderKeys = [];
    for (let code in COURSES_DB) {
        if (COURSES_DB[code].choices) {
            placeholderKeys.push(code);
        }
    }
    
    // 2. Gather all planned specific courses (excluding the placeholder keys themselves) and transfer credits
    const plannedSpecificCodes = new Set();
    transferCredits.forEach(c => plannedSpecificCodes.add(c.code));
    for (let semName in activeSchedule) {
        activeSchedule[semName].forEach(code => {
            if (!placeholderKeys.includes(code)) {
                plannedSpecificCodes.add(code);
            }
        });
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
            apListEl.appendChild(createClassCardForSemester(cls, true, fulfilledMap, "Transfer"));
        });

        const deListEl = semEl.querySelector('#de-transfer-list');
        deCredits.forEach(cls => {
            deListEl.appendChild(createClassCardForSemester(cls, true, fulfilledMap, "Transfer"));
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
                ${hasChoices ? `<span class="card-info-icon" title="View course descriptions in catalog" style="cursor: pointer; font-size: 0.85rem;">ℹ️</span>` : ''}
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
            const warningBadge = document.createElement('span');
            warningBadge.className = 'warning-badge';
            warningBadge.style.color = '#c62828';
            warningBadge.textContent = '⚠️ Specific Course Required';
            selectContainer.appendChild(warningBadge);
            
            const warningText = document.createElement('div');
            warningText.className = 'warning-text';
            warningText.textContent = 'Replace from left or search catalog';
            selectContainer.appendChild(warningText);
        }
        card.appendChild(selectContainer);
    }

    // Map requirement category badge
    const key = `${semName}|${cls.code}`;
    const reqCategory = fulfilledMap.get(key);
    
    const badge = document.createElement('div');
    if (reqCategory) {
        badge.className = 'class-badge';
        badge.textContent = reqCategory;
        card.appendChild(badge);
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
        
        catEl.innerHTML = `
            <div class="category-header">
                <span class="category-title"><span class="collapse-arrow">▼</span>${category}</span>
                <span class="category-progress">${satisfiedHours}/${requiredHours}h</span>
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
                } else {
                    // Regular satisfied slot
                    satisfiedSlot.innerHTML = `
                        <div class="satisfied-details">
                            <span class="satisfied-title">${slot.displayName}</span>
                            <span class="satisfied-source">${code} (${hours}h) - ${source}</span>
                        </div>
                        <span class="satisfied-icon">✓</span>
                    `;
                }
                
                listEl.appendChild(satisfiedSlot);
            } else {
                // Render remaining draggable card
                let card;
                if (slot.isChoice) {
                    card = createChoiceCard(slot);
                } else if (slot.slotKey.includes("ELECTIVE") || slot.slotKey.includes("DEPTH") || slot.slotKey.includes("BREADTH") || slot.slotKey === "RESEARCH") {
                    card = createElectiveCard(slot);
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

function createElectiveCard(slot) {
    const card = document.createElement('div');
    card.className = 'class-card elective-card';
    card.dataset.code = slot.slotKey;
    card.dataset.hours = 3;
    card.dataset.type = 'elective';
    
    card.innerHTML = `
        <div class="class-card-header">
            <span class="code" style="color: #e65100;">${slot.slotKey}</span>
            <span class="name">${slot.displayName}</span>
            <span class="hours">3h</span>
        </div>
        <div class="course-details">
            Drag this placeholder, or search catalog and drag a specific course.
        </div>
    `;
    
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

function updateStats(auditResults) {
    const major = majorData[activeMajor];
    const transferCredits = getTransferCredits();
    
    let totalSatisfiedHours = transferCredits.reduce((sum, c) => sum + c.hours, 0);
    
    for (let semName in activeSchedule) {
        activeSchedule[semName].forEach(code => {
            totalSatisfiedHours += getCourseHours(code);
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
            card.classList.add('expanded');
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

// Kick off planner init
init();
