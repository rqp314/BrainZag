/**
 * Author: BrainZag
 * Repository: https://github.com/rqp314/BrainZag
 * License: See LICENSE file
 * Copyright (c) 2026 BrainZag
 *
 * Core algorithms: unified cognitive adaptive engine using
 * Signal Detection Theory, Control Theory, Sequential Testing,
 * Flow Theory, and Entropy based load management.
 *
*/

// ============================================================================
// LOW-PASS FILTER (utility, used by main.js ReactionTimer)
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
// WORKING MEMORY STATE TRACKER
// ============================================================================

class WorkingMemoryState {
  constructor(n) {
    this.n = n;
    this.recentColors = [];
    this.currentLoad = 0;
  }

  addColor(color) {
    this.recentColors.push(color);

    if (this.recentColors.length > this.n + 1) {
      this.recentColors.shift();
    }

    this.currentLoad = new Set(this.recentColors).size;
  }

  getRecentColors() {
    return [...this.recentColors];
  }

  getCurrentLoad() {
    return this.currentLoad;
  }
}

// ============================================================================
// D-PRIME (signal detection sensitivity)
// ============================================================================

function computeDPrime(hitRate, faRate) {
  const cappedHitRate = Math.max(0.01, Math.min(0.99, hitRate));
  const cappedFaRate = Math.max(0.01, Math.min(0.99, faRate));

  function invNorm(p) {
    const a1 = -3.969683028665376e1;
    const a2 = 2.209460984245205e2;
    const a3 = -2.759285104469687e2;
    const a4 = 1.383577518672690e2;
    const a5 = -3.066479806614716e1;
    const a6 = 2.506628277459239e0;
    const b1 = -5.447609879822406e1;
    const b2 = 1.615858368580409e2;
    const b3 = -1.556989798598866e2;
    const b4 = 6.680131188771972e1;
    const b5 = -1.328068155288572e1;
    const c1 = -7.784894002430293e-3;
    const c2 = -3.223964580411365e-1;
    const c3 = -2.400758277161838e0;
    const c4 = -2.549732539343734e0;
    const c5 = 4.374664141464968e0;
    const c6 = 2.938163982698783e0;
    const d1 = 7.784695709041462e-3;
    const d2 = 3.224671290700398e-1;
    const d3 = 2.445134137142996e0;
    const d4 = 3.754408661907416e0;
    const pLow = 0.02425;
    const pHigh = 1 - pLow;

    let q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
    }
  }

  return invNorm(cappedHitRate) - invNorm(cappedFaRate);
}

// ============================================================================
// ABILITY MODEL (rolling Bayesian d' as master ability signal)
// ============================================================================

class AbilityModel {
  constructor() {
    // Rolling window of recent trial outcomes for d' computation.
    // Using a window instead of cumulative counts ensures theta responds
    // to recent performance, not ancient history from 40 trials ago.
    this.trialWindow = [];
    this.windowSize = 30;       // Last 30 trials for d' computation

    // Rolling d' (theta) with EMA smoothing
    this.theta = 1.5;           // Start at moderate ability
    this.thetaAlpha = 0.15;     // EMA smoothing for theta
    this.thetaWindow = [];      // Last 20 theta values for trend
    this.thetaWindowSize = 20;

    // Reaction time tracking
    this.rtWindow = [];
    this.rtWindowSize = 20;

    // Total trial count (cumulative, not windowed)
    this.totalTrials = 0;
  }

  recordTrial(wasMatch, userClicked, reactionTime) {
    this.totalTrials++;

    // Store trial outcome in rolling window
    this.trialWindow.push({ wasMatch, userClicked });
    if (this.trialWindow.length > this.windowSize) {
      this.trialWindow.shift();
    }

    // Compute d' from the rolling window using pseudo counts
    let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
    for (const t of this.trialWindow) {
      if (t.wasMatch && t.userClicked) hits++;
      else if (t.wasMatch && !t.userClicked) misses++;
      else if (!t.wasMatch && t.userClicked) falseAlarms++;
      else correctRejections++;
    }

    const targets = hits + misses;
    const nonTargets = falseAlarms + correctRejections;
    const hitRate = (hits + 0.5) / (targets + 1);
    const faRate = (falseAlarms + 0.5) / (nonTargets + 1);
    const rawDPrime = computeDPrime(hitRate, faRate);

    // EMA smooth the theta
    this.theta = this.theta * (1 - this.thetaAlpha) + rawDPrime * this.thetaAlpha;

    // Store theta history for trend analysis
    this.thetaWindow.push(this.theta);
    if (this.thetaWindow.length > this.thetaWindowSize) {
      this.thetaWindow.shift();
    }

    // Store RT
    if (reactionTime > 0) {
      this.rtWindow.push(reactionTime);
      if (this.rtWindow.length > this.rtWindowSize * 2) { // TODO why do we do *2 here ?
        this.rtWindow.shift();
      }
    }
  }

  // Slope of theta over recent history (positive = improving)
  getThetaTrend() {
    const h = this.thetaWindow;
    if (h.length < 5) return 0;

    // Simple linear regression slope
    const n = h.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += h[i];
      sumXY += i * h[i];
      sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0;
    return (n * sumXY - sumX * sumY) / denom;
  }

  // RT statistics
  getRTStats() {
    const rts = this.rtWindow.slice(-this.rtWindowSize);
    if (rts.length < 3) {
      return { median: 800, p90: 1200, cv: 0.2 };
    }

    const sorted = [...rts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];

    const mean = rts.reduce((a, b) => a + b, 0) / rts.length;
    const variance = rts.reduce((s, rt) => s + (rt - mean) ** 2, 0) / rts.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    return { median, p90, cv };
  }

  // Fatigue composite: RT tail growth + RT variability + negative theta trend
  // Calibrated so normal human RT variability (CV 0.25-0.35, tail ratio 1.3-1.5)
  // reads near 0%. Only genuine fatigue signals (CV > 0.4, tail > 1.7) register.
  getFatigueIndex() {
    const rt = this.getRTStats();
    const trend = this.getThetaTrend();

    // RT tail ratio: normal range is 1.2-1.5, fatigue starts at 1.6+
    const tailRatio = rt.median > 0 ? rt.p90 / rt.median : 1.0;
    const tailComponent = Math.max(0, (tailRatio - 1.6) / 0.6); // 0 at 1.6, 1.0 at 2.2

    // CV component: normal human CV is 0.2-0.35, fatigue starts at 0.4+
    const cvComponent = Math.max(0, (rt.cv - 0.4) / 0.3); // 0 at 0.4, 1.0 at 0.7

    // Trend component: negative trend = fatigued
    const trendComponent = Math.max(0, -trend * 10);

    return Math.min(1.0, (tailComponent + cvComponent + trendComponent) / 3);
  }

  // Flow score: good ability + low variability + positive trend.
  // Mastery at steady state: low-mid 70s (small positive trend pushes into 80s).
  // Strong improvement phase: 90s+. Perfect across all axes: 100%.
  // Note: while improving your flow score will be higher compared to sustaining perfect score
  getFlowScore() {
    const rt = this.getRTStats();
    const trend = this.getThetaTrend();

    // Normalize theta: 0 at theta=0, 1.0 at theta=2.5
    const normalizedTheta = Math.max(0, Math.min(1, this.theta / 2.5));

    // CV bonus: no penalty until CV=0.15 (normal human noise floor).
    // Then linear to 0 at CV=0.60. CV=0.25 earns 0.78, CV=0.35 earns 0.56.
    const cvBonus = Math.max(0, Math.min(1, 1 - Math.max(0, rt.cv - 0.15) / 0.45));

    // Trend bonus normalized to [0,1]: saturates at slope 0.05/trial.
    const trendBonus = Math.max(0, Math.min(1, trend * 20));

    // Weights: theta 55%, CV 25%, trend 20%
    return Math.min(1.0, normalizedTheta * 0.55 + cvBonus * 0.25 + trendBonus * 0.20);
  }

  // Map theta to 0..1 for backward compatibility with performanceEMA display
  getNormalizedPerformance() {
    // theta 0 maps to ~0.3, theta 1.8 maps to ~0.75, theta 3.5 maps to ~1.0
    return Math.max(0, Math.min(1, 0.3 + this.theta * 0.2));
  }

  // Get current SDT counts from the rolling window
  getSDTCounts() {
    let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
    for (const t of this.trialWindow) {
      if (t.wasMatch && t.userClicked) hits++;
      else if (t.wasMatch && !t.userClicked) misses++;
      else if (!t.wasMatch && t.userClicked) falseAlarms++;
      else correctRejections++;
    }
    return { hits, misses, falseAlarms, correctRejections };
  }

  getStats() {
    const rt = this.getRTStats();
    const sdt = this.getSDTCounts();
    return {
      theta: this.theta,
      thetaTrend: this.getThetaTrend(),
      flowScore: this.getFlowScore(),
      fatigueIndex: this.getFatigueIndex(),
      rtMedian: rt.median,
      rtP90: rt.p90,
      rtCV: rt.cv,
      totalTrials: this.totalTrials,
      hits: sdt.hits,
      misses: sdt.misses,
      falseAlarms: sdt.falseAlarms,
      correctRejections: sdt.correctRejections
    };
  }

  reset() {
    this.trialWindow = [];
    this.theta = 1.5;
    this.thetaWindow = [];
    this.rtWindow = [];
    this.totalTrials = 0;
  }
}

// ============================================================================
// DIFFICULTY CONTROLLER (PI controller targeting ideal engagement zone)
// ============================================================================

class DifficultyController {
  constructor(n) {
    this.n = n;

    // PI controller state
    this.targetTheta = 1.8;     // Ideal engagement zone
    this.Kp = 0.3;              // Proportional gain
    this.Ki = 0.05;             // Integral gain
    this.integral = 0;
    this.integralMax = 3.0;     // Anti windup clamp

    // Output variables
    // Start at 0 = minimum load (2 unique colors). Player must earn higher load.
    this.targetEntropy = 0.0;
    this.matchRate = 0.30;      // Dynamic match rate
    this.stimulusInterval = 1.0; // Speed multiplier (1.0 = normal)

    // TEMPORAL STRUCTURE ENTROPY (TSE)
    // Controls transition unpredictability independent of unique color count.
    // Low TSE = long runs of same color, predictable switching rhythm.
    // High TSE = frequent switching, near random transitions.
    // Starts at 0 after N increase so the player can stabilize the
    // expanded sliding buffer before facing transition chaos.
    // At low TSE the repeat bias naturally produces runs of ~N length
    // because the n back constraint forces a switch once the buffer
    // catches up to the run color.
    this.tse = 0.0;
    this.tseClimbRate = 0.06;   // Same base rate as entropy climb
    this.tseDropRate = 0.12;    // 2x faster to drop (same asymmetry)

    // Unique colors (derived from entropy)
    this.minUniqueColors = 2;
    this.maxUniqueColors = n + 1;
    this.currentUniqueColors = 2;

    // N-adaptive step hold: scale with the color range so higher N
    // levels dont require unreachable trial counts to progress.
    // N=2: range=1, hold=6 increase / 3 decrease
    // N=3: range=2, hold=3 increase / 2 decrease
    // N=8: range=7, hold=2 increase / 1 decrease
    const colorRange = this.maxUniqueColors - this.minUniqueColors;
    this.stepHoldIncrease = Math.max(2, Math.round(6 / colorRange));
    this.stepHoldDecrease = Math.max(1, Math.round(3 / colorRange));
    this.stepHoldCounter = 0;
    this.pendingUniqueColors = 2;

    // N-adaptive entropy climb rate: higher N means larger range to traverse,
    // so the per trial delta needs to be proportionally larger.
    // Floor of 0.06 ensures N=2 (range=1) can still reach max in 40 trials.
    // N=2: range=1, climbRate=0.06, dropRate=0.12
    // N=3: range=2, climbRate=0.06, dropRate=0.12
    // N=4: range=3, climbRate=0.075, dropRate=0.15
    // N=8: range=7, climbRate=0.12, dropRate=0.24
    this.entropyClimbRate = Math.min(0.12, Math.max(0.06, 0.03 + 0.015 * colorRange));
    this.entropyDropRate = this.entropyClimbRate * 2; // Always 2x faster to drop
    // No LPF on entropy. The step hold counter is the sole gate preventing
    // jumpy color count changes. Direct accumulation ensures a flawless player
    // can traverse the full color range within a 40 trial round.
  }

  update(abilityModel) {
    const theta = abilityModel.theta;
    const trend = abilityModel.getThetaTrend();
    const fatigue = abilityModel.getFatigueIndex();
    const flow = abilityModel.getFlowScore();

    // PI controller: positive error = player below target, negative = above target
    const error = this.targetTheta - theta;
    this.integral += error;
    this.integral = Math.max(-this.integralMax, Math.min(this.integralMax, this.integral));

    let adjustment = this.Kp * error + this.Ki * this.integral;

    // Flow boost: when performing well and improving, push slightly harder
    if (theta > 1.6 && trend > 0.005) {
      adjustment -= 0.1; // Negative adjustment = increase difficulty
    }

    // Recovery: when theta trending down and fatigue rising, ease off
    if (trend < -0.01 && fatigue > 0.5) {
      adjustment += 0.15; // Positive adjustment = decrease difficulty
    }

    // Map adjustment to entropy delta
    // Positive adjustment (struggling) = decrease entropy, negative (excelling) = increase
    // Asymmetric: increasing is slower than decreasing (harder to earn, easier to lose)
    let entropyDelta;
    if (adjustment < 0) {
      entropyDelta = -adjustment * this.entropyClimbRate;
    } else {
      entropyDelta = -adjustment * this.entropyDropRate;
    }

    this.targetEntropy = Math.max(0, Math.min(1, this.targetEntropy + entropyDelta));

    // ── KNOB 1: UNIQUE COLORS ──────────────────────────────────────────
    // Primary difficulty lever. Controls how many distinct colors appear
    // in the players attention window (n+1). More unique colors = harder
    // to discriminate matches from noise.
    // Entropy (0..1) maps linearly to the color range [min..max].
    // Step hold gate prevents flickering: the candidate must sustain for
    // several consecutive trials before the actual color count commits.
    // Asymmetric: harder to earn (holdIncrease) than to lose (holdDecrease).
    const range = this.maxUniqueColors - this.minUniqueColors;
    const targetFloat = this.minUniqueColors + this.targetEntropy * range;
    const candidateColors = Math.round(Math.max(this.minUniqueColors, Math.min(this.maxUniqueColors, targetFloat)));

    if (candidateColors !== this.currentUniqueColors) {
      if (candidateColors === this.pendingUniqueColors) {
        this.stepHoldCounter++;
      } else {
        this.pendingUniqueColors = candidateColors;
        this.stepHoldCounter = 1;
      }

      const requiredHold = candidateColors > this.currentUniqueColors
        ? this.stepHoldIncrease
        : this.stepHoldDecrease;

      if (this.stepHoldCounter >= requiredHold) {
        // Gate K (unique color count) increases: TSE must be >= 0.5 before allowing more
        // unique colors. Ensures temporal structure is stabilized before
        // adding discrimination load. K decreases are never gated.
        if (candidateColors > this.currentUniqueColors && this.tse < 0.5) {
          // TSE too low, hold K until transitions stabilize
        } else {
          this.currentUniqueColors = candidateColors;
          this.stepHoldCounter = 0;
        }
      }
    } else {
      this.stepHoldCounter = 0;
    }

    // ── KNOB 2: MATCH RATE ───────────────────────────────────────────
    // Controls how often n-back matches appear. More matches = easier
    // (detecting a match is simpler than correctly inhibiting a non match).
    // Struggling players get more matches (up to 40%) for more winnable
    // trials. Strong players get fewer (down to 25%) forcing more
    // correct rejection demands, which is the harder cognitive skill.
    const matchAdj = Math.max(-0.05, Math.min(0.10, adjustment * 0.05));
    this.matchRate = Math.max(0.25, Math.min(0.40, 0.30 + matchAdj));

    // ── KNOB 3: STIMULUS INTERVAL (speed) ────────────────────────────
    // Multiplier on display timing. < 1.0 = faster, > 1.0 = slower.
    // In flow (high flow, low fatigue): speed up slightly to maintain
    // engagement and prevent boredom. Under fatigue: slow down to give
    // the player more processing time and reduce overwhelm.
    if (flow > 0.6 && fatigue < 0.3) {
      this.stimulusInterval = 0.95;
    } else if (fatigue > 0.6) {
      this.stimulusInterval = 1.05;
    } else {
      this.stimulusInterval = 1.0;
    }

    // ── KNOB 4: TEMPORAL STRUCTURE ENTROPY (TSE) ─────────────────────
    // Controls transition unpredictability. Increases when player excels,
    // decreases when struggling. Leads K (unique color count) progression:
    // TSE must reach 0.5 before K can increase, ensuring temporal stability before adding
    // discrimination load. Uses the same PI adjustment signal as the other knobs.
    let tseDelta;
    if (adjustment < 0) {
      // Player excelling: increase TSE (more transition chaos)
      tseDelta = -adjustment * this.tseClimbRate;
    } else {
      // Player struggling: decrease TSE (more predictable transitions)
      tseDelta = -adjustment * this.tseDropRate;
    }
    this.tse = Math.max(0, Math.min(1, this.tse + tseDelta));
  }

  getTargetUniqueColors() {
    return this.currentUniqueColors;
  }

  getCurrentUniqueColors() {
    return this.currentUniqueColors;
  }

  getMaxUniqueColors() {
    return this.maxUniqueColors;
  }

  getMatchRate() {
    return this.matchRate;
  }

  // Called when SPRT stops a session for poor performance.
  // Aggressively reduces difficulty so the next round starts easier.
  onSessionStopped() {
    // Drop entropy by half (fast difficulty reduction)
    this.targetEntropy = Math.max(0, this.targetEntropy * 0.5);

    // Drop unique colors by 1 immediately (bypass step hold)
    if (this.currentUniqueColors > this.minUniqueColors) {
      this.currentUniqueColors--;
    }

    // Reset PI integral so accumulated "push harder" pressure is cleared
    this.integral = 0;
    this.stepHoldCounter = 0;

    // Ease match rate toward easier
    this.matchRate = Math.min(0.40, this.matchRate + 0.05);

    // Drop TSE aggressively (predictable transitions for recovery)
    this.tse = Math.max(0, this.tse * 0.3);
  }

  getStats() {
    return {
      currentUniqueColors: this.currentUniqueColors,
      maxUniqueColors: this.maxUniqueColors,
      minUniqueColors: this.minUniqueColors,
      targetEntropy: this.targetEntropy,
      tse: this.tse,
      matchRate: this.matchRate,
      stimulusInterval: this.stimulusInterval,
      piError: this.targetTheta - (this.integral / Math.max(1, Math.abs(this.integral)) * this.Ki),
      piIntegral: this.integral
    };
  }
}

// ============================================================================
// SPRT STOPPER (Sequential Probability Ratio Test for session stopping)
// ============================================================================

class SPRTStopper {
  constructor() {
    // Hypotheses about theta
    this.theta0 = 1.5;         // H0: acceptable performance
    this.theta1 = 0.8;         // H1: poor performance
    this.logLR = 0;            // Cumulative log likelihood ratio

    // Decision boundaries (from alpha=0.05, beta=0.10)
    // logLR accumulates log(P(data|H1) / P(data|H0))
    // Positive logLR = evidence for H1 (poor), negative = evidence for H0 (good)
    this.stopBound = Math.log((1 - 0.10) / 0.05);   // ~2.89, accept H1 (poor, stop session)
    this.acceptBound = Math.log(0.10 / (1 - 0.05));  // ~-2.25, accept H0 (performing OK)

    this.decision = 'continue'; // 'continue', 'stop'
    this.trialsRecorded = 0;
  }

  recordTrial(correct, wasMatch) {
    this.trialsRecorded++;

    // Likelihood of this outcome under H0 (theta=1.5) vs H1 (theta=0.8)
    // For targets: P(hit|theta) approximated from d' model
    // For non targets: P(correct rejection|theta)
    // Using simplified logistic mapping from theta to accuracy
    const p0 = this.thetaToAccuracy(this.theta0, wasMatch);
    const p1 = this.thetaToAccuracy(this.theta1, wasMatch);

    const pObserved0 = correct ? p0 : (1 - p0);
    const pObserved1 = correct ? p1 : (1 - p1);

    // Accumulate log likelihood ratio (H1 vs H0)
    // Correct trials push logLR negative (toward H0), errors push positive (toward H1)
    if (pObserved0 > 0 && pObserved1 > 0) {
      this.logLR += Math.log(pObserved1 / pObserved0);
    }

    // Check boundaries
    if (this.logLR >= this.stopBound) {
      this.decision = 'stop';     // Strong evidence for H1: poor performance, stop session
    } else if (this.logLR <= this.acceptBound) {
      this.decision = 'continue'; // Strong evidence for H0: performing OK, reset and keep monitoring
      this.logLR = 0;
    }

    return this.decision;
  }

  // Map theta (d') to expected accuracy for a trial type
  thetaToAccuracy(theta, isTarget) {
    // For targets: hit rate increases with theta
    // For non targets: correct rejection rate increases with theta
    // Using logistic approximation: accuracy = 1 / (1 + exp(-(theta-offset)*scale))
    if (isTarget) {
      return 1 / (1 + Math.exp(-(theta - 0.5) * 1.5));
    } else {
      return 1 / (1 + Math.exp(-(theta - 0.2) * 1.5));
    }
  }

  shouldStop() {
    // Need minimum trials before allowing stop
    if (this.trialsRecorded < 8) return false;
    return this.decision === 'stop';
  }

  getStatus() {
    return {
      logLR: this.logLR,
      stopBound: this.stopBound,
      acceptBound: this.acceptBound,
      decision: this.decision,
      trialsRecorded: this.trialsRecorded
    };
  }

  reset() {
    this.logLR = 0;
    this.decision = 'continue';
    this.trialsRecorded = 0;
  }
}

// ============================================================================
// COLOR SEQUENCE GENERATOR (with rank based weighting)
// ============================================================================

class ColorSequenceGenerator {
  constructor(n, availableColors) {
    this.n = n;
    this.availableColors = availableColors;
    this.memoryState = new WorkingMemoryState(n);
    this.activeSet = null;
    this.swapProbability = 0.7;
  }

  // Compute Shannon entropy of the current memory window (for stats/monitoring)
  computeEntropy(window) {
    if (!window || window.length === 0) return 0;
    const counts = {};
    for (const c of window) {
      counts[c] = (counts[c] || 0) + 1;
    }
    let entropy = 0;
    const n = window.length;
    for (const c in counts) {
      const p = counts[c] / n;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  isValidMatchColor(currentWindow, candidate, target) {
    // A match drops the oldest color and re-adds the n-back color.
    // Only one color is ever removed so unique count can only stay the same (= target)
    // or drop by exactly 1 (= target-1). target-2 or lower is impossible.
    // NEVER allow target+1: matches cannot introduce a new color.
    const windowSize = this.n + 1;
    const simulated = [...currentWindow, candidate].slice(-windowSize);
    const uniqueCount = new Set(simulated).size;
    return uniqueCount <= target;
  }

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

  generateNextColor(targetUniqueColors, shouldMatch, nBackColor, isForced = false, tse = 1.0) {
    const currentWindow = this.memoryState.recentColors;

    // Ensure target is at least 2
    const target = Math.max(2, targetUniqueColors);

    // Reset active set if target changed
    if (this.lastTarget !== undefined && this.lastTarget !== target) {
      this.activeSet = null;
    }
    this.lastTarget = target;

    // If this is a match trial, validate the N-back color maintains constraint
    if (shouldMatch && nBackColor) {
      if (isForced) {
        // Hard guarantee: always return the n-back color.
        // Matches only reduce or maintain unique count so no constraint is violated.
        return nBackColor;
      } else {
        // Normal match: only return n-back color if constraint is satisfied.
        // Falls through to non-match generation if validation fails.
        if (this.isValidMatchColor(currentWindow, nBackColor, target)) {
          return nBackColor;
        }
      }
    }

    // When NOT creating a match, exclude the n-back color to avoid accidental matches
    const excludeColor = !shouldMatch ? nBackColor : null;

    // ── TSE REPEAT BIAS ──────────────────────────────────────────────
    // Low TSE biases toward repeating the previous color, creating longer
    // runs and more predictable transitions. At TSE=1.0 this never fires
    // (pure random, current behavior). Max repeat bias = 1 - 1/(N+1) so
    // mean run targets the full window width. The n back constraint hard
    // caps runs at N (n back catches up), giving two cooperating forces:
    // probability aims to fill the window, n back trims at the right point.
    // N=2: p=0.67 mean=3. N=4: p=0.80 mean=5. N=7: p=0.875 mean=8.
    if (tse < 1.0 && currentWindow.length > 0) {
      const lastColor = currentWindow[currentWindow.length - 1];
      if (lastColor && lastColor !== excludeColor) {
        const repeatProb = (1 - 1 / (this.n + 1)) * (1 - tse);
        if (Math.random() < repeatProb && this.isValidNextColor(currentWindow, lastColor, target)) {
          return lastColor;
        }
      }
    }

    // ALGORITHM: Three cases based on targetUniqueColors (K)
    // Case 1: K = 2 (minimum) - keep patterns simple, repeat existing
    // Case 2: K = n+1 (maximum) - force all different colors
    // Case 3: K = in between - maintain active set of K colors

    let next;
    if (target === 2) { // Case 1: K = 2 (minimum load)
      next = this.generateForMinLoad(currentWindow, excludeColor, target);
    } else if (target === this.n + 1) { // Case 2: K = n+1 (maximum load)
      next = this.generateForMaxLoad(currentWindow, excludeColor, target);
    } else { // Case 3: K = in between (use active set)
      next = this.generateForMidLoad(currentWindow, excludeColor, target);
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

  generateForMidLoad(currentWindow, excludeColor, target) {
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
// Accepts dynamic target rate from DifficultyController
// ============================================================================

class MatchGenerator {
  constructor(targetMatchRate = 0.30) {
    this.targetRate = targetMatchRate;

    this.recentMatches = [];
    this.windowSize = 20;

    this.trialsSinceLastMatch = 0;
    this.maxGap = Math.round(1 / targetMatchRate) * 2;
  }

  // Allow DifficultyController to update the target rate dynamically
  setTargetRate(rate) {
    this.targetRate = Math.max(0.20, Math.min(0.45, rate));
    this.maxGap = Math.round(1 / this.targetRate) * 2;
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
// MAIN WORKING MEMORY TRAINER
// ============================================================================

class WorkingMemoryTrainer {
  constructor(n, colors) {
    this.n = n;
    this.colors = colors;

    // New unified components
    this.abilityModel = new AbilityModel();
    this.difficultyController = new DifficultyController(n);
    this.sprtStopper = new SPRTStopper();

    // Preserved components
    this.colorGenerator = new ColorSequenceGenerator(n, colors);
    this.matchGenerator = new MatchGenerator(0.30);

    this.trialNumber = 0;
    this.currentTile = null;
    this.lastTrialCorrect = true;
    this.excludedPositions = []; // positions to exclude from tile placement
  }

  setExcludedPositions(positions) {
    this.excludedPositions = positions || [];
  }

  generateNextTrial() {
    // 1. Update match generator with dynamic rate from controller
    this.matchGenerator.setTargetRate(this.difficultyController.getMatchRate());

    // 2. Get target number of unique colors from controller
    const targetUniqueColors = this.difficultyController.getTargetUniqueColors();

    // 3. Decide if this should be a match
    const memoryState = this.colorGenerator.getMemoryState();
    const matchDecision = this.matchGenerator.shouldCreateMatch(memoryState);
    const shouldMatch = matchDecision.shouldMatch;
    const isForced = matchDecision.isForced;

    // 4. Get the n-back color
    const nBackColor = this.matchGenerator.getNBackColor(memoryState);

    // 5. Generate appropriate color (pass TSE for transition structure control)
    let color = this.colorGenerator.generateNextColor(
      targetUniqueColors, shouldMatch, nBackColor, isForced,
      this.difficultyController.tse
    );

    // 6. Update memory state
    this.colorGenerator.updateMemoryState(color);

    // 7. Determine if this is actually a match
    const actuallyIsMatch = nBackColor && color === nBackColor;

    // 8. Register the actual match result
    this.matchGenerator.registerActualMatch(actuallyIsMatch);

    // 9. Create tile
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

      // Update AbilityModel first (single source of truth)
      this.abilityModel.recordTrial(wasMatch, userClicked, reactionTime);

      // DifficultyController reads from AbilityModel
      this.difficultyController.update(this.abilityModel);

      // SPRT stopper tracks trial outcomes
      this.sprtStopper.recordTrial(correct, wasMatch);
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
    // Simple random position on 3x3 grid, excluding deactivated cells
    const positions = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const isExcluded = this.excludedPositions.some(
          excluded => excluded.row === row && excluded.col === col
        );
        if (!isExcluded) {
          positions.push({ row, col });
        }
      }
    }
    return positions[Math.floor(Math.random() * positions.length)];
  }

  getStats() {
    const ability = this.abilityModel.getStats();
    const difficulty = this.difficultyController.getStats();
    const memoryState = this.colorGenerator.getMemoryState();
    const sprt = this.sprtStopper.getStatus();

    // Compute current window entropy
    const windowEntropy = this.colorGenerator.computeEntropy(memoryState.getRecentColors());

    return {
      n: this.n,
      trialNumber: this.trialNumber,
      currentLoad: memoryState.getCurrentLoad(),

      // New unified metrics
      theta: ability.theta,
      thetaTrend: ability.thetaTrend,
      flowScore: ability.flowScore,
      fatigueIndex: ability.fatigueIndex,
      targetEntropy: difficulty.targetEntropy,
      tse: difficulty.tse,
      windowEntropy: windowEntropy,
      matchRate: difficulty.matchRate,
      stimulusInterval: difficulty.stimulusInterval,
      sprtStatus: sprt,

      // Ability detail
      rtMedian: ability.rtMedian,
      rtCV: ability.rtCV,
      hits: ability.hits,
      misses: ability.misses,
      falseAlarms: ability.falseAlarms,
      correctRejections: ability.correctRejections,

      targetUniqueColors: difficulty.currentUniqueColors,
      maxUniqueColors: difficulty.maxUniqueColors,
      minUniqueColors: difficulty.minUniqueColors,
      performanceEMA: this.abilityModel.getNormalizedPerformance(), // TODO weird, all not needed ?
      accuracy: this.abilityModel.getNormalizedPerformance(),
      recentAccuracy: this.abilityModel.getNormalizedPerformance(),
      totalTrials: ability.totalTrials,
      confidence: this.abilityModel.getFlowScore(),
      isRecovery: this.abilityModel.getFatigueIndex() > 0.6,

      // PI controller state (replaces pressure counters)
      piError: difficulty.piError,
      piIntegral: difficulty.piIntegral
    };
  }

  reset() {
    this.trialNumber = 0;
    this.currentTile = null;
    this.colorGenerator = new ColorSequenceGenerator(this.n, this.colors);
    this.matchGenerator = new MatchGenerator(0.30);
    this.abilityModel.reset();
    this.difficultyController = new DifficultyController(this.n);
    this.sprtStopper.reset();
  }

  // Apply persisted profile data after a fresh reset.
  // strategic is always applied (skill level, difficulty calibration).
  // recency is only passed when the profile is fresh (<10min old);
  // null means the player was away and rolling windows stay empty.
  warmStart(strategic, recency) {
    const ab = this.abilityModel;
    const dc = this.difficultyController;

    if (strategic) {
      if (strategic.theta !== undefined) ab.theta = strategic.theta;
      if (strategic.totalTrials !== undefined) ab.totalTrials = strategic.totalTrials;
      if (strategic.targetEntropy !== undefined) dc.targetEntropy = strategic.targetEntropy;
      if (strategic.tse !== undefined) dc.tse = strategic.tse;
      if (strategic.currentUniqueColors !== undefined) dc.currentUniqueColors = strategic.currentUniqueColors;
      if (strategic.integral !== undefined) dc.integral = strategic.integral;
      if (strategic.matchRate !== undefined) dc.matchRate = strategic.matchRate;
    }

    if (recency) {
      if (Array.isArray(recency.trialWindow)) ab.trialWindow = recency.trialWindow.slice();
      if (Array.isArray(recency.thetaWindow)) ab.thetaWindow = recency.thetaWindow.slice();
      if (Array.isArray(recency.rtWindow)) ab.rtWindow = recency.rtWindow.slice();
      if (recency.stepHoldCounter !== undefined) dc.stepHoldCounter = recency.stepHoldCounter;
      if (recency.pendingUniqueColors !== undefined) dc.pendingUniqueColors = recency.pendingUniqueColors;
    }
  }

  getCurrentN() {
    return this.n;
  }
}

// ============================================================================
// N-BACK ENGINE (facade)
// ============================================================================

class NBackEngine {
  constructor(options = {}) {
    this.currentN = options.startN || 2;
    this.colors = options.colors || [];
    this.trainer = new WorkingMemoryTrainer(this.currentN, this.colors);
    this.currentTile = null;
  }

  generateNextTile() {
    this.currentTile = this.trainer.generateNextTrial();
    return this.currentTile;
  }

  onUserResponse(userClicked, wasMatch, reactionTime) {
    if (!this.currentTile) {
      throw new Error('No current tile');
    }

    const result = this.trainer.recordResponse(userClicked, wasMatch, reactionTime);
    return result;
  }

  getCurrentN() {
    return this.currentN;
  }

  setExcludedPositions(positions) {
    this.trainer.setExcludedPositions(positions);
  }

  // Cleanup helper when a session is stopped for poor performance.
  // Resets SPRT and eases difficulty so the next round starts gentler.
  onPoorPerformanceStop() {
    this.trainer.difficultyController.onSessionStopped();
    this.trainer.sprtStopper.reset();
  }

  // Check if SPRT says we should stop the session.
  // When it fires, also penalize the difficulty controller so the next
  // round starts easier instead of staying at the old high difficulty.
  shouldStopSession() {
    if (!this.trainer.sprtStopper.shouldStop()) return false;

    this.onPoorPerformanceStop();
    return true;
  }

  // Fallback if SPRT based session stop didnt fire.
  // Checks if recent trials show too many errors (50%+ error rate).
  shouldStopForErrors(recentTrials, errorThreshold = 5) {
    const respondedTrials = recentTrials.filter(t => t.wasMatch !== null);
    if (respondedTrials.length < recentTrials.length - 1) return false;

    const errors = respondedTrials.filter(t => {
      const isFalsePositive = t.userClicked && !t.wasMatch;
      const isMissedTarget = !t.userClicked && t.wasMatch;
      return isFalsePositive || isMissedTarget;
    }).length;

    if (errors >= errorThreshold) {
      this.onPoorPerformanceStop();
      return true;
    }

    return false;
  }

  getStats() {
    const stats = this.trainer.getStats();

    return {
      currentN: this.currentN,
      accuracy: stats.accuracy,
      confidence: stats.confidence,

      // New metrics
      theta: stats.theta,
      thetaTrend: stats.thetaTrend,
      flowScore: stats.flowScore,
      fatigueIndex: stats.fatigueIndex,
      targetEntropy: stats.targetEntropy,
      windowEntropy: stats.windowEntropy,
      matchRate: stats.matchRate,
      stimulusInterval: stats.stimulusInterval,
      tse: stats.tse,
      sprtStatus: stats.sprtStatus,

      // Ability detail
      rtMedian: stats.rtMedian,
      rtCV: stats.rtCV,

      workingMemory: {
        currentLoad: stats.currentLoad,
        targetUniqueColors: stats.targetUniqueColors,
        maxUniqueColors: stats.maxUniqueColors,
        minUniqueColors: stats.minUniqueColors,
        performanceEMA: stats.performanceEMA,
        progressToMax: stats.targetUniqueColors / stats.maxUniqueColors,
        // PI controller state replaces pressure counters
        piError: stats.piError,
        piIntegral: stats.piIntegral
      },
      totalTrials: stats.totalTrials,
      isRecovery: stats.isRecovery
    };
  }

  reset() {
    this.currentTile = null;
    this.trainer.reset();
  }

  warmStart(strategic, recency) {
    this.currentTile = null;
    this.trainer.warmStart(strategic, recency);
  }

  toJSON() {
    const ab = this.trainer.abilityModel;
    const dc = this.trainer.difficultyController;
    return {
      currentN: this.currentN,
      savedAt: Date.now(),
      strategic: {
        theta: ab.theta,
        targetEntropy: dc.targetEntropy,
        tse: dc.tse,
        currentUniqueColors: dc.currentUniqueColors,
        integral: dc.integral,
        matchRate: dc.matchRate,
        totalTrials: ab.totalTrials
      },
      recency: {
        trialWindow: ab.trialWindow.slice(),
        thetaWindow: ab.thetaWindow.slice(),
        rtWindow: ab.rtWindow.slice(),
        stepHoldCounter: dc.stepHoldCounter,
        pendingUniqueColors: dc.pendingUniqueColors
      }
    };
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NBackEngine,
    WorkingMemoryTrainer,
    LowPassFilter,
    AbilityModel,
    DifficultyController,
    SPRTStopper,
    computeDPrime
  };
}
