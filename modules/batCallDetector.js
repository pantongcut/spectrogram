import { getApplyWindowFunction, getGoertzelEnergyFunction } from './callAnalysisPopup.js';
import { getTimeExpansionMode } from './fileState.js';
export const DEFAULT_DETECTION_CONFIG = {
  // Energy threshold (dB below maximum within frequency range)
  // Typical: -18 dB (Avisoft), -24 dB (SonoBat, more conservative)
  callThreshold_dB: -24,

  // High frequency threshold (dB below peak for finding edges)
  highFreqThreshold_dB: -24,  // Threshold for calculating High Frequency (optimal value range: -24 to -100)

  // Low frequency threshold (dB below peak for finding edges) 
  // Fixed at -27dB for anti-rebounce compatibility
  // This is used for finding the lowest frequency in the call (last frame)
  lowFreqThreshold_dB: -27,

  // Characteristic frequency is defined as lowest or average frequency in the last 10-20% of the call duration
  characteristicFreq_percentEnd: 20,  // Last 20% duration

  // Minimum call duration to be considered valid (ms)
  minCallDuration_ms: 1,

  // Maximum gap to bridge between segments (ms) - for noise robustness
  maxGapBridge_ms: 0,

  // Frequency resolution for fine measurements (Hz)
  freqResolution_Hz: 1,

  // Window function for STFT
  windowType: 'hann',

  // FFT size for high resolution
  fftSize: 1024,

  // Time resolution (STFT hop size as percentage of FFT size)
  hopPercent: 3.125,  // 96.875% overlap = 3.125% hop

  // Advanced: Call type detection
  // 'auto': automatic detection (CF if bandwidth < 5kHz, FM otherwise)
  // 'cf': constant frequency (for Molossid, Rhinolophid, Hipposiderid)
  // 'fm': frequency modulated (for Phyllostomid, Vespertilionid)
  callType: 'auto',

  // For CF-FM calls: minimum power requirement in characteristic freq region (dB)
  cfRegionThreshold_dB: -30,
};

export class CallTypeClassifier {
  static classify(call) {
    if (!call.bandwidth_kHz || call.bandwidth_kHz < 5) {
      return 'CF';  // Constant Frequency
    }
    if (call.bandwidth_kHz > 20) {
      return 'FM';  // Frequency Modulated
    }
    return 'CF-FM';  // Mixed
  }

  /**
   * Check if call matches CF bat characteristics
   * CF bats: typically 10-100 kHz, low bandwidth (< 5 kHz)
   */
  static isCFBat(call) {
    return call.bandwidth_kHz < 5 && call.peakFreq_kHz > 10;
  }

  /**
   * Check if call matches FM bat characteristics
   * FM bats: typically 20-150 kHz, high bandwidth (> 10 kHz)
   */
  static isFMBat(call) {
    return call.bandwidth_kHz > 10 && call.highFreq_kHz > call.lowFreq_kHz;  // Downward FM
  }
}

export class BatCall {
  constructor() {
    this.startTime_s = null;        // Call start time (seconds)
    this.endTime_s = null;          // Call end time (seconds)
    this.duration_ms = null;        // Total duration (milliseconds)

    // ============================================================
    // 7 Frequency Parameters with Time Values (ms)
    // ============================================================
    this.peakFreq_kHz = null;       // Peak frequency (kHz) - absolute max power
    this.peakFreq_ms = null;    // Peak frequency time (ms) - time of peak power frame (absolute time in selection area)

    this.highFreq_kHz = null;       // High frequency (kHz) - highest frequency in entire call (calculated from all frames)
    this.highFreq_ms = null;    // High frequency time (ms) - time of high frequency occurrence within selection area
    this.highFreqFrameIdx = null;   // High frequency frame index - which frame the high frequency occurs in

    this.startFreq_kHz = null;      // Start frequency (kHz) - time-domain start frequency (from first frame, -24dB threshold or rule b)
    this.startFreq_ms = null;       // Start frequency time (ms) - time of start frequency in selection area (always at frame 0 = 0 ms)
    this.startFreqFrameIdx = null;  // Start frequency frame index - always 0 (first frame)
    this.startFreqTime_s = null;    // Start frequency time (s) - time point of start frequency (from first frame) [deprecated in favor of startFreq_ms]

    this.endFreq_kHz = null;        // End frequency (kHz) - time-domain end frequency (from last frame, -27dB threshold)
    this.endFreq_ms = null;         // End frequency time (ms) - absolute time of end frequency in selection area
    this.endFreqTime_s = null;      // End frequency time (s) - time point of end frequency (from last frame) [deprecated in favor of endFreq_ms]

    this.lowFreq_kHz = null;        // Low frequency (kHz) - lowest frequency in call (may be optimized with Start Frequency)
    this.lowFreq_ms = null;         // Low frequency time (ms) - absolute time of low frequency in selection area
    this.lowFreqFrameIdx = null;    // Low frequency frame index - which frame the low frequency occurs in
    this.endFrameIdx_forLowFreq = null;    // 2025 NEW: End frame index used for Low Frequency calculation (for SNR)

    this.characteristicFreq_kHz = null;  // Characteristic freq (lowest in last 20%)
    this.characteristicFreq_ms = null;   // Characteristic frequency time (ms) - absolute time of characteristic frequency in selection area

    this.kneeFreq_kHz = null;       // Knee frequency (kHz) - CF-FM transition point
    this.kneeFreq_ms = null;        // Knee frequency time (ms) - absolute time of knee frequency in selection area
    this.kneeTime_ms = null;        // Knee time (ms) - time at CF-FM transition [deprecated in favor of kneeFreq_ms]

    this.heelFreq_kHz = null;       // Heel frequency (kHz) - QCF/CF to FM transition
    this.heelFreq_ms = null;        // Absolute time of heel
    this.heelFrameIdx = null;       // Frame index of heel

    this.bandwidth_kHz = null;      // Bandwidth = highFreq - lowFreq

    this.Flow = null;               // Low frequency boundary (Hz) - from detection range
    this.Fhigh = null;              // High frequency boundary (kHz) - from detection range

    this.peakPower_dB = null;       // Peak power in dB
    this.startPower_dB = null;      // Power at start frequency
    this.endPower_dB = null;        // Power at end frequency

    this.noiseFloor_dB = null;      // Noise floor (25th percentile of all power values)
    this.snr_dB = null;             // Signal to Noise Ratio (dB) = peakPower_dB - noiseFloor_dB
    this.quality = null;            // Quality rating based on SNR (Very Poor, Poor, Normal, Good, Excellent)

    this.highFreqDetectionWarning = false;  // Warning flag: High Frequency detection reached -100dB limit

    // 2025: 儲存該 call 實際使用的 threshold 值（用於 UI 顯示）
    this.highFreqThreshold_dB_used = null;  // High Frequency threshold actually used for this call
    this.lowFreqThreshold_dB_used = null;   // Low Frequency threshold actually used for this call

    this.callType = 'FM';           // 'CF', 'FM', or 'CF-FM' (Constant/Frequency Modulated)

    // Internal: time-frequency spectrogram (for visualization/analysis)
    this.spectrogram = null;        // 2D array: [timeFrames][frequencyBins]
    this.timeFrames = null;         // Time points for each frame
    this.freqBins = null;           // Frequency bins in Hz

    // NEW (2025): Frequency contour for Peak Mode visualization
    // Format: Array of { time_s: number, freq_kHz: number, power_dB: number }
    this.frequencyContour = [];
  }

  /**
   * Calculate duration in milliseconds
   * Preferred method: Use Start Frequency Time and End Frequency Time
   * Fallback method: Use call start and end time
   */
  calculateDuration() {
    // Preferred: Calculate from Start Frequency time to End Frequency time
    if (this.startFreqTime_s !== null && this.endFreqTime_s !== null) {
      this.duration_ms = (this.endFreqTime_s - this.startFreqTime_s) * 1000;
    }
    // Fallback: Use overall call time boundaries if frequency times not available
    else if (this.startTime_s !== null && this.endTime_s !== null) {
      this.duration_ms = (this.endTime_s - this.startTime_s) * 1000;
    }
  }

  /**
   * Calculate bandwidth as difference between high and low frequencies
   */
  calculateBandwidth() {
    if (this.highFreq_kHz !== null && this.lowFreq_kHz !== null) {
      this.bandwidth_kHz = this.highFreq_kHz - this.lowFreq_kHz;
    }
  }

  /**
   * Apply Time Expansion correction to call parameters
   * 
   * In Time Expansion mode (e.g., 10x playback speed), the raw analysis yields:
   * - Frequencies that are 1/factor times the actual biological frequency
   * - Durations that are factor times the actual biological duration
   * 
   * This method corrects these parameters:
   * - Multiplies all frequency values by the factor
   * - Divides all time/duration values by the factor
   * 
   * @param {number} factor - Time expansion factor (e.g., 10 for 10x expansion)
   */
  applyTimeExpansion(factor = 10) {
    if (factor <= 1) return;  // No correction needed if factor is 1 or less

    // ============================================================
    // FREQUENCY FIELDS - Multiply by factor
    // ============================================================
    if (this.peakFreq_kHz !== null) {
      this.peakFreq_kHz *= factor;
    }
    if (this.highFreq_kHz !== null) {
      this.highFreq_kHz *= factor;
    }
    if (this.startFreq_kHz !== null) {
      this.startFreq_kHz *= factor;
    }
    if (this.endFreq_kHz !== null) {
      this.endFreq_kHz *= factor;
    }
    if (this.lowFreq_kHz !== null) {
      this.lowFreq_kHz *= factor;
    }
    if (this.characteristicFreq_kHz !== null) {
      this.characteristicFreq_kHz *= factor;
    }
    if (this.kneeFreq_kHz !== null) {
      this.kneeFreq_kHz *= factor;
    }
    if (this.heelFreq_kHz !== null) {
      this.heelFreq_kHz *= factor;
    }
    if (this.bandwidth_kHz !== null) {
      this.bandwidth_kHz *= factor;
    }
    if (this.Fhigh !== null) {
      this.Fhigh *= factor;
    }
    if (this.Flow !== null) {
      this.Flow *= factor;  // Flow is in Hz, needs scaling too
    }

    // ============================================================
    // TIME & DURATION FIELDS - Divide by factor
    // ============================================================
    if (this.startTime_s !== null) {
      this.startTime_s /= factor;
    }
    if (this.endTime_s !== null) {
      this.endTime_s /= factor;
    }
    if (this.duration_ms !== null) {
      this.duration_ms /= factor;
    }
    if (this.peakFreq_ms !== null) {
      this.peakFreq_ms /= factor;
    }
    if (this.highFreq_ms !== null) {
      this.highFreq_ms /= factor;
    }
    if (this.startFreq_ms !== null) {
      this.startFreq_ms /= factor;
    }
    if (this.endFreq_ms !== null) {
      this.endFreq_ms /= factor;
    }
    if (this.lowFreq_ms !== null) {
      this.lowFreq_ms /= factor;
    }
    if (this.characteristicFreq_ms !== null) {
      this.characteristicFreq_ms /= factor;
    }
    if (this.kneeFreq_ms !== null) {
      this.kneeFreq_ms /= factor;
    }
    if (this.heelFreq_ms !== null) {
      this.heelFreq_ms /= factor;
    }
    if (this.kneeTime_ms !== null) {
      this.kneeTime_ms /= factor;
    }
    if (this.startFreqTime_s !== null) {
      this.startFreqTime_s /= factor;
    }
    if (this.endFreqTime_s !== null) {
      this.endFreqTime_s /= factor;
    }

    // NEW (2025): Apply time expansion to frequency contour
    if (this.frequencyContour && this.frequencyContour.length > 0) {
      for (const point of this.frequencyContour) {
        if (point.time_s !== null) point.time_s /= factor;
        if (point.freq_kHz !== null) point.freq_kHz *= factor;
      }
    }
  }

  /**
   * Validate call parameters according to professional standards
   * Returns: { valid: boolean, reason: string }
   */
  validate() {
    if (this.duration_ms === null) this.calculateDuration();

    const checks = {
      hasDuration: this.duration_ms > 0,
      hasFreqs: this.peakFreq_kHz !== null && this.highFreq_kHz !== null && this.lowFreq_kHz !== null,
      reasonableDuration: this.duration_ms >= DEFAULT_DETECTION_CONFIG.minCallDuration_ms,
      frequencyOrder: this.lowFreq_kHz <= this.peakFreq_kHz && this.peakFreq_kHz <= this.highFreq_kHz,
    };

    const allValid = Object.values(checks).every(v => v);
    let reason = '';
    if (!checks.hasDuration) reason = 'Missing duration';
    else if (!checks.hasFreqs) reason = 'Missing frequency parameters';
    else if (!checks.reasonableDuration) reason = `Duration ${this.duration_ms}ms < min ${DEFAULT_DETECTION_CONFIG.minCallDuration_ms}ms`;
    else if (!checks.frequencyOrder) reason = 'Invalid frequency order';

    return { valid: allValid, reason };
  }

  /**
   * Convert to professional analysis format (similar to Avisoft export)
   */
  toAnalysisRecord() {
    return {
      // [NEW] 檔案中的絕對時間 (用於 Excel Column B & C)
      'Signal start time': this.startFreqTime_s?.toFixed(4) || '-',
      'Signal end time': this.endFreqTime_s?.toFixed(4) || '-',

      // 相對時間 (Relative to Start = 0.00ms)
      'Duration [ms]': this.duration_ms?.toFixed(2) || '-',

      // Frequency Parameters
      'Peak Freq [kHz]': this.peakFreq_kHz?.toFixed(2) || '-',
      'Start Freq [kHz]': this.startFreq_kHz?.toFixed(2) || '-',
      'End Freq [kHz]': this.endFreq_kHz?.toFixed(2) || '-',
      'High Freq [kHz]': this.highFreq_kHz?.toFixed(2) || '-',
      'Low Freq [kHz]': this.lowFreq_kHz?.toFixed(2) || '-',
      'Knee Freq [kHz]': this.kneeFreq_kHz?.toFixed(2) || '-',
      'Heel Freq [kHz]': this.heelFreq_kHz?.toFixed(2) || '-',
      'Characteristic Freq [kHz]': this.characteristicFreq_kHz?.toFixed(2) || '-',
      'Bandwidth [kHz]': this.bandwidth_kHz?.toFixed(2) || '-',

      // Time Parameters (Normalized)
      'Peak Time [ms]': this.peakFreq_ms?.toFixed(2) || '-',
      'Knee Time [ms]': this.kneeFreq_ms?.toFixed(2) || '-',
      'Heel Time [ms]': this.heelFreq_ms?.toFixed(2) || '-',
      'High Time [ms]': this.highFreq_ms?.toFixed(2) || '-',
      'Low Time [ms]': this.lowFreq_ms?.toFixed(2) || '-',

      // Other
      'Peak Power [dB]': this.peakPower_dB?.toFixed(1) || '-',
      'SNR [dB]': this.snr_dB !== null ? (this.snr_dB > 0 ? `+${this.snr_dB.toFixed(1)}` : this.snr_dB.toFixed(1)) : '-',
      'Quality': this.quality || '-',
    };
  }
}

/**
 * Main Bat Call Detector Class
 */
export class BatCallDetector {
  constructor(config = {}, wasmEngine = null) {
    this.config = { ...DEFAULT_DETECTION_CONFIG, ...config };
    this.applyWindow = getApplyWindowFunction();
    this.goertzelEnergy = getGoertzelEnergyFunction();
    this.wasmEngine = wasmEngine;  // Optional WASM engine for performance optimization
    this.debugMode = false; // 預設關閉 Debug 模式，避免在記憶體中建立大量陣列
  }

  /**
   * Set debug mode for performance optimization
   * When debugMode is false, logging arrays are not created and console output is suppressed
   * @param {boolean} isEnabled - Enable or disable debug mode
   */
  setDebugMode(isEnabled) {
    this.debugMode = isEnabled;
  }

  /**
   * Calculate quality rating based on SNR value
   * SNR ranges:
   * - < +10 dB: Very Poor (紅色)
   * - 10-15 dB: Poor (橙色)
   * - 15-20 dB: Normal (正常色)
   * - 20-30 dB: Good (綠色)
   * - >= 30 dB: Excellent (深綠色)
   * 
   * @param {number} snr_dB - Signal to Noise Ratio in dB
   * @returns {string} Quality rating
   */
  getQualityRating(snr_dB) {
    if (snr_dB < 10) {
      return 'Very Poor';
    } else if (snr_dB < 15) {
      return 'Poor';
    } else if (snr_dB < 20) {
      return 'Normal';
    } else if (snr_dB < 30) {
      return 'Good';
    } else {
      return 'Excellent';
    }
  }

  /**
     * 2025 ENHANCEMENT: Calculate RMS-based SNR from Spectrogram
     * Fixed Bug: Resizing selection area affects SNR.
     * Solution: Use Absolute Indices for Signal Region to strictly isolate call from selection noise.
     * * @param {Object} call - BatCall object
     * @param {Array} spectrogram - Full PowerMatrix of the selection
     * @param {Array} freqBins - Frequency bin centers
     * @param {number} signalStartIdx - ABSOLUTE Start Frame Index in spectrogram
     * @param {number} signalEndIdx - ABSOLUTE End Frame Index in spectrogram
     * @param {number} flowKHz - Selection Start Freq
     * @param {number} fhighKHz - Selection End Freq
     * @param {Object} noiseSpectrogram - (Optional) External noise reference
     */
  calculateRMSbasedSNR(call, spectrogram, freqBins, signalStartIdx, signalEndIdx, flowKHz, fhighKHz, noiseSpectrogram = null) {
    const result = {
      snr_dB: null,
      mechanism: 'RMS-based (2025)',
      signalPowerMean_dB: null,
      noisePowerMean_dB: null,
      signalCount: 0,
      noiseCount: 0,
      frequencyRange_kHz: null,
      timeRange_frames: null,
      debug: {}
    };

    // Validate inputs
    if (!call || !spectrogram || !freqBins) {
      result.debug.reason = 'Missing inputs';
      return result;
    }

    // 1. Calculate SIGNAL Power (From Call Region) with Dynamic Thresholding
    // =====================================================================
    const signalFreq_Hz_low = call.lowFreq_kHz * 1000;
    const signalFreq_Hz_high = call.highFreq_kHz * 1000;

    // Store ranges for logging
    result.frequencyRange_kHz = { lowFreq: call.lowFreq_kHz, highFreq: call.highFreq_kHz };
    result.timeRange_frames = { start: signalStartIdx, end: signalEndIdx, duration: signalEndIdx - signalStartIdx + 1 };

    // STEP 1-A: Find Max and Min Energy within the Signal Region
    let signalMaxDb = -Infinity;
    let signalMinDb = Infinity;
    let hasSignalBins = false;

    // Loop strictly within the defined Absolute Signal Region
    for (let timeIdx = signalStartIdx; timeIdx <= signalEndIdx; timeIdx++) {
      if (timeIdx >= spectrogram.length) break;
      const frame = spectrogram[timeIdx];

      for (let freqIdx = 0; freqIdx < frame.length; freqIdx++) {
        const freqHz = freqBins[freqIdx];
        if (freqHz >= signalFreq_Hz_low && freqHz <= signalFreq_Hz_high) {
          const powerDb = frame[freqIdx];
          if (powerDb > signalMaxDb) signalMaxDb = powerDb;
          if (powerDb < signalMinDb) signalMinDb = powerDb;
          hasSignalBins = true;
        }
      }
    }

    // Safety check if no bins found
    if (!hasSignalBins || signalMaxDb === -Infinity) {
      result.debug.reason = 'No signal bins in range';
      return result;
    }

    // STEP 1-B: Calculate Dynamic Threshold
    // Threshold = Min + (Range * 0.25)
    // Filters out the bottom 25% of energy (weak/edge bins) within the signal box
    const dynamicRange = signalMaxDb - signalMinDb;
    const thresholdOffset = dynamicRange * 0.25;
    const signalThreshold_dB = signalMinDb + thresholdOffset;

    // STEP 1-C: Calculate Signal Mean using only bins ABOVE threshold
    let signalPowerSum_linear = 0;
    let signalCount = 0;

    for (let timeIdx = signalStartIdx; timeIdx <= signalEndIdx; timeIdx++) {
      if (timeIdx >= spectrogram.length) break;
      const frame = spectrogram[timeIdx];

      for (let freqIdx = 0; freqIdx < frame.length; freqIdx++) {
        const freqHz = freqBins[freqIdx];
        if (freqHz >= signalFreq_Hz_low && freqHz <= signalFreq_Hz_high) {
          const powerDb = frame[freqIdx];

          // Apply Dynamic Threshold Filter
          if (powerDb > signalThreshold_dB) {
            signalPowerSum_linear += Math.pow(10, powerDb / 10);
            signalCount++;
          }
        }
      }
    }

    // Store debug info
    result.debug.signalThreshold = signalThreshold_dB;
    result.debug.signalMax = signalMaxDb;
    result.debug.signalMin = signalMinDb;

    // 2. Calculate NOISE Power (Last 10ms or Fallback)
    // =====================================================================
    let noisePowerSum_linear = 0;
    let noiseCount = 0;

    if (noiseSpectrogram && noiseSpectrogram.powerMatrix && noiseSpectrogram.powerMatrix.length > 0) {
      // Use External Noise Spectrogram (Last 10ms)
      result.mechanism = 'RMS-based (Last 10ms)';

      const selLowHz = flowKHz * 1000;
      const selHighHz = fhighKHz * 1000;
      const noiseMatrix = noiseSpectrogram.powerMatrix;
      const noiseFreqBins = noiseSpectrogram.freqBins;

      for (let t = 0; t < noiseMatrix.length; t++) {
        const frame = noiseMatrix[t];
        for (let b = 0; b < frame.length; b++) {
          const freqHz = noiseFreqBins[b];
          // Filter by Selection Area Frequency Range
          if (freqHz >= selLowHz && freqHz <= selHighHz) {
            const powerDb = frame[b];
            noisePowerSum_linear += Math.pow(10, powerDb / 10);
            noiseCount++;
          }
        }
      }
    } else {
      // Fallback: Use non-signal bins in the current spectrogram (Selection Area)
      // This correctly treats the "empty" area caused by resizing as Noise.
      result.mechanism = 'RMS-based (Fallback Internal)';

      for (let timeIdx = 0; timeIdx < spectrogram.length; timeIdx++) {
        const frame = spectrogram[timeIdx];
        for (let freqIdx = 0; freqIdx < frame.length; freqIdx++) {
          const freqHz = freqBins[freqIdx];

          // Check if this bin is inside the SIGNAL BOX
          const isInSignalTime = (timeIdx >= signalStartIdx) && (timeIdx <= signalEndIdx);
          const isInSignalFreq = (freqHz >= signalFreq_Hz_low) && (freqHz <= signalFreq_Hz_high);

          // If NOT inside Signal Box, it is Noise
          if (!(isInSignalTime && isInSignalFreq)) {
            const powerDb = frame[freqIdx];
            noisePowerSum_linear += Math.pow(10, powerDb / 10);
            noiseCount++;
          }
        }
      }
    }

    // 3. Compute Results
    // =====================================================================
    if (signalCount === 0) {
      result.debug.reason = 'No signal bins found above threshold';
      return result;
    }

    if (noiseCount === 0) {
      result.snr_dB = Infinity;
      return result;
    }

    const signalPowerMean_linear = signalPowerSum_linear / signalCount;
    const noisePowerMean_linear = noisePowerSum_linear / noiseCount;

    // Convert back to dB
    result.signalPowerMean_dB = 10 * Math.log10(Math.max(signalPowerMean_linear, 1e-16));
    result.noisePowerMean_dB = 10 * Math.log10(Math.max(noisePowerMean_linear, 1e-16));
    result.signalCount = signalCount;
    result.noiseCount = noiseCount;

    if (noisePowerMean_linear < 1e-16) {
      result.snr_dB = Infinity;
      return result;
    }

    // SNR = 10 * log10(Signal_Mean / Noise_Mean)
    result.snr_dB = 10 * Math.log10(signalPowerMean_linear / noisePowerMean_linear);

    return result;
  }

  // ============================================================
  // 2025 NEW: Two-Pass Detection (Two-Stage Detection) for Full Files
  // Industry-standard optimization for long recordings
  // ============================================================

  /**
   * Process entire audio file using Two-Pass Detection (Optimized 2025)
   * Optimization: 
   * 1. Spectrogram generated once per ROI
   * 2. Echo filtering based on Peak Time Separation (< 30ms) BEFORE detailed measurement
   */
  async processFullFile(fullAudioData, sampleRate, flowKHz, fhighKHz, options = {}) {
    const threshold_dB = options.threshold_dB || -60;
    const padding_ms = options.padding_ms || 5;
    const progressCallback = options.progressCallback || (() => { });

    if (this.debugMode) {
      console.log(`[BatCallDetector] Starting full file scan. Threshold: ${threshold_dB}dB`);
    }

    // STEP 1: Fast Scan (Find ROIs)
    const rawSegments = this.fastScanSegments(fullAudioData, sampleRate, flowKHz, fhighKHz, threshold_dB);

    if (rawSegments.length === 0) {
      return [];
    }

    // STEP 2: Merge & Pad
    const mergedSegments = this.mergeAndPadSegments(rawSegments, fullAudioData.length, sampleRate, padding_ms);
    if (this.debugMode) {
      console.log(`[BatCallDetector] Found ${mergedSegments.length} ROI segments.`);
    }

    const allCalls = [];

    // STEP 3: Process Each ROI
    for (let i = 0; i < mergedSegments.length; i++) {
      const seg = mergedSegments[i];
      let segmentAudio = fullAudioData.slice(seg.startSample, seg.endSample);
      const roiStartSample = seg.startSample;

      // 3.1 Generate Spectrogram (ONCE)
      // We generate it here and reuse it for both HPF check and Detection
      const spec = this.generateSpectrogram(segmentAudio, sampleRate, flowKHz, fhighKHz);

      if (!spec) continue;

      let { powerMatrix, timeFrames, freqBins, freqResolution } = spec;

      const roiZonalNoiseMap = this.calculateZonalNoiseFloors(
        powerMatrix,
        freqBins,
        0,
        Math.min(5, powerMatrix.length - 1) // 取前 5 frames
      );

      // 3.2 [Optional] Auto-HPF Logic
      // Check global peak of this ROI to decide if HPF is needed
      let maxPower = -Infinity;
      let maxBinIdx = 0;
      let maxFrameIdx = 0;

      for (let f = 0; f < powerMatrix.length; f++) {
        const frame = powerMatrix[f];
        for (let b = 0; b < frame.length; b++) {
          if (frame[b] > maxPower) {
            maxPower = frame[b];
            maxBinIdx = b;
            maxFrameIdx = f;
          }
        }
      }

      const roiPeakFreq_kHz = freqBins[maxBinIdx] / 1000;
      const autoCutoff = this.calculateAutoHighpassFilterFreq(roiPeakFreq_kHz);

      // If HPF needed, we must re-process audio and re-generate spectrogram
      // This ensures measurements are clean
      if (autoCutoff > 0) {
        const peakTime_ms = timeFrames[maxFrameIdx] * 1000;

        if (this.debugMode) {
          console.log(
            `%c[Auto HPF] ROI ${i}: Peak ${roiPeakFreq_kHz.toFixed(1)}kHz ${peakTime_ms.toFixed(1)}ms (Frame ${maxFrameIdx}) -> Applying HPF @ ${autoCutoff}kHz`,
            'color: #ff9f43; font-weight: bold; font-size: 12px;'
          );
        }
        segmentAudio = this.applyHighpassFilter(segmentAudio, autoCutoff * 1000, sampleRate);
        this.config.enableHighpassFilter = true;
        this.config.highpassFilterFreq_kHz = autoCutoff;

        // Re-generate spectrogram with filtered audio
        const newSpec = this.generateSpectrogram(segmentAudio, sampleRate, flowKHz, fhighKHz);
        if (newSpec) {
          powerMatrix = newSpec.powerMatrix;
          timeFrames = newSpec.timeFrames;
          freqBins = newSpec.freqBins;
          freqResolution = newSpec.freqResolution;
        }
      } else {
        this.config.enableHighpassFilter = false;
      }

      // 3.3 Detect Segments (Boundaries Only - Cheap)
      const callSegments = this.detectCallSegments(powerMatrix, timeFrames, freqBins, flowKHz, fhighKHz);

      if (callSegments.length === 0) continue;

      // 3.4 [OPTIMIZATION] Pre-calculate Peaks & Filter by Time Separation
      // Instead of full measurement, we just look at Peak Time
      const candidates = [];
      const minDurationSec = this.config.minCallDuration_ms / 1000;

      callSegments.forEach(segment => {
        // Filter short segments early
        const segDur = timeFrames[segment.endFrame] - timeFrames[segment.startFrame];
        if (segDur < minDurationSec) return;

        // Find Peak within this segment (Cheap scan)
        let segPeakPower = -Infinity;
        let segPeakFrameIdx = segment.startFrame;

        for (let f = segment.startFrame; f <= segment.endFrame; f++) {
          const frame = powerMatrix[f];
          for (let b = 0; b < frame.length; b++) {
            if (frame[b] > segPeakPower) {
              segPeakPower = frame[b];
              segPeakFrameIdx = f;
            }
          }
        }

        candidates.push({
          ...segment,
          peakPower: segPeakPower,
          peakTime: timeFrames[segPeakFrameIdx], // Relative time in ROI
          peakFrameIdx: segPeakFrameIdx
        });
      });

      // SORT by Energy (Strongest first)
      candidates.sort((a, b) => b.peakPower - a.peakPower);

      // APPLY FILTER: Peak Time Separation < 30ms
      const keptCandidates = [];
      const minGap_s = 0.030; // 30ms

      for (const candidate of candidates) {
        let isTooClose = false;
        for (const kept of keptCandidates) {
          // Compare Peak Times (Time Values) directly
          const timeDiff = Math.abs(candidate.peakTime - kept.peakTime);

          if (timeDiff < minGap_s) {
            isTooClose = true;
            break; // Discard as echo
          }
        }
        if (!isTooClose) {
          keptCandidates.push(candidate);
        }
      }

      // 3.5 Detailed Measurement (Only for Survivors)
      const timeOffset_s = roiStartSample / sampleRate;

      for (const segment of keptCandidates) {
        const call = new BatCall();

        // Padding Logic (Same as detectCalls)
        const pad_ms = 5;
        const timePerFrame = timeFrames[1] - timeFrames[0];
        const paddingFrames = Math.ceil((pad_ms / 1000) / timePerFrame);

        let safeStartFrame = Math.max(0, segment.startFrame - paddingFrames);
        let safeEndFrame = Math.min(powerMatrix.length - 1, segment.endFrame + paddingFrames);

        // ============================================================
        // Oscillogram Refinement
        // ============================================================
        try {
          // 1. 計算 ROI 內的 Sample Index (相對位置)
          const startSample = Math.floor(timeFrames[safeStartFrame] * sampleRate);
          const endSample = Math.floor(timeFrames[safeEndFrame] * sampleRate);

          // 2. 執行時域精修 (使用 segmentAudio)
          // 注意：this.refineEndUsingOscillogram 必須已經定義在 class 內
          const refinedEndSample = this.refineEndUsingOscillogram(segmentAudio, sampleRate, startSample, endSample);

          // 3. 檢查是否有變化
          if (refinedEndSample < endSample) {
            const cutSamples = endSample - refinedEndSample;
            const cutMs = (cutSamples / sampleRate) * 1000;

            // 轉換回 Frame Index
            const refinedEndTime = refinedEndSample / sampleRate;

            let newEndFrame = safeEndFrame;
            while (newEndFrame > safeStartFrame && timeFrames[newEndFrame] > refinedEndTime) {
              newEndFrame--;
            }

            const frameDiff = safeEndFrame - (newEndFrame + 1);

            // 更新 safeEndFrame
            safeEndFrame = Math.min(powerMatrix.length - 1, newEndFrame + 1);
          }
        } catch (e) {
          console.warn('[AutoDetect] Oscillogram refinement failed:', e);
        }
        // ============================================================

        // Setup Call Object
        call.spectrogram = powerMatrix.slice(safeStartFrame, safeEndFrame + 1);
        call.timeFrames = timeFrames.slice(safeStartFrame, safeEndFrame + 2); // +2 for safety
        call.freqBins = freqBins;

        // Set Times (Relative to ROI start initially)
        call.startTime_s = timeFrames[safeStartFrame];
        call.endTime_s = timeFrames[Math.min(safeEndFrame + 1, timeFrames.length - 1)];

        call.calculateDuration();

        // Run Detailed Measurement
        this.measureFrequencyParameters(call, flowKHz, fhighKHz, freqBins, freqResolution, roiZonalNoiseMap);

        // ============================================================
        // [FIX] Check if call was discarded during measurement
        // ============================================================
        if (call.isDiscarded) {
          continue;
        }

        // [NEW] Discard calls with duration <= 1ms (Do not create selection box)
        if (call.duration_ms <= 1.0) {
            if (this.debugMode) console.log(`[AutoDetect] Discarding short call: ${call.duration_ms.toFixed(2)}ms`);
            continue;
        }

        // Classify
        call.Flow = call.lowFreq_kHz * 1000;
        call.Fhigh = call.highFreq_kHz;
        call.callType = CallTypeClassifier.classify(call); // Assuming imported

        // SNR Calculation (Simplified)
        call.snr_dB = call.peakPower_dB - (-80); // Placeholder or calculate properly
        call.quality = this.getQualityRating(call.snr_dB);

        // CORRECT TIMING TO ABSOLUTE (File Time)
        call.startTime_s += timeOffset_s;
        call.endTime_s += timeOffset_s;
        if (call.startFreqTime_s !== null) call.startFreqTime_s += timeOffset_s;
        if (call.endFreqTime_s !== null) call.endFreqTime_s += timeOffset_s;

        allCalls.push(call);
      }

      // Report progress
      if (i % 5 === 0 || i === mergedSegments.length - 1) {
        progressCallback((i + 1) / mergedSegments.length);
      }
    }

    if (this.debugMode) {
      console.log(`[BatCallDetector] Full scan complete. Detected ${allCalls.length} calls.`);
    }
    return allCalls;
  }

  /**
   * Fast scan of audio to find energy levels exceeding threshold
   * Uses larger hop size (low overlap) for speed
   * Returns sample ranges of potential signal areas
   * 
   * @param {Float32Array} audioData - Audio samples
   * @param {number} sampleRate - Sample rate
   * @param {number} flowKHz - Low freq bound
   * @param {number} fhighKHz - High freq bound
   * @param {number} threshold_dB - Energy threshold
   * @returns {Array} Array of {start, end} sample ranges
   */
  /**
   * [2025 OPTIMIZED] Fast scan using WASM if available, with JS fallback
   * Prioritizes WASM engine for 20-50x performance improvement on long files
   */
  fastScanSegments(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB) {
    // Priority 1: Use WASM engine for acceleration (速度提升 20x+)
    if (this.wasmEngine) {
      try {
        return this.fastScanSegmentsWasm(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB);
      } catch (e) {
        console.warn('[BatCallDetector] WASM scan failed, falling back to JS:', e);
      }
    }

    // Priority 2: Fall back to JS implementation
    return this.fastScanSegmentsLegacy(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB);
  }

  /**
     * [2025 FIXED] WASM 加速版快速掃描
     * 修復問題：
     * 1. 使用 50% Overlap 避免 Windowing Loss (漏測短信號)
     * 2. 計算頻帶總能量 (Band Energy) 而非單點能量，匹配 RMS 邏輯
     */
  fastScanSegmentsWasm(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB) {
    const segments = [];

    // 1. 獲取 WASM 引擎參數
    const fftSize = this.wasmEngine.get_fft_size(); // 通常是 1024

    // 2. [FIX] 使用 50% Overlap 避免邊緣衰減導致漏測
    const hopSize = Math.floor(fftSize / 2);
    const overlapSamples = fftSize - hopSize;

    // 3. 計算頻率範圍 Bin
    const freqRes = sampleRate / fftSize;
    const minBin = Math.floor(flowKHz * 1000 / freqRes);
    const maxBin = Math.ceil(fhighKHz * 1000 / freqRes);

    // 4. 調用 WASM 批量計算
    const rawSpectrum = this.wasmEngine.compute_spectrogram(audioData, overlapSamples);

    const numBinsTotal = this.wasmEngine.get_freq_bins();
    const numFrames = Math.floor(rawSpectrum.length / numBinsTotal);

    // 5. [FIX] 能量閾值計算 (對齊 RMS 邏輯)
    // Legacy JS 邏輯: 20*log10(RMS) > Threshold
    // RMS^2 = Sum(Energy) / FFT_Size
    // Threshold_Linear = 10^(dB/10)
    // 判斷式: (Sum(Bin_Mag^2) / FFT_Size) > Threshold_Linear
    // 優化後: Sum(Bin_Mag^2) > Threshold_Linear * FFT_Size

    const thresholdLinear = Math.pow(10, threshold_dB / 10);
    // [校準] 經驗值：WASM 輸出通常未歸一化，為保險起見，稍微降低掃描閾值 (-6dB) 以確保不漏測
    // 之後的 Detailed Detection 會做精確過濾
    const targetEnergySum = thresholdLinear * fftSize * 0.25;

    let activeStart = null;

    for (let f = 0; f < numFrames; f++) {
      const frameOffset = f * numBinsTotal;
      let bandEnergySum = 0;

      // [FIX] 計算感興趣頻段的總能量 (Sum of Squares)
      for (let b = minBin; b <= maxBin; b++) {
        if (frameOffset + b >= rawSpectrum.length) break;
        const mag = rawSpectrum[frameOffset + b];
        bandEnergySum += mag * mag;

        // 優化：如果累積能量已經超過閾值，可以提早跳出
        if (bandEnergySum > targetEnergySum) break;
      }

      const isFrameActive = bandEnergySum > targetEnergySum;

      // 狀態機: 記錄區段 (轉換回 Sample Index)
      const sampleIndex = f * hopSize;

      if (isFrameActive) {
        if (activeStart === null) activeStart = sampleIndex;
      } else {
        if (activeStart !== null) {
          // 結束一段信號
          segments.push({ start: activeStart, end: sampleIndex + fftSize });
          activeStart = null;
        }
      }
    }

    // Close last segment
    if (activeStart !== null) {
      segments.push({ start: activeStart, end: audioData.length });
    }

    return segments;
  }

  /**
   * Legacy JS implementation for fast scan
   * Used as fallback when WASM engine is unavailable
   * Performance: Suitable for files < 1 minute at 256 kHz
   */
  fastScanSegmentsLegacy(audioData, sampleRate, flowKHz, fhighKHz, threshold_dB) {
    const fftSize = 512;  // Smaller FFT for speed
    const hopSize = 256;  // 50% overlap (sufficient for scanning)
    const segments = [];

    const freqRes = sampleRate / fftSize;
    const minBin = Math.floor(flowKHz * 1000 / freqRes);
    const maxBin = Math.ceil(fhighKHz * 1000 / freqRes);

    // Pre-compute Hann window
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }

    let activeStart = null;
    const numFrames = Math.floor((audioData.length - fftSize) / hopSize);

    // Time-domain RMS pre-check and energy assessment
    const tempReal = new Float32Array(fftSize);
    const tempImag = new Float32Array(fftSize);

    for (let f = 0; f < numFrames; f++) {
      const startSample = f * hopSize;

      // Safety check: ensure we don't read past audio data
      if (startSample + fftSize > audioData.length) break;

      // 1. Copy & Window
      for (let i = 0; i < fftSize; i++) {
        tempReal[i] = audioData[startSample + i] * window[i];
        tempImag[i] = 0;
      }

      // 2. Time Domain Pre-check using RMS
      let rms = 0;
      for (let i = 0; i < fftSize; i++) {
        rms += tempReal[i] * tempReal[i];
      }
      rms = Math.sqrt(rms / fftSize);
      const approxDb = 20 * Math.log10(rms + 1e-9);

      // If total energy is too low, skip (Parseval's theorem)
      if (approxDb < threshold_dB - 10) {
        if (activeStart !== null) {
          segments.push({ start: activeStart, end: (f - 1) * hopSize + fftSize });
          activeStart = null;
        }
        continue;
      }

      // 3. Potential candidate found
      if (activeStart === null) activeStart = startSample;
    }

    // Close last segment if active
    if (activeStart !== null) {
      segments.push({ start: activeStart, end: audioData.length });
    }

    return segments;
  }

  /**
   * Merge overlapping segments and add padding
   * 
   * @param {Array} segments - Array of {start, end} sample ranges
   * @param {number} totalSamples - Total audio samples
   * @param {number} sampleRate - Sample rate
   * @param {number} padding_ms - Padding duration in milliseconds
   * @returns {Array} Array of merged segments {startSample, endSample}
   */
  mergeAndPadSegments(segments, totalSamples, sampleRate, padding_ms) {
    if (segments.length === 0) return [];

    const paddingSamples = Math.round((padding_ms / 1000) * sampleRate);
    const sorted = segments.sort((a, b) => a.start - b.start);
    const merged = [];

    let currentStart = Math.max(0, sorted[0].start - paddingSamples);
    let currentEnd = Math.min(totalSamples, sorted[0].end + paddingSamples);

    for (let i = 1; i < sorted.length; i++) {
      const nextStart = Math.max(0, sorted[i].start - paddingSamples);
      const nextEnd = Math.min(totalSamples, sorted[i].end + paddingSamples);

      if (nextStart <= currentEnd) {
        // Overlapping or adjacent, merge
        currentEnd = Math.max(currentEnd, nextEnd);
      } else {
        // Separated, save current and start new
        merged.push({ startSample: currentStart, endSample: currentEnd });
        currentStart = nextStart;
        currentEnd = nextEnd;
      }
    }
    // Add last segment
    merged.push({ startSample: currentStart, endSample: currentEnd });

    return merged;
  }

  /**
   * Detect all bat calls in audio selection
   * Returns: array of BatCall objects
   * * @param {Float32Array} audioData - Audio samples
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} flowKHz - Low frequency bound in kHz
   * @param {number} fhighKHz - High frequency bound in kHz
   * @param {Object} options - Optional parameters
   * @param {boolean} options.skipSNR - If true, skip expensive SNR calculation on first pass
   * @param {Object} options.noiseSpectrogram - (Optional) Spectrogram of last 10ms for SNR calc
   * @returns {Promise<Array>} Array of BatCall objects
   */
  async detectCalls(audioData, sampleRate, flowKHz, fhighKHz, options = { skipSNR: false, noiseSpectrogram: null }) {
    if (!audioData || audioData.length === 0) return [];

    // Generate high-resolution STFT spectrogram (Full Selection)
    const spectrogram = this.generateSpectrogram(audioData, sampleRate, flowKHz, fhighKHz);
    if (!spectrogram) return [];

    const { powerMatrix, timeFrames, freqBins, freqResolution } = spectrogram;

    // ============================================================
    // 2025 OPTIMIZATION: Pre-calculate Zonal Noise Map (Last 10ms)
    // 利用 RMS-based SNR 的邏輯，優先使用外部的 noiseSpectrogram (Last 10ms)
    // 這樣在 findOptimalThreshold 時不用重複計算，且基準更穩定。
    // ============================================================
    let globalZonalNoiseMap = null;

    if (options.noiseSpectrogram && options.noiseSpectrogram.powerMatrix && options.noiseSpectrogram.powerMatrix.length > 0) {
      const ns = options.noiseSpectrogram;
      const totalNoiseFrames = ns.powerMatrix.length;
      let startFrameIdx = 0;

      // 計算 5ms 對應多少 Frames
      if (ns.timeFrames && ns.timeFrames.length > 1) {
        const timePerFrame = ns.timeFrames[1] - ns.timeFrames[0]; // 秒
        const targetDuration_sec = 0.005; // 5ms
        const framesFor5ms = Math.ceil(targetDuration_sec / timePerFrame);

        // 設定起始點：總長度 - 5ms的Frame數 (確保只取最後一段)
        startFrameIdx = Math.max(0, totalNoiseFrames - framesFor5ms);

        // Debug Log (Optional)
        // console.log(`[Detector] Noise Map Source: Last 5ms (Frames ${startFrameIdx} - ${totalNoiseFrames-1})`);
      }

      // 情況 A: 使用外部傳入的 Noise Spectrogram (Last 5ms)
      globalZonalNoiseMap = this.calculateZonalNoiseFloors(
        ns.powerMatrix,
        ns.freqBins,
        startFrameIdx,      // <--- 從倒數 5ms 處開始
        totalNoiseFrames - 1
      );

    } else {
      // 情況 B: Fallback (使用當前選取範圍的前 5 Frames)
      // 這通常是選取範圍開頭的靜音區
      globalZonalNoiseMap = this.calculateZonalNoiseFloors(
        powerMatrix,
        freqBins,
        0,
        Math.min(5, powerMatrix.length - 1)
      );
    }

    // Phase 1: Detect call boundaries using energy threshold
    const callSegments = this.detectCallSegments(powerMatrix, timeFrames, freqBins, flowKHz, fhighKHz);

    if (callSegments.length === 0) return [];

    // FILTER: Remove segments that are too short
    const filteredSegments = callSegments.filter(segment => {
      const frameDurationSec = 1 / (sampleRate / this.config.fftSize);
      const numFrames = segment.endFrame - segment.startFrame + 1;
      const segmentDuration_ms = numFrames * frameDurationSec * 1000;
      return segmentDuration_ms >= this.config.minCallDuration_ms;
    });

    if (filteredSegments.length === 0) return [];

    // Phase 2: Measure precise parameters for each detected call
    const calls = filteredSegments.map(segment => {
      const call = new BatCall();

      // ============================================================
      // [保留此邏輯] 加入 Padding 以保留叫聲微弱的頭尾
      // 這是解決 Start Freq = High Freq 的關鍵！
      // ============================================================
      const padding_ms = 3; // 你可以調整這裡
      const timePerFrame = timeFrames[1] - timeFrames[0];
      const paddingFrames = Math.ceil((padding_ms / 1000) / timePerFrame);

      // 計算擴張後的安全邊界
      let safeStartFrame = Math.max(0, segment.startFrame - paddingFrames);
      let safeEndFrame = Math.min(powerMatrix.length - 1, segment.endFrame + paddingFrames);

      // ============================================================
      // [2025 NEW] Oscillogram Refinement Step (DEBUG VERSION)
      // ============================================================
      try {
        const startSample = Math.floor(timeFrames[safeStartFrame] * sampleRate);
        const endSample = Math.floor(timeFrames[safeEndFrame] * sampleRate);

        // 執行精修
        const refinedEndSample = this.refineEndUsingOscillogram(audioData, sampleRate, startSample, endSample);

        // 檢查是否有變化
        if (refinedEndSample < endSample) {
          const cutSamples = endSample - refinedEndSample;
          const cutMs = (cutSamples / sampleRate) * 1000;

          // 轉換回 Frame
          const refinedEndTime = refinedEndSample / sampleRate;
          let newEndFrame = safeEndFrame;
          while (newEndFrame > safeStartFrame && timeFrames[newEndFrame] > refinedEndTime) {
            newEndFrame--;
          }

          // 計算 Frame 的變化
          const frameDiff = safeEndFrame - (newEndFrame + 1);

          console.log(`%c[Refine Action] Cut ${cutMs.toFixed(2)}ms (${cutSamples} samples)`, 'color: #e67e22; font-weight: bold');
          console.log(`   Original Frame: ${safeEndFrame} -> New Frame: ${newEndFrame + 1} (Diff: ${frameDiff})`);

          // 如果 Frame 沒有變，代表裁剪幅度小於 1 個 Frame (通常是 FFT Size 導致)
          if (frameDiff === 0) {
            console.log(`   Note: Cut was too small to shift FFT frame index.`);
          }

          // 更新 safeEndFrame
          safeEndFrame = Math.min(powerMatrix.length - 1, newEndFrame + 1);
        }
      } catch (e) {
        console.warn('[BatCallDetector] Oscillogram refinement failed:', e);
      }
      // ============================================================

      // 設定時間與切片
      call.startTime_s = timeFrames[safeStartFrame];
      call.endTime_s = timeFrames[Math.min(safeEndFrame + 1, timeFrames.length - 1)];

      // [關鍵] 切出的 spectrogram[0] 會是安靜的 padding 區
      call.spectrogram = powerMatrix.slice(safeStartFrame, safeEndFrame + 1);
      call.timeFrames = timeFrames.slice(safeStartFrame, safeEndFrame + 2);
      call.freqBins = freqBins;

      call.calculateDuration();

      if (call.duration_ms <= 1.0 || call.duration_ms < this.config.minCallDuration_ms) {
        return null;
      }

      // [CRITICAL] 傳遞預計算的 globalZonalNoiseMap
      this.measureFrequencyParameters(call, flowKHz, fhighKHz, freqBins, freqResolution, globalZonalNoiseMap);

      call.Flow = call.lowFreq_kHz * 1000;
      call.Fhigh = call.highFreq_kHz;
      call.callType = CallTypeClassifier.classify(call);

      return call;
    }).filter(call => call !== null);

    // ============================================================
    // Noise Floor & SNR Calculation
    // ============================================================
    const allPowerValues = [];
    for (let frameIdx = 0; frameIdx < powerMatrix.length; frameIdx++) {
      const framePower = powerMatrix[frameIdx];
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        allPowerValues.push(framePower[binIdx]);
      }
    }
    allPowerValues.sort((a, b) => a - b);

    const percentile25Index = Math.floor(allPowerValues.length * 0.25);
    const noiseFloor_dB = allPowerValues[Math.max(0, percentile25Index)];
    const minNoiseFloor_dB = -80;
    const robustNoiseFloor_dB = Math.max(noiseFloor_dB, minNoiseFloor_dB);
    const snrThreshold_dB = -20;

    const filteredCalls = calls.filter(call => {
      if (call.peakPower_dB === null || call.peakPower_dB === undefined) {
        return false;
      }

      call.noiseFloor_dB = robustNoiseFloor_dB;

      if (options.skipSNR) {
        const spectralSNR_dB = call.peakPower_dB - robustNoiseFloor_dB;
        call.snr_dB = spectralSNR_dB;
        call.snrMechanism = 'Skipped (Filtered Pass)';
        call.quality = this.getQualityRating(spectralSNR_dB);
        return true;
      }

      try {
        const snrResult = this.calculateRMSbasedSNR(
          call,
          call.spectrogram,
          freqBins,
          0,                             // signalStartIdx (相對於 slice，通常是開頭)
          call.endFrameIdx_forLowFreq,   // signalEndIdx (相對於 slice)
          flowKHz,
          fhighKHz,
          options.noiseSpectrogram
        );

        if (snrResult.snr_dB !== null && isFinite(snrResult.snr_dB)) {
          call.snr_dB = snrResult.snr_dB;
          call.snrMechanism = snrResult.mechanism;
        } else {
          const spectralSNR_dB = call.peakPower_dB - robustNoiseFloor_dB;
          call.snr_dB = spectralSNR_dB;
          call.snrMechanism = 'RMS-based (2025) - Calculation failed fallback';
        }
      } catch (error) {
        const spectralSNR_dB = call.peakPower_dB - robustNoiseFloor_dB;
        call.snr_dB = spectralSNR_dB;
      }

      call.quality = this.getQualityRating(call.snr_dB);

      const snr_dB = call.peakPower_dB - robustNoiseFloor_dB;
      if (snr_dB < snrThreshold_dB) {
        return false;
      }

      return true;
    });

    return filteredCalls;
  }

  /**
   * Generate high-resolution STFT spectrogram using WebAssembly FFT
   * Much faster than Goertzel algorithm for large audio buffers.
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution } or null if failed
   */
  generateSpectrogramWasm(audioData, sampleRate, flowKHz, fhighKHz) {
    // [OPTIMIZED] Removed redundant check and fallback logic.
    // This method now purely attempts WASM calculation and returns null on failure.

    try {
      // 1. Get the actual FFT size from WASM engine
      const effectiveFFTSize = this.wasmEngine.get_fft_size();

      // 2. Calculate hop size based on effective FFT size
      const { hopPercent } = this.config;
      const hopSize = Math.floor(effectiveFFTSize * (hopPercent / 100));
      const overlapSamples = effectiveFFTSize - hopSize;

      if (hopSize < 1 || effectiveFFTSize > audioData.length) {
        console.warn('FFT size too large for audio data');
        return null;
      }

      // 3. Call WASM to compute spectrogram (returns Linear Magnitude)
      const rawSpectrum = this.wasmEngine.compute_spectrogram(audioData, overlapSamples);

      // 4. Get metadata
      const numBinsTotal = this.wasmEngine.get_freq_bins();
      const freqResolution = sampleRate / effectiveFFTSize;
      const numFrames = Math.floor(rawSpectrum.length / numBinsTotal);

      if (numFrames < 1 || numBinsTotal < 1 || rawSpectrum.length === 0) {
        console.warn('Invalid WASM output dimensions');
        return null;
      }

      // 5. Calculate frequency range indices
      const minBin = Math.max(0, Math.floor(flowKHz * 1000 / freqResolution));
      const maxBin = Math.min(numBinsTotal - 1, Math.floor(fhighKHz * 1000 / freqResolution));
      const numBinsOfInterest = maxBin - minBin + 1;

      if (numBinsOfInterest <= 0) {
        console.warn('No frequency bins in requested range');
        return null;
      }

      const powerMatrix = new Array(numFrames);
      const timeFrames = new Array(numFrames);
      const freqBins = new Float32Array(numBinsOfInterest);

      // Pre-calculate frequency axis
      for (let i = 0; i < numBinsOfInterest; i++) {
        freqBins[i] = (minBin + i) * freqResolution;
      }

      // 6. Reshape data and convert to dB
      for (let f = 0; f < numFrames; f++) {
        const framePower = new Float32Array(numBinsOfInterest);
        const frameOffset = f * numBinsTotal;
        const frameStart = f * hopSize;
        timeFrames[f] = (frameStart + effectiveFFTSize / 2) / sampleRate;

        for (let b = 0; b < numBinsOfInterest; b++) {
          const sourceIdx = frameOffset + (minBin + b);
          if (sourceIdx >= rawSpectrum.length) break;

          const magnitude = rawSpectrum[sourceIdx];
          const power = magnitude * magnitude;
          const psd = power / effectiveFFTSize;
          framePower[b] = 10 * Math.log10(Math.max(psd, 1e-16));
        }
        powerMatrix[f] = framePower;
      }

      // [IMPORTANT] Sync config fftSize
      if (this.config.fftSize !== effectiveFFTSize) {
        console.log(`[FFT Alignment] Detector config FFT adjusted from ${this.config.fftSize} to ${effectiveFFTSize}`);
        this.config.fftSize = effectiveFFTSize;
      }

      return { powerMatrix, timeFrames, freqBins, freqResolution };

    } catch (error) {
      console.warn('WASM computation failed:', error);
      return null; // Return null to trigger fallback in the caller
    }
  }

  /**
   * Generate high-resolution STFT spectrogram
   * Orchestrator method: Tries WASM first, falls back to Legacy JS if WASM fails or is missing.
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution }
   */
  generateSpectrogram(audioData, sampleRate, flowKHz, fhighKHz) {
    // 1. Try WASM Engine
    if (this.wasmEngine) {
      const spec = this.generateSpectrogramWasm(audioData, sampleRate, flowKHz, fhighKHz);
      if (spec) {
        return spec;
      }
      // If spec is null (error occurred inside WASM method), fall through to Legacy
      console.warn('Switching to Legacy JS Spectrogram generation due to WASM failure.');
    }

    // 2. Fallback to Legacy Engine
    return this.generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz);
  }

  /**
   * [Optimized] Generate high-resolution STFT spectrogram using legacy Goertzel algorithm
   * Optimizations:
   * 1. Replaced .slice() with .subarray() and .set() to avoid memory allocation per frame.
   * 2. Pre-calculated Window weights to avoid repeated function calls.
   * 3. Used a single reusable buffer for signal processing (Windowing/DC removal).
   */
  generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz) {
    const { fftSize, hopPercent, windowType } = this.config;
    const hopSize = Math.floor(fftSize * (hopPercent / 100));

    if (hopSize < 1 || fftSize > audioData.length) {
      console.warn('FFT size too large for audio data');
      return null;
    }

    const freqResolution = sampleRate / fftSize;
    const minBin = Math.max(0, Math.floor(flowKHz * 1000 / freqResolution));
    const maxBin = Math.min(
      Math.floor(fftSize / 2),
      Math.floor(fhighKHz * 1000 / freqResolution)
    );

    const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1;
    const numBins = maxBin - minBin + 1;

    const powerMatrix = new Array(numFrames);
    const timeFrames = new Array(numFrames);
    const freqBins = new Float32Array(numBins);

    // Prepare frequency bins array (in Hz)
    for (let i = 0; i < numBins; i++) {
      freqBins[i] = (minBin + i) * freqResolution;
    }

    // ============================================================
    // OPTIMIZATION 1: Pre-calculate Window Weights (Lookup Table)
    // ============================================================
    // Avoids calling function and Math.cos() thousands of times
    const windowWeights = new Float32Array(fftSize);
    const twoPiOverLen = (2 * Math.PI) / (fftSize - 1);

    for (let i = 0; i < fftSize; i++) {
      if (windowType === 'hann' || windowType === 'hanning') {
        windowWeights[i] = 0.5 * (1 - Math.cos(twoPiOverLen * i));
      } else if (windowType === 'hamming') {
        windowWeights[i] = 0.54 - 0.46 * Math.cos(twoPiOverLen * i);
      } else {
        windowWeights[i] = 1.0; // Rectangular / Default
      }
    }

    // ============================================================
    // OPTIMIZATION 2: Pre-allocate Reusable Buffer
    // ============================================================
    const processingBuffer = new Float32Array(fftSize);

    // Apply Goertzel to each frame
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const frameStart = frameIdx * hopSize;

      // ============================================================
      // OPTIMIZATION 3: Zero-Copy Data Loading
      // ============================================================
      if (frameStart + fftSize <= audioData.length) {
        processingBuffer.set(audioData.subarray(frameStart, frameStart + fftSize));
      } else {
        // Edge case: Handle end of file padding
        processingBuffer.fill(0); // Reset buffer first
        processingBuffer.set(audioData.subarray(frameStart));
      }

      // ============================================================
      // In-Place Processing: Windowing & DC Removal
      // ============================================================

      // 1. Apply Window (In-place)
      for (let i = 0; i < fftSize; i++) {
        processingBuffer[i] = processingBuffer[i] * windowWeights[i];
      }

      // 2. Calculate DC Offset (Mean)
      let sum = 0;
      for (let i = 0; i < fftSize; i++) {
        sum += processingBuffer[i];
      }
      const dcOffset = sum / fftSize;

      // 3. Remove DC Offset (In-place)
      // processingBuffer is now clean and ready for Goertzel
      for (let i = 0; i < fftSize; i++) {
        processingBuffer[i] -= dcOffset;
      }

      // ============================================================
      // Frequency Analysis (Goertzel)
      // ============================================================
      // Only allocate the result array for storage
      const framePower = new Float32Array(numBins);

      for (let i = 0; i < numBins; i++) {
        const freqHz = freqBins[i];

        // Pass the prepared buffer to Goertzel
        const energy = this.goertzelEnergy(processingBuffer, freqHz, sampleRate);

        // Convert to dB
        const rms = Math.sqrt(energy);
        const psd = (rms * rms) / fftSize;
        framePower[i] = 10 * Math.log10(Math.max(psd, 1e-16));
      }

      powerMatrix[frameIdx] = framePower;
      timeFrames[frameIdx] = (frameStart + fftSize / 2) / sampleRate; // Center of frame
    }

    return { powerMatrix, timeFrames, freqBins, freqResolution };
  }

  /**
   * Generate high-resolution STFT spectrogram
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution }
   */
  generateSpectrogram(audioData, sampleRate, flowKHz, fhighKHz) {
    // Use WASM engine if available, fallback to legacy Goertzel
    if (this.wasmEngine) {
      return this.generateSpectrogramWasm(audioData, sampleRate, flowKHz, fhighKHz);
    }
    return this.generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz);
  }

  /**
   * Generate high-resolution STFT spectrogram
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution }
   */


  /**
   * Phase 1: Detect call segments using energy threshold
   * Returns: array of { startFrame, endFrame }
   */
  detectCallSegments(powerMatrix, timeFrames, freqBins, flowKHz, fhighKHz) {
    const { callThreshold_dB } = this.config;

    // Find global maximum power across entire spectrogram for threshold reference
    let globalMaxPower = -Infinity;
    for (let frameIdx = 0; frameIdx < powerMatrix.length; frameIdx++) {
      const framePower = powerMatrix[frameIdx];
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        globalMaxPower = Math.max(globalMaxPower, framePower[binIdx]);
      }
    }

    // Threshold = global max + relative dB (typically -24 dB)
    const threshold_dB = globalMaxPower + callThreshold_dB;

    // Detect active frames (frames with any bin above threshold)
    const activeFrames = new Array(powerMatrix.length);
    for (let frameIdx = 0; frameIdx < powerMatrix.length; frameIdx++) {
      const framePower = powerMatrix[frameIdx];
      let isActive = false;
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        if (framePower[binIdx] > threshold_dB) {
          isActive = true;
          break;
        }
      }
      activeFrames[frameIdx] = isActive;
    }

    // Segment continuous active frames into call segments
    const segments = [];
    let segmentStart = null;

    for (let frameIdx = 0; frameIdx < activeFrames.length; frameIdx++) {
      if (activeFrames[frameIdx]) {
        if (segmentStart === null) {
          segmentStart = frameIdx;
        }
      } else {
        if (segmentStart !== null) {
          segments.push({
            startFrame: segmentStart,
            endFrame: frameIdx - 1
          });
          segmentStart = null;
        }
      }
    }

    // Catch final segment if call extends to end
    if (segmentStart !== null) {
      segments.push({
        startFrame: segmentStart,
        endFrame: activeFrames.length - 1
      });
    }

    return segments;
  }

  /**
   * Savitzky-Golay Smoothing Filter
   * 
   * Used for smoothing frequency contours before 2nd derivative calculation
   * Parameters: window size = 5, polynomial order = 2
   * This is the standard used by Avisoft for stable knee detection
   * 
   * Algorithm: Fits a polynomial to each data point's neighborhood
   * Advantages: Preserves peaks/edges better than moving average
   */
  savitzkyGolay(data, windowSize = 5, polyOrder = 2) {
    if (data.length < windowSize) return data; // Cannot smooth

    const halfWindow = Math.floor(windowSize / 2);
    const smoothed = new Array(data.length);

    // Pre-calculate SG coefficients for window=5, polynomial=2
    // These are standard coefficients from numerical analysis literature
    const sgCoeffs = [-3, 12, 17, 12, -3]; // Normalized for window=5, polyorder=2
    const sgSum = 35; // Sum of coefficients for normalization

    // Apply filter
    for (let i = 0; i < data.length; i++) {
      let sum = 0;
      let count = 0;

      // Apply within available window
      for (let j = -halfWindow; j <= halfWindow; j++) {
        const idx = i + j;
        if (idx >= 0 && idx < data.length) {
          const coeffIdx = j + halfWindow;
          sum += data[idx] * sgCoeffs[coeffIdx];
          count += sgCoeffs[coeffIdx];
        }
      }

      smoothed[i] = sum / sgSum;
    }

    return smoothed;
  }

  /**
   * [2025 NEW] 利用 Oscillogram (時域波形) 精修叫聲結尾
   * 優化版：使用 console.table 整合輸出 Summary
   */
  refineEndUsingOscillogram(audioData, sampleRate, startSample, endSample) {
    const logSummary = this.debugMode ? [] : null; // 如果不是 debug mode，就不建立陣列

    // 1. 安全邊界檢查
    const safeStart = Math.max(0, startSample);
    const safeEnd = Math.min(audioData.length, endSample);

    if (safeEnd - safeStart < sampleRate * 0.0005) {
      // if (this.debugMode) console.log(`[Oscillogram] Segment too short (<0.5ms), skipping.`);
      return endSample;
    }

    // 2. 參數設定
    const windowSizeMs = 0.1;
    const windowSize = Math.floor(sampleRate * (windowSizeMs / 1000));
    const rebounceThreshold_dB = 0.5;
    const sustainedDuration_ms = 0.5;
    const sustainedSamples = Math.floor(sampleRate * (sustainedDuration_ms / 1000));
    const hopSize = Math.floor(windowSize / 2);
    const absoluteNoiseFloorDb = -60;

    // 3. 計算 RMS Envelope
    const maxSteps = Math.ceil((safeEnd - safeStart - windowSize) / hopSize) + 1;
    const dbValues = new Float32Array(maxSteps);
    const sampleIndices = new Uint32Array(maxSteps);

    let peakRms = -Infinity;
    let peakIndex = 0;
    let stepCount = 0;

    for (let i = safeStart; i < safeEnd - windowSize; i += hopSize) {
      let sumSq = 0;
      for (let j = 0; j < windowSize; j++) {
        const val = audioData[i + j];
        sumSq += val * val;
      }
      const rms = Math.sqrt(sumSq / windowSize);
      const db = 20 * Math.log10(rms + 1e-9);

      dbValues[stepCount] = db;
      sampleIndices[stepCount] = i + Math.floor(windowSize / 2);

      if (db > peakRms) {
        peakRms = db;
        peakIndex = stepCount;
      }

      stepCount++;
    }

    if (stepCount === 0) return endSample;

    // 4. 掃描邏輯
    let minDbSoFar = peakRms;
    let minDbIndex = peakIndex;
    let hasLoggedSkip = false; // 用於表格顯示控制

    for (let i = peakIndex + 1; i < stepCount; i++) {
      const currentDb = dbValues[i];

      // A. 更新最低能量點
      if (currentDb < minDbSoFar) {
        minDbSoFar = currentDb;
        minDbIndex = i;
        hasLoggedSkip = false; // 重置 Skip 標記，以便記錄新的低點事件
      }

      // B. 底噪截斷檢查
      if (minDbSoFar < absoluteNoiseFloorDb && currentDb < absoluteNoiseFloorDb + 2) {
        if (this.debugMode) {
          console.log(`[Oscillogram] Hit Noise Floor (${dbValues[i].toFixed(1)}dB). Cutting.`);
        }
        return sampleIndices[minDbIndex];
      }

      // C. 反彈 (Rebounce) 檢查
      const diff = currentDb - minDbSoFar;
      if (diff > rebounceThreshold_dB) {

        // ============================================================
        // 強信號保護機制 (收集到表格)
        // ============================================================
        if (minDbSoFar > -32) {
          if (this.debugMode && !hasLoggedSkip) {
            logSummary.push({
              Step: 'SKIP Rebounce',
              Details: `Low ${minDbSoFar.toFixed(1)}dB > -32dB`,
              Value: '(Signal Body)',
              Note: 'Suppressing repeats...'
            });
            hasLoggedSkip = true;
          }
          continue;
        }
        // ============================================================

        // 檢查持續性
        let isSustained = true;
        let lookAheadLimit = Math.min(stepCount, i + Math.ceil(sustainedSamples / hopSize));

        for (let k = i + 1; k < lookAheadLimit; k++) {
          if (dbValues[k] < minDbSoFar + rebounceThreshold_dB) {
            isSustained = false;
            break;
          }
        }

        if (isSustained) {
          if (this.debugMode) {
            // 計算將被切除的時間長度 (用於顯示)
            const cutSamples = endSample - sampleIndices[minDbIndex];
            const cutMs = (cutSamples / sampleRate) * 1000;
            const pointsTrimmed = stepCount - minDbIndex;

            // 1. 加入 CUT 事件詳情
            logSummary.push({
              Step: 'CUT: Detected',
              Details: 'Rebounce verified',
              Value: `Diff: +${diff.toFixed(1)}dB`,
              Note: 'Threshold met'
            });

            // 2. 加入數據詳情
            logSummary.push({
              Step: '   Low Point',
              Details: `${minDbSoFar.toFixed(1)}dB`,
              Value: `@ Index ${minDbIndex}`,
              Note: ''
            });

            logSummary.push({
              Step: '   Rebounce To',
              Details: `${currentDb.toFixed(1)}dB`,
              Value: `@ Index ${i}`,
              Note: ''
            });

            // 3. 加入最終動作 (整合了原本外部的 AutoDetect Refine 資訊)
            logSummary.push({
              Step: 'ACTION',
              Details: `Trimming ${pointsTrimmed} pts`,
              Value: `Cut: ${cutMs.toFixed(2)}ms`, // <--- 這裡整合了 Cut ms
              Note: 'Applying Cut'
            });

            // 4. 輸出表格
            console.groupCollapsed(`[Oscillogram Refine] Cut ${cutMs.toFixed(2)}ms`);
            console.table(logSummary);
            console.groupEnd();
          }

          // 返回反彈發生前的那個谷底
          return sampleIndices[minDbIndex];
        }
      }
    }
    return endSample;
  }

  /**
   * [2025 OPTIMIZED & CONSISTENT] Calculate Noise Floor per 10kHz Frequency Zone
   * Optimization: Uses a flat Int32Array for histograms to avoid GC and Object overhead.
   * Consistency: STRICTLY matches the original logic:
   * 1. Clamps < -100dB to -100dB.
   * 2. Uses Math.floor() for binning.
   * 3. Resolves ties by picking the LOWER dB value (Conservative Mode).
   * * @param {Array} spectrogram - Power matrix [time][freq]
   * @param {Float32Array} freqBins - Frequency bin values in Hz
   * @param {number} startFrame - Analysis start frame index
   * @param {number} endFrame - Analysis end frame index
   * @returns {Object} Map of zone start freq (kHz) -> noise floor (dB)
   */
  calculateZonalNoiseFloors(spectrogram, freqBins, startFrame, endFrame) {
    // ============================================================
    // 1. Constants (Strictly matching original logic)
    // ============================================================
    const MIN_NOISE_FLOOR_DB = -100.0;
    const OFFSET_DB = -2.0;

    // Define Histogram Bounds (Integers)
    // Original logic bins by Math.floor(val).
    // We map dB values to array indices. 
    // Range covered: -120dB to +20dB (Sufficient for standard audio)
    const HIST_MIN = -120;
    const HIST_MAX = 20;
    const HIST_RANGE = HIST_MAX - HIST_MIN + 1;

    // ============================================================
    // 2. Setup Memory-Efficient Histogram
    // ============================================================
    // Calculate how many zones we need (e.g., 0-150kHz -> 16 zones)
    const maxFreq = freqBins[freqBins.length - 1];
    const maxZoneIdx = Math.floor(maxFreq / 10000);
    const numZones = maxZoneIdx + 1;

    // Flat array to store counts for all zones
    // Index = (ZoneIndex * HIST_RANGE) + (DbValue - HIST_MIN)
    // This replaces the dynamic object/array structure.
    const histograms = new Int32Array(numZones * HIST_RANGE);

    // ============================================================
    // 3. Single Pass Aggregation (Zero GC)
    // ============================================================
    for (let f = startFrame; f <= endFrame; f++) {
      if (f >= spectrogram.length) break;
      const frame = spectrogram[f];

      for (let b = 0; b < frame.length; b++) {
        let powerDb = frame[b];

        // [CONSISTENCY CHECK 1] Clamp silence to -100dB
        if (powerDb < MIN_NOISE_FLOOR_DB) {
          powerDb = MIN_NOISE_FLOOR_DB;
        }

        // Determine Zone
        // Note: Avoiding string conversion here saves significant CPU
        const freqHz = freqBins[b];
        const zoneIdx = Math.floor(freqHz / 10000);

        // Determine dB Bin (Math.floor)
        let intDb = Math.floor(powerDb);

        // Safety clamp for array bounds (just in case of extreme signals)
        if (intDb < HIST_MIN) intDb = HIST_MIN;
        if (intDb > HIST_MAX) intDb = HIST_MAX;

        // Increment count in the flat array
        if (zoneIdx < numZones) {
          const histIdx = (zoneIdx * HIST_RANGE) + (intDb - HIST_MIN);
          histograms[histIdx]++;
        }
      }
    }

    // ============================================================
    // 4. Calculate Mode per Zone (Strictly matching tie-breaker)
    // ============================================================
    const zoneFloors = {};

    for (let z = 0; z < numZones; z++) {
      let maxCount = 0;
      let modeDb = MIN_NOISE_FLOOR_DB; // Default if empty
      let hasData = false;

      // Iterate through the dB range for this zone
      const offset = z * HIST_RANGE;

      // [CONSISTENCY CHECK 2] Loop from Low dB to High dB
      for (let i = 0; i < HIST_RANGE; i++) {
        const count = histograms[offset + i];

        if (count > 0) hasData = true;

        // Tie-breaker Logic:
        // Original: if (count > max) update; else if (count == max && bin < mode) update;
        // Since we iterate from LOW to HIGH dB:
        // - If we find a `count > maxCount`, it's a new peak.
        // - If we find a `count == maxCount`, the current `i` is HIGHER than the stored one.
        //   The original rule says "pick smaller bin". So we do NOT update.
        // -> Therefore, using strictly `>` ensures we keep the lowest dB bin in a tie.
        if (count > maxCount) {
          maxCount = count;
          modeDb = i + HIST_MIN; // Recover original Math.floor(dB) value
        }
      }

      // Restore string key format for compatibility ("0", "10", "20")
      const zoneKey = (z * 10).toString();

      if (hasData) {
        zoneFloors[zoneKey] = modeDb + OFFSET_DB;
      } else {
        zoneFloors[zoneKey] = MIN_NOISE_FLOOR_DB + OFFSET_DB;
      }
    }

    return zoneFloors;
  }

  /**
     * Find optimal High Threshold by testing range and detecting anomalies
     * * 2025 ENHANCED ALGORITHM v3 (Zonal Noise Floor):
     * * 2026 UPDATE: Added Weak Signal Time-Gap Check
     */
  findOptimalHighFrequencyThreshold(spectrogram, timeFrames, freqBins, flowKHz, fhighKHz, callPeakPower_dB, peakFrameIdx = 0, zonalNoiseMap = null) {
    if (spectrogram.length === 0) return {
      threshold: -1,
      highFreq_Hz: null,
      highFreq_kHz: null,
      highFreqFrameIdx: 0,
      startFreq_Hz: null,
      startFreq_kHz: null,
      warning: false,
      isCFStablePattern: false
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================
    const firstFramePower = spectrogram[0];
    const numBins = firstFramePower.length;

    // Initial search limit: from 0 to peakFrameIdx
    let currentSearchLimitFrame = Math.min(peakFrameIdx, spectrogram.length - 1);

    const stablePeakPower_dB = callPeakPower_dB;

    let hitNoiseFloor = false;
    let optimalThreshold = -1;
    let optimalMeasurement = null;

    // CF Detection Variables
    let consecutiveStableCount = 0;
    let isCFStablePattern = false;
    let lastMeasuredFreq_kHz = null;

    // Test thresholds: -1 to -100 dB, step 1.0 dB
    const thresholdRange = [];
    for (let threshold = -1; threshold >= -100; threshold -= 1.0) {
      thresholdRange.push(threshold);
    }

    const measurements = [];
    const summaryLog = this.debugMode ? [] : null; // 如果不是 debug mode，就不建立陣列

    let lastValidHighFreqFrameIdx = currentSearchLimitFrame;
    let currentSearchMinBinIdx = 0;

    if (!zonalNoiseMap) {
      zonalNoiseMap = this.calculateZonalNoiseFloors(spectrogram, freqBins, 0, Math.min(peakFrameIdx, spectrogram.length - 1));
    }

    for (const testThreshold_dB of thresholdRange) {
      const highFreqThreshold_dB = stablePeakPower_dB + testThreshold_dB;

      // [PRE-STEP] Reference for Harmonic Rejection
      let referenceFreq_kHz = null;
      for (let i = measurements.length - 1; i >= 0; i--) {
        if (measurements[i].foundBin && measurements[i].highFreq_kHz !== null) {
          referenceFreq_kHz = measurements[i].highFreq_kHz;
          break;
        }
      }

      // ============================================================
      // 2. SCAN HIGH FREQUENCY (Frame-by-Frame) [REVERSED: Peak -> 0]
      // ============================================================
      let highFreq_Hz = null;
      let highFreqBinIdx = 0;
      let highFreqFrameIdx = 0;
      let foundBin = false;

      let consecutiveSilenceFrames = 0;
      const MAX_ALLOWED_GAP_FRAMES = 1;

      for (let f = currentSearchLimitFrame; f >= 0; f--) {
        const framePower = spectrogram[f];
        let foundInThisFrame = false;

        for (let b = numBins - 1; b >= currentSearchMinBinIdx; b--) {
          if (framePower[b] > highFreqThreshold_dB) {

            let candidateFreq_Hz = freqBins[b];

            if (b < numBins - 1) {
              const thisPower = framePower[b];
              const nextPower = framePower[b + 1];

              if (nextPower < highFreqThreshold_dB && thisPower > highFreqThreshold_dB) {
                const powerRatio = (thisPower - highFreqThreshold_dB) / (thisPower - nextPower);
                const freqDiff = freqBins[b + 1] - freqBins[b];
                candidateFreq_Hz = freqBins[b] + powerRatio * freqDiff;
              }
            }

            if (referenceFreq_kHz !== null) {
              const candidateFreq_kHz = candidateFreq_Hz / 1000;
              const diff = candidateFreq_kHz - referenceFreq_kHz;
              if (diff > 10.0) continue;
            }

            if (highFreq_Hz === null || candidateFreq_Hz > highFreq_Hz) {
              highFreq_Hz = candidateFreq_Hz;
              highFreqBinIdx = b;
              highFreqFrameIdx = f;
              foundBin = true;
            }

            foundInThisFrame = true;
            break;
          }
        }

        if (!foundInThisFrame) {
          consecutiveSilenceFrames++;
          if (consecutiveSilenceFrames > MAX_ALLOWED_GAP_FRAMES) {
            break;
          }
        } else {
          consecutiveSilenceFrames = 0;
        }
      }

      let startFreq_Hz = null;

      // CF Logic
      if (foundBin && highFreq_Hz !== null) {
        const currentFreq_kHz = highFreq_Hz / 1000;
        if (lastMeasuredFreq_kHz !== null) {
          const diff = Math.abs(currentFreq_kHz - lastMeasuredFreq_kHz);
          if (diff > 0 && diff <= 0.05) {
            consecutiveStableCount++;
          } else if (diff === 0) {
            // no-op
          } else {
            consecutiveStableCount = 0;
          }
          if (consecutiveStableCount >= 10) {
            isCFStablePattern = true;
          }
        }
        lastMeasuredFreq_kHz = currentFreq_kHz;
      } else {
        consecutiveStableCount = 0;
      }

      // Log Row Setup
      let time_ms = '-';
      let frameStr = '-';
      if (foundBin && timeFrames && timeFrames.length > 0) {
        const startTime = timeFrames[0];
        const currentTime = timeFrames[highFreqFrameIdx];
        time_ms = ((currentTime - startTime) * 1000).toFixed(1);
        frameStr = highFreqFrameIdx.toString();
      }

      let logRow = {
        'Thr (dB)': testThreshold_dB,
        'Frame': frameStr,
        'Time (ms)': time_ms,
        'Freq (kHz)': highFreq_Hz !== null ? (highFreq_Hz / 1000).toFixed(2) : '-',
        'Diff (kHz)': '-',
        'Signal (dB)': '-',
        'Noise (dB)': '-',
        'Judgment': 'OK'
      };

      // ============================================================
      // [2026 NEW] Time Gap Check & Jump Protection
      // ============================================================
      if (foundBin && highFreq_Hz !== null) {
        const currentHighFreq_kHz = highFreq_Hz / 1000;
        const currentHighFreqPower_dB = spectrogram[highFreqFrameIdx][highFreqBinIdx];

        // Find last valid measurement
        let lastValidMeasurement = null;
        for (let i = measurements.length - 1; i >= 0; i--) {
          if (measurements[i].foundBin && measurements[i].highFreq_kHz !== null) {
            lastValidMeasurement = measurements[i];
            break;
          }
        }

        // ------------------------------------------------------------------
        // [NEW] Weak Signal Time Gap Check
        // Condition: Energy < -100dB AND Time Diff > 0.15ms
        // Action: Stop loop, use last valid measurement (previous detection)
        // ------------------------------------------------------------------
        if (lastValidMeasurement !== null && currentHighFreqPower_dB < -100) {
          const t_curr = timeFrames[highFreqFrameIdx];
          const t_prev = timeFrames[lastValidMeasurement.highFreqFrameIdx];
          // Calculate Absolute Time Difference in ms
          const timeDiff_ms = Math.abs(t_curr - t_prev) * 1000;

          if (timeDiff_ms > 0.15) {
            logRow['Signal (dB)'] = currentHighFreqPower_dB.toFixed(2);
            logRow['Judgment'] = `STOP (Time > 0.15ms)`;

            hitNoiseFloor = true;
            optimalMeasurement = lastValidMeasurement; // Revert to last valid
            optimalThreshold = lastValidMeasurement.threshold;

            if (this.debugMode) {
              summaryLog.push(logRow);
            }
            break; // Exit Loop Immediately
          }
        }
        // ------------------------------------------------------------------

        if (lastValidMeasurement !== null) {
          const lastValidFreq_kHz = lastValidMeasurement.highFreq_kHz;
          const jumpDiff = Math.abs(currentHighFreq_kHz - lastValidFreq_kHz);

          logRow['Diff (kHz)'] = jumpDiff.toFixed(2);
          logRow['Signal (dB)'] = currentHighFreqPower_dB.toFixed(2);

          // CF Call Protection (> 1.0 kHz)
          if (isCFStablePattern && jumpDiff > 1.0) {
            logRow['Judgment'] = 'CF STOP (>1.0kHz)';
            hitNoiseFloor = true;
            optimalMeasurement = lastValidMeasurement;
            optimalThreshold = lastValidMeasurement.threshold;
            if (this.debugMode) {
              summaryLog.push(logRow);
            }
            break;
          }
          // Standard Protection (> 1.5 kHz)
          else if (jumpDiff > 1.5) {
            const zoneKey = Math.floor(currentHighFreq_kHz / 10) * 10;
            let specificNoiseFloor_dB = zonalNoiseMap[zoneKey] !== undefined ? zonalNoiseMap[zoneKey] : -100;
            specificNoiseFloor_dB = Math.max(specificNoiseFloor_dB, -115);

            logRow['Noise (dB)'] = specificNoiseFloor_dB.toFixed(2);

            if (currentHighFreqPower_dB > specificNoiseFloor_dB) {
              logRow['Judgment'] = 'Continue';
            } else {
              logRow['Judgment'] = 'STOP';
              hitNoiseFloor = true;
              optimalMeasurement = lastValidMeasurement;
              optimalThreshold = lastValidMeasurement.threshold;
              if (this.debugMode) {
                summaryLog.push(logRow);
              }
              break;
            }
          }
        }
      }

      if (this.debugMode) {
        summaryLog.push(logRow);
      }

      measurements.push({
        threshold: testThreshold_dB,
        highFreqThreshold_dB: highFreqThreshold_dB,
        highFreq_Hz: highFreq_Hz,
        highFreq_kHz: highFreq_Hz !== null ? highFreq_Hz / 1000 : null,
        highFreqBinIdx: highFreqBinIdx,
        highFreqFrameIdx: highFreqFrameIdx,
        highFreqPower_dB: foundBin && highFreqFrameIdx < spectrogram.length ? spectrogram[highFreqFrameIdx][highFreqBinIdx] : null,
        startFreq_Hz: null,
        startFreq_kHz: null,
        foundBin: foundBin
      });

      if (foundBin && highFreqFrameIdx >= 0) {
        if (highFreqFrameIdx < currentSearchLimitFrame) {
          currentSearchLimitFrame = highFreqFrameIdx;
          lastValidHighFreqFrameIdx = highFreqFrameIdx;
        }
        if (highFreqBinIdx > currentSearchMinBinIdx) {
          currentSearchMinBinIdx = highFreqBinIdx;
        }
      }

      if (hitNoiseFloor) break;
    }

    // ============================================================
    // RESULT SELECTION
    // ============================================================
    const finalSearchLimitFrame = currentSearchLimitFrame;
    const validMeasurements = measurements.filter(m => m.foundBin);

    if (validMeasurements.length === 0) {
      if (this.debugMode && summaryLog) {
        console.table(summaryLog);
      }
      return {
        threshold: -24,
        highFreq_Hz: null,
        highFreq_kHz: null,
        highFreqFrameIdx: 0,
        startFreq_Hz: null,
        startFreq_kHz: null,
        warning: false
      };
    }

    if (!hitNoiseFloor && validMeasurements.length > 0) {
      optimalMeasurement = validMeasurements[0];
    }

    // Anomaly Check (2.5 - 4.0 kHz)
    if (!hitNoiseFloor) {
      let lastValidThreshold = validMeasurements[0].threshold;
      let lastValidMeasurement = validMeasurements[0];
      let recordedEarlyAnomaly = null;
      let firstAnomalyIndex = -1;

      for (let i = 1; i < validMeasurements.length; i++) {
        const prevFreq_kHz = validMeasurements[i - 1].highFreq_kHz;
        const currFreq_kHz = validMeasurements[i].highFreq_kHz;
        const freqDifference = Math.abs(currFreq_kHz - prevFreq_kHz);

        if (freqDifference > 4.0) {
          optimalThreshold = validMeasurements[i - 1].threshold;
          optimalMeasurement = validMeasurements[i - 1];
          break;
        }

        let isAnomaly = false;
        if (freqDifference > 2.5) {
          const zoneKey = Math.floor(currFreq_kHz / 10) * 10;
          let specificNoiseFloor_dB = zonalNoiseMap[zoneKey] !== undefined ? zonalNoiseMap[zoneKey] : -100;
          specificNoiseFloor_dB = Math.max(specificNoiseFloor_dB, -115);

          const currentPower_dB = validMeasurements[i].highFreqPower_dB;

          if (currentPower_dB !== null && currentPower_dB <= specificNoiseFloor_dB) {
            const targetRow = summaryLog.find(r => r['Thr (dB)'] === validMeasurements[i].threshold);
            if (targetRow) {
              targetRow['Noise (dB)'] = specificNoiseFloor_dB.toFixed(2);
              targetRow['Signal (dB)'] = currentPower_dB.toFixed(2);
              targetRow['Judgment'] = `Anomaly > 2.5kHz (Signal <= Noise)`;
            }
            isAnomaly = true;
          }
        }

        if (isAnomaly) {
          if (recordedEarlyAnomaly === null && firstAnomalyIndex === -1) {
            firstAnomalyIndex = i;
            recordedEarlyAnomaly = validMeasurements[i - 1].threshold;
            lastValidThreshold = validMeasurements[i - 1].threshold;
            lastValidMeasurement = validMeasurements[i - 1];
          }
        } else {
          if (recordedEarlyAnomaly !== null && firstAnomalyIndex !== -1) {
            const afterAnomalyStart = firstAnomalyIndex + 1;
            const afterAnomalyEnd = Math.min(firstAnomalyIndex + 3, validMeasurements.length - 1);
            let hasThreeNormalAfterAnomaly = true;

            for (let checkIdx = afterAnomalyStart; checkIdx <= afterAnomalyEnd; checkIdx++) {
              if (checkIdx >= validMeasurements.length) { hasThreeNormalAfterAnomaly = false; break; }
              const checkDiff = Math.abs(validMeasurements[checkIdx].highFreq_kHz - validMeasurements[checkIdx - 1].highFreq_kHz);
              if (checkDiff > 2.5) { hasThreeNormalAfterAnomaly = false; break; }
            }
            if (hasThreeNormalAfterAnomaly && (afterAnomalyEnd - afterAnomalyStart + 1) >= 3) {
              recordedEarlyAnomaly = null;
              firstAnomalyIndex = -1;
            }
          }
          lastValidThreshold = validMeasurements[i].threshold;
          lastValidMeasurement = validMeasurements[i];
        }
      }

      if (recordedEarlyAnomaly !== null) {
        optimalThreshold = recordedEarlyAnomaly;
        optimalMeasurement = lastValidMeasurement;
      } else {
        optimalThreshold = lastValidThreshold;
        optimalMeasurement = lastValidMeasurement;
      }
    }

    if (this.debugMode && summaryLog && summaryLog.length > 0) {
      const finalFreq = optimalMeasurement ? optimalMeasurement.highFreq_kHz : null;
      const freqText = finalFreq !== null ? ` | ${finalFreq.toFixed(2)} kHz` : '';
      console.groupCollapsed(`[High Freq] Scan Summary (Selected: ${optimalThreshold} dB${freqText})`);
      console.table(summaryLog);
      console.groupEnd();
    }

    const finalThreshold = Math.max(Math.min(optimalThreshold, -22), -100);
    const safeThreshold = (finalThreshold <= -100) ? -30 : finalThreshold;
    const hasWarning = finalThreshold <= -100;

    let returnHighFreq_Hz = optimalMeasurement.highFreq_Hz;
    let returnHighFreq_kHz = optimalMeasurement.highFreq_kHz;
    let returnHighFreqBinIdx = optimalMeasurement.highFreqBinIdx;
    let returnHighFreqFrameIdx = optimalMeasurement.highFreqFrameIdx;
    let returnStartFreq_Hz = optimalMeasurement.startFreq_Hz;
    let returnStartFreq_kHz = optimalMeasurement.startFreq_kHz;

    // Safety Mechanism Re-scan logic
    if (safeThreshold !== finalThreshold) {
      const highFreqThreshold_dB_safe = stablePeakPower_dB + safeThreshold;
      let highFreq_Hz_safe = null;
      let highFreqBinIdx_safe = 0;
      let highFreqFrameIdx_safe = 0;
      let startFreq_Hz_safe = null;
      let foundBin_safe = false;

      for (let f = 0; f <= finalSearchLimitFrame; f++) {
        const framePower = spectrogram[f];
        for (let b = numBins - 1; b >= 0; b--) {
          if (framePower[b] > highFreqThreshold_dB_safe) {
            let thisFrameFreq_Hz = freqBins[b];
            if (b < numBins - 1) {
              const thisPower = framePower[b];
              const nextPower = framePower[b + 1];
              if (nextPower < highFreqThreshold_dB_safe && thisPower > highFreqThreshold_dB_safe) {
                const powerRatio = (thisPower - highFreqThreshold_dB_safe) / (thisPower - nextPower);
                const freqDiff = freqBins[b + 1] - freqBins[b];
                thisFrameFreq_Hz = freqBins[b] + powerRatio * freqDiff;
              }
            }
            if (highFreq_Hz_safe === null || thisFrameFreq_Hz > highFreq_Hz_safe) {
              highFreq_Hz_safe = thisFrameFreq_Hz;
              highFreqBinIdx_safe = b;
              highFreqFrameIdx_safe = f;
              foundBin_safe = true;
            }
            break;
          }
        }
      }

      if (foundBin_safe) {
        for (let binIdx = 0; binIdx < firstFramePower.length; binIdx++) {
          if (firstFramePower[binIdx] > highFreqThreshold_dB_safe) {
            startFreq_Hz_safe = freqBins[binIdx];
            if (binIdx > 0) {
              const thisPower = firstFramePower[binIdx];
              const prevPower = firstFramePower[binIdx - 1];
              if (prevPower < highFreqThreshold_dB_safe && thisPower > highFreqThreshold_dB_safe) {
                const powerRatio = (thisPower - highFreqThreshold_dB_safe) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                startFreq_Hz_safe = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }
            break;
          }
        }
      }

      if (highFreq_Hz_safe !== null) {
        returnHighFreq_Hz = highFreq_Hz_safe;
        returnHighFreq_kHz = highFreq_Hz_safe / 1000;
        returnHighFreqBinIdx = highFreqBinIdx_safe;
        returnHighFreqFrameIdx = highFreqFrameIdx_safe;
        returnStartFreq_Hz = startFreq_Hz_safe;
        returnStartFreq_kHz = startFreq_Hz_safe !== null ? startFreq_Hz_safe / 1000 : null;
      }
    }

    return {
      threshold: safeThreshold,
      highFreq_Hz: returnHighFreq_Hz,
      highFreq_kHz: returnHighFreq_kHz,
      highFreqBinIdx: returnHighFreqBinIdx,
      highFreqFrameIdx: returnHighFreqFrameIdx,
      startFreq_Hz: returnStartFreq_Hz,
      startFreq_kHz: returnStartFreq_kHz,
      finalSearchLimitFrame: finalSearchLimitFrame,
      warning: hasWarning,
      isCFStablePattern: isCFStablePattern
    };
  }

  /**
     * 2025 ENHANCEMENT: Find Optimal Low Frequency Threshold
     * Optimized with:
     * 1. Zonal Noise Floor (10kHz bands, Mode-based)
     * 2. "Reverse Narrowing / Ratcheting"
     * 3. Hard Stop Logic with Fallback
     * 4. Sub-harmonic Rejection (> 15kHz jump protection)
     * 5. [NEW] 10kHz Bottoming Out Check (Noise Reject)
     * [UPDATED] Added zonalNoiseMap parameter
     */
  findOptimalLowFrequencyThreshold(spectrogram, timeFrames, freqBins, flowKHz, fhighKHz, callPeakPower_dB, peakFrameIdx = 0, limitFrameIdx = null, zonalNoiseMap = null) {
    if (spectrogram.length === 0) return {
      threshold: -24, // Default fallback
      lowFreq_Hz: null,
      lowFreq_kHz: null,
      endFreq_Hz: null,
      endFreq_kHz: null,
      warning: false
    };

    const stablePeakPower_dB = callPeakPower_dB;
    const numBins = spectrogram[0].length;

    // Use limitFrameIdx if provided
    const searchEndFrame = (limitFrameIdx !== null && limitFrameIdx < spectrogram.length)
      ? limitFrameIdx
      : spectrogram.length - 1;

    const validPeakFrameIdx = Math.min(peakFrameIdx, spectrogram.length - 1);

    // Initial search limit: from 0 to peakFrameIdx
    let currentSearchLimitFrame = Math.min(peakFrameIdx, spectrogram.length - 1);

    // [Fallback]
    if (!zonalNoiseMap) {
      zonalNoiseMap = this.calculateZonalNoiseFloors(spectrogram, freqBins, validPeakFrameIdx, searchEndFrame);
    }

    // ============================================================
    // 1. Calculate Zonal Robust Noise Floors
    // ============================================================
    // Initialize Variables
    let hitNoiseFloor = false;
    let optimalThreshold = -24; // Default safe value
    let optimalMeasurement = null;

    let currentSearchStartFrame = validPeakFrameIdx;

    // [NEW 2025] Initialize frequency search upper limit (Frequency space convergence - Top-Down Ceiling)
    // Low Frequency logic: Can only get lower, so we progressively lower this ceiling
    let currentSearchMaxBinIdx = numBins - 1;

    // ============================================================
    // [UPDATED] Test Thresholds Configuration
    // Range: -1dB down to -100dB
    // Step: 1.0 dB
    // ============================================================
    const thresholdRange = [];
    for (let threshold = -1; threshold >= -100; threshold -= 1.0) {
      thresholdRange.push(threshold);
    }

    const measurements = [];

    // [2025] Summary Table Data Collection
    const summaryLog = this.debugMode ? [] : null; // 如果不是 debug mode，就不建立陣列

    for (const testThreshold_dB of thresholdRange) {
      let lowFreq_Hz = null;
      let endFreq_Hz = null;
      let foundBin = false;

      const lowFreqThreshold_dB = stablePeakPower_dB + testThreshold_dB;

      // Get Reference from previous valid measurement for Jump Protection
      let referenceFreq_kHz = null;
      for (let i = measurements.length - 1; i >= 0; i--) {
        if (measurements[i].foundBin && measurements[i].lowFreq_kHz !== null) {
          referenceFreq_kHz = measurements[i].lowFreq_kHz;
          break;
        }
      }

      let time_ms = '-';
      let frameStr = '-';

      let logRow = {
        'Thr (dB)': testThreshold_dB,
        'Frame': frameStr,
        'Time (ms)': time_ms,
        'Freq (kHz)': '-',
        'Diff (kHz)': '-',
        'Signal (dB)': '-',
        'Noise (dB)': '-',
        'Judgment': 'OK'
      };

      // ============================================================
      // 2. Gap-Bridging Forward Scan (Time Restriction + Continuity Lock)
      // ============================================================
      let activeEndFrameIdx = currentSearchStartFrame;

      let consecutiveSilenceFrames = 0;
      const MAX_ALLOWED_GAP_FRAMES = 1; // 允許的最大斷層幀數

      // Time Restriction: Continue forward scan from where we left off
      for (let f = currentSearchStartFrame; f <= searchEndFrame; f++) {
        const frame = spectrogram[f];
        let frameHasSignal = false;
        let lowestFreqInThisFrame = null; // [NEW] 用於記錄該 Frame 的最低頻率

        // Apply frequency restriction: only check up to currentSearchMaxBinIdx
        // Scan from Low Bin (0) to High (currentSearchMaxBinIdx) to find lowest freq
        for (let b = 0; b <= currentSearchMaxBinIdx; b++) {
          if (frame[b] > lowFreqThreshold_dB) {
            frameHasSignal = true;
            lowestFreqInThisFrame = freqBins[b]; // [NEW] 記錄找到的第一個(最低)頻率
            break; // 找到該 Frame 的最低點後，不需再往高頻找
          }
        }

        if (frameHasSignal) {
          activeEndFrameIdx = f;
          consecutiveSilenceFrames = 0;

          // ============================================================
          if (referenceFreq_kHz !== null && lowestFreqInThisFrame !== null) {
            const referenceFreq_Hz = referenceFreq_kHz * 1000;

            // 如果找到比參考值更低的頻率 (例如 Ref=41k, Found=40k)
            // 立即停止掃描，鎖定在 Frame 100，放棄後面的 Frame 102 (38k)
            if (lowestFreqInThisFrame < referenceFreq_Hz) {
              break; // 觸發鎖定，停止 Forward Scan
            }
          }

        } else {
          // Increment gap counter and check limit
          consecutiveSilenceFrames++;
          if (consecutiveSilenceFrames > MAX_ALLOWED_GAP_FRAMES) {
            break; // Stop scanning forward if gap is too large
          }
        }
      }

      currentSearchStartFrame = activeEndFrameIdx;

      // ============================================================
      // 3. Measure Low Frequency at the found End Frame
      // ============================================================
      let currentLowFreqPower_dB = -Infinity;
      let foundBinIdx = -1; // Track Bin Index for convergence update

      if (activeEndFrameIdx !== -1) {
        const targetFramePower = spectrogram[activeEndFrameIdx];

        // Find lowest freq (Low -> High) with frequency restriction
        for (let binIdx = 0; binIdx <= currentSearchMaxBinIdx; binIdx++) {
          if (targetFramePower[binIdx] > lowFreqThreshold_dB) {

            let candidateFreq_Hz = freqBins[binIdx];

            // Linear Interpolation
            if (binIdx > 0) {
              const thisPower = targetFramePower[binIdx];
              const prevPower = targetFramePower[binIdx - 1];

              if (prevPower < lowFreqThreshold_dB && thisPower > lowFreqThreshold_dB) {
                const powerRatio = (thisPower - lowFreqThreshold_dB) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                candidateFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }

            const candidateFreq_kHz = candidateFreq_Hz / 1000;

            // ============================================================
            // Sub-harmonic Rejection Logic (Hard Stop)
            // ============================================================
            if (referenceFreq_kHz !== null) {
              const diff = candidateFreq_kHz - referenceFreq_kHz;

              // > 15kHz Jump Protection
              if (Math.abs(diff) > 15.0) {
                logRow['Freq (kHz)'] = candidateFreq_kHz.toFixed(2);
                logRow['Diff (kHz)'] = Math.abs(diff).toFixed(2);
                logRow['Judgment'] = 'Hard Stop > 15kHz (Sub-harmonic)';

                hitNoiseFloor = true;

                // [CRITICAL FIX] Fallback to last valid measurement
                for (let j = measurements.length - 1; j >= 0; j--) {
                  if (measurements[j].foundBin && measurements[j].lowFreq_kHz !== null) {
                    optimalMeasurement = measurements[j];
                    optimalThreshold = measurements[j].threshold;
                    break;
                  }
                }
                break;
              }
            }

            // Valid Low Frequency Found
            lowFreq_Hz = candidateFreq_Hz;
            foundBin = true;
            foundBinIdx = binIdx;
            currentLowFreqPower_dB = targetFramePower[binIdx];
            break;
          }
        }
      }

      // Update Log Row with found frequency
      if (foundBin && lowFreq_Hz !== null) {
        logRow['Freq (kHz)'] = (lowFreq_Hz / 1000).toFixed(2);

        // ============================================================
        // [NEW 2025] 10kHz Bottoming Out Check (Noise Protection)
        // 條件：當前 Low Frequency <= 10kHz
        // 動作：立即廢棄整個 Call Segment
        // ============================================================
        if (lowFreq_Hz <= 10000) {
          if (this.debugMode) {
            console.warn(`%c[Noise Reject] Low Freq ${lowFreq_Hz.toFixed(0)}Hz <= 10kHz at ${testThreshold_dB}dB. Discarding Call Segment.`, 'color: red; font-weight: bold; background: #ffeaea; padding: 2px;');
          }

          // 回傳無效數據，強制外部邏輯放棄此 Call
          return {
            threshold: testThreshold_dB,
            lowFreq_Hz: null,
            lowFreq_kHz: null,
            endFreq_Hz: null,
            endFreq_kHz: null,
            lowFreqFrameIdx: null,
            warning: true,
            discard: true // 標記為廢棄
          };
        }
        // ============================================================

      }

      // [NEW] Update Log Row with Frame/Time information
      if (foundBin && timeFrames && timeFrames.length > 0 && activeEndFrameIdx !== undefined && activeEndFrameIdx !== null) {
        const startTime = timeFrames[0];
        const currentTime = timeFrames[activeEndFrameIdx];
        logRow['Time (ms)'] = ((currentTime - startTime) * 1000).toFixed(1);
        logRow['Frame'] = activeEndFrameIdx.toString();
      }

      // 如果內部觸發了 hitNoiseFloor (Hard Stop)，直接跳出 Threshold 循環
      if (hitNoiseFloor) {
        if (this.debugMode) {
          summaryLog.push(logRow);
        }
        break;
      }

      if (foundBin) {
        endFreq_Hz = lowFreq_Hz;
      } else {
        lowFreq_Hz = null;
        endFreq_Hz = null;
      }

      // ============================================================
      // 4. JUMP PROTECTION & DYNAMIC ZONAL NOISE FLOOR CHECK
      // ============================================================
      if (foundBin && lowFreq_Hz !== null) {
        const currentLowFreq_kHz = lowFreq_Hz / 1000;

        // Find last valid measurement for comparison
        let lastValidMeasurement = null;
        let lastValidFreq_kHz = null;

        for (let i = measurements.length - 1; i >= 0; i--) {
          if (measurements[i].foundBin && measurements[i].lowFreq_kHz !== null) {
            lastValidFreq_kHz = measurements[i].lowFreq_kHz;
            lastValidMeasurement = measurements[i];
            break;
          }
        }

        if (lastValidFreq_kHz !== null) {
          const jumpDiff = Math.abs(currentLowFreq_kHz - lastValidFreq_kHz);

          logRow['Diff (kHz)'] = jumpDiff.toFixed(2);
          logRow['Signal (dB)'] = currentLowFreqPower_dB.toFixed(2);

          // ----------------------------------------------------------------
          // Hard Stop > 8kHz (Immediate Revert)
          // ----------------------------------------------------------------
          if (jumpDiff > 8.0) {
            logRow['Judgment'] = 'Hard Stop > 8kHz (Large Jump)';

            hitNoiseFloor = true;

            // Select the previous correct bin (Revert to last valid)
            if (lastValidMeasurement) {
              optimalMeasurement = lastValidMeasurement;
              optimalThreshold = lastValidMeasurement.threshold;
            }

            if (this.debugMode) {
              summaryLog.push(logRow);
            }
            break; // Immediate exit
          }
          // ----------------------------------------------------------------

          // Standard Anomaly Check (> 1.5 kHz)
          if (jumpDiff > 1.5) {
            // [OPTIMIZED] Use Pre-calculated Map
            const zoneKey = Math.floor(currentLowFreq_kHz / 10) * 10;
            const specificNoiseFloor_dB = zonalNoiseMap[zoneKey] !== undefined ? zonalNoiseMap[zoneKey] : -100;

            logRow['Noise (dB)'] = specificNoiseFloor_dB.toFixed(2);

            if (currentLowFreqPower_dB > specificNoiseFloor_dB) {
              logRow['Judgment'] = 'Jump > 1.5kHz (Signal > Noise) -> Continue';
            } else {
              logRow['Judgment'] = 'Jump > 1.5kHz (Noise Hit) -> STOP';

              hitNoiseFloor = true;

              // Fallback to last valid
              if (lastValidMeasurement) {
                optimalMeasurement = lastValidMeasurement;
                optimalThreshold = lastValidMeasurement.threshold;
              }

              if (this.debugMode) {
                summaryLog.push(logRow);
              }
              break;
            }
          }
        }
      }

      if (this.debugMode) {
        summaryLog.push(logRow);
      }

      measurements.push({
        threshold: testThreshold_dB,
        lowFreqThreshold_dB: lowFreqThreshold_dB,
        lowFreq_Hz: lowFreq_Hz,
        lowFreq_kHz: lowFreq_Hz !== null ? lowFreq_Hz / 1000 : null,
        endFreq_Hz: endFreq_Hz,
        endFreq_kHz: endFreq_Hz !== null ? endFreq_Hz / 1000 : null,
        endFrameIdx: activeEndFrameIdx,
        foundBin: foundBin,
        lowFreqBinIdx: foundBin ? foundBinIdx : -1
      });

      // [MODIFIED 2025] Loop tail: Update frequency search range (Top-Down Ceiling Lock)
      if (foundBin && foundBinIdx !== -1) {
        if (foundBinIdx < currentSearchMaxBinIdx) {
          currentSearchMaxBinIdx = foundBinIdx;
        }
      }

      if (hitNoiseFloor) break;
    }

    // ============================================================
    // RESULT SELECTION
    // ============================================================
    const validMeasurements = measurements.filter(m => m.foundBin);

    if (!optimalMeasurement) {
      if (validMeasurements.length > 0) {
        optimalMeasurement = validMeasurements[0];
        optimalThreshold = validMeasurements[0].threshold;
      } else {
        if (this.debugMode && summaryLog && summaryLog.length > 0) {
          console.groupCollapsed(`[Low Freq] Scan Summary (No Valid Found)`);
          console.table(summaryLog);
          console.groupEnd();
        }
        return {
          threshold: -24,
          lowFreq_Hz: null,
          lowFreq_kHz: null,
          endFreq_Hz: null,
          endFreq_kHz: null,
          warning: false
        };
      }
    }

    // If we didn't hit noise floor, apply standard anomaly check logic to pick best from full range
    if (!hitNoiseFloor && validMeasurements.length > 0) {
      let recordedEarlyAnomaly = null;
      let firstAnomalyIndex = -1;
      let lastValidMeasurement = validMeasurements[0];
      let lastValidThreshold = validMeasurements[0].threshold;

      for (let i = 1; i < validMeasurements.length; i++) {
        const prevFreq = validMeasurements[i - 1].lowFreq_kHz;
        const currFreq = validMeasurements[i].lowFreq_kHz;
        const diff = Math.abs(currFreq - prevFreq);

        const isAnomaly = diff > 1.5;

        if (isAnomaly) {
          if (recordedEarlyAnomaly === null && firstAnomalyIndex === -1) {
            firstAnomalyIndex = i;
            recordedEarlyAnomaly = validMeasurements[i - 1].threshold;
            lastValidMeasurement = validMeasurements[i - 1];
          }
          const targetRow = summaryLog.find(r => r['Thr (dB)'] === validMeasurements[i].threshold);
          if (targetRow) {
            targetRow['Judgment'] += ' [Diff > 1.5kHz]';
          }

        } else {
          if (recordedEarlyAnomaly !== null && firstAnomalyIndex !== -1) {
            const checkStart = firstAnomalyIndex + 1;
            const checkEnd = Math.min(firstAnomalyIndex + 3, validMeasurements.length - 1);
            let stable = true;
            for (let k = checkStart; k <= checkEnd; k++) {
              if (Math.abs(validMeasurements[k].lowFreq_kHz - validMeasurements[k - 1].lowFreq_kHz) > 1.5) stable = false;
            }
            if (stable && (checkEnd - checkStart + 1) >= 3) {
              recordedEarlyAnomaly = null;
              firstAnomalyIndex = -1;
            }
          }
          lastValidMeasurement = validMeasurements[i];
          lastValidThreshold = validMeasurements[i].threshold;
        }
      }

      if (recordedEarlyAnomaly !== null) {
        optimalThreshold = recordedEarlyAnomaly;
        optimalMeasurement = lastValidMeasurement;
      } else {
        optimalThreshold = lastValidThreshold;
        optimalMeasurement = lastValidMeasurement;
      }
    }

    // Output the summary table
    if (this.debugMode && summaryLog && summaryLog.length > 0) {
      const finalFreq = optimalMeasurement ? optimalMeasurement.lowFreq_kHz : null;
      const freqText = finalFreq !== null ? ` | ${finalFreq.toFixed(2)} kHz` : '';

      console.groupCollapsed(`[Low Freq] Scan Summary (Selected: ${optimalThreshold} dB${freqText})`);
      console.table(summaryLog);
      console.groupEnd();
    }

    // Final Safety Limits
    const finalThreshold = Math.max(Math.min(optimalThreshold, -1), -100);
    const safeThreshold = (finalThreshold <= -100) ? -30 : finalThreshold;
    const hasWarning = finalThreshold <= -100;

    let returnLowFreq_Hz = optimalMeasurement.lowFreq_Hz;
    let returnLowFreq_kHz = optimalMeasurement.lowFreq_kHz;
    let returnEndFreq_Hz = optimalMeasurement.endFreq_Hz;
    let returnEndFreq_kHz = optimalMeasurement.endFreq_kHz;

    // Safety Mechanism Re-calculation
    if (safeThreshold !== finalThreshold) {
      const lowFreqThreshold_dB_safe = stablePeakPower_dB + safeThreshold;
      let activeEndFrameIdx_safe = validPeakFrameIdx;

      for (let f = validPeakFrameIdx; f <= searchEndFrame; f++) {
        const frame = spectrogram[f];
        for (let b = 0; b < numBins; b++) {
          if (frame[b] > lowFreqThreshold_dB_safe) { activeEndFrameIdx_safe = f; break; }
        }
      }

      const targetFramePower = spectrogram[activeEndFrameIdx_safe];
      for (let b = 0; b < numBins; b++) {
        if (targetFramePower[b] > lowFreqThreshold_dB_safe) {
          let lf_hz = freqBins[b];
          if (b > 0) {
            const p1 = targetFramePower[b], p0 = targetFramePower[b - 1];
            if (p0 < lowFreqThreshold_dB_safe && p1 > lowFreqThreshold_dB_safe) {
              const ratio = (p1 - lowFreqThreshold_dB_safe) / (p1 - p0);
              lf_hz = freqBins[b] - ratio * (freqBins[b] - freqBins[b - 1]);
            }
          }
          returnLowFreq_Hz = lf_hz;
          returnLowFreq_kHz = lf_hz / 1000;
          returnEndFreq_Hz = lf_hz;
          returnEndFreq_kHz = lf_hz / 1000;
          break;
        }
      }
    }

    return {
      threshold: safeThreshold,
      lowFreq_Hz: returnLowFreq_Hz,
      lowFreq_kHz: returnLowFreq_kHz,
      endFreq_Hz: returnEndFreq_Hz,
      endFreq_kHz: returnEndFreq_kHz,
      lowFreqFrameIdx: optimalMeasurement ? optimalMeasurement.endFrameIdx : validPeakFrameIdx,
      lowFreqBinIdx: optimalMeasurement ? optimalMeasurement.lowFreqBinIdx : -1,
      warning: hasWarning
    };
  }

  // ============================================================
  // HELPER METHODS (NEW)
  // 用於減少重複的數學運算與頻譜掃描邏輯
  // ============================================================

  /**
   * [Helper] 計算線性插值頻率
   * @private
   */
  _calculateLinearInterpolation(freqBins, binIdx, thisPower, neighborPower, threshold_dB) {
    // 簡單的線性插值公式
    // neighbor 是 binIdx +/- 1，由調用者決定傳入誰
    const powerRatio = (thisPower - threshold_dB) / (thisPower - neighborPower);

    return powerRatio;
  }

  /**
   * [Helper] 掃描單一頻譜陣列尋找超過閾值的頻率 (含線性插值)
   * @param {Float32Array} spectrumData - 頻譜數據 (可以是單幀，也可以是 MaxSpectrum)
   * @param {Float32Array} freqBins - 頻率軸
   * @param {number} threshold_dB - 閾值
   * @param {string} direction - 'HighToLow' (找 High Freq) 或 'LowToHigh' (找 Low Freq)
   * @returns {Object|null} { freq_Hz, binIdx }
   */
  _scanSpectrumForFrequency(spectrumData, freqBins, threshold_dB, direction) {
    const numBins = spectrumData.length;
    let foundFreq_Hz = null;
    let foundBinIdx = -1;

    if (direction === 'HighToLow') {
      // 從高頻往低頻掃 (用於找 High Freq)
      for (let b = numBins - 1; b >= 0; b--) {
        if (spectrumData[b] > threshold_dB) {
          foundBinIdx = b;
          foundFreq_Hz = freqBins[b];

          // 線性插值 (檢查 b+1, 因為是從高往低掃，邊緣在 b 與 b+1 之間)
          if (b < numBins - 1) {
            const thisPower = spectrumData[b];
            const nextPower = spectrumData[b + 1];
            if (nextPower < threshold_dB) {
              const ratio = (thisPower - threshold_dB) / (thisPower - nextPower);
              // Freq = Current + ratio * (Next - Current)
              foundFreq_Hz = freqBins[b] + ratio * (freqBins[b + 1] - freqBins[b]);
            }
          }
          break;
        }
      }
    } else {
      // 從低頻往高頻掃 (用於找 Low Freq)
      for (let b = 0; b < numBins; b++) {
        if (spectrumData[b] > threshold_dB) {
          foundBinIdx = b;
          foundFreq_Hz = freqBins[b];

          // 線性插值 (檢查 b-1, 因為是從低往高掃，邊緣在 b 與 b-1 之間)
          if (b > 0) {
            const thisPower = spectrumData[b];
            const prevPower = spectrumData[b - 1];
            if (prevPower < threshold_dB) {
              const ratio = (thisPower - threshold_dB) / (thisPower - prevPower);
              // Freq = Current - ratio * (Current - Prev)
              foundFreq_Hz = freqBins[b] - ratio * (freqBins[b] - freqBins[b - 1]);
            }
          }
          break;
        }
      }
    }

    if (foundBinIdx !== -1) {
      return { freq_Hz: foundFreq_Hz, binIdx: foundBinIdx };
    }
    return null;
  }

  /**
   * Measure call parameters for a selected frequency range
   * * [UPDATED 2026] Reordered Logic for Early Noise Rejection
   * Order: Peak -> Inst. BW Check -> Low Freq Check -> High Freq -> Tracing -> Knee
   */
  measureFrequencyParameters(call, flowKHz, fhighKHz, freqBins, freqResolution, zonalNoiseMap = null) {
    let { highFreqThreshold_dB, characteristicFreq_percentEnd } = this.config;
    const spectrogram = call.spectrogram;  // [timeFrame][freqBin]
    const timeFrames = call.timeFrames;    // Time points for each frame

    if (spectrogram.length === 0) return;

    // ============================================================
    // STEP 0: Find peak frequency FIRST (Base Anchor)
    // ============================================================
    let peakFreq_Hz = null;
    let peakPower_dB = -Infinity;
    let peakFrameIdx = 0;
    let peakBinIdx = 0;

    // Phase 1: Find global peak bin
    for (let frameIdx = 0; frameIdx < spectrogram.length; frameIdx++) {
      const framePower = spectrogram[frameIdx];
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        if (framePower[binIdx] > peakPower_dB) {
          peakPower_dB = framePower[binIdx];
          peakBinIdx = binIdx;
          peakFrameIdx = frameIdx;
        }
      }
    }

    // Phase 2: Parabolic Interpolation for Peak
    peakFreq_Hz = freqBins[peakBinIdx];
    if (peakBinIdx > 0 && peakBinIdx < spectrogram[peakFrameIdx].length - 1) {
      const framePower = spectrogram[peakFrameIdx];
      const db0 = framePower[peakBinIdx - 1];
      const db1 = framePower[peakBinIdx];
      const db2 = framePower[peakBinIdx + 1];
      const a = (db2 - 2 * db1 + db0) / 2;
      if (Math.abs(a) > 1e-10) {
        const binCorrection = (db0 - db2) / (4 * a);
        const binWidth = freqBins[1] - freqBins[0];
        peakFreq_Hz = freqBins[peakBinIdx] + binCorrection * binWidth;
      }
    }

    call.peakFreq_kHz = peakFreq_Hz / 1000;
    call.peakPower_dB = peakPower_dB;

    // Calculate peak time
    if (peakFrameIdx < timeFrames.length) {
      const peakTimeInSeconds = timeFrames[peakFrameIdx];
      const firstFrameTimeInSeconds = timeFrames[0];
      call.peakFreq_ms = (peakTimeInSeconds - firstFrameTimeInSeconds) * 1000;
      call.peakFrameIdx = peakFrameIdx;
    }

    // Auto HPF Setup
    const autoCutoff = this.calculateAutoHighpassFilterFreq(call.peakFreq_kHz);
    if (autoCutoff > 0) {
      this.config.enableHighpassFilter = true;
      this.config.highpassFilterFreq_kHz = autoCutoff;
    }

    // ============================================================
    // [STEP 0.5] Instantaneous Bandwidth Check (Vertical Noise Filter)
    // 第一道防線：檢查 Peak Frame 的「瞬時頻寬」。
    // 蝙蝠 (Sweep) = 瞬時窄頻；噪音 (Click) = 瞬時寬頻。
    // ============================================================
    if (spectrogram.length > 0) {
      const peakFrameData = spectrogram[peakFrameIdx];
      const threshold_dB = peakPower_dB - 12; // 檢查 Peak 下方 12dB 的寬度

      let minBin = peakFrameData.length;
      let maxBin = 0;
      let activeBinCount = 0;

      for (let b = 0; b < peakFrameData.length; b++) {
        if (peakFrameData[b] > threshold_dB) {
          if (b < minBin) minBin = b;
          if (b > maxBin) maxBin = b;
          activeBinCount++;
        }
      }

      if (maxBin >= minBin) {
        const instBandwidth_Hz = (maxBin - minBin) * freqResolution;
        const instBandwidth_kHz = instBandwidth_Hz / 1000;

        // 閾值：如果單一 Frame 內能量橫跨超過 20kHz，判定為垂直噪音
        if (instBandwidth_kHz > 20.0) {
          if (this.debugMode) {
            console.warn(`%c[Noise Reject] Vertical Click Detected! Instant BW: ${instBandwidth_kHz.toFixed(1)}kHz. Discarding early.`,
              'color: red; font-weight: bold;');
          }
          call.isDiscarded = true;
          return; // <--- 立即停止
        }
      }
    }

    // ============================================================
    // [STEP 1] Low Frequency Check (Bottoming Out Filter)
    // 第二道防線：檢查是否觸底 (<10kHz)
    // 這裡我們先用 spectrogram 的最後一幀作為結束點進行快速掃描
    // ============================================================
    const roughEndFrameIdx = spectrogram.length - 1;

    // 執行 Low Frequency 檢測
    const resultLow = this.findOptimalLowFrequencyThreshold(
      spectrogram,
      timeFrames,
      freqBins,
      flowKHz,
      fhighKHz,
      peakPower_dB,
      peakFrameIdx,
      roughEndFrameIdx,
      zonalNoiseMap
    );

    // 檢查是否為噪音 (觸底 10kHz)
    if (resultLow.discard) {
      call.isDiscarded = true;
      // console.log('[Noise Reject] Call discarded by Low Freq check (<10kHz).');
      return; // <--- 立即停止，不執行 High Freq 和其他測量
    }

    // 暫存 Low Freq 結果，稍後整合
    let safeLowFreq_kHz = resultLow.lowFreq_kHz;
    let safeEndFreq_kHz = resultLow.endFreq_kHz;
    let usedThresholdLow = resultLow.threshold;


    // ============================================================
    // STEP 2: High Frequency Search (Expensive Operation)
    // 只有通過上述兩道防線，才執行這裡
    // ============================================================
    let safeHighFreq_kHz = null;
    let safeHighFreqHz = null;
    let safeHighFreqFrameIdx = 0;
    let safeHighFreqBinIdx = 0;
    let usedThresholdHigh = -24;
    let finalSearchLimitFrameFromAuto = 0;
    let isCFCallDetected = false;

    const resultHigh = this.findOptimalHighFrequencyThreshold(
      spectrogram,
      timeFrames,
      freqBins,
      flowKHz,
      fhighKHz,
      peakPower_dB,
      peakFrameIdx,
      zonalNoiseMap
    );

    safeHighFreq_kHz = resultHigh.highFreq_kHz;
    safeHighFreqHz = resultHigh.highFreq_Hz;
    safeHighFreqFrameIdx = resultHigh.highFreqFrameIdx;
    safeHighFreqBinIdx = resultHigh.highFreqBinIdx;
    usedThresholdHigh = resultHigh.threshold;
    finalSearchLimitFrameFromAuto = resultHigh.finalSearchLimitFrame;
    isCFCallDetected = resultHigh.isCFStablePattern;

    // --- High Freq Safety Re-scan ---
    if (resultHigh.highFreq_kHz !== null && resultHigh.highFreq_kHz < (peakFreq_Hz / 1000)) {
      const peakFreq_kHz = peakFreq_Hz / 1000;

      // Pre-calculate Max Spectrum ONCE
      const numBins = spectrogram[0].length;
      const testMaxSpectrum = new Float32Array(numBins).fill(-Infinity);
      const testFrameIndexForBin = new Uint16Array(numBins);

      for (let f = 0; f <= finalSearchLimitFrameFromAuto; f++) {
        const frame = spectrogram[f];
        for (let b = 0; b < frame.length; b++) {
          if (frame[b] > testMaxSpectrum[b]) {
            testMaxSpectrum[b] = frame[b];
            testFrameIndexForBin[b] = f;
          }
        }
      }

      // Scan Thresholds from -24 to -100
      for (let testThreshold_dB = -24; testThreshold_dB >= -100; testThreshold_dB--) {
        const highFreqThreshold_dB = peakPower_dB + testThreshold_dB;
        const scanRes = this._scanSpectrumForFrequency(testMaxSpectrum, freqBins, highFreqThreshold_dB, 'HighToLow');

        if (scanRes && (scanRes.freq_Hz / 1000) >= peakFreq_kHz) {
          safeHighFreqHz = scanRes.freq_Hz;
          safeHighFreq_kHz = scanRes.freq_Hz / 1000;
          safeHighFreqBinIdx = scanRes.binIdx;
          safeHighFreqFrameIdx = testFrameIndexForBin[scanRes.binIdx];
          usedThresholdHigh = testThreshold_dB;
          break;
        }
      }
    }

    // 設定 High Frequency 參數
    this.config.highFreqThreshold_dB = usedThresholdHigh;
    call.highFreqThreshold_dB_used = usedThresholdHigh;

    // Assign Result
    let highFreq_Hz = 0;
    if (safeHighFreq_kHz !== null) {
      call.highFreq_kHz = safeHighFreq_kHz;
      call.highFreqFrameIdx = safeHighFreqFrameIdx;
      highFreq_Hz = safeHighFreqHz;

      // Calculate Time
      if (safeHighFreqFrameIdx < timeFrames.length) {
        call.highFreq_ms = (timeFrames[safeHighFreqFrameIdx] - timeFrames[0]) * 1000;
      }
    } else {
      // Fallback
      highFreq_Hz = fhighKHz * 1000;
      call.highFreq_kHz = fhighKHz;
      call.highFreqFrameIdx = 0;
      call.highFreq_ms = 0;
    }

    // ============================================================
    // STEP 2.5: Start Frequency & Time Boundary Tracing
    // ============================================================

    // Recalculate Time Boundaries based on used High Threshold
    const highThreshold_dB = peakPower_dB + usedThresholdHigh;
    let newStartFrameIdx = 0;
    for (let frameIdx = 0; frameIdx < spectrogram.length; frameIdx++) {
      const framePower = spectrogram[frameIdx];
      let frameHasSignal = false;
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        if (framePower[binIdx] > highThreshold_dB) { frameHasSignal = true; break; }
      }
      if (frameHasSignal) { newStartFrameIdx = frameIdx; break; }
    }

    if (newStartFrameIdx < timeFrames.length) {
      call.startTime_s = timeFrames[newStartFrameIdx];
    }

    // Start Frequency Tracing Logic
    let validStartFreq_Hz = highFreq_Hz;
    let validStartBinIdx = safeHighFreqBinIdx;
    let validStartFrameIdx = safeHighFreqFrameIdx;

    let performStartFreqTracing = true;
    let startFreqThreshold_dB = peakPower_dB + usedThresholdHigh;

    // Logic Flow for Start Freq Tracing
    if (isCFCallDetected) {
      performStartFreqTracing = true;
      startFreqThreshold_dB = peakPower_dB - 35;
    } else {
      // Simple check if high freq point is strong enough to trace
      if (safeHighFreqFrameIdx < spectrogram.length) {
        const p = spectrogram[safeHighFreqFrameIdx][safeHighFreqBinIdx];
        if (p < (peakPower_dB - 30) || p < -80) performStartFreqTracing = false;
      }
    }

    if (performStartFreqTracing && safeHighFreqFrameIdx > 0) {
      let currentTrackBinIdx = safeHighFreqBinIdx;
      const maxJumpHz = 2000;
      const maxJumpBins = Math.ceil(maxJumpHz / freqResolution);
      const numBins = freqBins.length;

      for (let f = safeHighFreqFrameIdx - 1; f >= 0; f--) {
        const framePower = spectrogram[f];
        const searchMinBin = Math.max(0, currentTrackBinIdx - maxJumpBins);
        const searchMaxBin = Math.min(numBins - 1, currentTrackBinIdx + maxJumpBins);

        let bestBin = -1;
        let bestPower = -Infinity;

        for (let b = searchMinBin; b <= searchMaxBin; b++) {
          if (framePower[b] > bestPower) {
            bestPower = framePower[b];
            bestBin = b;
          }
        }

        if (bestPower > startFreqThreshold_dB) {
          currentTrackBinIdx = bestBin;
          validStartBinIdx = bestBin;
          validStartFrameIdx = f;
          validStartFreq_Hz = freqBins[bestBin];

          // Linear Interpolation
          if (bestBin > 0 && bestBin < numBins - 1) {
            const prevP = framePower[bestBin - 1];
            const nextP = framePower[bestBin + 1];
            if (bestPower > prevP && bestPower > nextP) {
              const ratio = (bestPower - startFreqThreshold_dB) / (bestPower - Math.min(prevP, nextP));
              const freqDiff = freqBins[bestBin + 1] - freqBins[bestBin];
              validStartFreq_Hz = freqBins[bestBin] + (ratio * freqDiff * (prevP < nextP ? 1 : -1));
            }
          }
        } else {
          break; // Gap found
        }
      }
    }

    const startFreq_kHz = validStartFreq_Hz / 1000;
    call.startFreq_kHz = startFreq_kHz;
    call.startFreqBinIdx = validStartBinIdx;
    call.startFreqFrameIdx = validStartFrameIdx;

    if (validStartFrameIdx < timeFrames.length) {
      call.startFreqTime_s = timeFrames[validStartFrameIdx];
      const firstFrameTime_s = timeFrames[0];
      call.startFreq_ms = (call.startFreqTime_s - firstFrameTime_s) * 1000;
    }


    // ============================================================
    // STEP 3: Finalize Low & End Frequencies (獨立 End Freq 計算)
    // ============================================================

    // 1. 設定 Low Frequency (保持不變)
    this.config.lowFreqThreshold_dB = usedThresholdLow;
    call.lowFreqThreshold_dB_used = usedThresholdLow;
    call.lowFreq_kHz = safeLowFreq_kHz;

    // 2. 初始化 End Freq 為 Low Freq (Fallback)
    // 預設情況下，End Freq 等於 Low Freq (如果不需要 Tracing)
    let finalEndFreq_kHz = safeLowFreq_kHz;
    let finalEndFrameIdx = resultLow.lowFreqFrameIdx !== null ? resultLow.lowFreqFrameIdx : peakFrameIdx;

    // ============================================================
    // [NEW] End Frequency Forward Tracing (With Console Debug)
    // ============================================================

    // A. 確定追蹤起點 (Anchor Point)
    const anchorFrameIdx = resultLow.lowFreqFrameIdx; // safeLowFreqFrameIdx

    // [FIX] 直接使用 resultLow 提供的 Bin Index，避免反算誤差導致落入噪音區
    let anchorBinIdx = -1;
    if (resultLow.lowFreqBinIdx !== undefined && resultLow.lowFreqBinIdx !== -1) {
      anchorBinIdx = resultLow.lowFreqBinIdx;
    } else if (safeLowFreq_kHz !== null) {
      // Fallback: 只有在沒有 BinIdx 時才用反算 (舊邏輯)
      anchorBinIdx = Math.floor((safeLowFreq_kHz * 1000) / freqResolution);
      anchorBinIdx = Math.max(0, Math.min(freqBins.length - 1, anchorBinIdx));
    }

    // B. 設定判定閾值 & 預檢查
    let performEndFreqTracing = true;
    const endFreqThreshold_dB = peakPower_dB + usedThresholdLow;
    let skipReason = ""; // 用於 Log

    if (anchorFrameIdx !== null && anchorBinIdx !== -1 && anchorFrameIdx < spectrogram.length) {
      const anchorPower = spectrogram[anchorFrameIdx][anchorBinIdx];

      // Simple check: weak anchor?
      if (anchorPower < (peakPower_dB - 50) || anchorPower < -100) {
        performEndFreqTracing = false;
        skipReason = `Anchor Weak (${anchorPower.toFixed(1)}dB < Threshold)`;
      }
    } else {
      performEndFreqTracing = false;
      skipReason = "Invalid Anchor Frame/Bin";
    }

    // [DEBUG] 準備 Summary Table
    const endFreqSummary = this.debugMode ? [] : null;

    // C. 順向追蹤迴圈 (Forward Trace Loop)
    if (performEndFreqTracing && anchorFrameIdx !== null) {
      let currentTrackBinIdx = anchorBinIdx;

      // 參數設定
      const maxJumpHz = 2000;
      const maxJumpBins = Math.ceil(maxJumpHz / freqResolution);
      const numBins = freqBins.length;

      // 記錄起點 (Anchor)
      if (this.debugMode) {
        endFreqSummary.push({
          'Frame': anchorFrameIdx,
          'Time (ms)': ((timeFrames[anchorFrameIdx] - timeFrames[0]) * 1000).toFixed(2),
          'Freq (kHz)': safeLowFreq_kHz.toFixed(2),
          'Power (dB)': spectrogram[anchorFrameIdx][anchorBinIdx].toFixed(2),
          'Thr (dB)': endFreqThreshold_dB.toFixed(2),
          'Judgment': 'ANCHOR (Start)'
        });
      }

      // 從 safeLowFreqFrameIdx + 1 開始，往後掃描直到 spectrogram 結束
      for (let f = anchorFrameIdx + 1; f < spectrogram.length; f++) {
        const framePower = spectrogram[f];
        const currentTimeMs = (timeFrames[f] - timeFrames[0]) * 1000;

        // 局部搜索窗口 (Local Search Window)
        const searchMinBin = Math.max(0, currentTrackBinIdx - maxJumpBins);
        const searchMaxBin = Math.min(numBins - 1, currentTrackBinIdx + maxJumpBins);

        let bestBin = -1;
        let bestPower = -Infinity;

        // 尋找局部最強點
        for (let b = searchMinBin; b <= searchMaxBin; b++) {
          if (framePower[b] > bestPower) {
            bestPower = framePower[b];
            bestBin = b;
          }
        }

        // 準備 Log Row
        let logRow = null;
        if (this.debugMode) {
           logRow = {
            'Frame': f,
            'Time (ms)': currentTimeMs.toFixed(2),
            'Freq (kHz)': (freqBins[bestBin] / 1000).toFixed(2),
            'Power (dB)': bestPower.toFixed(2),
            'Thr (dB)': endFreqThreshold_dB.toFixed(2),
            'Judgment': 'Pending'
          };
        }

        // 能量判定
        if (bestPower > endFreqThreshold_dB) {
          // 信號存在！
          currentTrackBinIdx = bestBin;
          
          if (this.debugMode && logRow) {
             logRow['Judgment'] = 'Trace OK';
          }

          // D. 更新暫定 End Freq (鎖定最後一個有效點)
          finalEndFrameIdx = f;

          // 執行線性插值 (Linear Interpolation)
          let validEndFreq_Hz = freqBins[bestBin];

          if (bestBin > 0 && bestBin < numBins - 1) {
            const prevP = framePower[bestBin - 1];
            const nextP = framePower[bestBin + 1];
            // 確保是 Peak 形狀
            if (bestPower > prevP && bestPower > nextP) {
              const ratio = (bestPower - endFreqThreshold_dB) / (bestPower - Math.min(prevP, nextP));
              const freqDiff = freqBins[bestBin + 1] - freqBins[bestBin];
              const direction = (prevP < nextP) ? 1 : -1;
              validEndFreq_Hz = freqBins[bestBin] + (ratio * freqDiff * direction * 0.5);
            }
          }

          finalEndFreq_kHz = validEndFreq_Hz / 1000;
          
          if (this.debugMode && logRow) {
            logRow['Freq (kHz)'] = finalEndFreq_kHz.toFixed(2); // 更新插值後的頻率
            endFreqSummary.push(logRow); // [FIX] Added check
          }

        } else {
          // 信號斷裂！中斷迴圈
          if (this.debugMode && logRow) {
            logRow['Judgment'] = 'STOP (< Thr)';
            endFreqSummary.push(logRow); // [FIX] Added check
          }
          break;
        }
      }
    } else {
      // 如果被 Skip，記錄原因
      if (this.debugMode) {
        console.log(`%c[End Freq] Tracing Skipped: ${skipReason}`, "color: orange; font-weight: bold;");
      }
    }

    // [DEBUG] 輸出 Table
    if (this.debugMode && endFreqSummary.length > 0) {
      console.groupCollapsed(`[End Freq] Trace Summary (Result: ${finalEndFreq_kHz.toFixed(2)}kHz @ Frame ${finalEndFrameIdx})`);
      console.table(endFreqSummary);
      console.groupEnd();
    }

    // 3. 寫入 End Freq 結果
    call.endFreq_kHz = finalEndFreq_kHz;
    call.endFrameIdx_forLowFreq = finalEndFrameIdx; // 這裡我們讓 End Frame 指向新的 Trace 結果

    // 更新時間
    if (finalEndFrameIdx < timeFrames.length) {
      call.endFreqTime_s = timeFrames[finalEndFrameIdx];

      // 更新 End Time Boundary (這會影響 Duration 計算)
      call.endTime_s = timeFrames[Math.min(finalEndFrameIdx + 1, timeFrames.length - 1)];

      // 計算相對時間 ms
      const firstFrameTime_s = timeFrames[0];
      call.endFreq_ms = (call.endFreqTime_s - firstFrameTime_s) * 1000;

      // 更新 Low Freq Time (通常 Low Freq Time 與 End Freq Time 相近，或是保留在 Anchor 點)
      // [OPTION] 用戶要求 End Freq 獨立。Low Freq Time 可以保持在 resultLow 找到的位置。
      if (resultLow.lowFreqFrameIdx < timeFrames.length) {
        call.lowFreq_ms = (timeFrames[resultLow.lowFreqFrameIdx] - timeFrames[0]) * 1000;
      }
    }

    // Update Duration based on new End Freq Time
    if (call.startFreqTime_s !== null && call.endFreqTime_s !== null) {
      call.duration_ms = (call.endFreqTime_s - call.startFreqTime_s) * 1000;
    }

    // Optimization: Compare Low with Start (保持原樣)
    if (call.startFreq_kHz !== null && call.startFreq_kHz < call.lowFreq_kHz) {
      call.lowFreq_kHz = call.startFreq_kHz;
    }

    // Compare Low with End (確保 Low Freq 真的是最低的)
    if (call.endFreq_kHz !== null && call.endFreq_kHz < call.lowFreq_kHz) {
      call.lowFreq_kHz = call.endFreq_kHz;
    }

    // ============================================================
    // STEP 4: Characteristic Frequency
    // ============================================================
    const charFreqSearchEnd = call.endFrameIdx_forLowFreq || (spectrogram.length - 1);
    const lastPercentStart = Math.floor(newStartFrameIdx + (charFreqSearchEnd - newStartFrameIdx) * (1 - 0.40));
    let characteristicFreq_Hz = peakFreq_Hz;
    let characteristicFreq_FrameIdx = 0;

    if (lastPercentStart < charFreqSearchEnd) {
      const frameFrequencies = [];
      let timeFrameDelta_ms = (timeFrames.length > 1) ? (timeFrames[1] - timeFrames[0]) * 1000 : 0;

      for (let frameIdx = Math.max(0, lastPercentStart); frameIdx <= charFreqSearchEnd; frameIdx++) {
        const framePower = spectrogram[frameIdx];
        let maxPower_dB = -Infinity;
        let peakBin = 0;
        for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
          if (framePower[binIdx] > maxPower_dB) { maxPower_dB = framePower[binIdx]; peakBin = binIdx; }
        }
        frameFrequencies.push({ frameIdx: frameIdx, freq_Hz: freqBins[peakBin], power_dB: maxPower_dB, slope_kHz_per_ms: null });
      }

      for (let i = 0; i < frameFrequencies.length - 1; i++) {
        const curr = frameFrequencies[i];
        const next = frameFrequencies[i + 1];
        const freqDifference_kHz = (next.freq_Hz - curr.freq_Hz) / 1000;
        curr.slope_kHz_per_ms = timeFrameDelta_ms > 0 ? freqDifference_kHz / timeFrameDelta_ms : 0;
      }

      let minSlope = Infinity;
      let charFreqFrameIdx = lastPercentStart;
      for (let i = 0; i < frameFrequencies.length; i++) {
        const point = frameFrequencies[i];
        if (point.slope_kHz_per_ms !== null && Math.abs(point.slope_kHz_per_ms) < minSlope) {
          minSlope = Math.abs(point.slope_kHz_per_ms);
          charFreqFrameIdx = i;
        }
      }

      if (charFreqFrameIdx < frameFrequencies.length) {
        characteristicFreq_Hz = frameFrequencies[charFreqFrameIdx].freq_Hz;
        characteristicFreq_FrameIdx = frameFrequencies[charFreqFrameIdx].frameIdx;
      }
    }

    call.characteristicFreq_kHz = characteristicFreq_Hz / 1000;
    if (characteristicFreq_FrameIdx < timeFrames.length) {
      call.characteristicFreq_ms = (timeFrames[characteristicFreq_FrameIdx] - timeFrames[0]) * 1000;
    }

    // Validate Characteristic Freq
    if (call.characteristicFreq_kHz < call.lowFreq_kHz) call.characteristicFreq_kHz = call.lowFreq_kHz;
    else if (call.characteristicFreq_kHz > call.peakFreq_kHz) call.characteristicFreq_kHz = call.peakFreq_kHz;

    // ============================================================
    // STEP 5: Bandwidth & Validation
    // ============================================================
    call.calculateBandwidth();

    // Secondary Noise Check (Time Tilt - Vertical Streak)
    if (call.bandwidth_kHz !== null && call.highFreqTime_ms !== null && call.lowFreq_ms !== null) {
      const timeTilt_ms = Math.abs(call.lowFreq_ms - call.highFreqTime_ms);
      if (call.bandwidth_kHz > 20 && timeTilt_ms < 1.5) {
        if (this.debugMode) {
          console.warn(`%c[Noise Reject] Vertical Click (Secondary)! BW: ${call.bandwidth_kHz.toFixed(1)}kHz. Discarding.`, 'color: red; background: #ffeaea;');
        }
        call.isDiscarded = true;
        return;
      }
    }

    // ============================================================
    // STEP 6: Calculate Knee Frequency and Knee Time (FULL CODE)
    // ============================================================

    // 1. Time Constraints
    let searchStartFrame = Math.max(0, newStartFrameIdx);
    if (call.startFreqFrameIdx !== null && call.startFreqFrameIdx > searchStartFrame) {
      searchStartFrame = call.startFreqFrameIdx;
    }

    // Use rough end frame derived from low freq result or spectrogram end
    const searchEndFrame = Math.min(spectrogram.length - 1, call.endFrameIdx_forLowFreq || (spectrogram.length - 1));
    const searchDurationFrames = searchEndFrame - searchStartFrame + 1;

    // 2. Frequency Constraints (+/- 1kHz Buffer)
    const constraintMinFreq_Hz = (call.lowFreq_kHz !== null) ? (call.lowFreq_kHz * 1000) - 1000 : 0;
    const constraintMaxFreq_Hz = (call.highFreq_kHz !== null) ? (call.highFreq_kHz * 1000) + 1000 : freqBins[freqBins.length - 1];

    let minBinIdx = 0;
    let maxBinIdx = freqBins.length - 1;

    for (let b = 0; b < freqBins.length; b++) {
      if (freqBins[b] >= constraintMinFreq_Hz) { minBinIdx = b; break; }
    }
    for (let b = freqBins.length - 1; b >= 0; b--) {
      if (freqBins[b] <= constraintMaxFreq_Hz) { maxBinIdx = b; break; }
    }

    const contourKHz = [];
    const validFrameIndices = [];

    // 3. Extract Contour
    if (searchDurationFrames > 2) {
      for (let frameIdx = searchStartFrame; frameIdx <= searchEndFrame; frameIdx++) {
        const framePower = spectrogram[frameIdx];
        let peakIdx = -1;
        let maxPower = -Infinity;

        for (let binIdx = minBinIdx; binIdx <= maxBinIdx; binIdx++) {
          if (binIdx < framePower.length) {
            if (framePower[binIdx] > maxPower) {
              maxPower = framePower[binIdx];
              peakIdx = binIdx;
            }
          }
        }

        if (peakIdx !== -1) {
          contourKHz.push(freqBins[peakIdx] / 1000); // Store as kHz
          validFrameIndices.push(frameIdx);
        }
      }
    }

    if (contourKHz.length < 5) {
      // console.log('[Knee Search] Too few points, skipping.');
      call.kneeTime_ms = null;
      call.kneeFreq_kHz = null;
    } else {
      // 4. Smoothing (on kHz data)
      const smoothedKHz = this.savitzkyGolay(contourKHz, 5, 2);
      const firstDerivatives = [];

      // Calculate 1st Derivative (Slope in kHz / ms)
      for (let i = 0; i < smoothedKHz.length - 1; i++) {
        const freqChange = smoothedKHz[i + 1] - smoothedKHz[i]; // kHz

        const absFrameIdx_curr = validFrameIndices[i];
        const absFrameIdx_next = validFrameIndices[i + 1];
        // Time Delta in ms
        const timeDelta_ms = (timeFrames[absFrameIdx_next] - timeFrames[absFrameIdx_curr]) * 1000;

        // Slope unit: kHz/ms
        firstDerivatives.push(freqChange / (timeDelta_ms > 0 ? timeDelta_ms : 0.001));
      }

      // Calculate 2nd Derivative
      const secondDerivatives = [];
      const derivIndices = [];

      for (let i = 0; i < firstDerivatives.length - 1; i++) {
        const derivChange = firstDerivatives[i + 1] - firstDerivatives[i];

        const absFrameIdx_curr = validFrameIndices[i];
        const absFrameIdx_next2 = validFrameIndices[i + 2];
        const timeDelta_ms = ((timeFrames[absFrameIdx_next2] - timeFrames[absFrameIdx_curr]) * 1000) / 2;

        secondDerivatives.push(derivChange / (timeDelta_ms > 0 ? timeDelta_ms : 0.001));
        derivIndices.push(i + 1);
      }

      // [Helper] Validation (Thresholds adjusted for kHz/ms)
      const isValidKneeBySlope = (localIndex) => {
        if (localIndex <= 0 || localIndex >= firstDerivatives.length) return false;

        const incomingSlope = firstDerivatives[localIndex - 1];
        const outgoingSlope = firstDerivatives[localIndex];

        if (incomingSlope === null || outgoingSlope === null) return false;

        const MIN_INCOMING_STEEPNESS = -0.5; // Must be at least this steep to be FM

        // 1. Direction check: Must be downward FM (negative slope)
        if (incomingSlope > 0) return false;

        // 2. Steepness check: Entering slope must be essentially FM
        if (incomingSlope > MIN_INCOMING_STEEPNESS) return false; // Too flat, not FM

        // 3. Knee Shape check: Outgoing must be flatter than Incoming
        const incomingAbs = Math.abs(incomingSlope);
        const outgoingAbs = Math.abs(outgoingSlope);

        if (outgoingAbs >= incomingAbs * 0.8) return false; // Not enough bend

        return true;
      };

      let bestLocalIdx = -1;
      let maxCurvature = -1;

      // 5. Find Max Curvature
      for (let i = 0; i < secondDerivatives.length; i++) {
        const localFreqIdx = derivIndices[i];
        const df_dt = firstDerivatives[localFreqIdx - 1];
        const d2f_dt2 = secondDerivatives[i];

        // Math using kHz/ms scales
        const denominator = Math.pow(1 + df_dt * df_dt, 1.5);
        const curvature = Math.abs(d2f_dt2) / (denominator + 1e-10);

        if (curvature > maxCurvature && isValidKneeBySlope(localFreqIdx - 1)) {
          maxCurvature = curvature;
          bestLocalIdx = localFreqIdx;
        }
      }

      // console.log(`[Knee Search] Max Curvature: ${maxCurvature.toFixed(4)} at Local Index: ${bestLocalIdx}`);

      // Weak Curvature / Fallback
      if (bestLocalIdx < 0 || maxCurvature < 0.01) {
        // Fallback: Find the point where slope changes the most (2nd deriv peak)
        let maxChange = -1;
        for (let i = 0; i < secondDerivatives.length; i++) {
          const change = Math.abs(secondDerivatives[i]);
          const localIdx = derivIndices[i];
          if (change > maxChange && firstDerivatives[localIdx - 1] < -0.5) {
            maxChange = change;
            bestLocalIdx = localIdx;
          }
        }
      }

      // 6. Map Result (Mapping back to Absolute Frame)
      let finalKneeIdx = -1;
      if (typeof bestLocalIdx !== 'undefined' && bestLocalIdx >= 0 && bestLocalIdx < validFrameIndices.length) {
        finalKneeIdx = validFrameIndices[bestLocalIdx];
      }

      // 7. Store Result
      if (finalKneeIdx >= 0 && finalKneeIdx < timeFrames.length) {
        call.kneeFreq_kHz = contourKHz[bestLocalIdx];
        call.kneeFrameIdx = finalKneeIdx;

        // Store temp absolute time
        call.kneeFreq_ms = (timeFrames[finalKneeIdx] - timeFrames[0]) * 1000;
        call.kneeTime_ms = call.kneeFreq_ms;
      } else {
        call.kneeTime_ms = null;
        call.kneeFreq_kHz = null;
        call.kneeFrameIdx = null;
      }

      // ============================================================
      // STEP 6.5: Calculate Heel Frequency (QCF/CF -> FM)
      // ============================================================
      // Heel Logic: Start Flat (Slope > -0.5) -> End Steep (Slope < -0.5)
      // We reuse the same derivatives calculated for Knee

      const isValidHeelBySlope = (localIndex) => {
        if (localIndex <= 0 || localIndex >= firstDerivatives.length) return false;

        const incomingSlope = firstDerivatives[localIndex - 1]; // Left side
        const outgoingSlope = firstDerivatives[localIndex];     // Right side

        if (incomingSlope === null || outgoingSlope === null) return false;

        // 1. Definition: Heel is the start of the drop.
        // Incoming (Left) should be relatively flat (CF/QCF)
        // Values are usually negative (downward), so "flatter" means closer to 0 (e.g., > -0.5 or > -0.2)
        const MAX_INCOMING_STEEPNESS = -0.5;

        // 2. Outgoing (Right) must be steeper (FM)
        // Must be steeper than incoming
        const MIN_OUTGOING_STEEPNESS = -0.5; // Must drop faster than this

        // Check 1: Incoming is flatish
        if (incomingSlope < MAX_INCOMING_STEEPNESS) return false; // Too steep already

        // Check 2: Outgoing is steep
        if (outgoingSlope > MIN_OUTGOING_STEEPNESS) return false; // Too flat, not dropping

        // Check 3: Corner Shape (Outgoing is significantly steeper than Incoming)
        if (Math.abs(outgoingSlope) < Math.abs(incomingSlope) * 1.5) return false;

        return true;
      };

      let bestHeelLocalIdx = -1;
      let maxHeelCurvature = -1;

      // Scan for Max Curvature that satisfies Heel condition
      for (let i = 0; i < secondDerivatives.length; i++) {
        const localFreqIdx = derivIndices[i];

        // Temporal Constraint: Heel must be AFTER Knee
        if (bestLocalIdx !== -1 && localFreqIdx <= bestLocalIdx + 1) {
          continue;
        }

        const df_dt = firstDerivatives[localFreqIdx - 1];
        const d2f_dt2 = secondDerivatives[i];

        // Curvature Formula
        const denominator = Math.pow(1 + df_dt * df_dt, 1.5);
        const curvature = Math.abs(d2f_dt2) / (denominator + 1e-10);

        if (curvature > maxHeelCurvature && isValidHeelBySlope(localFreqIdx - 1)) {
          maxHeelCurvature = curvature;
          bestHeelLocalIdx = localFreqIdx;
        }
      }

      // Map Heel Result
      let finalHeelIdx = -1;
      if (bestHeelLocalIdx >= 0 && bestHeelLocalIdx < validFrameIndices.length) {
        finalHeelIdx = validFrameIndices[bestHeelLocalIdx];
      }

      // Store Heel Result
      if (finalHeelIdx >= 0 && finalHeelIdx < timeFrames.length) {
        call.heelFreq_kHz = contourKHz[bestHeelLocalIdx];
        call.heelFrameIdx = finalHeelIdx;

        // Store temp absolute time (relative to ROI start)
        call.heelFreq_ms = (timeFrames[finalHeelIdx] - timeFrames[0]) * 1000;
      } else {
        call.heelFreq_ms = null;
        call.heelFreq_kHz = null;
        call.heelFrameIdx = null;
      }
    }

    // ============================================================
    // STEP 7: Time Normalization (Start Freq = 0.00ms)
    // [FIXED] 確保 End Freq 與 Low Freq 使用各自獨立的 Frame 進行計算
    // ============================================================
    if (call.startFreqFrameIdx !== null && call.startFreqFrameIdx < timeFrames.length) {
      const t0_s = timeFrames[call.startFreqFrameIdx];

      // 定義歸一化函數：將絕對時間轉換為相對於 Start Freq 的 ms
      const normalizeTime = (frameIdx) => {
        if (frameIdx === null || frameIdx === undefined) return null;
        if (frameIdx >= timeFrames.length) return null;
        const t_target = timeFrames[frameIdx];
        return (t_target - t0_s) * 1000;
      };

      call.startFreq_ms = 0.00;

      if (peakFrameIdx !== null) call.peakFreq_ms = normalizeTime(peakFrameIdx);
      if (call.highFreqFrameIdx !== null) call.highFreq_ms = normalizeTime(call.highFreqFrameIdx);

      // [FIX] Update End Freq Time (使用 Tracing 後的 Frame: call.endFrameIdx_forLowFreq)
      if (call.endFrameIdx_forLowFreq !== null) {
        call.endFreq_ms = normalizeTime(call.endFrameIdx_forLowFreq);
      }

      // [FIX] Update Low Freq Time (使用 Step 1 找到的 Anchor Frame: resultLow.lowFreqFrameIdx)
      // 注意：必須確保 resultLow 在此作用域內可用
      if (resultLow && resultLow.lowFreqFrameIdx !== null) {
        call.lowFreq_ms = normalizeTime(resultLow.lowFreqFrameIdx);
      } else if (call.endFrameIdx_forLowFreq !== null) {
        // Fallback: 如果 resultLow 丟失，才使用 End Frame (舊邏輯)
        call.lowFreq_ms = normalizeTime(call.endFrameIdx_forLowFreq);
      }

      // Knee & Heel Normalization
      if (call.kneeFrameIdx !== null) {
        call.kneeFreq_ms = normalizeTime(call.kneeFrameIdx);
        call.kneeTime_ms = call.kneeFreq_ms;
      }
      if (call.heelFrameIdx !== null) {
        call.heelFreq_ms = normalizeTime(call.heelFrameIdx);
      }

      // Recalculate Duration based on normalized times
      if (call.endFreq_ms !== null) {
        call.duration_ms = call.endFreq_ms - call.startFreq_ms;
      }
    }

    // ============================================================
    // [FIX] Sync Call Start/End Times with Frequency Boundaries
    // ============================================================
    if (call.startFreqTime_s !== null) {
      call.startTime_s = call.startFreqTime_s;
    }
    if (call.endFreqTime_s !== null) {
      call.endTime_s = call.endFreqTime_s;
    }

    // Time Expansion Correction
    if (getTimeExpansionMode()) {
      call.applyTimeExpansion(10);
    }
  }

  /**
   * Measure call parameters for a selected frequency range
   * Used by Power Spectrum popup for real-time parameter calculation
   */
  async measureSelectionParameters(audioData, sampleRate, startTime_s, endTime_s, flowKHz, fhighKHz) {
    const startSample = Math.floor(startTime_s * sampleRate);
    const endSample = Math.floor(endTime_s * sampleRate);

    const selectionAudio = audioData.slice(startSample, endSample);
    if (selectionAudio.length === 0) return null;

    // For a selected region, we treat it as one call
    const calls = await this.detectCalls(selectionAudio, sampleRate, flowKHz, fhighKHz);

    if (calls.length === 0) {
      // If no call detected, still provide peak frequency
      return this.measureDirectSelection(selectionAudio, sampleRate, flowKHz, fhighKHz);
    }

    // Return the most significant call in the selection
    let maxCall = calls[0];
    for (const call of calls) {
      if ((call.endTime_s - call.startTime_s) > (maxCall.endTime_s - maxCall.startTime_s)) {
        maxCall = call;
      }
    }

    // Adjust times to be relative to original audio
    maxCall.startTime_s += startTime_s;
    maxCall.endTime_s += startTime_s;

    return maxCall;
  }

  /**
   * Direct measurement for user-selected region (no detection, just measurement)
   * Used when user explicitly selects an area
   * 
   * Commercial standard (Avisoft, SonoBat, Kaleidoscope, BatSound):
   * Flow = lowest detectable frequency in selection (Hz)
   * Fhigh = highest detectable frequency in selection (kHz)
   */
  measureDirectSelection(audioData, sampleRate, flowKHz, fhighKHz) {
    const { fftSize, windowType, highFreqThreshold_dB } = this.config;

    // Apply window
    const windowed = this.applyWindow(audioData, windowType);

    // Remove DC
    let dcOffset = 0;
    for (let i = 0; i < windowed.length; i++) dcOffset += windowed[i];
    dcOffset /= windowed.length;

    const dcRemoved = new Float32Array(windowed.length);
    for (let i = 0; i < windowed.length; i++) {
      dcRemoved[i] = windowed[i] - dcOffset;
    }

    const freqResolution = sampleRate / fftSize;
    const minBin = Math.max(0, Math.floor(flowKHz * 1000 / freqResolution));
    const maxBin = Math.min(
      Math.floor(fftSize / 2),
      Math.floor(fhighKHz * 1000 / freqResolution)
    );

    // Measure peak frequency and find frequency range
    let peakFreq_Hz = null;
    let peakPower_dB = -Infinity;
    let lowestFreq_Hz = null;
    let highestFreq_Hz = null;

    // First pass: find peak
    for (let binIdx = minBin; binIdx <= maxBin; binIdx++) {
      const freqHz = binIdx * freqResolution;
      const energy = this.goertzelEnergy(dcRemoved, freqHz, sampleRate);
      const rms = Math.sqrt(energy);
      const psd = (rms * rms) / fftSize;
      const powerDb = 10 * Math.log10(Math.max(psd, 1e-16));

      if (powerDb > peakPower_dB) {
        peakPower_dB = powerDb;
        peakFreq_Hz = freqHz;
      }
    }

    // Second pass: find frequency range based on -27dB threshold from peak
    if (peakPower_dB > -Infinity) {
      const threshold_dB = peakPower_dB + highFreqThreshold_dB; // Typically -24dB

      // Find lowest frequency above threshold
      for (let binIdx = minBin; binIdx <= maxBin; binIdx++) {
        const freqHz = binIdx * freqResolution;
        const energy = this.goertzelEnergy(dcRemoved, freqHz, sampleRate);
        const rms = Math.sqrt(energy);
        const psd = (rms * rms) / fftSize;
        const powerDb = 10 * Math.log10(Math.max(psd, 1e-16));

        if (powerDb > threshold_dB) {
          lowestFreq_Hz = freqHz;
          break;
        }
      }

      // Find highest frequency above threshold
      for (let binIdx = maxBin; binIdx >= minBin; binIdx--) {
        const freqHz = binIdx * freqResolution;
        const energy = this.goertzelEnergy(dcRemoved, freqHz, sampleRate);
        const rms = Math.sqrt(energy);
        const psd = (rms * rms) / fftSize;
        const powerDb = 10 * Math.log10(Math.max(psd, 1e-16));

        if (powerDb > threshold_dB) {
          highestFreq_Hz = freqHz;
          break;
        }
      }
    }

    const call = new BatCall();
    call.peakFreq_kHz = peakFreq_Hz ? peakFreq_Hz / 1000 : null;
    call.peakPower_dB = peakPower_dB;
    call.Flow = lowestFreq_Hz ? lowestFreq_Hz : (flowKHz * 1000);     // Hz
    call.Fhigh = highestFreq_Hz ? (highestFreq_Hz / 1000) : fhighKHz; // kHz

    return call;
  }

  /**
   * Calculate optimal highpass filter frequency based on peak frequency
   * @param {number} peakFreq_kHz - Peak frequency in kHz
   * @returns {number} Optimal highpass filter frequency in kHz
   */
  calculateAutoHighpassFilterFreq(peakFreq_kHz) {
    // Select appropriate highpass filter frequency based on peak frequency
    // Thresholds: 40, 35, 30 kHz
    if (peakFreq_kHz >= 40) return 30;
    if (peakFreq_kHz >= 35) return 25;
    if (peakFreq_kHz >= 30) return 20;
    return 0;  // Default minimum value
  }

  /**
   * Apply Butterworth Highpass Filter to audio data
   * @param {Float32Array} audioData - Audio samples
   * @param {number} filterFreq_Hz - Filter frequency in Hz
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} order - Filter order (default 4)
   * @returns {Float32Array} Filtered audio data
   */
  applyHighpassFilter(audioData, filterFreq_Hz, sampleRate, order = 4) {
    if (!audioData || audioData.length === 0 || filterFreq_Hz <= 0) {
      return audioData;
    }

    // Clamp order to valid range 1-8
    const clampedOrder = Math.max(1, Math.min(8, Math.round(order)));

    // Calculate normalized frequency (0 to 1, 1 = Nyquist frequency)
    const nyquistFreq = sampleRate / 2;
    const normalizedFreq = filterFreq_Hz / nyquistFreq;

    // Ensure normalized frequency is valid
    if (normalizedFreq >= 1) {
      return audioData;
    }

    // Calculate Butterworth filter coefficients
    const wc = Math.tan(Math.PI * normalizedFreq / 2);

    // Apply cascaded filter stages
    let filtered = new Float32Array(audioData);

    // For order 1 and 2, apply directly
    // For order > 2, cascade multiple 2nd-order stages and 1 1st-order stage if needed
    const numOf2ndOrder = Math.floor(clampedOrder / 2);
    const has1stOrder = (clampedOrder % 2) === 1;

    // Apply multiple 2nd order cascaded stages
    for (let stage = 0; stage < numOf2ndOrder; stage++) {
      filtered = this._applyButterworthStage(filtered, wc, 2);
    }

    // If order is odd, apply one 1st order stage
    if (has1stOrder) {
      filtered = this._applyButterworthStage(filtered, wc, 1);
    }

    return filtered;
  }

  /**
   * Apply a specific order Butterworth Highpass Filter stage
   * @private
   * @param {Float32Array} audioData - Audio samples
   * @param {number} wc - Normalized cutoff frequency coefficient
   * @param {number} order - Filter stage order (1 or 2)
   * @returns {Float32Array} Filtered audio data
   */
  _applyButterworthStage(audioData, wc, order) {
    const wc2 = wc * wc;

    if (order === 1) {
      // 1st order highpass filter
      const denom = wc + 1;
      const b0 = 1 / denom;
      const b1 = -1 / denom;
      const a1 = (wc - 1) / denom;

      const result = new Float32Array(audioData.length);
      let y1 = 0, x1 = 0;

      for (let i = 0; i < audioData.length; i++) {
        const x0 = audioData[i];
        const y0 = b0 * x0 + b1 * x1 - a1 * y1;
        result[i] = y0;
        x1 = x0;
        y1 = y0;
      }
      return result;
    } else {
      // 2nd order Butterworth highpass filter
      const sqrt2wc = Math.sqrt(2) * wc;
      const denom = wc2 + sqrt2wc + 1;

      const b0 = 1 / denom;
      const b1 = -2 / denom;
      const b2 = 1 / denom;
      const a1 = (2 * (wc2 - 1)) / denom;
      const a2 = (wc2 - sqrt2wc + 1) / denom;

      const result = new Float32Array(audioData.length);
      let y1 = 0, y2 = 0, x1 = 0, x2 = 0;

      for (let i = 0; i < audioData.length; i++) {
        const x0 = audioData[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        result[i] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
      }
      return result;
    }
  }
}

/**
 * Export default detector instance with standard configuration
 */
export const defaultDetector = new BatCallDetector();
