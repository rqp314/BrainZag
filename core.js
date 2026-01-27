/**
 * Author: BrainZag
 * Repository: https://github.com/rqp314/BrainZag
 * License: See LICENSE file
 * Copyright (c) 2026 BrainZag
 *
 * Core algorithms: adaptive training, cognitive drift detection,
 * color sequence generation, and performance tracking.
 *
*/

// ============================================================================
// LOW-PASS FILTER (smooth accuracy tracking)
// ============================================================================

class LowPassFilter {
  constructor(factor = 0.1) {
    this.factor = factor;
  }

  apply(currentValue, newSample) {
    return currentValue * (1 - this.factor) + newSample * this.factor;
  }
}

// ============================================================================
// SESSION TRACKER - Track play sessions and timing
// ============================================================================

class SessionTracker {
  constructor() {
    this.loadSession();
  }

  loadSession() {
    try {
      const data = localStorage.getItem('nback_session_data');
      if (data) {
        const parsed = JSON.parse(data);
        this.lastSessionDate = new Date(parsed.lastSessionDate);
        this.lastSessionDuration = parsed.lastSessionDuration || 0;
        this.totalPlayTime = parsed.totalPlayTime || 0;
        this.sessionCount = parsed.sessionCount || 0;
        this.currentSessionStart = null;
      } else {
        this.initializeNew();
      }
    } catch (e) {
      console.error('Failed to load session data:', e);
      this.initializeNew();
    }
  }

  initializeNew() {
    this.lastSessionDate = null;
    this.lastSessionDuration = 0;
    this.totalPlayTime = 0;
    this.sessionCount = 0;
    this.currentSessionStart = null;
  }

  startSession() {
    this.currentSessionStart = Date.now();
  }

  endSession() {
    if (!this.currentSessionStart) return;

    const duration = Date.now() - this.currentSessionStart;
    this.lastSessionDate = new Date();
    this.lastSessionDuration = duration;
    this.totalPlayTime += duration;
    this.sessionCount++;
    this.currentSessionStart = null;

    this.save();
  }

  save() {
    try {
      const data = {
        lastSessionDate: this.lastSessionDate ? this.lastSessionDate.toISOString() : null,
        lastSessionDuration: this.lastSessionDuration,
        totalPlayTime: this.totalPlayTime,
        sessionCount: this.sessionCount
      };
      localStorage.setItem('nback_session_data', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save session data:', e);
    }
  }

  getTimeSinceLastSession() {
    if (!this.lastSessionDate) return Infinity;
    return Date.now() - this.lastSessionDate.getTime();
  }

  getCurrentSessionDuration() {
    if (!this.currentSessionStart) return 0;
    return Date.now() - this.currentSessionStart;
  }

  getStats() {
    return {
      lastSessionDate: this.lastSessionDate,
      lastSessionDuration: this.lastSessionDuration,
      totalPlayTime: this.totalPlayTime,
      sessionCount: this.sessionCount,
      timeSinceLastSession: this.getTimeSinceLastSession(),
      currentSessionDuration: this.getCurrentSessionDuration()
    };
  }
}

// ============================================================================
// COGNITIVE DRIFT DETECTOR - Detect fatigue and performance degradation
// ============================================================================

class CognitiveDriftDetector {
  constructor() {
    this.reactionTimes = [];
    this.recentAccuracy = 0.75;
    this.accuracyFilter = new LowPassFilter(0.1);
    this.rtFilter = new LowPassFilter(0.15);
    this.avgRT = 800;

    // Drift indicators
    this.rtVariability = 0;
    this.slowdownTrend = 0;
    this.easyTrialSlowdowns = 0;
    this.totalEasyTrials = 0;

    // State
    this.inRecoveryBlock = false;
    this.recoveryTrialsRemaining = 0;
    this.confidenceScore = 1.0;

    // History window for variability calculation
    this.windowSize = 10;
  }

  recordTrial(correct, reactionTime, targetLoad, isValid) {
    if (!isValid) return;

    // Update accuracy
    this.recentAccuracy = this.accuracyFilter.apply(this.recentAccuracy, correct ? 1 : 0);

    // Update RT
    this.avgRT = this.rtFilter.apply(this.avgRT, reactionTime);
    this.reactionTimes.push(reactionTime);

    // Keep window size limited
    if (this.reactionTimes.length > this.windowSize * 2) {
      this.reactionTimes.shift();
    }

    // Calculate RT variability (coefficient of variation)
    if (this.reactionTimes.length >= this.windowSize) {
      const recent = this.reactionTimes.slice(-this.windowSize);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const variance = recent.reduce((sum, rt) => sum + Math.pow(rt - mean, 2), 0) / recent.length;
      const stdDev = Math.sqrt(variance);
      this.rtVariability = mean > 0 ? stdDev / mean : 0;
    }

    // Detect slowdown trend (comparing recent vs historical)
    // Inverted: positive = improving (faster), negative = slowing down
    if (this.reactionTimes.length >= this.windowSize * 2) {
      const older = this.reactionTimes.slice(0, this.windowSize);
      const recent = this.reactionTimes.slice(-this.windowSize);
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      this.slowdownTrend = (olderAvg - recentAvg) / olderAvg; // inverted: positive = faster
    }

    // Track easy trial slowdowns (suspiciously slow on easy trials)
    if (targetLoad < 2.0) {
      this.totalEasyTrials++;
      if (reactionTime > this.avgRT * 1.5) {
        this.easyTrialSlowdowns++;
      }
    }

    // Update confidence score
    this.updateConfidence();
  }

  updateConfidence() {
    // Composite confidence score from multiple factors
    let confidence = 1.0;

    // Factor 1: Accuracy (0.8 - 1.0 range)
    const accuracyFactor = Math.min(1.0, this.recentAccuracy / 0.85);
    confidence *= (0.3 * accuracyFactor + 0.7); // Weight 30%

    // Factor 2: RT Speed (faster = higher confidence)
    // Assume optimal RT is around 700ms, slower reduces confidence
    const rtFactor = Math.max(0.5, Math.min(1.0, 700 / this.avgRT));
    confidence *= (0.2 * rtFactor + 0.8); // Weight 20%

    // Factor 3: RT Variability (lower = higher confidence)
    // CV < 0.2 is good, > 0.4 is concerning
    const variabilityFactor = Math.max(0.5, Math.min(1.0, 1.0 - (this.rtVariability / 0.4)));
    confidence *= (0.2 * variabilityFactor + 0.8); // Weight 20%

    // Factor 4: RT Trend (positive = faster/better, negative = slower/worse)
    // +10% faster gives boost, -10% slower reduces confidence
    const trendFactor = Math.max(0.5, Math.min(1.0, 1.0 + this.slowdownTrend * 2));
    confidence *= (0.15 * trendFactor + 0.85); // Weight 15%

    // Factor 5: Easy Trial Performance (no slowdowns = 1.0)
    const easyTrialFactor = this.totalEasyTrials > 0
      ? Math.max(0.6, 1.0 - (this.easyTrialSlowdowns / this.totalEasyTrials))
      : 1.0;
    confidence *= (0.15 * easyTrialFactor + 0.85); // Weight 15%

    this.confidenceScore = Math.max(0.3, Math.min(1.0, confidence));
  }

  detectDrift() {
    // Drift detected if confidence drops below threshold
    const driftThreshold = 0.65;
    return this.confidenceScore < driftThreshold && !this.inRecoveryBlock;
  }

  startRecoveryBlock() {
    this.inRecoveryBlock = true;
    this.recoveryTrialsRemaining = 5; // 5 easier trials
  }

  updateRecoveryBlock() {
    if (!this.inRecoveryBlock) return;

    this.recoveryTrialsRemaining--;
    if (this.recoveryTrialsRemaining <= 0) {
      this.inRecoveryBlock = false;
      // Reset easy trial tracking after recovery
      this.easyTrialSlowdowns = 0;
      this.totalEasyTrials = 0;
    }
  }

  getConfidence() {
    return this.confidenceScore;
  }

  isInRecovery() {
    return this.inRecoveryBlock;
  }

  getStats() {
    return {
      confidence: this.confidenceScore,
      recentAccuracy: this.recentAccuracy,
      avgRT: Math.round(this.avgRT),
      rtVariability: this.rtVariability.toFixed(3),
      slowdownTrend: (this.slowdownTrend * 100).toFixed(1) + '%',
      inRecovery: this.inRecoveryBlock,
      recoveryRemaining: this.recoveryTrialsRemaining
    };
  }

  reset() {
    this.reactionTimes = [];
    this.rtVariability = 0;
    this.slowdownTrend = 0;
    this.easyTrialSlowdowns = 0;
    this.totalEasyTrials = 0;
    this.confidenceScore = 1.0;
  }
}

// ============================================================================
// WORKING MEMORY STATE TRACKER
// ============================================================================

class WorkingMemoryState {
  constructor(n) {
    this.n = n; // Fixed N-back level (e.g., 2, 3, 7)
    this.recentColors = []; // Last N+1 colors shown (user needs current + previous N)
    this.currentLoad = 0; // Unique colors in memory window (1 to N+1)
  }

  addColor(color) {
    this.recentColors.push(color);

    // Keep only the N+1 most recent colors (current + previous N positions)
    if (this.recentColors.length > this.n + 1) {
      this.recentColors.shift();
    }

    // Calculate load: count unique colors in window
    this.currentLoad = new Set(this.recentColors).size;
  }

  getRecentColors() {
    return [...this.recentColors];
  }

  getCurrentLoad() {
    return this.currentLoad;
  }

  // Check if color at position N-back matches current
  checkNBackMatch(currentColor) {
    if (this.recentColors.length < this.n) {
      return false;
    }
    const nBackColor = this.recentColors[this.recentColors.length - this.n];
    return currentColor === nBackColor;
  }
}

// ============================================================================
// UNIQUE COLOR STEP CONTROLLER
// ============================================================================

class UniqueColorController {
  constructor(n) {
    this.n = n;

    this.minUniqueColors = 2;
    this.maxUniqueColors = n + 1;
    this.currentUniqueColors = 2;

    // Smoothed performance signal
    this.performanceEMA = 0.75;
    this.alpha = 0.15; // responsiveness (higher = faster reaction)

    // Pressure counters
    this.increasePressure = 0;
    this.decreasePressure = 0;

    // Thresholds (asymmetric by design)
    this.increaseThreshold = 0.88;
    this.decreaseThreshold = 0.62;

    // How much pressure needed
    this.increasePressureLimit = 6;
    this.decreasePressureLimit = 3;

    // Correct rejection tracking (for deferred micro-reward)
    this.correctRejectionStreak = 0;
    this.rejectionWindow = n + 1; // Window length needed to earn credit
    this.rejectionReward = 0.05; // Very small delayed reward
  }

  recordTrial(correct, isValid, confidence = 1.0, wasMatch = false, userClicked = false) {
    if (!isValid) return;

    // MATCH trials -> immediate full EMA update
    if (wasMatch) {
      const score = this.computeWeightedScore(correct, confidence);

      this.performanceEMA +=
        this.alpha * (score - this.performanceEMA);

      this.correctRejectionStreak = 0; // Reset streak
      this.updatePressure();
      return;
    }

    // FALSE ALARM (non-match + user clicked) -> immediate punishment
    if (!wasMatch && userClicked) {
      const score = this.computeWeightedScore(false, confidence);

      this.performanceEMA +=
        this.alpha * (score - this.performanceEMA);

      this.correctRejectionStreak = 0; // Reset streak
      this.updatePressure();
      return;
    }

    // CORRECT REJECTION (non-match + no click) -> accumulate streak, deferred micro-reward
    if (!wasMatch && !userClicked) {
      this.correctRejectionStreak++;

      // Only reward after sustained inhibition (n consecutive correct rejections)
      if (this.correctRejectionStreak >= this.rejectionWindow) {
        // Tiny upward nudge as stability signal (not skill signal)
        this.performanceEMA +=
          this.alpha * this.rejectionReward * (1.0 - this.performanceEMA);

        this.correctRejectionStreak = 0; // Reset after reward
        this.updatePressure();
      }
      // No immediate EMA update - waiting for sustained inhibition
    }
  }

  computeWeightedScore(correct, confidence) {
    if (correct) {
      return 0.7 + 0.3 * confidence;
    } else {
      return 0.3 * (1 - confidence);
    }
  }

  updatePressure() {
    // Decrease reacts faster
    if (this.performanceEMA < this.decreaseThreshold) {
      this.decreasePressure++;
      this.increasePressure = Math.max(0, this.increasePressure - 1);
    }

    // Increase reacts slower
    else if (this.performanceEMA > this.increaseThreshold) {
      this.increasePressure++;
      this.decreasePressure = Math.max(0, this.decreasePressure - 1);
    }

    // Neutral zone slowly relaxes both
    else {
      this.increasePressure = Math.max(0, this.increasePressure - 1);
      this.decreasePressure = Math.max(0, this.decreasePressure - 1);
    }

    // Apply changes
    if (this.decreasePressure >= this.decreasePressureLimit) {
      this.decreaseUniqueColors();
      this.resetPressure();
    } else if (this.increasePressure >= this.increasePressureLimit) {
      this.increaseUniqueColors();
      this.resetPressure();
    }
  }

  resetPressure() {
    this.increasePressure = 0;
    this.decreasePressure = 0;
  }

  increaseUniqueColors() {
    if (this.currentUniqueColors < this.maxUniqueColors) {
      this.currentUniqueColors++;
    }
  }

  decreaseUniqueColors() {
    if (this.currentUniqueColors > this.minUniqueColors) {
      this.currentUniqueColors--;
    }
  }

  getTargetUniqueColors() {
    return this.currentUniqueColors;
  }

  getMaxUniqueColors() {
    return this.maxUniqueColors;
  }

  getCurrentUniqueColors() {
    return this.currentUniqueColors;
  }

  getStats() {
    return {
      currentUniqueColors: this.currentUniqueColors,
      maxUniqueColors: this.maxUniqueColors,
      minUniqueColors: this.minUniqueColors,
      performanceEMA: this.performanceEMA,
      increasePressure: this.increasePressure,
      decreasePressure: this.decreasePressure,
      increaseThreshold: this.increaseThreshold,
      decreaseThreshold: this.decreaseThreshold,
      correctRejectionStreak: this.correctRejectionStreak,
      rejectionWindow: this.rejectionWindow
    };
  }
}

// ============================================================================
// COLOR SEQUENCE GENERATOR (with rank-based weighting)
// ============================================================================

class ColorSequenceGenerator {
  constructor(n, availableColors) {
    this.n = n;
    this.availableColors = availableColors; // Array of {color, rank, name}
    this.memoryState = new WorkingMemoryState(n);
    this.activeSet = null; // Active set of K colors for maintaining targetUniqueColors
    this.swapProbability = 0.7; // Probability of swapping a color for novelty
  }

  // CONSTRAINT VALIDATION: The window is the source of truth
  isValidNextColor(currentWindow, candidate, target) {
    // Simulate what the window will look like after adding this candidate
    const windowSize = this.n + 1;
    const simulated = [...currentWindow, candidate].slice(-windowSize);
    const uniqueCount = new Set(simulated).size;
    return uniqueCount === target;
  }

  pickNextWithConstraint(currentWindow, candidates, target) {
    // Filter candidates to only those that maintain the constraint
    const valid = candidates.filter(c =>
      this.isValidNextColor(currentWindow, c, target)
    );

    if (valid.length > 0) {
      return valid[Math.floor(Math.random() * valid.length)];
    }

    // Hard fallback: force repair if no valid candidates
    return this.forceRepair(currentWindow, target);
  }

  forceRepair(currentWindow, target) {
    // If we're under target, introduce a new color
    const windowSize = this.n + 1;
    const recentWindow = currentWindow.slice(-windowSize);
    const windowSet = new Set(recentWindow);

    if (windowSet.size < target) {
      // Try to introduce a new color not in window
      const available = this.availableColors
        .map(c => c.name)
        .filter(c => !windowSet.has(c));

      if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
      }
    }

    // If we're at or over target, repeat existing to consolidate
    return [...windowSet][0];
  }

  generateNextColor(targetUniqueColors, isMatch, nBackColor, isForced = false) {
    const currentWindow = this.memoryState.recentColors;

    // Ensure target is at least 2
    const target = Math.max(2, targetUniqueColors);

    // Reset active set if target changed
    if (this.lastTarget !== undefined && this.lastTarget !== target) {
      this.activeSet = null;
    }
    this.lastTarget = target;

    // If this is a match trial, validate the N-back color maintains constraint
    if (isMatch && nBackColor) {
      // When forced due to gap pressure, allow reducing load but never increasing
      if (isForced) {
        // Relaxed validation for forced matches
        const windowSize = this.n + 1;
        const simulated = [...currentWindow, nBackColor].slice(-windowSize);
        const uniqueCount = new Set(simulated).size;
        // Allow target-1, target-2, etc. (reduce cognitive load) but NEVER target+1
        if (uniqueCount <= target) {
          return nBackColor;
        }
      } else {
        // Strict validation for normal matches
        if (this.isValidNextColor(currentWindow, nBackColor, target)) {
          return nBackColor;
        }
      }
      // If match would violate constraint even with relaxation, fall through
    }

    // When NOT creating a match, exclude the n-back color to avoid accidental matches
    const excludeColor = !isMatch ? nBackColor : null;

    // ALGORITHM: Three cases based on targetUniqueColors (K)
    // Case 1: K = 2 (minimum) - keep patterns simple, repeat existing
    // Case 2: K = n+1 (maximum) - force all different colors
    // Case 3: K = in between - maintain active set of K colors

    let next;

    // Case 1: K = 2 (minimum load)
    if (target === 2) {
      next = this.generateForMinLoad(currentWindow, excludeColor, target);
    }
    // Case 2: K = n+1 (maximum load)
    else if (target === this.n + 1) {
      next = this.generateForMaxLoad(currentWindow, excludeColor, target);
    }
    // Case 3: K = in between (use active set)
    else {
      next = this.generateForMidLoad(currentWindow, target, excludeColor);
    }

    return next;
  }

  generateForMinLoad(currentWindow, excludeColor, target) {
    // K = 2: Maintain exactly 2 unique colors using active pair strategy

    const uniqueColors = [...new Set(currentWindow)];

    // If we only have 1 unique color, introduce a second
    if (uniqueColors.length < 2) {
      // Build list of candidates (all colors not in window, except excluded)
      const windowSet = new Set(currentWindow);
      const candidates = this.availableColors
        .map(c => c.name)
        .filter(c => !windowSet.has(c) && c !== excludeColor);

      if (candidates.length > 0) {
        const newColor = this.pickNextWithConstraint(currentWindow, candidates, target);
        // Initialize active pair
        if (uniqueColors.length === 1) {
          this.activeSet = [uniqueColors[0], newColor];
        } else {
          this.activeSet = [newColor];
        }
        return newColor;
      }
    }

    // We have 2 or more unique colors - maintain exactly 2
    // Initialize active set if not set
    if (!this.activeSet || this.activeSet.length !== 2) {
      this.activeSet = uniqueColors.slice(0, 2);
    }

    // Occasionally swap one color for novelty
    if (Math.random() < this.swapProbability) {
      const keep = this.activeSet[Math.floor(Math.random() * this.activeSet.length)];
      const availableForSwap = this.availableColors
        .map(c => c.name)
        .filter(c => !this.activeSet.includes(c));

      if (availableForSwap.length > 0) {
        // Validate the replacement maintains constraint
        const validReplacements = availableForSwap.filter(replacement =>
          this.isValidNextColor(currentWindow, replacement, target)
        );

        if (validReplacements.length > 0) {
          const replacement = validReplacements[Math.floor(Math.random() * validReplacements.length)];
          this.activeSet = [keep, replacement];
          return replacement;
        }
      }
    }

    // Normal behavior: stay within active pair
    // Build list of candidates from active set (excluding n-back if needed)
    const candidates = excludeColor
      ? this.activeSet.filter(c => c !== excludeColor)
      : this.activeSet;

    // Use constraint validation to pick
    return this.pickNextWithConstraint(currentWindow, candidates, target);
  }

  generateForMaxLoad(currentWindow, excludeColor, target) {
    // K = n+1: Force all different colors in the window
    // Pick a color that's NOT in the current window (and not excluded)

    const windowSet = new Set(currentWindow);
    const candidates = this.availableColors
      .map(c => c.name)
      .filter(c => !windowSet.has(c) && c !== excludeColor);

    // Use constraint validation to pick
    return this.pickNextWithConstraint(currentWindow, candidates, target);
  }

  generateForMidLoad(currentWindow, target, excludeColor) {
    // K = between 2 and n+1: Maintain active set of K colors

    const uniqueColors = [...new Set(currentWindow)];

    // If we have fewer than K unique colors, introduce new ones
    if (uniqueColors.length < target) {
      const windowSet = new Set(currentWindow);
      const candidates = this.availableColors
        .map(c => c.name)
        .filter(c => !windowSet.has(c) && c !== excludeColor);

      if (candidates.length > 0) {
        const newColor = this.pickNextWithConstraint(currentWindow, candidates, target);
        // Add to active set
        if (!this.activeSet) {
          this.activeSet = [...uniqueColors, newColor];
        } else {
          this.activeSet = [...new Set([...this.activeSet, newColor])].slice(0, target);
        }
        return newColor;
      }
    }

    // Initialize or update active set to match target size
    if (!this.activeSet || this.activeSet.length !== target) {
      this.activeSet = uniqueColors.slice(0, target);
    }

    // Occasionally swap one color for novelty
    if (Math.random() < this.swapProbability) {
      const keepIndex = Math.floor(Math.random() * this.activeSet.length);
      const keep = this.activeSet.filter((_, i) => i !== keepIndex);

      const availableForSwap = this.availableColors
        .map(c => c.name)
        .filter(c => !this.activeSet.includes(c));

      if (availableForSwap.length > 0) {
        // Validate the replacement maintains constraint
        const validReplacements = availableForSwap.filter(replacement =>
          this.isValidNextColor(currentWindow, replacement, target)
        );

        if (validReplacements.length > 0) {
          const replacement = validReplacements[Math.floor(Math.random() * validReplacements.length)];
          this.activeSet = [...keep, replacement];
          return replacement;
        }
      }
    }

    // Normal behavior: stay within active set
    // Build list of candidates from active set (excluding n-back if needed)
    const candidates = excludeColor
      ? this.activeSet.filter(c => c !== excludeColor)
      : this.activeSet;

    // Use constraint validation to pick
    return this.pickNextWithConstraint(currentWindow, candidates, target);
  }

  updateMemoryState(color) {
    this.memoryState.addColor(color);
  }

  getMemoryState() {
    return this.memoryState;
  }
}

// ============================================================================
// MATCH GENERATOR (controls frequency of N-back matches)
// ============================================================================

class MatchGenerator {
  constructor(targetMatchRate = 0.30) {
    this.targetRate = targetMatchRate;

    this.recentMatches = [];
    this.windowSize = 20;

    this.trialsSinceLastMatch = 0;
    this.maxGap = Math.round(1 / targetMatchRate) * 2; // ~6-7 for 0.3
  }

  shouldCreateMatch(memoryState) {
    if (memoryState.recentColors.length < memoryState.n) {
      return { shouldMatch: false, isForced: false };
    }

    const recentRate =
      this.recentMatches.length > 0
        ? this.recentMatches.filter(Boolean).length / this.recentMatches.length
        : this.targetRate;

    let probability = this.targetRate;
    let isForced = false;

    // Rate correction
    if (recentRate < this.targetRate - 0.05) {
      probability += 0.15;
    } else if (recentRate > this.targetRate + 0.05) {
      probability -= 0.15;
    }

    // Gap pressure - force matches after long droughts
    if (this.trialsSinceLastMatch > this.maxGap) {
      probability = 1.0; // force a match
      isForced = true; // Mark as forced so constraint can be relaxed
    } else {
      probability += this.trialsSinceLastMatch * 0.03;
    }

    probability = Math.min(Math.max(probability, 0), 1);

    const shouldMatch = Math.random() < probability;

    // NOTE: We don't record here - we record after color validation
    // to avoid desynchronization when matches are rejected by constraints

    return { shouldMatch, isForced: isForced && shouldMatch };
  }

  registerActualMatch(didMatch) {
    // Record the actual match result after color generation
    this.recentMatches.push(didMatch);
    if (this.recentMatches.length > this.windowSize) {
      this.recentMatches.shift();
    }

    this.trialsSinceLastMatch = didMatch ? 0 : this.trialsSinceLastMatch + 1;
  }

  getNBackColor(memoryState) {
    if (memoryState.recentColors.length < memoryState.n) {
      return null;
    }
    return memoryState.recentColors[memoryState.recentColors.length - memoryState.n];
  }

  getStats() {
    const recentRate = this.recentMatches.length > 0
      ? this.recentMatches.filter(Boolean).length / this.recentMatches.length
      : this.targetRate;

    return {
      trialsSinceLastMatch: this.trialsSinceLastMatch,
      maxGap: this.maxGap,
      recentRate: recentRate,
      targetRate: this.targetRate
    };
  }
}

// ============================================================================
// PERFORMANCE TRACKER
// ============================================================================

class PerformanceTracker {
  constructor() {
    this.trials = [];
    this.accuracy = 0.75; // Smoothed accuracy
    this.accuracyFilter = new LowPassFilter(0.15);
  }

  recordTrial(correct, reactionTime, isValid) {
    this.trials.push({
      correct,
      reactionTime,
      isValid,
      timestamp: Date.now()
    });

    // Update smoothed accuracy (only from valid trials)
    if (isValid) {
      this.accuracy = this.accuracyFilter.apply(this.accuracy, correct ? 1 : 0);
    }
  }

  getAccuracy() {
    return this.accuracy;
  }

  getRecentAccuracy(window = 10) {
    const validTrials = this.trials.filter(t => t.isValid);
    if (validTrials.length === 0) return this.accuracy;

    const recent = validTrials.slice(-window);
    const correct = recent.filter(t => t.correct).length;
    return correct / recent.length;
  }

  getStats() {
    const validTrials = this.trials.filter(t => t.isValid);
    const correctTrials = validTrials.filter(t => t.correct);

    return {
      totalTrials: validTrials.length,
      correctTrials: correctTrials.length,
      accuracy: this.getAccuracy(),
      recentAccuracy: this.getRecentAccuracy()
    };
  }

  reset() {
    this.trials = [];
    this.accuracy = 0.75;
  }
}

// ============================================================================
// MAIN WORKING MEMORY TRAINER
// ============================================================================

class WorkingMemoryTrainer {
  constructor(n, colors) {
    this.n = n;
    this.colors = colors;

    this.colorController = new UniqueColorController(n);
    this.colorGenerator = new ColorSequenceGenerator(n, colors);
    this.matchGenerator = new MatchGenerator(0.30);
    this.performanceTracker = new PerformanceTracker();
    this.driftDetector = new CognitiveDriftDetector();

    this.trialNumber = 0;
    this.currentTile = null;
    this.lastTrialCorrect = true;
  }

  generateNextTrial() {
    // 1. Get target number of unique colors from controller
    const targetUniqueColors = this.colorController.getTargetUniqueColors();

    // 2. Decide if this should be a match
    const memoryState = this.colorGenerator.getMemoryState();
    const matchDecision = this.matchGenerator.shouldCreateMatch(memoryState);
    const shouldMatch = matchDecision.shouldMatch;
    const isForced = matchDecision.isForced;

    // 3. Get the n-back color (to use for match or exclude for non-match)
    const nBackColor = this.matchGenerator.getNBackColor(memoryState);

    // 4. Generate appropriate color (pass isForced to relax constraints if needed)
    // targetUniqueColors acts as targetLoad for the color generator
    let color = this.colorGenerator.generateNextColor(targetUniqueColors, shouldMatch, nBackColor, isForced);

    // 5. Update memory state with the new color
    this.colorGenerator.updateMemoryState(color);

    // 6. Determine if this is actually a match (after color generation/validation)
    const actuallyIsMatch = nBackColor && color === nBackColor;

    // 7. Register the actual match result to keep stats accurate
    this.matchGenerator.registerActualMatch(actuallyIsMatch);

    // 8. Create tile
    this.currentTile = {
      color: color,
      position: this.generatePosition(),
      isMatch: actuallyIsMatch, // Use actual match, not intended match
      currentLoad: memoryState.getCurrentLoad(),
      targetLoad: targetUniqueColors,
      targetUniqueColors: targetUniqueColors,
      trialNumber: this.trialNumber
    };

    this.trialNumber++;

    return this.currentTile;
  }

  recordResponse(userClicked, wasMatch, reactionTime) {
    const correct = userClicked === wasMatch;

    // Validate trial (reject outliers)
    const isValid = this.isValidTrial(reactionTime);

    // Store last trial result
    if (isValid) {
      this.lastTrialCorrect = correct;
    }

    // Record to performance tracker and color controller
    if (isValid) {
      this.performanceTracker.recordTrial(correct, reactionTime, isValid);

      // Record to drift detector first to update confidence
      this.driftDetector.recordTrial(
        correct,
        reactionTime,
        this.currentTile ? this.currentTile.targetLoad : 2,
        isValid
      );

      // Pass confidence, wasMatch, and userClicked to color controller for eligibility-gated evaluation
      const confidence = this.driftDetector.confidenceScore;
      this.colorController.recordTrial(correct, isValid, confidence, wasMatch, userClicked);
    }

    // Update recovery block status
    if (this.driftDetector.isInRecovery()) {
      this.driftDetector.updateRecoveryBlock();
    }

    return {
      correct,
      wasMatch,
      feedback: this.generateFeedback(correct, wasMatch),
      isValid
    };
  }

  isValidTrial(reactionTime) {
    // Reject suspiciously fast reactions (< 150ms = likely accidental click)
    if (reactionTime < 150) return false;

    // Reject impossibly slow reactions (> 5000ms = distracted/not engaged)
    if (reactionTime > 5000) return false;

    return true;
  }

  generateFeedback(correct, wasMatch) {
    if (correct && wasMatch) return 'Correct match!';
    if (correct && !wasMatch) return 'Correct - no match';
    if (!correct && wasMatch) return 'Missed a match';
    return 'False positive';
  }

  generatePosition() {
    // Simple random position on 3x3 grid
    const positions = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        positions.push({ row, col });
      }
    }
    return positions[Math.floor(Math.random() * positions.length)];
  }

  getStats() {
    const perfStats = this.performanceTracker.getStats();
    const memoryState = this.colorGenerator.getMemoryState();
    const driftStats = this.driftDetector.getStats();
    const colorStats = this.colorController.getStats();

    return {
      n: this.n,
      trialNumber: this.trialNumber,
      currentLoad: memoryState.getCurrentLoad(),
      targetUniqueColors: colorStats.currentUniqueColors,
      maxUniqueColors: colorStats.maxUniqueColors,
      minUniqueColors: colorStats.minUniqueColors,
      performanceEMA: colorStats.performanceEMA,
      increasePressure: colorStats.increasePressure,
      decreasePressure: colorStats.decreasePressure,
      increaseThreshold: colorStats.increaseThreshold,
      decreaseThreshold: colorStats.decreaseThreshold,
      accuracy: perfStats.accuracy,
      recentAccuracy: perfStats.recentAccuracy,
      totalTrials: perfStats.totalTrials,
      confidence: driftStats.confidence,
      driftDetector: driftStats,
      isRecovery: this.driftDetector.isInRecovery()
    };
  }

  reset() {
    this.trialNumber = 0;
    this.currentTile = null;
    this.colorGenerator = new ColorSequenceGenerator(this.n, this.colors);
    this.colorController = new UniqueColorController(this.n);
    this.matchGenerator = new MatchGenerator(0.30); // Reset to get early match forcing
    this.performanceTracker.reset();
    this.driftDetector.reset();
  }

  getCurrentN() {
    return this.n;
  }
}

// ============================================================================
// ADAPTIVE N-BACK GAME
// ============================================================================

class AdaptiveNBackGame {
  constructor(options = {}) {
    this.currentN = options.startN || 2;
    this.colors = options.colors || [];
    this.sessionTracker = new SessionTracker();

    // Create the working memory trainer
    this.trainer = new WorkingMemoryTrainer(this.currentN, this.colors);

    // For compatibility with existing code
    this.history = { colors: [], positions: [], timestamps: [] };
    this.currentTile = null;
    this.allTrials = [];

    // Start session tracking
    this.sessionTracker.startSession();
  }

  generateNextTile() {
    this.currentTile = this.trainer.generateNextTrial();
    // NOTE: History is updated in game.js (before calling isActualMatch)
    // to ensure correct sequencing for match detection
    return this.currentTile;
  }

  // method to check if current tile is an actual match based on sequence
  // IMPORTANT: This should be called AFTER the current color is added to history
  isActualMatch() {
    if (!this.currentTile || this.history.colors.length === 0) return false;

    // The current color is at the end of history
    // Compare it with the color from N positions back
    // For n=2: compare history[length-1] with history[length-1-2] = history[length-3]
    const currentColor = this.history.colors[this.history.colors.length - 1];
    const nBackIndex = this.history.colors.length - 1 - this.currentN;

    return nBackIndex >= 0 && currentColor === this.history.colors[nBackIndex];
  }

  onUserResponse(userClicked, reactionTime) {
    if (!this.currentTile) {
      throw new Error('No current tile');
    }

    // check actual match based on sequence
    const actualWasMatch = this.isActualMatch();

    const result = this.trainer.recordResponse(userClicked, actualWasMatch, reactionTime);

    // Store trial for compatibility
    this.allTrials.push({
      n: this.currentN,
      timestamp: Date.now(),
      correct: result.correct,
      userClicked,
      wasMatch: actualWasMatch, // use actual match, not intended
      reactionTime,
      isValid: result.isValid,
      currentLoad: this.currentTile.currentLoad,
      targetLoad: this.currentTile.targetLoad
    });

    return result;
  }

  getCurrentN() {
    return this.currentN;
  }

  getStats() {
    const stats = this.trainer.getStats();
    const sessionStats = this.sessionTracker.getStats();

    return {
      currentN: this.currentN,
      accuracy: stats.recentAccuracy,
      confidence: stats.confidence,
      workingMemory: {
        currentLoad: stats.currentLoad,
        targetUniqueColors: stats.targetUniqueColors,
        maxUniqueColors: stats.maxUniqueColors,
        minUniqueColors: stats.minUniqueColors,
        performanceEMA: stats.performanceEMA,
        increasePressure: stats.increasePressure,
        decreasePressure: stats.decreasePressure,
        increaseThreshold: stats.increaseThreshold,
        decreaseThreshold: stats.decreaseThreshold,
        progressToMax: stats.targetUniqueColors / stats.maxUniqueColors
      },
      totalTrials: stats.totalTrials,
      driftDetector: stats.driftDetector,
      isRecovery: stats.isRecovery,
      session: sessionStats
    };
  }

  endSession() {
    this.sessionTracker.endSession();
  }

  reset() {
    this.history = { colors: [], positions: [], timestamps: [] };
    this.allTrials = [];
    this.currentTile = null;
    this.trainer.reset();
  }

  // Compatibility methods for localStorage
  toJSON() {
    return {
      currentN: this.currentN,
      history: this.history,
      allTrials: this.allTrials,
      trainerState: {
        trialNumber: this.trainer.trialNumber,
        currentUniqueColors: this.trainer.colorController.currentUniqueColors,
        accuracy: this.trainer.performanceTracker.accuracy
      }
    };
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AdaptiveNBackGame,
    WorkingMemoryTrainer,
    LowPassFilter,
    SessionTracker,
    CognitiveDriftDetector
  };
}
