/**
 * Author: BrainZag
 * Repository: https://github.com/rqp314/BrainZag
 * License: See LICENSE file
 * Copyright (c) 2026 BrainZag
 *
 * Game logic, UI handling, debug tools
 *
*/

// ------------------ Debug Flag ------------------
// Debug mode enabled automatically on localhost, disabled on production
const IS_LOCAL_HOST = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

// ------------------ Config ------------------

const COLORS = [
    { color: "#0000FF", rank: 1, name: "blue" },
    { color: "#9D00FF", rank: 2, name: "purple" },
    { color: "#23AE3A", rank: 3, name: "green" },
    { color: "#FFDE21", rank: 4, name: "yellow" },
    { color: "#FFA500", rank: 5, name: "orange" },
    { color: "#895129", rank: 6, name: "brown" },
    { color: "#CD1C18", rank: 7, name: "red" },
    { color: "#0C0A09", rank: 8, name: "black" }
];

// Create color mappings
const COLOR_NAME_TO_HEX = {};
const COLOR_HEX_TO_NAME = {};
COLORS.forEach(c => {
    COLOR_NAME_TO_HEX[c.name] = c.color;
    COLOR_HEX_TO_NAME[c.color] = c.name;
});

const DISPLAY_TIME = 500;   // 0.5s stimulus showing
const INTERVAL_TIME = 2500; // 2.5s between items

// Get adaptive stimulus interval, applying the DifficultyController speed multiplier
// stimulusInterval: 0.92 = faster (in flow), 1.08 = slower (fatigued), 1.0 = normal
function getAdaptiveInterval() {
    const adaptive = nbackEngine
        ? (nbackEngine.getStats().stimulusInterval || 1.0)
        : 1.0;
    return INTERVAL_TIME * adaptive;
}

// Get adaptive display time for how long the stimulus stays visible
function getAdaptiveDisplayTime() {
    const adaptive = nbackEngine
        ? (nbackEngine.getStats().stimulusInterval || 1.0)
        : 1.0;
    return DISPLAY_TIME * adaptive;
}

// ------------------ ReactionTimer ------------------

class ReactionTimer {
    constructor() {
        this.stimulusTime = null;
        this.filter = new LowPassFilter(0.1);
        this.currentAvg = 500; // initial estimate
    }

    startTrial() {
        this.stimulusTime = performance.now();
    }

    recordResponse() {
        if (this.stimulusTime === null) {
            return 500; // fallback if no trial started
        }
        const reactionTime = performance.now() - this.stimulusTime;
        this.currentAvg = this.filter.apply(this.currentAvg, reactionTime);
        return reactionTime;
    }

    recordNonResponse() {
        // User didn't click, count full interval time
        return INTERVAL_TIME;
    }

    reset() {
        this.stimulusTime = null;
    }
}

// ------------------ State ------------------

let n = 1;
let index = 0;
let intervalId = null;
let isRunning = false;
let rounds = 0;

let correctMatches = 0;
let incorrectMatches = 0;
let totalTargets = 0;

// Positive insight tracking
let currentStreak = 0;
let longestStreak = 0;
let lastRoundAccuracy = null; // accuracy from previous round (for comparison)
let recentInsights = []; // avoid repeating the same insight recently

let roundLocked = false;
let currentActiveCell = null; // track the cell currently showing stimulus
let currentBgCell = null; // track corresponding background cell
let coloredCellVisible = false; // track if colored cell is currently visible
let hideTimeout = null; // track timeout for hiding colored cell
let speedMultiplier = 1; // 1 = normal speed, 2 = double speed
let deactivatedCells = []; // indices of cells that are hidden for this game (0-8)

// Cell hiding timing system
const WARMUP_DURATION = 1 * 60 * 1000; // 1 minute warmup before cell hiding starts
const LAYOUT_DURATION = 1.618 * 60 * 1000; // 1.618 minutes per layout (based on play time)
let lastActivityTimestamp = null; // when player last had activity (persisted)
let currentGameStartTime = null; // when current game round started
let accumulatedPlayTime = 0; // total ms played in current session (resets when away > 10 min)
let layoutPlayTimeStart = 0; // accumulated play time when current layout was created
let cellHidingActive = false; // whether cell hiding is currently active

const AWAY_THRESHOLD = 10 * 60 * 1000; // 10 minutes in ms

// N-Back Engine
let nbackEngine = null;
let reactionTimer = new ReactionTimer(); // track reaction times

// Trial history: Map<roundId, Trial[]> - each round has its own array of trials
const MAX_ROUNDS_STORED = 50; // keep last 50 rounds
let trialHistory = new Map();
let currentRoundId = 0;

// Performance tracking: Map<dateStr, PerformanceData> - daily aggregates
// includes heatmap (playTime) and progress (hits, misses, etc.)
const MAX_DAYS_STORED = 3650; // ~10 years
let performanceHistory = new Map();
let pendingPerformance = null; // in memory until stopGame saves it
let pendingPerformanceDate = null; // which date this pending data belongs to

// Load nback engine state from localStorage (trainer state only, not trial history)
function loadNBackEngineState() {
    try {
        const savedState = localStorage.getItem('nbackEngineState');
        if (!savedState) return null;

        const state = JSON.parse(savedState);

        // Recreate the nback engine from saved state
        const game = new NBackEngine({
            startN: state.currentN,
            colors: COLORS
        });

        // Restore internal state if available
        if (state.trainerState) {
            game.trainer.trialNumber = state.trainerState.trialNumber || 0;
            game.trainer.difficultyController.currentUniqueColors = state.trainerState.currentUniqueColors || 2;
            if (state.trainerState.theta !== undefined) {
                game.trainer.abilityModel.theta = state.trainerState.theta;
            }
            if (state.trainerState.targetEntropy !== undefined) {
                game.trainer.difficultyController.targetEntropy = state.trainerState.targetEntropy;
            }
        }

        return game;
    } catch (e) {
        console.error('Failed to load nback engine state:', e);
        return null;
    }
}

// Save nback engine state to localStorage (trainer state only)
function saveNBackEngineState() {
    if (!nbackEngine) return;

    try {
        const state = nbackEngine.toJSON();
        localStorage.setItem('nbackEngineState', JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save nback engine state:', e);
    }
}

// Prune Map to keep only most recent entries (Maps preserve insertion order)
function pruneMap(map, maxSize) {
    let deleteCount = map.size - maxSize;
    for (const key of map.keys()) {
        if (deleteCount-- <= 0) break;
        map.delete(key);
    }
}

// ================== Trial History (Map<roundId, Trial[]>) ==================

function loadTrialHistory() {
    try {
        const saved = localStorage.getItem('trialHistory');
        if (saved) {
            const data = JSON.parse(saved);
            trialHistory = new Map(data.rounds || []);
            currentRoundId = data.currentRoundId || 0;
        }
    } catch (e) {
        console.error('Failed to load trial history:', e);
        trialHistory = new Map();
        currentRoundId = 0;
    }
}

function saveTrialHistory() {
    try {
        pruneMap(trialHistory, MAX_ROUNDS_STORED);
        localStorage.setItem('trialHistory', JSON.stringify({
            rounds: [...trialHistory.entries()],
            currentRoundId: currentRoundId
        }));
    } catch (e) {
        console.error('Failed to save trial history:', e);
    }
}

// Get trials from the current round
function getCurrentRoundTrials() {
    return trialHistory.get(currentRoundId) || [];
}

// Check if current tile matches the one N positions back (within current round only)
function isActualMatchInRound(currentColor, nBack) {
    const roundTrials = getCurrentRoundTrials();
    const nBackIndex = roundTrials.length - 1 - nBack;
    if (nBackIndex < 0) return false;
    return currentColor === roundTrials[nBackIndex].color;
}

// Add a new trial to history (called when tile is shown)
function addTrialToHistory(tile, nBack) {
    const trial = {
        color: tile.color,
        position: tile.position,
        timestamp: Date.now(),
        n: nBack,
        currentLoad: tile.currentLoad,
        targetLoad: tile.targetLoad,
        targetUniqueColors: tile.targetUniqueColors,
        wasMatch: null,
        userClicked: null,
        correct: null,
        reactionTime: null
    };

    if (!trialHistory.has(currentRoundId)) {
        trialHistory.set(currentRoundId, []);
    }
    trialHistory.get(currentRoundId).push(trial);

    return trial;
}

// Update the last trial in current round with response data
function updateLastTrialWithResponse(wasMatch, userClicked, correct, reactionTime) {
    const roundTrials = getCurrentRoundTrials();
    if (roundTrials.length === 0) return;

    const lastTrial = roundTrials[roundTrials.length - 1];
    lastTrial.wasMatch = wasMatch;
    lastTrial.userClicked = userClicked;
    lastTrial.correct = correct;
    lastTrial.reactionTime = reactionTime;
}

// Get recent trials from current round for error monitoring
function getRecentTrialsInRound(count) {
    return getCurrentRoundTrials().slice(-count);
}

// Get last trial info for response recording
function getLastTrialInfo() {
    const roundTrials = getCurrentRoundTrials();
    const lastTrial = roundTrials.length > 0 ? roundTrials[roundTrials.length - 1] : null;
    const wasMatch = lastTrial ? isActualMatchInRound(lastTrial.color, n) : false;
    return { lastTrial, wasMatch };
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Get localStorage size and top biggest entries
function getLocalStorageInfo() {
    const entries = [];
    let total = 0;

    for (const key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            const size = key.length + localStorage[key].length;
            total += size;
            entries.push({ key, size });
        }
    }

    entries.sort((a, b) => b.size - a.size);
    const top = entries.slice(0, 5).map(e => `${e.key}: ${formatBytes(e.size)}`);

    return { total: formatBytes(total), top };
}

// Save cell hiding state to localStorage
function saveCellHidingState() {
    try {
        const state = {
            accumulatedPlayTime,
            layoutPlayTimeStart,
            cellHidingActive,
            deactivatedCells
        };
        localStorage.setItem('cellHidingState', JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save cell hiding state:', e);
    }
}

// Load cell hiding state from localStorage
function loadCellHidingState() {
    try {
        const saved = localStorage.getItem('cellHidingState');
        if (!saved) return;

        const state = JSON.parse(saved);
        accumulatedPlayTime = state.accumulatedPlayTime || 0;
        layoutPlayTimeStart = state.layoutPlayTimeStart || 0;
        cellHidingActive = state.cellHidingActive || false;
        deactivatedCells = state.deactivatedCells || [];

        // Apply the visual state
        applyDeactivatedCells();
    } catch (e) {
        console.error('Failed to load cell hiding state:', e);
    }
}

// ------------------ Daily Timer & Progress Bar (Centered Marks) ------------------

let elapsedSeconds = 0;      // total seconds played today
let timerInterval = null;
const CHUNK_SECONDS = 1200; // 20 minutes per chunk
let minuteIndicators = [];  // DOM elements for minute markers
let progressBarFull = false; // track if progress bar has reached 100% during gameplay
let minutePositions = []; // Fibonacci-based minute positions (in minutes)
let lastCompletedChunk = 0; // track the last completed chunk to detect resets
let isAnimatingBar = false; // track if progress bar is animating (during stopGame)
let segmentElements = []; // DOM elements for segmented progress bars during gameplay

// ================== Performance History (Map<dateStr, PerformanceData>) ==================
// heatmap + progress: { n, hits, misses, falseAlarms, correctRejections, sumLoad, maxLoad, playTime }
// ~100 bytes per day = ~365KB for 10 years

const HEATMAP_TARGET_SECONDS = 1200; // 20 minutes = full green

// Format date as YYYY-MM-DD in local time (not UTC)
function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Load performance history from localStorage
function loadPerformanceHistory() {
    try {
        const saved = localStorage.getItem("performanceHistory");
        if (saved) {
            performanceHistory = new Map(JSON.parse(saved));
        }
    } catch (e) {
        console.error("Failed to load performance history:", e);
        performanceHistory = new Map();
    }
}

// Save performance history to localStorage (~10 years)
function savePerformanceHistory() {
    try {
        pruneMap(performanceHistory, MAX_DAYS_STORED);
        localStorage.setItem("performanceHistory", JSON.stringify([...performanceHistory.entries()]));
    } catch (e) {
        console.error("Failed to save performance history:", e);
    }
}

// Initialize pendingPerformance from Map (load today's existing data if any)
function initPendingPerformance() {
    const today = formatDateLocal(new Date());
    const existing = performanceHistory.get(today);

    if (existing) {
        pendingPerformance = { ...existing };
    } else {
        pendingPerformance = {
            n: 1,
            hits: 0,
            misses: 0,
            falseAlarms: 0,
            correctRejections: 0,
            sumLoad: 0,
            maxLoad: 0,
            playTime: 0
        };
    }
    pendingPerformanceDate = today;
}

// Update pendingPerformance in memory (called after each trial, no disk write)
function updateDailyProgress(trialData) {
    if (!pendingPerformance) {
        initPendingPerformance();
    }

    if (trialData.wasMatch && trialData.userClicked) {
        pendingPerformance.hits++;
    } else if (trialData.wasMatch && !trialData.userClicked) {
        pendingPerformance.misses++;
    } else if (!trialData.wasMatch && trialData.userClicked) {
        pendingPerformance.falseAlarms++;
    } else {
        pendingPerformance.correctRejections++;
    }

    pendingPerformance.sumLoad += trialData.currentLoad;
    pendingPerformance.maxLoad = Math.max(pendingPerformance.maxLoad, trialData.currentLoad);
    pendingPerformance.n = Math.max(pendingPerformance.n, trialData.n);
}

// Update playTime in pendingPerformance
function updatePlayTime(seconds) {
    if (!pendingPerformance) {
        initPendingPerformance();
    }
    pendingPerformance.playTime = seconds;
}

// Save pendingPerformance to Map and disk (called on game end)
function savePerformanceToDisk() {
    if (!pendingPerformance) return;

    const today = formatDateLocal(new Date());

    // Handles midnight boundary: if the date rolled over, save stale data under its
    // original date and re-init a fresh object for the new day
    if (pendingPerformanceDate && pendingPerformanceDate !== today) {
        // Day changed since we started accumulating. Save old data under its date.
        performanceHistory.set(pendingPerformanceDate, pendingPerformance);
        savePerformanceHistory();
        // Start fresh for the new day
        initPendingPerformance();
    }

    performanceHistory.set(today, pendingPerformance);
    savePerformanceHistory();
}

// Get playTime for a date (for heatmap rendering)
function getPlayTime(dateStr) {
    const data = performanceHistory.get(dateStr);
    return data ? data.playTime : 0;
}

// TODO: Get computed stats for a day (for display/graphing user's progression) thats for the future when we want to display graph

// function getDailyStats(dateStr) {
//     const entry = performanceHistory.get(dateStr);
//     if (!entry) return null;

//     const trials = entry.hits + entry.misses + entry.falseAlarms + entry.correctRejections;
//     if (trials === 0) return null;

//     const totalMatches = entry.hits + entry.misses;
//     const totalNonMatches = entry.falseAlarms + entry.correctRejections;
//     const hitRate = totalMatches > 0 ? entry.hits / totalMatches : 0;
//     const faRate = totalNonMatches > 0 ? entry.falseAlarms / totalNonMatches : 0;

//     return {
//         date: dateStr,
//         n: entry.n,
//         trials: trials,
//         accuracy: (entry.hits + entry.correctRejections) / trials,
//         hitRate: hitRate,
//         faRate: faRate,
//         dPrime: totalMatches > 0 && totalNonMatches > 0 ? computeDPrime(hitRate, faRate) : null,
//         avgLoad: entry.sumLoad / trials,
//         maxLoad: entry.maxLoad,
//         playTime: entry.playTime
//     };
// }

// // Get all daily stats for graphing (returns array sorted by date)
// function getAllDailyStats() {
//     const stats = [];

//     for (const [dateStr] of performanceHistory) {
//         const dayStats = getDailyStats(dateStr);
//         if (dayStats) {
//             stats.push(dayStats);
//         }
//     }

//     // Sort by date ascending
//     stats.sort((a, b) => a.date.localeCompare(b.date));
//     return stats;
// }

// Helper: check if a date has level-4 playtime (20+ min)
function isLevel4(dateStr, todayStr, elapsedSec) {
    const seconds = dateStr === todayStr ? elapsedSec : getPlayTime(dateStr);
    return seconds >= 1200;
}

// Helper: find current streak start date (returns null if no active streak)
function findStreakStart(today, todayStr, elapsedSec) {
    // Check if today is level-4
    if (!isLevel4(todayStr, todayStr, elapsedSec)) {
        return null; // No active streak
    }

    // Walk backwards to find streak start
    let streakStart = new Date(today);
    let checkDate = new Date(today);

    while (true) {
        checkDate.setDate(checkDate.getDate() - 1);
        const checkDateStr = formatDateLocal(checkDate);

        if (!isLevel4(checkDateStr, todayStr, elapsedSec)) {
            break; // Found the day before streak started
        }
        streakStart = new Date(checkDate);
    }

    return streakStart;
}

// Render the activity heatmap (3 months, Monday start, 2 weeks ahead)
function renderActivityHeatmap() {
    const container = bannerHeatmap;
    if (!container) return;

    const today = new Date();
    const todayStr = formatDateLocal(today);

    // Find current streak and calculate 21-day goal
    // (total of 7h training is required, if you train 20min per day)
    const streakStart = findStreakStart(today, todayStr, elapsedSeconds);
    let goalDateStr = null;
    if (streakStart) {
        const goalDate = new Date(streakStart);
        goalDate.setDate(goalDate.getDate() + 20); // 21 days total (day 0 + 20)
        const goalDateFormatted = formatDateLocal(goalDate);
        // Only show flag if goal is strictly in the future (not today or past)
        if (goalDateFormatted > todayStr) {
            goalDateStr = goalDateFormatted;
        }
    }

    // Month names (3 letter)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Get the 3 months to display (current month and 2 previous)
    const months = [];
    for (let i = 2; i >= 0; i--) {
        const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push({
            year: monthDate.getFullYear(),
            month: monthDate.getMonth(),
            name: monthNames[monthDate.getMonth()]
        });
    }

    // End date is 25 days from now
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 25);

    // Fixed 5 weeks per month for uniform display
    const WEEKS_PER_MONTH = 5;

    // Counter for wave animation delay on future cells
    let futureCellIndex = 0;

    let html = '<div class="heatmap-container">';

    // Render each month separately
    months.forEach((monthInfo, monthIndex) => {
        const monthStart = new Date(monthInfo.year, monthInfo.month, 1);
        const monthEnd = new Date(monthInfo.year, monthInfo.month + 1, 0);

        // Align start to Monday
        const startDayOfWeek = monthStart.getDay();
        const daysToMonday = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
        const alignedStart = new Date(monthStart);
        alignedStart.setDate(alignedStart.getDate() - daysToMonday);

        html += '<div class="heatmap-month">';
        html += '<div class="heatmap-grid">';

        // Day labels (only for first month)
        if (monthIndex === 0) {
            html += '<div class="heatmap-labels">';
            html += '<div class="heatmap-day-label"></div>'; // empty for title row
            const dayLabels = ['M', '', 'W', '', 'F', '', ''];
            dayLabels.forEach(label => {
                html += `<div class="heatmap-day-label">${label}</div>`;
            });
            html += '</div>';
        }

        html += '<div class="heatmap-weeks-container">';
        html += `<div class="heatmap-month-title">${monthInfo.name}</div>`;
        html += '<div class="heatmap-weeks">';

        for (let week = 0; week < WEEKS_PER_MONTH; week++) {
            html += '<div class="heatmap-week">';

            for (let day = 0; day < 7; day++) {
                const cellDate = new Date(alignedStart);
                cellDate.setDate(alignedStart.getDate() + week * 7 + day);
                const dateStr = formatDateLocal(cellDate);
                const cellMonth = cellDate.getMonth();

                // Check if date is outside this month
                if (cellMonth !== monthInfo.month) {
                    html += '<div class="heatmap-cell heatmap-outside"></div>';
                    continue;
                }

                // Check if date is in the future (but within 2 weeks for last month)
                if (cellDate > today) {
                    if (monthIndex === 2 && cellDate <= endDate) {
                        const isGoal = dateStr === goalDateStr;
                        const goalClass = isGoal ? ' heatmap-goal' : '';
                        // Only show dots if goal exists and date is before or on goal
                        const showDot = goalDateStr && dateStr <= goalDateStr && !isGoal;
                        const dotClass = showDot ? ' heatmap-future-dot' : '';
                        const waveDelay = showDot ? `style="--wave-delay: ${futureCellIndex * 0.08}s"` : '';
                        html += `<div class="heatmap-cell heatmap-future${goalClass}${dotClass}" ${waveDelay}></div>`;
                        if (showDot) futureCellIndex++;
                    } else {
                        html += '<div class="heatmap-cell heatmap-outside"></div>';
                    }
                    continue;
                }

                // Use current elapsedSeconds for today, otherwise get from history
                const seconds = dateStr === todayStr ? elapsedSeconds : getPlayTime(dateStr);

                // Color levels based on playtime thresholds
                let colorClass = 'heatmap-level-0';
                const isCurrentLevel4 = seconds >= 1200;
                if (isCurrentLevel4) colorClass = 'heatmap-level-4';      // 20+ min
                else if (seconds >= 600) colorClass = 'heatmap-level-3';  // 10+ min
                else if (seconds >= 300) colorClass = 'heatmap-level-2';  // 5+ min
                else if (seconds >= 30) colorClass = 'heatmap-level-1';   // 30+ sec

                const isToday = dateStr === todayStr;
                const todayClass = isToday ? ' heatmap-today' : '';

                // Check for streak (consecutive level-4 days)
                let streakClass = '';
                if (isCurrentLevel4) {
                    // Check previous day
                    const prevDate = new Date(cellDate);
                    prevDate.setDate(prevDate.getDate() - 1);
                    const prevDateStr = formatDateLocal(prevDate);
                    const prevIsLevel4 = isLevel4(prevDateStr, todayStr, elapsedSeconds);

                    // Check next day
                    const nextDate = new Date(cellDate);
                    nextDate.setDate(nextDate.getDate() + 1);
                    const nextDateStr = formatDateLocal(nextDate);
                    const nextIsLevel4 = nextDate <= today && isLevel4(nextDateStr, todayStr, elapsedSeconds);

                    if (prevIsLevel4 && nextIsLevel4) {
                        streakClass = ' heatmap-streak-middle';
                    } else if (prevIsLevel4) {
                        streakClass = ' heatmap-streak-end';
                    } else if (nextIsLevel4) {
                        streakClass = ' heatmap-streak-start';
                    }
                }

                html += `<div class="heatmap-cell ${colorClass}${todayClass}${streakClass}" title="${dateStr}: ${Math.floor(seconds / 60)}min"></div>`;
            }

            html += '</div>';
        }

        html += '</div></div></div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

// Show results banner (overlays grid with heatmap OR stats, not both)
function showBanner(showStats = false) {
    if (!resultsBanner) return;

    if (showStats) {
        // End screen: show stats only, no heatmap
        if (bannerHeatmap) bannerHeatmap.innerHTML = '';
    } else {
        // Idle screen: show heatmap only, no stats
        if (bannerStats) bannerStats.innerHTML = '';
        renderActivityHeatmap();
    }

    resultsBanner.classList.remove('banner-hidden');
}

// Hide results banner (during gameplay)
function hideBanner() {
    if (!resultsBanner) return;
    resultsBanner.classList.add('banner-hidden');
}

// Initialize daily timer from performanceHistory (single source of truth)
function loadDailyTimer() {
    const today = formatDateLocal(new Date());
    const todayData = performanceHistory.get(today);
    elapsedSeconds = todayData ? todayData.playTime : 0;

    updateTimerUI();
    loadMinutePositions();
    renderActivityHeatmap();
}

function generateFibonacciMinutePositions() {
    const PHI = 1.618;

    // Start with first position in first 5 minutes
    const pos1 = Math.random() * 3 + 1; // random between 1 and 4 minutes

    // Initial interval between positions
    const baseInterval = Math.random() * 2 + 2; // random between 2 and 4 minutes

    // Each subsequent position uses Fibonacci ratio for spacing
    const pos2 = Math.min(pos1 + baseInterval, 18.0);
    const pos3 = Math.min(pos2 + (baseInterval * PHI), 18.0);
    const pos4 = Math.min(pos3 + (baseInterval * PHI * PHI), 18.0);

    return [pos1, pos2, pos3, pos4];
}

// Load minute positions from localStorage or generate new ones if new day
function loadMinutePositions() {
    const savedDate = localStorage.getItem("minutePositionsDate");
    const savedPositions = localStorage.getItem("minutePositions");
    const today = formatDateLocal(new Date());

    if (savedDate === today && savedPositions) {
        minutePositions = JSON.parse(savedPositions);
    } else {
        minutePositions = generateFibonacciMinutePositions();
        saveMinutePositions();
    }
}

// Save minute positions to localStorage
function saveMinutePositions() {
    const today = formatDateLocal(new Date());
    localStorage.setItem("minutePositions", JSON.stringify(minutePositions));
    localStorage.setItem("minutePositionsDate", today);
}

// Update segmented progress bar based on current progress
function updateSegmentedProgressBar(progressPercent) {
    if (!isRunning || segmentElements.length === 0) return;

    segmentElements.forEach(seg => {
        if (progressPercent <= seg.startPercent) {
            // Haven't reached this segment yet
            seg.fill.style.width = "0%";
        } else if (progressPercent >= seg.endPercent) {
            // Segment is completely filled
            seg.fill.style.width = "100%";
        } else {
            // Partially filled segment
            const segmentWidth = seg.endPercent - seg.startPercent;
            const segmentProgress = progressPercent - seg.startPercent;
            const fillPercent = (segmentProgress / segmentWidth) * 100;
            seg.fill.style.width = `${fillPercent}%`;
        }
    });
}

function updateTimerUI() {
    // Update current session progress fill (only during gameplay)
    if (isRunning) {
        const currentProgress = elapsedSeconds % CHUNK_SECONDS;
        const progressPercent = (currentProgress / CHUNK_SECONDS) * 100;

        // If bar has reached 100% during this session, keep it there
        if (progressBarFull) {
            timerFill.style.width = "100%";
            updateSegmentedProgressBar(100);
            return;
        }

        // Check if we're at or past 100%
        if (progressPercent >= 99.9) {
            progressBarFull = true;
            timerFill.style.transition = "width 0.3s linear";
            timerFill.style.width = "100%";
            updateSegmentedProgressBar(100);
        } else {
            // Normal update
            timerFill.style.transition = "width 0.3s linear";
            timerFill.style.width = `${progressPercent}%`;
            updateSegmentedProgressBar(progressPercent);
        }

        // Update indicator styles based on progress
        updateIndicatorStyles();
    }
}

// Start daily timer while game runs
function startDailyTimer() {
    if (timerInterval) return;

    // Initialize last completed chunk
    lastCompletedChunk = Math.floor(elapsedSeconds / CHUNK_SECONDS);

    timerInterval = setInterval(() => {
        elapsedSeconds++;

        // Check if we crossed into a new chunk
        const currentChunk = Math.floor(elapsedSeconds / CHUNK_SECONDS);
        if (currentChunk > lastCompletedChunk) {
            lastCompletedChunk = currentChunk;

            // Only reset progress bar if it hasn't reached 100% yet
            // If progressBarFull is true, keep the bar at 100% during gameplay
            if (!progressBarFull) {
                // Reset progress bar to start of new chunk
                timerFill.style.transition = "none";
                timerFill.style.width = "0%";

                // Reset segmented progress bar if in gameplay mode
                if (isRunning && segmentElements.length > 0) {
                    segmentElements.forEach(seg => {
                        seg.fill.style.transition = "none";
                        seg.fill.style.width = "0%";
                    });
                    setTimeout(() => {
                        segmentElements.forEach(seg => {
                            seg.fill.style.transition = "width 0.3s linear";
                        });
                    }, 50);
                }

                // Force reflow
                setTimeout(() => {
                    timerFill.style.transition = "width 0.3s linear";
                }, 50);
            }

            // DO NOT show indicators during gameplay
            // Indicators are only shown during end screen (in stopGame)
        }

        updateTimerUI();
        updatePlayTime(elapsedSeconds);
    }, 1000);
}

// Stop daily timer when game stops
function stopDailyTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
}

// Format seconds to HH:MM:SS or MM:SS
function formatTime(secs) {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const s = secs % 60;

    if (hrs > 0) {
        return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Create minute indicators using Fibonacci-based positions (offset by completed chunks)
function createMinuteIndicators() {
    // Remove old indicators
    minuteIndicators.forEach(m => m.remove());
    minuteIndicators = [];

    const completedChunks = Math.floor(elapsedSeconds / CHUNK_SECONDS);
    const minuteOffset = completedChunks * 20; // offset for completed 20-min chunks

    minutePositions.forEach(min => {
        const seconds = min * 60;
        const position = (seconds / CHUNK_SECONDS) * 100; // percentage

        if (position <= 100) { // only show if within current 20-min chunk
            const indicator = document.createElement("div");
            indicator.style.position = "absolute";
            indicator.style.left = `${position}%`;
            indicator.style.top = "0";
            indicator.style.width = "2px";
            indicator.style.height = "100%";
            indicator.style.background = "rgba(0, 0, 0, 0.6)";
            indicator.style.transform = "translateX(-1px)"; // center the 2px line
            indicator.style.opacity = "0";
            indicator.style.transition = "opacity 0.3s ease, background 0.3s ease, width 0.3s ease";
            indicator.dataset.position = position; // store position for later checks

            // Add label inside the bar with offset
            const label = document.createElement("div");
            const displayMinute = Math.round(min + minuteOffset);
            label.textContent = `${displayMinute}m`;
            label.style.position = "absolute";
            label.style.top = "50%";
            label.style.left = "4px"; // offset to the right of the line
            label.style.transform = "translateY(-50%)";
            label.style.fontSize = "9px";
            label.style.color = "rgba(0, 0, 0, 0.8)";
            label.style.whiteSpace = "nowrap";
            label.style.fontWeight = "bold";
            label.style.transition = "color 0.3s ease, font-weight 0.3s ease";

            indicator.appendChild(label);
            timerProgress.appendChild(indicator);
            minuteIndicators.push(indicator);

            // Fade in
            setTimeout(() => {
                indicator.style.opacity = "1";
            }, 50);
        }
    });

    // Update styles based on current progress (only if not animating)
    if (!isAnimatingBar) {
        setTimeout(() => {
            updateIndicatorStyles();
        }, 100);
    } else {
        // During animation, start with all indicators highlighted (bar at 0%)
        setTimeout(() => {
            updateIndicatorStyles(0);
        }, 100);
    }
}

// Update indicator styles based on current progress
// animatedPercent: optional override for when bar is animating (use animated position instead of actual time)
function updateIndicatorStyles(animatedPercent = null) {
    let progressPercent;

    if (animatedPercent !== null) {
        // Use the animated bar position
        progressPercent = animatedPercent;
    } else {
        // Use actual time progress
        const currentProgress = elapsedSeconds % CHUNK_SECONDS;
        progressPercent = (currentProgress / CHUNK_SECONDS) * 100;
    }

    // Find upcoming indicators (not yet passed) and sort by position
    const upcomingIndicators = minuteIndicators
        .map(indicator => ({
            element: indicator,
            position: parseFloat(indicator.dataset.position)
        }))
        .filter(item => progressPercent <= item.position)
        .sort((a, b) => a.position - b.position);

    // Get the next 2 upcoming indicators
    const nextTwoPositions = upcomingIndicators.slice(0, 2).map(item => item.position);

    // Get the very next indicator position for bounce animation
    const nextIndicatorPosition = upcomingIndicators.length > 0 ? upcomingIndicators[0].position : null;

    minuteIndicators.forEach(indicator => {
        const indicatorPosition = parseFloat(indicator.dataset.position);
        const label = indicator.querySelector("div");
        const isNextIndicator = indicatorPosition === nextIndicatorPosition;

        if (progressPercent > indicatorPosition) {
            // Progress bar has passed this indicator - make it grey/thin
            indicator.style.background = "rgba(0, 0, 0, 0.2)";
            indicator.style.width = "1px";
            indicator.style.transform = "translateX(-0.5px)";
            if (label) {
                label.classList.remove("minute-label-bounce", "minute-label-drift");
                label.style.color = "rgba(0, 0, 0, 0.4)";
                label.style.fontWeight = "400";
            }
        } else if (nextTwoPositions.includes(indicatorPosition)) {
            // This is one of the next 2 upcoming indicators - MOST bold
            indicator.style.background = "rgba(0, 0, 0, 0.6)";
            indicator.style.width = "2px";
            indicator.style.transform = "translateX(-1px)";
            if (label) {
                // Apply animation only to the very next indicator's label
                // Randomly pick between bounce and drift
                if (isNextIndicator) {
                    if (!label.classList.contains("minute-label-bounce") && !label.classList.contains("minute-label-drift")) {
                        const anim = Math.random() < 0.4 ? "minute-label-drift" : "minute-label-bounce";
                        label.classList.add(anim);
                    }
                } else {
                    label.classList.remove("minute-label-bounce", "minute-label-drift");
                }
                label.style.color = "rgba(0, 0, 0, 0.8)";
                label.style.fontWeight = "bold";
            }
        } else {
            // Further ahead indicators - all should have the same less bold style
            indicator.style.background = "rgba(0, 0, 0, 0.45)";
            indicator.style.width = "1.5px";
            indicator.style.transform = "translateX(-0.75px)";
            if (label) {
                label.classList.remove("minute-label-bounce", "minute-label-drift");
                label.style.color = "rgba(0, 0, 0, 0.65)";
                label.style.fontWeight = "600";
            }
        }
    });
}

// Remove minute indicators
function removeMinuteIndicators() {
    minuteIndicators.forEach(m => {
        m.style.opacity = "0";
    });
    setTimeout(() => {
        minuteIndicators.forEach(m => m.remove());
        minuteIndicators = [];
    }, 300);
}

// Create pulsating goal zone between fill and next indicator (or end of bar)
function createGoalZone(fillPercent) {
    // Remove any existing goal zone
    removeGoalZone();

    // Find the next indicator position after the fill
    const upcomingIndicators = minuteIndicators
        .map(indicator => parseFloat(indicator.dataset.position))
        .filter(pos => pos > fillPercent)
        .sort((a, b) => a - b);

    // Target is next indicator or end of bar (100%)
    const targetPercent = upcomingIndicators.length > 0 ? upcomingIndicators[0] : 100;

    // Create goal zone element
    const goalZone = document.createElement("div");
    goalZone.id = "goalZone";
    goalZone.style.left = `${fillPercent}%`;
    goalZone.style.width = `${targetPercent - fillPercent}%`;

    // Fade in the goal zone
    goalZone.style.opacity = "0";
    timerProgress.appendChild(goalZone);

    // Trigger animation after reflow
    requestAnimationFrame(() => {
        goalZone.style.transition = "opacity 0.3s linear";
        goalZone.style.opacity = "";  // Let CSS animation take over
    });
}

// Remove goal zone
function removeGoalZone() {
    const existingZone = document.getElementById("goalZone");
    if (existingZone) {
        existingZone.remove();
    }
}


// ------------------ UI ------------------

const grid = document.getElementById("grid");
const nBackButtons = document.querySelectorAll(".n-back-btn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const matchBtn = document.getElementById("matchBtn");
const roundDisplay = document.getElementById("roundDisplay");
const timerFill = document.getElementById("timerFill");
const timerProgress = document.getElementById("timerProgress");
const resultsBanner = document.getElementById("resultsBanner");
const bannerStats = document.getElementById("bannerStats");
const bannerHeatmap = document.getElementById("bannerHeatmap");
const showColorsBtn = document.getElementById("showColorsBtn");
const extraColorsContainer = document.getElementById("extraColorsContainer");
const doubleSpeedBtn = document.getElementById("doubleSpeedBtn");
const roundProgressContainer = document.getElementById("roundProgressContainer");
const roundProgressCircle = document.getElementById("roundProgressCircle");
const timerWrapper = document.getElementById("timerWrapper");

const TOTAL_ROUNDS = 40;



// ------------------ Level Unlocking System ------------------

let highestUnlockedLevel = 2; // default: levels 1 and 2 are unlocked
const UNLOCK_THRESHOLD = 80; // 80% accuracy needed to unlock next level
const UNLOCK_MIN_ROUNDS = 20; // minimum rounds required to qualify for unlock

// Load highest unlocked level from localStorage
function loadUnlockedLevel() {
    try {
        const saved = localStorage.getItem("highestUnlockedLevel");
        if (saved) {
            highestUnlockedLevel = parseInt(saved);
        }
    } catch (e) {
        console.error("Failed to load unlocked level:", e);
        highestUnlockedLevel = 2;
    }
}

// Save highest unlocked level to localStorage
function saveUnlockedLevel() {
    try {
        localStorage.setItem("highestUnlockedLevel", highestUnlockedLevel.toString());
    } catch (e) {
        console.error("Failed to save unlocked level:", e);
    }
}

// Check if a level is locked
function isLevelLocked(level) {
    return level > highestUnlockedLevel;
}

// Try to unlock next level (called after a game ends)
function checkAndUnlockNextLevel(nLevel, accuracy, roundsPlayed, colorLoad) {
    // Only check if playing at the highest unlocked level
    // AND player completed enough rounds for a meaningful accuracy
    // AND the average unique color load was above 80% of the maximum for this n level
    if (nLevel === highestUnlockedLevel && accuracy >= UNLOCK_THRESHOLD && roundsPlayed >= UNLOCK_MIN_ROUNDS && colorLoad * 100 >= UNLOCK_THRESHOLD) {
        // Unlock next level (max 6)
        if (highestUnlockedLevel < 6) {
            highestUnlockedLevel++;
            saveUnlockedLevel();
            console.log(`Unlocked level ${highestUnlockedLevel}! (${roundsPlayed} rounds at ${accuracy}%)`);

            // Animate the newly unlocked button
            animateUnlockedButton(highestUnlockedLevel);

            return true; // level was unlocked
        }
    }
    return false; // no unlock
}

// Animate button when unlocked
function animateUnlockedButton(level) {
    const btn = document.querySelector(`.n-back-btn[data-n="${level}"]`);
    if (btn) {
        setTimeout(() => {
            btn.classList.add("unlock-animate");
            btn.addEventListener("animationend", () => {
                btn.classList.remove("unlock-animate");
            }, { once: true });
        }, 250);
    }
}

// Locked level popup
const lockedPopup = document.getElementById("lockedPopup");
let lockedPopupTimeout = null;

function showLockedPopup(buttonEl) {
    // Clear any existing timeout
    if (lockedPopupTimeout) {
        clearTimeout(lockedPopupTimeout);
    }

    // Position popup above the clicked button
    const btnRect = buttonEl.getBoundingClientRect();
    const containerRect = document.getElementById("nBackButtons").getBoundingClientRect();
    const leftOffset = btnRect.left - containerRect.left + btnRect.width / 2;
    lockedPopup.style.left = `${leftOffset}px`;

    // Show the popup
    lockedPopup.classList.add("visible");

    lockedPopupTimeout = setTimeout(() => {
        lockedPopup.classList.remove("visible");
    }, 1618);
}

// Update button appearance
function updateNBackButtons() {
    nBackButtons.forEach(btn => {
        const nValue = parseInt(btn.dataset.n);
        const isSelected = nValue === n;
        const locked = isLevelLocked(nValue);

        // Get or create text element
        let textEl = btn.querySelector('.n-back-btn-text');
        if (!textEl) {
            textEl = document.createElement('span');
            textEl.className = 'n-back-btn-text';
            btn.appendChild(textEl);
        }

        // Apply or remove locked class
        if (locked) {
            btn.classList.add("locked");
        } else {
            btn.classList.remove("locked");
        }

        if (isRunning) {
            // During gameplay
            btn.classList.add("playing");

            if (isSelected) {
                // Selected button: keep large with text during gameplay
                btn.classList.add("large");
                textEl.textContent = `${nValue}-back`;
                btn.style.fontSize = "16px";
            } else {
                // Other buttons: animate to very small with no text
                btn.classList.remove("large");
                textEl.textContent = "";
                btn.style.fontSize = "0";
            }
        } else {
            // Not playing
            btn.classList.remove("playing");

            if (isSelected) {
                // Selected button: large with full text
                btn.classList.add("large");
                textEl.textContent = `${nValue}-back`;
                btn.style.fontSize = "16px";
            } else {
                // Other buttons: small with number
                btn.classList.remove("large");
                textEl.textContent = nValue;
                btn.style.fontSize = "11px";
            }
        }
    });
}

// Handle n-back button clicks
function setupNBackButtons() {
    nBackButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            if (isRunning) return; // can't change during gameplay

            const newN = parseInt(btn.dataset.n);

            // early exit if nothing has changed
            if (n == newN) return;

            // Check if level is locked
            if (isLevelLocked(newN)) {
                showLockedPopup(btn);
                return;
            }

            // Update global n variable and persist
            n = newN;
            localStorage.setItem("selectedN", n.toString());

            // Reset nback engine to use new N level
            nbackEngine = null;
            localStorage.removeItem("nbackEngineState");

            // Update button appearance
            updateNBackButtons();

            // Update stats display to reflect reset
            updateStatsDisplay();

            console.log(`N-back level changed to ${newN}-back. Game reset.`);
        });
    });
}

// ------------------ Grid Setup ------------------

function createGrid() {
    grid.innerHTML = "";

    // Create background grid (always visible grey cells)
    for (let i = 0; i < 9; i++) {
        const bgCell = document.createElement("div");
        bgCell.classList.add("bg-cell");

        grid.appendChild(bgCell);
    }

    // Create overlay grid for colored cells
    const overlayGrid = document.createElement("div");
    overlayGrid.id = "overlay-grid";

    for (let i = 0; i < 9; i++) {
        const cell = document.createElement("div");
        cell.classList.add("cell");

        overlayGrid.appendChild(cell);
    }

    grid.appendChild(overlayGrid);
}

// Check if deactivated cells form a straight line of 3 (horizontal or vertical)
function hasThreeInLine(cells) {
    if (cells.length < 3) return false;

    const cellSet = new Set(cells);

    // Horizontal lines: rows 0, 1, 2
    const rows = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
    // Vertical lines: columns 0, 1, 2
    const cols = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];

    const lines = [...rows, ...cols];

    for (const line of lines) {
        if (line.every(idx => cellSet.has(idx))) {
            return true;
        }
    }
    return false;
}

// Select 0-3 random cells to deactivate for visual variety
function selectDeactivatedCells() {
    const numToDeactivate = Math.floor(Math.random() * 4); // 0, 1, 2, or 3
    const allIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];

    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
        // Shuffle and pick first N
        for (let i = allIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allIndices[i], allIndices[j]] = [allIndices[j], allIndices[i]];
        }

        const selected = allIndices.slice(0, numToDeactivate);

        // Accept if no 3 in a line constraint violated
        if (!hasThreeInLine(selected)) {
            return selected;
        }

        attempts++;
    }

    // Fallback: return empty (no deactivated cells) if we cant find valid config
    return [];
}

// Apply deactivated cells visually (make them invisible)
function applyDeactivatedCells() {
    const bgCells = document.querySelectorAll(".bg-cell");
    const overlayCells = document.querySelectorAll("#overlay-grid .cell");

    // First reset all cells to active state
    bgCells.forEach(cell => cell.classList.remove("deactivated"));
    overlayCells.forEach(cell => cell.classList.remove("deactivated"));

    // Then deactivate selected cells
    deactivatedCells.forEach(index => {
        if (bgCells[index]) {
            bgCells[index].classList.add("deactivated");
        }
        if (overlayCells[index]) {
            overlayCells[index].classList.add("deactivated");
        }
    });

    // Show a 1px grid outline whenever outer cells are hidden so the
    // overall boundary stays clear to the player (center index 4 does not affect outer edge)
    const hasOuterHidden = deactivatedCells.some(idx => idx !== 4);
    document.getElementById("grid").classList.toggle("grid-outlined", hasOuterHidden);
}

// Convert deactivated cell indices to position objects for nbackEngine.js
function getExcludedPositions() {
    return deactivatedCells.map(index => ({
        row: Math.floor(index / 3),
        col: index % 3
    }));
}

// Load last activity timestamp from localStorage
function loadLastActivityTimestamp() {
    try {
        const saved = localStorage.getItem("lastActivityTimestamp");
        if (saved) {
            lastActivityTimestamp = parseInt(saved);
        }
    } catch (e) {
        console.error("Failed to load last activity timestamp:", e);
    }
}

// Save last activity timestamp to localStorage
function saveLastActivityTimestamp() {
    try {
        lastActivityTimestamp = Date.now();
        localStorage.setItem("lastActivityTimestamp", lastActivityTimestamp.toString());
    } catch (e) {
        console.error("Failed to save last activity timestamp:", e);
    }
}

// Check if player was away for more than 10 minutes
function wasPlayerAwayTooLong() {
    if (!lastActivityTimestamp) return true; // first time playing, treat as away
    const timeSinceLastActivity = Date.now() - lastActivityTimestamp;
    return timeSinceLastActivity > AWAY_THRESHOLD;
}

// Get total play time including current game
function getTotalPlayTime() {
    let total = accumulatedPlayTime;
    if (currentGameStartTime && isRunning) {
        total += Date.now() - currentGameStartTime;
    }
    return total;
}

// Activate cell hiding with a new random layout
function activateCellHiding() {
    cellHidingActive = true;
    deactivatedCells = selectDeactivatedCells();
    applyDeactivatedCells();
    layoutPlayTimeStart = getTotalPlayTime(); // use play time, not real time

    // Tell the nback engine which positions to exclude
    if (nbackEngine) {
        nbackEngine.setExcludedPositions(getExcludedPositions());
    }

    console.log(`Cell hiding activated: ${deactivatedCells.length} cells hidden for ${Math.round(LAYOUT_DURATION / 1000)}s of play time`);
}

// Deactivate cell hiding (show full grid)
function deactivateCellHiding() {
    cellHidingActive = false;
    deactivatedCells = [];
    applyDeactivatedCells();

    // Tell the nback engine no positions are excluded
    if (nbackEngine) {
        nbackEngine.setExcludedPositions([]);
    }
}

createGrid();
loadLastActivityTimestamp();
loadCellHidingState();
loadUnlockedLevel();

// Show banner with heatmap on page load
showBanner(false);

// Start the start button animation on page load
setTimeout(() => {
    startBtn.classList.add("animate");
}, 1618);

// Load saved N-back level preference
const savedN = localStorage.getItem("selectedN");
if (savedN) {
    const parsedN = parseInt(savedN);
    // Make sure saved level is not locked
    if (isLevelLocked(parsedN)) {
        n = 1; // Reset to level 1 if saved level is now locked
    } else {
        n = parsedN;
    }
} else {
    n = 1; // Default to 1-back for first time users
}

// Load nback engine state only if it matches current N selection
const loadedGame = loadNBackEngineState();
if (loadedGame) {
    // Verify that loaded game's N matches current selection
    const loadedN = loadedGame.getCurrentN();
    if (loadedN === n) {
        nbackEngine = loadedGame;
        console.log(`Loaded nback engine state with ${n}-back`);
    } else {
        console.log(`Discarded saved game (was ${loadedN}-back, now ${n}-back)`);
        localStorage.removeItem('nbackEngineState');
        nbackEngine = null;
    }
} else {
    nbackEngine = null;
}

// Load trial history and initialize performance tracking
loadTrialHistory();
loadPerformanceHistory();
initPendingPerformance();
loadDailyTimer();

// Setup n-back buttons
setupNBackButtons();
updateNBackButtons();

// Initialize stats display
updateStatsDisplay();

// Initialize progress bar with current value on page load
const currentProgress = elapsedSeconds % CHUNK_SECONDS;
const initialPercent = (currentProgress / CHUNK_SECONDS) * 100;
timerFill.style.width = `${initialPercent}%`;
timerFill.style.background = "#57b9c6";
timerProgress.style.height = "24px"; // start expanded
createMinuteIndicators(); // show indicators on load

function getPlayableCells() {
    const overlayGrid = document.getElementById("overlay-grid");
    return Array.from(overlayGrid.querySelectorAll(".cell"));
}

// ------------------ Game Logic ------------------

function nextStimulus() {
    // Safety check: only generate cells if game is running
    if (!isRunning) {
        return;
    }

    // Record non-response to previous stimulus (if applicable)
    if (nbackEngine && index > 0 && index > n && !roundLocked) {
        // User did not click, so this is a non-response
        const reactionTime = reactionTimer.recordNonResponse();
        const { lastTrial, wasMatch } = getLastTrialInfo();
        const correct = !wasMatch; // not clicking on non-match is correct

        // Pass wasMatch to onUserResponse (it no longer computes it internally)
        nbackEngine.onUserResponse(false, wasMatch, reactionTime);

        // Update the trial in trialHistory with response data
        updateLastTrialWithResponse(wasMatch, false, correct, reactionTime);

        // Update daily progress tracking
        updateDailyProgress({
            n: nbackEngine.getCurrentN(),
            wasMatch: wasMatch,
            userClicked: false,
            currentLoad: lastTrial ? lastTrial.currentLoad : 0
        });

        // Break streak if user missed a match
        if (wasMatch) {
            currentStreak = 0;
        }
    }

    // Now unlock for the current round
    roundLocked = false;

    // Start timing for this new trial
    reactionTimer.startTrial();

    clearGrid();
    resetAllCells(); // thorough reset for mobile rendering glitches

    // Use nback engine to generate next tile
    const tile = nbackEngine.generateNextTile();

    // Convert color name to hex
    const color = COLOR_NAME_TO_HEX[tile.color];

    // Convert grid position to cell index (row * 3 + col)
    const cellIndex = tile.position.row * 3 + tile.position.col;

    // Store currentTile for later response handling
    nbackEngine.currentTile = tile;

    // Add trial to history
    // This tracks all trials across rounds with round boundary detection
    addTrialToHistory(tile, n);

    // Check if this is a match (only considers trials within current round)
    const actualIsMatch = isActualMatchInRound(tile.color, n);

    const cells = getPlayableCells();
    const randomCell = cells[cellIndex];

    // Find the corresponding background cell
    const overlayGrid = document.getElementById("overlay-grid");
    const actualCellIndex = Array.from(overlayGrid.children).indexOf(randomCell);
    const bgCells = Array.from(document.querySelectorAll(".bg-cell"));
    currentBgCell = bgCells[actualCellIndex];

    randomCell.style.background = color;
    randomCell.style.outline = "1px solid rgba(0, 0, 0, 0.15)"; // fake shadow
    currentActiveCell = randomCell;
    coloredCellVisible = true;

    index++;
    rounds++;

    // Track if this is a target (match) for accuracy calculation
    if (index > n && actualIsMatch) {
        totalTargets++;
    }

    // Clear any existing timeout
    if (hideTimeout) {
        clearTimeout(hideTimeout);
    }

    hideTimeout = setTimeout(() => {
        // Double check game is still running before hiding
        if (!isRunning) {
            return;
        }
        randomCell.style.background = "transparent";
        randomCell.style.outline = "none";
        coloredCellVisible = false;
        // Don't restore squish animation if it's running
        // Just let the cell disappear
    }, IS_LOCAL_HOST ? getAdaptiveDisplayTime() / speedMultiplier : getAdaptiveDisplayTime());

    updateRoundDisplay();
    updateStatsDisplay();

    // Live update history if it's showing
    if (IS_LOCAL_HOST && historyShowing) {
        updateHistoryDisplay();
    }

    // Autopilot: automatically click when there's a match
    if (IS_LOCAL_HOST && autopilotEnabled && nbackEngine && index > n) {
        if (actualIsMatch) {
            // Wait a short random time (100-300ms) to simulate human reaction
            const reactionDelay = Math.random() * 200 + 400;
            setTimeout(() => {
                if (isRunning && !roundLocked) {
                    handleMatch();
                }
            }, reactionDelay);
        }
    }

    // Live update graph if it's showing
    if (IS_LOCAL_HOST && graphShowing) {
        updateGraphDisplay();
    }

    // Monitor performance and end if sustained poor performance detected
    // Uses SPRT (Sequential Probability Ratio Test) from the engine,
    // with fallback to error count check
    if (nbackEngine && rounds >= 10) {
        if (nbackEngine.shouldStopSession() || shouldStopForErrors(getRecentTrialsInRound(10))) {
            stopGame(true);
        }
    }

    // Always end game after 40 trials regardless of performance
    if (rounds >= 40) {
        stopGame(true);
    }
}

function clearGrid() {
    const overlayGrid = document.getElementById("overlay-grid");
    overlayGrid.querySelectorAll(".cell").forEach(cell => {
        cell.style.background = "transparent";
        cell.style.outline = "none";
        cell.classList.remove("squish-right", "squish-left");
    });

    // Clear background cell squish animations
    document.querySelectorAll(".bg-cell").forEach(cell => {
        cell.classList.remove("squish-right", "squish-left");
    });

    currentActiveCell = null;
    currentBgCell = null;
    coloredCellVisible = false;

    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
}

// Thorough reset of all cells to fix mobile rendering glitches
function resetAllCells() {
    const overlayGrid = document.getElementById("overlay-grid");
    const cells = overlayGrid.querySelectorAll(".cell");
    const bgCells = document.querySelectorAll(".bg-cell");

    // Reset all overlay cells
    cells.forEach(cell => {
        cell.style.background = "transparent";
        cell.style.outline = "none";
        cell.style.transform = "";
        cell.style.opacity = "";
        cell.classList.remove("squish-right", "squish-left");
        // Force reflow to ensure styles are applied
        void cell.offsetWidth;
    });

    // Reset all background cells
    bgCells.forEach(cell => {
        cell.style.transform = "";
        cell.style.opacity = "";
        cell.classList.remove("squish-right", "squish-left");
        // Force reflow
        void cell.offsetWidth;
    });
}

function handleMatch() {
    if (!isRunning) return;

    // Randomly choose squish direction
    const squishClass = Math.random() < 0.5 ? "squish-right" : "squish-left";

    // Squish the background cell
    if (currentBgCell) {
        currentBgCell.classList.remove("squish-right", "squish-left");
        void currentBgCell.offsetWidth;
        currentBgCell.classList.add(squishClass);

        setTimeout(() => {
            if (currentBgCell) {
                currentBgCell.classList.remove("squish-right", "squish-left");
            }
        }, 120);
    }

    // Also squish the colored overlay cell if it exists and is visible
    if (currentActiveCell && coloredCellVisible) {
        currentActiveCell.classList.remove("squish-right", "squish-left");
        void currentActiveCell.offsetWidth;
        currentActiveCell.classList.add(squishClass);

        setTimeout(() => {
            if (currentActiveCell) {
                currentActiveCell.classList.remove("squish-right", "squish-left");
            }
        }, 120);
    }

    // Don't count clicks before the first n is reached for accuracy
    if (index <= n) return;

    if (roundLocked) return; // already clicked this round for scoring

    roundLocked = true; // lock for the rest of this round

    const { lastTrial, wasMatch } = getLastTrialInfo();
    const correct = wasMatch; // clicking on a match is correct

    if (wasMatch) {
        correctMatches++;
        currentStreak++;
        if (currentStreak > longestStreak) {
            longestStreak = currentStreak;
        }

    } else {
        incorrectMatches++;
        currentStreak = 0; // break streak on false positive
    }

    // Record response in nback engine
    if (nbackEngine) {
        const reactionTime = reactionTimer.recordResponse();

        // Pass wasMatch to onUserResponse (it no longer computes it internally)
        nbackEngine.onUserResponse(true, wasMatch, reactionTime);

        // Update the trial in trialHistory with response data
        updateLastTrialWithResponse(wasMatch, true, correct, reactionTime);

        // Update daily progress tracking
        updateDailyProgress({
            n: nbackEngine.getCurrentN(),
            wasMatch: wasMatch,
            userClicked: true,
            currentLoad: lastTrial ? lastTrial.currentLoad : 0
        });

        updateStatsDisplay();

        // Live update graph if it's showing
        if (IS_LOCAL_HOST && graphShowing) {
            updateGraphDisplay();
        }
    }
}


// ------------------ Controls ------------------

function startGame() {
    if (isRunning) return;

    // Initialize game state
    index = 0;
    rounds = 0;
    correctMatches = 0;
    incorrectMatches = 0;
    totalTargets = 0;
    currentStreak = 0;
    longestStreak = 0;
    isRunning = true;
    progressBarFull = false;
    reactionTimer.reset(); // reset reaction timer for new game

    // Stop any locked button vibration from end screen
    stopLockedButtonVibration();

    // Stop start button animation
    startBtn.classList.remove("animate");

    // Increment round ID for trial history boundary detection
    currentRoundId++;

    // Initialize or continue nback engine
    if (!nbackEngine) {
        // Create new nback engine if none exists
        nbackEngine = new NBackEngine({
            startN: n,
            colors: COLORS
        });
    }

    // Initialize cell hiding based on how long player was away
    if (wasPlayerAwayTooLong()) {
        // Player was away > 10 min, reset everything and start fresh
        deactivateCellHiding();
        accumulatedPlayTime = 0;
        layoutPlayTimeStart = 0;
        cellHidingActive = false;
        // Reset adaptive engine so player warms up from minimum load again
        if (nbackEngine) {
            nbackEngine.reset();
        }
        console.log("Player was away > 10 min, starting with full grid + fresh ability model");

    } else {
        // Player returned within 10 min
        if (cellHidingActive) {
            // Cell hiding already active, check if layout still valid (based on play time)
            const layoutPlayTime = accumulatedPlayTime - layoutPlayTimeStart;
            if (layoutPlayTime < LAYOUT_DURATION) {
                // Layout still valid, restore and continue with same layout
                applyDeactivatedCells();
                nbackEngine.setExcludedPositions(getExcludedPositions());
                const remaining = Math.round((LAYOUT_DURATION - layoutPlayTime) / 1000);
                console.log(`Restoring layout (${deactivatedCells.length} cells hidden, ${remaining}s play time remaining)`);
            } else {
                // Layout expired, create a new one
                deactivatedCells = selectDeactivatedCells();
                applyDeactivatedCells();
                layoutPlayTimeStart = accumulatedPlayTime;
                nbackEngine.setExcludedPositions(getExcludedPositions());
                console.log(`Layout expired, new layout: ${deactivatedCells.length} cells hidden for ${Math.round(LAYOUT_DURATION / 1000)}s play time`);
            }
        } else if (!cellHidingActive && accumulatedPlayTime >= WARMUP_DURATION) {
            // Warmup complete, activate cell hiding now (at round start)
            activateCellHiding();
            console.log(`Warmup complete, cell hiding activated: ${deactivatedCells.length} cells hidden`);
        }
        // If warmup not complete yet, accumulatedPlayTime preserves progress
    }

    // Mark start of this game round
    currentGameStartTime = Date.now();

    // Hide results banner and clear stats
    hideBanner();
    if (bannerStats) bannerStats.innerHTML = "";

    // Remove minute indicators and goal zone
    removeMinuteIndicators();
    removeGoalZone();

    // Hide daily timer bar visually during gameplay (keeps layout for stopBtn and roundProgressContainer)
    timerProgress.style.visibility = "hidden";
    timerFill.style.display = "none";
    timerProgress.style.height = "8px";


    // Hide color preview if showing
    if (IS_LOCAL_HOST && colorsShowing) {
        hideAllColors();
    }

    // Hide GitHub footer during gameplay
    const githubFooter = document.getElementById("githubFooter");
    if (githubFooter) githubFooter.style.display = "none";

    // Update button visibility (game is now in playing mode)
    startBtn.style.display = "none";
    matchBtn.style.display = "inline-block";
    stopBtn.style.display = "inline-block";
    roundProgressContainer.style.display = "block";
    roundProgressContainer.classList.remove("end-screen");

    // Reset round progress circle to empty
    if (roundProgressCircle) {
        roundProgressCircle.style.setProperty('--fill-pct', '0%');
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    matchBtn.disabled = false;

    // Update n-back buttons to playing state
    updateNBackButtons();

    // Start timer (game is running during animation)
    startDailyTimer();

    clearGrid();

    // Trigger grid bounce animation (game is already in playing mode)
    grid.classList.add("grid-bounce");

    // Wait for animation to complete before showing first stimulus
    setTimeout(() => {
        grid.classList.remove("grid-bounce");

        // Add another small pause after animation completes
        setTimeout(() => {
            nextStimulus();
            scheduleNextStimulus();
        }, 500); // small pause after animation
    }, 450); // slightly longer than animation duration (400ms) for better feel
}

// Schedule next stimulus with randomized timing
function scheduleNextStimulus() {
    if (!isRunning) return;

    const delay = IS_LOCAL_HOST ? getAdaptiveInterval() / speedMultiplier : getAdaptiveInterval();
    intervalId = setTimeout(() => {
        if (!isRunning) return;
        nextStimulus();
        scheduleNextStimulus(); // schedule the next one recursively
    }, delay);
}

function stopGame(autoEnded = false) {
    if (!isRunning) return;

    clearTimeout(intervalId);
    intervalId = null;

    stopDailyTimer();

    isRunning = false;
    if (IS_LOCAL_HOST) {
        speedMultiplier = 1;
        doubleSpeedBtn.textContent = "Speed: 2x";
        doubleSpeedBtn.style.fontWeight = "normal";
    }

    // Show daily timer bar on end screen
    timerProgress.style.visibility = "";
    timerFill.style.display = "block";
    timerProgress.style.height = "24px";
    timerProgress.style.overflow = "visible";
    timerProgress.style.background = "#ddd";
    timerFill.style.background = "#57b9c6";

    // Animate progress bar from 0 to current value with FIXED duration
    const currentProgress = elapsedSeconds % CHUNK_SECONDS;
    const targetPercent = (currentProgress / CHUNK_SECONDS) * 100;

    // Reset to 0 first
    timerFill.style.transition = "none";
    timerFill.style.width = "0%";

    // Force reflow
    timerProgress.offsetHeight;

    // Set animation flag
    isAnimatingBar = true;

    // Create minute indicators after expansion (they'll start with 0% styling)
    setTimeout(() => {
        createMinuteIndicators();
    }, 300);

    // Animate to target with FIXED 800ms duration and ease-in-out (fast start, slow end)
    // Also animate indicator styles in sync
    const BAR_ANIMATION_DURATION = 800;
    const animationStartTime = Date.now() + 50;

    setTimeout(() => {
        timerFill.style.transition = "width 0.8s cubic-bezier(0.32, 0, 0.07, 1)"; // fast start, slow finish
        timerFill.style.width = `${targetPercent}%`;

        // Animate indicator styles in sync with bar
        const animateIndicators = () => {
            const elapsed = Date.now() - animationStartTime;
            const progress = Math.min(elapsed / BAR_ANIMATION_DURATION, 1);

            // Use same easing as bar animation
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const currentAnimatedPercent = targetPercent * easeProgress;

            updateIndicatorStyles(currentAnimatedPercent);

            if (progress < 1) {
                requestAnimationFrame(animateIndicators);
            } else {
                // Animation complete
                isAnimatingBar = false;
                updateIndicatorStyles(targetPercent);
                // Show pulsating goal zone after animation
                createGoalZone(targetPercent);

                // Start the start button animation after a slight delay
                setTimeout(() => {
                    startBtn.classList.add("animate");
                }, 1618);
            }
        };

        requestAnimationFrame(animateIndicators);
    }, 50);

    // Update button visibility
    startBtn.style.display = "inline-block";
    matchBtn.style.display = "none";
    stopBtn.style.display = "none";
    roundProgressContainer.style.display = "none";

    startBtn.disabled = false;
    stopBtn.disabled = true;
    matchBtn.disabled = true;

    // Update n-back buttons to idle state
    updateNBackButtons();

    // Show GitHub footer after gameplay
    const githubFooter = document.getElementById("githubFooter");
    if (githubFooter) githubFooter.style.display = "block";

    clearGrid();

    // Save activity timestamp for next session timing check
    saveLastActivityTimestamp();

    // Accumulate play time from this game round
    if (currentGameStartTime) {
        accumulatedPlayTime += Date.now() - currentGameStartTime;
        currentGameStartTime = null;
    }

    // Check if layout has expired (based on play time)
    const layoutPlayTime = accumulatedPlayTime - layoutPlayTimeStart;
    const layoutExpired = cellHidingActive && (layoutPlayTime >= LAYOUT_DURATION);

    // Save cell hiding state (preserves layout for next round)
    saveCellHidingState();

    // If layout expired, restore full grid on end screen (new layout on next round)
    // If layout still valid, keep partial grid visible
    if (layoutExpired) {
        deactivatedCells = [];
        applyDeactivatedCells();
    }

    // Save all data to disk on game end
    saveTrialHistory();
    savePerformanceToDisk();
    saveNBackEngineState();

    if (rounds >= 1 || autoEnded) {
        showResults();
    } else {
        // No results to show, just display banner with heatmap
        showBanner(false);
    }

    updateStatsDisplay();
}

function updateRoundDisplay() {
    if (IS_LOCAL_HOST) {
        roundDisplay.textContent = `Round: ${rounds}`;
    }
    updateRoundProgressCircle();
}

// Update the round progress circle (fills from empty to full over 40 rounds)
function updateRoundProgressCircle() {
    if (!roundProgressCircle) return;

    const progress = Math.min(rounds / TOTAL_ROUNDS, 1);
    roundProgressCircle.style.setProperty('--fill-pct', (progress * 100).toFixed(1) + '%');
}

// ------------------ Results ------------------

function showResults() {
    // New formula: correct_clicks / (total_targets + wrong_clicks)
    const denominator = totalTargets + incorrectMatches;

    let percentage = 0;
    if (denominator > 0) {
        percentage = Math.round((correctMatches / denominator) * 100);
    }

    // Get memory load info (session average)
    let memoryLoadHtml = '';
    let loadPercent = 0; // ratio 0..1, used for unlock check
    const roundTrials = getCurrentRoundTrials();
    if (nbackEngine && roundTrials.length > 0) {
        const maxUniqueColors = n + 1;

        // Calculate average load across the session
        const avgLoad = roundTrials.reduce((sum, t) => sum + t.currentLoad, 0) / roundTrials.length;
        const roundedAvg = Math.round(avgLoad * 10) / 10; // round to 1 decimal

        // Traffic light color based on load percentage
        loadPercent = avgLoad / maxUniqueColors;
        let loadColor;
        if (loadPercent <= 0.33) {
            loadColor = COLORS.find(c => c.name === "green").color; // easy
        } else if (loadPercent <= 0.66) {
            loadColor = COLORS.find(c => c.name === "yellow").color; // medium
        } else {
            loadColor = COLORS.find(c => c.name === "red").color; // hard
        }

        const TOTAL_SEGMENTS = 4;
        const loadRatio = avgLoad / maxUniqueColors;
        const filledSegments = Math.round(loadRatio * TOTAL_SEGMENTS);
        const emptySegments = TOTAL_SEGMENTS - filledSegments;
        const loadBar = '█'.repeat(filledSegments) + '░'.repeat(emptySegments);
        memoryLoadHtml = `
            <div style="font-size: 12px; color: #666; margin-top: 12px;">
                Memory Load:  <span style="color: ${loadColor}; border: 0.7px solid #0000007f; padding: 1px 1px; border-radius: 3px;">${loadBar}</span>&nbsp&nbsp${roundedAvg} / ${maxUniqueColors}
            </div>`;
    }

    // Generate positive insight
    const insightText = generatePositiveInsight(percentage, rounds);
    const insightHtml = insightText ? `<div style="font-size: 13px; margin-top: 7px; font-weight: 500; font-style: italic;"><span>${insightText}</span></div>` : '';

    // Save accuracy for next round comparison
    lastRoundAccuracy = percentage;

    // Render stats to banner
    bannerStats.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 36px; font-weight: bold; color: #333; margin-bottom: 8px;">
                <span id="accuracyNumber">0</span><span style="font-size: 20px; color: #555;">%</span>
            </div>
            <div style="font-size: 14px; color: #555; margin-bottom: 6px;">
                <strong style="font-weight: 800;">Correct:</strong> ${correctMatches} / ${totalTargets}
                <span style="margin: 0 10px; color: #ccc;">|</span>
                <strong style="font-weight: 800;">Incorrect:</strong> ${incorrectMatches}
            </div>
            <div style="font-size: 12px; color: #888;">
                Rounds: ${rounds}
            </div>
            ${memoryLoadHtml}
            <br>
            ${insightHtml}
        </div>
    `;

    // Show banner with stats
    showBanner(true);

    const display = document.getElementById("accuracyNumber");

    // Animate accuracy number with SHORTER duration for faster feedback
    const ANIMATION_DURATION = 500; // 500ms for quicker updates
    const startTime = Date.now();

    const animateAccuracy = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

        // Use a gentler easing for more consistent value updates throughout
        // Using quadratic ease-out for smoother, more visible progression
        const easeProgress = 1 - Math.pow(1 - progress, 2);
        const current = Math.round(percentage * easeProgress);

        display.textContent = current;

        if (progress < 1) {
            requestAnimationFrame(animateAccuracy);
        } else {
            display.textContent = percentage;

            // Check if we should unlock the next level (requires minimum rounds)
            checkAndUnlockNextLevel(n, percentage, rounds, loadPercent);

            // Update button colors immediately after saving accuracy
            updateNBackButtons();
        }
    };

    requestAnimationFrame(animateAccuracy);

    // Start vibration on locked buttons with staggered delays
    startLockedButtonVibration();
}

// Start animation on the next locked n-back button only
// Randomly chooses vibrate (most of the time) or jump (occasionally)
function startLockedButtonVibration() {
    const lockedButtons = document.querySelectorAll(".n-back-btn.locked");

    // Sometimes no animation at all
    if (Math.random() < 0.3)
        return

    // Only animate the first (next) locked button
    if (lockedButtons.length > 0) {
        const nextLockedBtn = lockedButtons[0];

        // 80% chance vibrate, 20% chance jump
        const useJump = Math.random() < 0.2;

        setTimeout(() => {
            if (useJump) {
                nextLockedBtn.classList.add("jump");
            } else {
                nextLockedBtn.classList.add("vibrate");
            }
        }, 100);
    }
}

// Stop animation on all locked buttons
function stopLockedButtonVibration() {
    const lockedButtons = document.querySelectorAll(".n-back-btn.locked");
    lockedButtons.forEach(btn => {
        btn.classList.remove("vibrate");
        btn.classList.remove("jump");
    });
}

// ------------------ Keyboard Controls ------------------

document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
        e.preventDefault();
        if (!isRunning) startGame();
        else handleMatch();
    }

    if (e.code === "Escape") {
        e.preventDefault();
        stopGame(false);
    }
});

// Buttons also work
matchBtn.addEventListener("click", handleMatch);
startBtn.addEventListener("click", startGame);
stopBtn.addEventListener("click", () => stopGame(false));


// ------------------ Daily Playtime Popup ------------------

const playtimePopup = document.getElementById("playtimePopup");
let playtimePopupTimeout = null;

function showPlaytimePopup() {
    // Only show when NOT in playing phase
    if (isRunning) return;

    // Clear any existing timeout
    if (playtimePopupTimeout) {
        clearTimeout(playtimePopupTimeout);
    }

    // Show the popup
    playtimePopup.classList.add("visible");

    // Hide after x seconds
    playtimePopupTimeout = setTimeout(() => {
        playtimePopup.classList.remove("visible");
    }, 1618);
}

// Click handler for progress bar
timerProgress.addEventListener("click", showPlaytimePopup);

// Also support touch events for mobile
timerProgress.addEventListener("touchend", (e) => {
    e.preventDefault(); // prevent double firing with click
    showPlaytimePopup();
});


// ------------------ Rounds Popup ------------------

const roundsPopup = document.getElementById("roundsPopup");
let roundsPopupTimeout = null;

function showRoundsPopup() {
    if (isRunning) return;

    if (roundsPopupTimeout) {
        clearTimeout(roundsPopupTimeout);
    }

    roundsPopup.textContent = `Played rounds: ${rounds}`;
    roundsPopup.classList.add("visible");

    roundsPopupTimeout = setTimeout(() => {
        roundsPopup.classList.remove("visible");
    }, 1618);
}

roundProgressContainer.addEventListener("click", showRoundsPopup);

roundProgressContainer.addEventListener("touchend", (e) => {
    e.preventDefault();
    showRoundsPopup();
});


// ------------------ Tab Focus Detection (Refresh after 5min absence) ------------------

let tabHiddenTimestamp = null;

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        // Tab is being hidden, record timestamp
        tabHiddenTimestamp = Date.now();
    } else {
        // Tab is visible again
        if (tabHiddenTimestamp) {
            const awayDuration = Date.now() - tabHiddenTimestamp;
            tabHiddenTimestamp = null;

            // If user was away 5+ minutes and game is NOT running, reset layout and refresh page
            if (awayDuration >= AWAY_THRESHOLD && !isRunning) {
                console.log(`User returned after ${Math.round(awayDuration / 1000 / 60)} min, resetting layout and refreshing page`);
                localStorage.removeItem('cellHidingState');
                window.location.reload();
            }
        }
    }
});

// ------------------ NOTE: all code below is for debugging only ------------------

// ------------------ Stats Display ------------------

function updateStatsDisplay() {
    if (!IS_LOCAL_HOST) return;

    const statsEl = document.getElementById("adaptiveStats");
    if (!statsEl) {
        return;
    }

    if (!nbackEngine) {
        statsEl.textContent = '';
        return;
    }

    const stats = nbackEngine.getStats();
    const flowPercent = Math.round((stats.flowScore || 0) * 100);

    const BOX_WIDTH = 50;

    // Helper to create a properly padded line
    const makeLine = (content) => {
        // Strip HTML tags for length calculation
        const strippedContent = content.replace(/<[^>]*>/g, '');
        const len = strippedContent.length;
        const padding = ' '.repeat(Math.max(0, BOX_WIDTH - len));
        return `│ ${content}${padding} │\n`;
    };

    // Build the display
    let display = '┌────────────────────────────────────────────────────┐\n';
    display += makeLine(`<strong>BrainZag Stats:</strong>`);
    display += '├────────────────────────────────────────────────────┤\n';
    display += makeLine(`N-Back Level: ${stats.currentN}`);
    display += makeLine(`Trials: ${stats.totalTrials}`);
    display += '├────────────────────────────────────────────────────┤\n';

    // Ability (theta / d')
    const theta = (stats.theta || 0).toFixed(2);
    const thetaVal2 = stats.theta || 0;
    const thetaLabel = thetaVal2 >= 2.5 ? 'Excellent'
        : thetaVal2 >= 1.6 ? 'Good'
            : thetaVal2 >= 1.0 ? 'Okayish'
                : 'Guessing';
    const thetaTrend = (stats.thetaTrend || 0).toFixed(4);
    const trendArrow = stats.thetaTrend > 0.005 ? '<strong>↑</strong>' : stats.thetaTrend < -0.005 ? '<strong>↓</strong>' : '<strong>→</strong>';
    display += makeLine(`<strong>Ability (d')</strong>`);
    display += makeLine(`Theta: ${theta} ${trendArrow} (trend: ${thetaTrend}) - ${thetaLabel}`);

    // Flow and Fatigue
    const fatiguePercent = Math.round((stats.fatigueIndex || 0) * 100);
    const flowBar = '▓'.repeat(Math.floor(flowPercent / 20)) + '░'.repeat(5 - Math.floor(flowPercent / 20));
    display += makeLine(`Flow:    ${String(flowPercent).padStart(3)}% ${flowBar}`);
    display += makeLine(`Fatigue: ${String(fatiguePercent).padStart(3)}%`);

    display += '├────────────────────────────────────────────────────┤\n';

    // Working Memory Load
    display += makeLine(`<strong>Memory Load</strong>`);

    const currentLoad = stats.workingMemory.currentLoad;
    const targetUniqueColors = stats.workingMemory.targetUniqueColors;
    const maxUniqueColors = stats.workingMemory.maxUniqueColors;
    const progressToMax = stats.workingMemory.progressToMax;

    // Target unique colors
    const targetBar = '█'.repeat(targetUniqueColors) + '░'.repeat(maxUniqueColors - targetUniqueColors);
    const progressPercent = Math.round(progressToMax * 100);
    display += makeLine(`Target Colors:    ${targetBar} ${targetUniqueColors}/${maxUniqueColors} (${progressPercent}%)`);

    // Current load in working memory
    const loadBar = '█'.repeat(Math.floor(currentLoad)) + '░'.repeat(Math.floor(maxUniqueColors - currentLoad));
    display += makeLine(`Current Load:     ${loadBar} ${currentLoad}/${maxUniqueColors}`);

    // Entropy and match rate
    const targetEntropy = (stats.targetEntropy || 0).toFixed(2);
    const windowEntropy = (stats.windowEntropy || 0).toFixed(2);
    display += makeLine(`Match Rate: ${((stats.matchRate || 0.30) * 100).toFixed(0)}% | Speed: ${((stats.stimulusInterval || 1.0) * 100).toFixed(0)}%`);
    display += makeLine(`Entropy: target=${targetEntropy} window=${windowEntropy}`);

    // PI controller state
    const piIntegral = (stats.workingMemory.piIntegral || 0).toFixed(2);
    display += makeLine(`PI Integral: ${piIntegral}`);

    // Player capacity status
    display += '├────────────────────────────────────────────────────┤\n';

    // Capacity progress label
    let capacityLabel = '';
    if (progressPercent >= 90) {
        capacityLabel = 'near max';
    } else if (progressPercent >= 50) {
        capacityLabel = 'expanding';
    } else {
        capacityLabel = 'building';
    }

    display += makeLine(`<strong>Status:</strong> Capacity ${capacityLabel} (${progressPercent}%)`);

    // SPRT session monitor
    if (stats.sprtStatus) {
        const sprt = stats.sprtStatus;
        const sprtBar = sprt.logLR.toFixed(2);
        display += makeLine(`SPRT: ${sprtBar} [${sprt.acceptBound.toFixed(1)}..${sprt.stopBound.toFixed(1)}] ${sprt.decision}`);
    }

    // Cognitive state info (RT stats)
    display += '├────────────────────────────────────────────────────┤\n';
    display += makeLine(`<strong>Cognitive State</strong>`);
    display += makeLine(`RT Median: ${Math.round(stats.rtMedian || 800)}ms | CV: ${(stats.rtCV || 0).toFixed(3)}`);

    // Cell hiding timing info
    display += '├────────────────────────────────────────────────────┤\n';
    display += makeLine(`<strong>Grid Layout</strong>`);

    // Calculate total play time
    let totalPlayTime = accumulatedPlayTime;
    if (currentGameStartTime && isRunning) {
        totalPlayTime += Date.now() - currentGameStartTime;
    }

    if (!cellHidingActive) {
        // In warmup phase
        const warmupRemaining = Math.max(0, WARMUP_DURATION - totalPlayTime);
        const warmupSecs = Math.ceil(warmupRemaining / 1000);
        const warmupProgress = Math.min(100, Math.round((totalPlayTime / WARMUP_DURATION) * 100));
        display += makeLine(`Mode: Warmup (full grid)`);
        display += makeLine(`Warmup: ${warmupProgress}% (${warmupSecs}s play)`);
    } else {
        // Cell hiding active (use play time for layout age)
        const layoutPlayTime = totalPlayTime - layoutPlayTimeStart;
        const layoutExpired = layoutPlayTime >= LAYOUT_DURATION;
        const layoutRemaining = Math.max(0, LAYOUT_DURATION - layoutPlayTime);
        const layoutSecs = Math.ceil(layoutRemaining / 1000);
        const layoutProgress = Math.min(100, Math.round((layoutPlayTime / LAYOUT_DURATION) * 100));
        display += makeLine(`Mode: Cell hiding active`);
        display += makeLine(`Hidden cells: ${deactivatedCells.length} [${deactivatedCells.join(', ') || 'none'}]`);
        if (layoutExpired) {
            display += makeLine(`Layout: EXPIRED (new layout on next round)`);
        } else {
            display += makeLine(`Layout: ${layoutProgress}% (${layoutSecs}s play left)`);
        }
    }

    // LocalStorage and memory usage
    display += '├────────────────────────────────────────────────────┤\n';
    const lsInfo = getLocalStorageInfo();
    display += makeLine(`<strong>LocalStorage</strong>: ${lsInfo.total}`);
    lsInfo.top.forEach(entry => {
        display += makeLine(`  ${entry}`);
    });

    // RAM usage (Chrome only)
    if (performance.memory) {
        const used = formatBytes(performance.memory.usedJSHeapSize);
        const total = formatBytes(performance.memory.totalJSHeapSize);
        display += makeLine(`<strong>RAM</strong>: ${used} / ${total}`);
    }

    display += '└────────────────────────────────────────────────────┘';

    statsEl.innerHTML = display;
}

// Regenerate minute positions (for debug button)
function regenerateMinutePositions() {
    minutePositions = generateFibonacciMinutePositions();
    saveMinutePositions();
}

// Variables needed for debugging
let autopilotEnabled = false; // autopilot mode for debugging
let statsVisible = true; // stats display visibility (default: true)
let colorsShowing = false;
let historyShowing = false;
let graphShowing = false;

// ------------------ start IS_LOCAL_HOST debug block ------------------
if (IS_LOCAL_HOST) {

    // ------------------ Color Preview Debug ------------------

    function showAllColors() {
        if (colorsShowing) {
            hideAllColors();
            return;
        }

        colorsShowing = true;
        showColorsBtn.textContent = "Hide Colors";

        const cells = getPlayableCells();

        // Fill grid cells with colors (we have 8 cells and 8 colors)
        cells.forEach((cell, index) => {
            if (index < COLORS.length) {
                cell.style.background = COLORS[index].color;
            }
        });

        // If there are more colors than cells, add them to the extra container
        if (COLORS.length > cells.length) {
            for (let i = cells.length; i < COLORS.length; i++) {
                const extraCell = document.createElement("div");
                extraCell.className = "extra-color-cell";
                extraCell.style.width = "95px";
                extraCell.style.height = "95px";
                extraCell.style.background = COLORS[i].color;
                extraCell.style.borderRadius = "8px";
                extraCell.style.outline = "1px solid rgba(0, 0, 0, 0.15)"; // fake shadow
                extraColorsContainer.appendChild(extraCell);
            }
        }
    }

    function hideAllColors() {
        colorsShowing = false;
        showColorsBtn.textContent = "Show Colors";

        const cells = getPlayableCells();
        cells.forEach(cell => {
            cell.style.background = "transparent";
        });

        // Clear extra colors
        extraColorsContainer.innerHTML = "";
    }

    showColorsBtn.addEventListener("click", showAllColors);

    // Toggle speed function
    function toggleSpeed() {
        if (!isRunning) return; // only works during gameplay

        if (speedMultiplier === 1) {
            speedMultiplier = 2;
            doubleSpeedBtn.textContent = "Speed: 2x (Active)";
            doubleSpeedBtn.style.fontWeight = "bold";
        } else {
            speedMultiplier = 1;
            doubleSpeedBtn.textContent = "Speed: 2x";
            doubleSpeedBtn.style.fontWeight = "normal";
        }

        // Restart the interval with new speed
        if (intervalId) {
            clearTimeout(intervalId);
            scheduleNextStimulus();
        }
    }

    // Debug buttons
    const toggleStatsBtn = document.getElementById("toggleStatsBtn");
    const clearStorageBtn = document.getElementById("clearStorageBtn");
    const debugSetTimeBtn = document.getElementById("debugSetTimeBtn");
    const regenIndicatorsBtn = document.getElementById("regenIndicatorsBtn");
    const autopilotBtn = document.getElementById("autopilotBtn");

    clearStorageBtn.addEventListener("click", () => {
        localStorage.clear();
        window.location.reload(true);
    });

    debugSetTimeBtn.addEventListener("click", () => {
        const today = formatDateLocal(new Date());

        // Set to 18 minutes (1080 seconds)
        elapsedSeconds = 1080;
        pendingPerformance.playTime = elapsedSeconds;
        savePerformanceToDisk();

        // Update UI
        const currentProgress = elapsedSeconds % CHUNK_SECONDS;
        const initialPercent = (currentProgress / CHUNK_SECONDS) * 100;
        timerFill.style.width = `${initialPercent}%`;
        timerFill.style.background = "#57b9c6";

        // Recreate indicators
        minuteIndicators.forEach(m => m.remove());
        minuteIndicators = [];
        createMinuteIndicators();

        // Update button colors
        updateNBackButtons();

        alert("Set to 18 minutes with demo accuracies!");
    });

    regenIndicatorsBtn.addEventListener("click", () => {
        // Regenerate Fibonacci positions
        regenerateMinutePositions();

        // Remove old indicators
        minuteIndicators.forEach(m => m.remove());
        minuteIndicators = [];

        // Recreate indicators with new positions
        createMinuteIndicators();

        // Show confirmation
        const positions = minutePositions.map(p => Math.round(p * 10) / 10).join(", ");
        alert(`Indicators regenerated at: ${positions} minutes`);
    });

    doubleSpeedBtn.addEventListener("click", toggleSpeed);

    // Toggle autopilot function
    function toggleAutopilot() {
        autopilotEnabled = !autopilotEnabled;

        if (autopilotEnabled) {
            autopilotBtn.textContent = "Autopilot: On";
            autopilotBtn.style.fontWeight = "bold";
            autopilotBtn.style.background = "#4caf50";
            autopilotBtn.style.color = "white";
        } else {
            autopilotBtn.textContent = "Autopilot: Off";
            autopilotBtn.style.fontWeight = "normal";
            autopilotBtn.style.background = "";
            autopilotBtn.style.color = "";
        }
    }

    autopilotBtn.addEventListener("click", toggleAutopilot);

    // Toggle stats display function
    function toggleStatsDisplay() {
        const adaptiveStats = document.getElementById("adaptiveStats");
        statsVisible = !statsVisible;

        if (statsVisible) {
            adaptiveStats.style.display = "inline-block";
            toggleStatsBtn.textContent = "Hide Stats";
        } else {
            adaptiveStats.style.display = "none";
            toggleStatsBtn.textContent = "Show Stats";
        }

        localStorage.setItem("statsVisible", statsVisible.toString());
    }

    // Load stats visibility preference from localStorage
    function loadStatsVisibility() {
        const savedVisibility = localStorage.getItem("statsVisible");
        if (savedVisibility !== null) {
            statsVisible = savedVisibility === "true";
        } else {
            statsVisible = true; // default: visible
        }

        const adaptiveStats = document.getElementById("adaptiveStats");
        if (statsVisible) {
            adaptiveStats.style.display = "inline-block";
            toggleStatsBtn.textContent = "Hide Stats";
        } else {
            adaptiveStats.style.display = "none";
            toggleStatsBtn.textContent = "Show Stats";
        }
    }

    // Load stats visibility on page load
    loadStatsVisibility();

    toggleStatsBtn.addEventListener("click", toggleStatsDisplay);

    // Change Layout debug button (triggers a new grid layout)
    const changeLayoutBtn = document.getElementById("changeLayoutBtn");
    changeLayoutBtn.addEventListener("click", () => {
        deactivatedCells = selectDeactivatedCells();
        applyDeactivatedCells();
        console.log(`Debug: Changed layout, ${deactivatedCells.length} cells hidden [${deactivatedCells.join(', ') || 'none'}]`);
    });

    // Place Color debug button (places one random color in one random available cell)
    const placeColorBtn = document.getElementById("placeColorBtn");
    let debugPlacedCell = null;

    placeColorBtn.addEventListener("click", () => {
        // Clear previously placed cell
        if (debugPlacedCell) {
            debugPlacedCell.style.background = "transparent";
            debugPlacedCell.style.outline = "none";
        }

        const cells = getPlayableCells();
        // Filter out deactivated cells
        const overlayGrid = document.getElementById("overlay-grid");
        const availableCells = cells.filter((cell) => {
            const actualIndex = Array.from(overlayGrid.children).indexOf(cell);
            return !deactivatedCells.includes(actualIndex);
        });

        if (availableCells.length === 0) {
            console.log("Debug: No available cells to place color");
            debugPlacedCell = null;
            return;
        }

        // Pick a random available cell
        const randomCellIndex = Math.floor(Math.random() * availableCells.length);
        const randomCell = availableCells[randomCellIndex];

        // Pick a random color
        const randomColorIndex = Math.floor(Math.random() * COLORS.length);
        const randomColor = COLORS[randomColorIndex];

        // Place the color
        randomCell.style.background = randomColor.color;
        randomCell.style.outline = "1px solid rgba(0, 0, 0, 0.15)"; // fake shadow
        debugPlacedCell = randomCell;

        console.log(`Debug: Placed ${randomColor.name} (${randomColor.color}) in cell`);
    });

    // Fill Heatmap debug button (fills heatmap with various playtimes to test colors)
    const fillHeatmapBtn = document.getElementById("fillHeatmapBtn");
    if (fillHeatmapBtn) {
        fillHeatmapBtn.addEventListener("click", () => {
            const today = new Date();

            // Last 7 days: force level-4 streak (20+ min each)
            for (let i = 0; i <= 7; i++) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateStr = formatDateLocal(date);

                const existing = performanceHistory.get(dateStr) || {
                    n: 2, hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, sumLoad: 0, maxLoad: 0, playTime: 0
                };
                existing.playTime = 1200 + Math.floor(Math.random() * 600); // 20-30 min
                performanceHistory.set(dateStr, existing);
            }

            // Also set today's elapsed time to trigger streak for current day
            elapsedSeconds = 1200 + Math.floor(Math.random() * 600);
            pendingPerformance.playTime = elapsedSeconds;
            savePerformanceToDisk();

            // Fill remaining days (8-90) with random playtimes
            for (let i = 8; i <= 90; i++) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateStr = formatDateLocal(date);

                // Random level distribution
                const rand = Math.random();
                let playTime;
                if (rand < 0.15) {
                    playTime = 0; // level 0: no play
                } else if (rand < 0.35) {
                    playTime = 30 + Math.floor(Math.random() * 250); // level 1: 30s to 280s
                } else if (rand < 0.55) {
                    playTime = 300 + Math.floor(Math.random() * 300); // level 2: 5 to 10 min
                } else if (rand < 0.75) {
                    playTime = 600 + Math.floor(Math.random() * 600); // level 3: 10 to 20 min
                } else {
                    playTime = 1200 + Math.floor(Math.random() * 600); // level 4: 20+ min
                }

                const existing = performanceHistory.get(dateStr) || {
                    n: 2, hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, sumLoad: 0, maxLoad: 0, playTime: 0
                };
                existing.playTime = playTime;
                performanceHistory.set(dateStr, existing);
            }

            // Save and re-render
            savePerformanceToDisk();
            renderActivityHeatmap();
            showBanner(false);

            console.log("Debug: Filled heatmap with 7-day streak + random playtimes");
        });
    }

    // Show or hide debug tools section based on DEBUG flag
    const debugSection = document.getElementById("debugSection");
    if (debugSection) {
        debugSection.style.display = IS_LOCAL_HOST ? "block" : "none";
    }

    // ------------------ Debug: History Display ------------------

    const showHistoryBtn = document.getElementById("showHistoryBtn");
    const historyContainer = document.getElementById("historyContainer");
    const historyDisplay = document.getElementById("historyDisplay");

    function updateHistoryDisplay() {
        if (!IS_LOCAL_HOST) return;

        // Read last 10 trials from trialHistory (single source of truth)
        const roundTrials = getCurrentRoundTrials();
        const last10 = roundTrials.slice(-10);

        if (last10.length === 0) {
            historyDisplay.innerHTML = '<p style="color: #999;">No trials yet. Start a game to see history.</p>';
            return;
        }

        let html = '<div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; min-height: 170px;">';

        last10.forEach((trial) => {
            const colorEntry = COLORS.find(c => c.name === trial.color);
            const colorHex = colorEntry ? colorEntry.color : '#999';
            const isMatch = trial.wasMatch;
            const userClicked = trial.userClicked;
            const isError = (userClicked && !isMatch) || (!userClicked && isMatch);

            // Background color based on status
            let bgColor = '#fff';
            if (isError) {
                bgColor = '#ffebee'; // light red for errors
            } else if (isMatch && userClicked) {
                bgColor = '#e8f5e9'; // light green for correct matches
            }

            html += `<div style="background: ${bgColor}; padding: 8px; border-radius: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 70px;">`;

            // Color swatch and name
            html += `<div style="width: 26px; height: 26px; background: ${colorHex}; border-radius: 3px; border: 2px solid #ccc;"></div>`;
            html += `<div style="font-size: 10px; font-weight: 500;">${trial.color}</div>`;

            // Badges (compact icons/symbols)
            html += `<div style="display: flex; gap: 3px; flex-wrap: wrap; justify-content: center;">`;

            if (isMatch) {
                html += `<span style="background: #4caf50; color: white; padding: 1px 4px; border-radius: 2px; font-size: 9px; font-weight: bold;">M</span>`;
            }

            if (isError) {
                const errorSymbol = userClicked && !isMatch ? '✗' : '!';
                html += `<span style="background: #f44336; color: white; padding: 1px 4px; border-radius: 2px; font-size: 9px; font-weight: bold;">${errorSymbol}</span>`;
            }

            if (userClicked) {
                html += `<span style="background: #ffeb3b; padding: 1px 4px; border-radius: 2px; font-size: 9px; font-weight: bold;">✓</span>`;
            }

            html += `</div>`;
            html += `</div>`;
        });

        html += '</div>';
        historyDisplay.innerHTML = html;
    }

    function showTrialHistory() {
        if (historyShowing) {
            hideTrialHistory();
            return;
        }

        historyShowing = true;
        showHistoryBtn.textContent = "Hide History";
        historyContainer.style.display = "block";
        updateHistoryDisplay();
    }

    function hideTrialHistory() {
        historyShowing = false;
        showHistoryBtn.textContent = "Show History";
        historyContainer.style.display = "none";
    }

    showHistoryBtn.addEventListener("click", showTrialHistory);

    // ------------------ Debug: Baseline Graph Display ------------------

    const showGraphBtn = document.getElementById("showGraphBtn");
    const graphContainer = document.getElementById("graphContainer");
    const graphDisplay = document.getElementById("graphDisplay");

    function updateGraphDisplay() {
        if (!IS_LOCAL_HOST) return;

        const trials = getCurrentRoundTrials();
        if (trials.length === 0) {
            graphDisplay.innerHTML = '<p style="color: #999; text-align: center; padding-top: 130px;">No data yet. Start a game to see the graph.</p>';
            return;
        }

        const width = graphDisplay.offsetWidth;
        const height = 300;
        const padding = { top: 20, right: 20, bottom: 30, left: 40 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;

        // Get data range (maxUniqueColors = n + 1)
        const maxUniqueColors = n + 1;
        const minLoad = 1;
        const trialCount = trials.length;

        // Create SVG
        let svg = `<svg width="${width}" height="${height}" style="font-family: Arial, sans-serif; font-size: 11px;">`;

        // Background
        svg += `<rect x="${padding.left}" y="${padding.top}" width="${graphWidth}" height="${graphHeight}" fill="rgba(240, 240, 240, 0.3)"/>`;

        // Y-axis labels and grid lines (from minLoad to maxUniqueColors)
        for (let i = minLoad; i <= maxUniqueColors; i++) {
            const y = padding.top + graphHeight - ((i - minLoad) / (maxUniqueColors - minLoad)) * graphHeight;
            svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;
            svg += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" fill="#666">${i}</text>`;
        }

        // Target line (maxUniqueColors)
        const targetY = padding.top;
        svg += `<line x1="${padding.left}" y1="${targetY}" x2="${width - padding.right}" y2="${targetY}" stroke="#999" stroke-width="2" stroke-dasharray="5,5"/>`;
        svg += `<text x="${width - padding.right + 5}" y="${targetY + 4}" fill="#666" font-size="10px">Max</text>`;

        // Current load line
        let pathData = '';
        trials.forEach((t, i) => {
            const x = padding.left + (i / Math.max(trialCount - 1, 1)) * graphWidth;
            const y = padding.top + graphHeight - ((t.currentLoad - minLoad) / (maxUniqueColors - minLoad)) * graphHeight;

            if (i === 0) {
                pathData += `M ${x} ${y}`;
            } else {
                pathData += ` L ${x} ${y}`;
            }
        });

        svg += `<path d="${pathData}" fill="none" stroke="#2196F3" stroke-width="2"/>`;

        // Trial outcome markers (dots)
        // Green = correct match click, Red = error (missed match or false positive)
        for (let i = 0; i < trialCount; i++) {
            const t = trials[i];

            // Skip if outcome not yet recorded
            if (t.wasMatch === null || t.userClicked === null) continue;

            const x = padding.left + (i / Math.max(trialCount - 1, 1)) * graphWidth;
            const y = padding.top + graphHeight - ((t.currentLoad - minLoad) / (maxUniqueColors - minLoad)) * graphHeight;

            if (t.wasMatch && t.userClicked) {
                svg += `<circle cx="${x}" cy="${y}" r="6" fill="#4caf50" stroke="white" stroke-width="1.5" opacity="0.9"/>`;
            } else if ((t.wasMatch && !t.userClicked) || (!t.wasMatch && t.userClicked)) {
                svg += `<circle cx="${x}" cy="${y}" r="6" fill="#f44336" stroke="white" stroke-width="1.5" opacity="0.9"/>`;
            }
        }

        // X-axis
        svg += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#666" stroke-width="1"/>`;

        // X-axis label
        svg += `<text x="${width / 2}" y="${height - 5}" text-anchor="middle" fill="#666">Trials</text>`;

        // Y-axis
        svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#666" stroke-width="1"/>`;

        // Y-axis label
        svg += `<text x="10" y="15" fill="#666" font-size="11px">Load</text>`;

        svg += '</svg>';
        graphDisplay.innerHTML = svg;
    }

    function showBaselineGraph() {
        if (graphShowing) {
            hideBaselineGraph();
            return;
        }

        graphShowing = true;
        showGraphBtn.textContent = "Hide Graph";
        graphContainer.style.display = "block";
        updateGraphDisplay();
    }

    function hideBaselineGraph() {
        graphShowing = false;
        showGraphBtn.textContent = "Show Graph";
        graphContainer.style.display = "none";
    }

    showGraphBtn.addEventListener("click", showBaselineGraph);


    // Debug: Test unlock button
    const testUnlockBtn = document.getElementById("testUnlockBtn");
    testUnlockBtn.addEventListener("click", () => {
        if (highestUnlockedLevel < 6) {
            // Unlock next level with animation (immediate for debug)
            highestUnlockedLevel++;
            saveUnlockedLevel();
            updateNBackButtons();
            animateUnlockedButton(highestUnlockedLevel);
            testUnlockBtn.textContent = `Test Unlock (${highestUnlockedLevel}/6)`;
        } else {
            // Reset to level 2 for testing again
            highestUnlockedLevel = 2;
            saveUnlockedLevel();
            updateNBackButtons();
            testUnlockBtn.textContent = "Test Unlock (Reset)";
        }
    });

} // end IS_LOCAL_HOST debug block
