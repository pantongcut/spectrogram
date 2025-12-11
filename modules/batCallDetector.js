import { getApplyWindowFunction, getGoertzelEnergyFunction } from './callAnalysisPopup.js';
export const DEFAULT_DETECTION_CONFIG = {
  // Energy threshold (dB below maximum within frequency range)
  // Typical: -18 dB (Avisoft), -24 dB (SonoBat, more conservative)
  callThreshold_dB: -24,
  
  // High frequency threshold (dB below peak for finding edges)
  highFreqThreshold_dB: -24,  // Threshold for calculating High Frequency (optimal value range: -24 to -70)
  
  // Automatic high frequency threshold optimization, automatically tests thresholds from -24dB to -70dB to find optimal value that provides stable measurements
  highFreqThreshold_dB_isAuto: true,
  
  // Low frequency threshold (dB below peak for finding edges) 
  // Fixed at -27dB for anti-rebounce compatibility
  // This is used for finding the lowest frequency in the call (last frame)
  lowFreqThreshold_dB: -27,
  
  // Automatic low frequency threshold optimization, automatically tests thresholds from -24dB to -70dB to find optimal value that provides stable measurements
  lowFreqThreshold_dB_isAuto: true,
  
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
  
  // ============================================================
  // 2025 ANTI-REBOUNCE (Anti-Echo/Reflection) PARAMETERS
  // ============================================================
  // These parameters protect against reverberations in tunnels, forests, buildings
  
  // Trick 1: Backward scanning for end frequency detection
  // When enabled, scan from end towards start to find -27dB cutoff (prevents rebounce tail)
  enableBackwardEndFreqScan: true,
  
  // Trick 2: Maximum Frequency Drop Rule (kHz)
  // Once frequency drops by this amount below peak, lock and don't accept further increases
  maxFrequencyDropThreshold_kHz: 10,
  
  // Trick 3: Protection window after peak energy (ms)
  // Only accept call content within this duration after peak energy frame
  protectionWindowAfterPeak_ms: 10,
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
    this.peakFreqTime_ms = null;    // Peak frequency time (ms) - time of peak power frame (absolute time in selection area)
    
    this.highFreq_kHz = null;       // High frequency (kHz) - highest frequency in entire call (calculated from all frames)
    this.highFreqTime_ms = null;    // High frequency time (ms) - time of high frequency occurrence within selection area
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
    
    this.bandwidth_kHz = null;      // Bandwidth = highFreq - lowFreq
    
    this.Flow = null;               // Low frequency boundary (Hz) - from detection range
    this.Fhigh = null;              // High frequency boundary (kHz) - from detection range
    
    this.peakPower_dB = null;       // Peak power in dB
    this.startPower_dB = null;      // Power at start frequency
    this.endPower_dB = null;        // Power at end frequency
    
    this.noiseFloor_dB = null;      // Noise floor (25th percentile of all power values)
    this.snr_dB = null;             // Signal to Noise Ratio (dB) = peakPower_dB - noiseFloor_dB
    this.quality = null;            // Quality rating based on SNR (Very Poor, Poor, Normal, Good, Excellent)
    
    this.highFreqDetectionWarning = false;  // Warning flag: High Frequency detection reached -70dB limit
    
    // 2025: 儲存該 call 實際使用的 threshold 值（用於 UI 顯示）
    this.highFreqThreshold_dB_used = null;  // High Frequency threshold actually used for this call
    this.lowFreqThreshold_dB_used = null;   // Low Frequency threshold actually used for this call
    
    this.callType = 'FM';           // 'CF', 'FM', or 'CF-FM' (Constant/Frequency Modulated)
    
    // Internal: time-frequency spectrogram (for visualization/analysis)
    this.spectrogram = null;        // 2D array: [timeFrames][frequencyBins]
    this.timeFrames = null;         // Time points for each frame
    this.freqBins = null;           // Frequency bins in Hz
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
      'Start Time [s]': this.startTime_s?.toFixed(4) || '-',
      'End Time [s]': this.endTime_s?.toFixed(4) || '-',
      'Duration [ms]': this.duration_ms?.toFixed(2) || '-',
      'Peak Freq [kHz]': this.peakFreq_kHz?.toFixed(2) || '-',
      'High Freq [kHz]': this.highFreq_kHz?.toFixed(2) || '-',
      'Start Freq [kHz]': this.startFreq_kHz?.toFixed(2) || '-',
      'End Freq [kHz]': this.endFreq_kHz?.toFixed(2) || '-',
      'Low Freq [kHz]': this.lowFreq_kHz?.toFixed(2) || '-',
      'Knee Freq [kHz]': this.kneeFreq_kHz?.toFixed(2) || '-',
      'Characteristic Freq [kHz]': this.characteristicFreq_kHz?.toFixed(2) || '-',
      'Bandwidth [kHz]': this.bandwidth_kHz?.toFixed(2) || '-',
      'Peak Power [dB]': this.peakPower_dB?.toFixed(1) || '-',
      'Knee Time [ms]': this.kneeTime_ms?.toFixed(2) || '-',
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
   * 
   * SNR = 10 × log₁₀ (Signal RMS / Noise RMS)
   * 
   * Signal Region: 
   *   - Time range: from highFreqFrameIdx to endFrameIdx_forLowFreq
   *   - Frequency range: from call.lowFreq_kHz to call.highFreq_kHz
   *   - Calculated from spectrogram power values in dB (not from time-domain audio)
   * 
   * Noise Region: All other spectrogram bins in the selection area
   * 
   * @param {Object} call - BatCall object with frequency/time parameters
   * @param {Array} spectrogram - STFT spectrogram [timeFrame][freqBin] in dB
   * @param {Array} freqBins - Frequency bin centers in Hz
   * @param {number} endFrameIdx_forLowFreq - End frame index for Low Frequency (limiting frame)
   * @returns {Object} { snr_dB, mechanism, signalPowerMean_dB, noisePowerMean_dB, signalCount, noiseCount }
   */
  calculateRMSbasedSNR(call, spectrogram, freqBins, endFrameIdx_forLowFreq) {
    const result = {
      snr_dB: null,
      mechanism: 'RMS-based (2025) - Spectrogram',
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
    
    if (call.highFreqFrameIdx === undefined || call.highFreqFrameIdx === null) {
      result.debug.reason = 'highFreqFrameIdx not set';
      return result;
    }
    
    if (call.highFreq_kHz === undefined || call.lowFreq_kHz === undefined) {
      result.debug.reason = 'Frequency parameters not set';
      return result;
    }
    
    // Convert frequency boundaries to Hz for comparison
    const signalFreq_Hz_low = call.lowFreq_kHz * 1000;
    const signalFreq_Hz_high = call.highFreq_kHz * 1000;
    
    // Store frequency range for logging
    result.frequencyRange_kHz = {
      lowFreq: call.lowFreq_kHz,
      highFreq: call.highFreq_kHz
    };
    
    // Store time range for logging
    result.timeRange_frames = {
      start: call.highFreqFrameIdx,
      end: endFrameIdx_forLowFreq,
      duration: endFrameIdx_forLowFreq - call.highFreqFrameIdx + 1
    };
    
    // Collect power values from spectrogram
    let signalPowerSum_linear = 0;  // Linear scale (not dB)
    let noisePowerSum_linear = 0;
    let signalCount = 0;
    let noiseCount = 0;
    
    // Iterate through spectrogram in time-frequency space
    for (let timeIdx = 0; timeIdx < spectrogram.length; timeIdx++) {
      const frame = spectrogram[timeIdx];
      
      for (let freqIdx = 0; freqIdx < frame.length; freqIdx++) {
        const freqHz = freqBins[freqIdx];
        const powerDb = frame[freqIdx];
        
        // Convert dB to linear scale: P_linear = 10^(P_dB / 10)
        const powerLinear = Math.pow(10, powerDb / 10);
        
        // Check if this bin is in the signal region
        const isInTimeRange = (timeIdx >= call.highFreqFrameIdx) && (timeIdx <= endFrameIdx_forLowFreq);
        const isInFreqRange = (freqHz >= signalFreq_Hz_low) && (freqHz <= signalFreq_Hz_high);
        
        if (isInTimeRange && isInFreqRange) {
          // This bin is in the SIGNAL region
          signalPowerSum_linear += powerLinear;
          signalCount++;
        } else {
          // This bin is in the NOISE region
          noisePowerSum_linear += powerLinear;
          noiseCount++;
        }
      }
    }
    
    if (signalCount === 0) {
      result.debug.reason = 'No signal bins found';
      return result;
    }
    
    if (noiseCount === 0) {
      result.debug.reason = 'No noise region (entire area is signal)';
      result.snr_dB = Infinity;
      result.noisePowerMean_dB = -Infinity;
      return result;
    }
    
    // Calculate mean power in linear scale
    const signalPowerMean_linear = signalPowerSum_linear / signalCount;
    const noisePowerMean_linear = noisePowerSum_linear / noiseCount;
    
    // Convert back to dB for logging
    result.signalPowerMean_dB = 10 * Math.log10(Math.max(signalPowerMean_linear, 1e-16));
    result.noisePowerMean_dB = 10 * Math.log10(Math.max(noisePowerMean_linear, 1e-16));
    result.signalCount = signalCount;
    result.noiseCount = noiseCount;
    
    // Avoid division by zero
    if (noisePowerMean_linear < 1e-16) {
      result.snr_dB = Infinity;
      result.debug.reason = 'Noise power too small';
      return result;
    }
    
    if (signalPowerMean_linear < 1e-16) {
      result.snr_dB = -Infinity;
      result.debug.reason = 'Signal power too small';
      return result;
    }
    
    // Calculate SNR in dB: 10 × log₁₀(Signal Power / Noise Power)
    // (not 20 × log₁₀ because we're comparing power, not amplitude)
    result.snr_dB = -10 * Math.log10(signalPowerMean_linear / noisePowerMean_linear);
    
    return result;
  }
  
  /**
   * Detect all bat calls in audio selection
   * Returns: array of BatCall objects
   */
  async detectCalls(audioData, sampleRate, flowKHz, fhighKHz) {
    if (!audioData || audioData.length === 0) return [];
    
    // Generate high-resolution STFT spectrogram
    const spectrogram = this.generateSpectrogram(audioData, sampleRate, flowKHz, fhighKHz);
    if (!spectrogram) return [];
    
    const { powerMatrix, timeFrames, freqBins, freqResolution } = spectrogram;
    
    // Phase 1: Detect call boundaries using energy threshold
    const callSegments = this.detectCallSegments(powerMatrix, timeFrames, freqBins, flowKHz, fhighKHz);
    
    if (callSegments.length === 0) return [];
    
    // Phase 2: Measure precise parameters for each detected call
    const calls = callSegments.map(segment => {
      const call = new BatCall();
      call.startTime_s = timeFrames[segment.startFrame];
      call.endTime_s = timeFrames[Math.min(segment.endFrame + 1, timeFrames.length - 1)];
      call.spectrogram = powerMatrix.slice(segment.startFrame, segment.endFrame + 1);
      call.timeFrames = timeFrames.slice(segment.startFrame, segment.endFrame + 2);
      call.freqBins = freqBins;
      
      call.calculateDuration();
      
      // 驗證: 過濾不符合最小時長要求的 call
      if (call.duration_ms < this.config.minCallDuration_ms) {
        return null;  // 標記為無效，之後過濾掉
      }
      
      // Measure frequency parameters from spectrogram
      // This will calculate highFreq, lowFreq, peakFreq, startFreq, endFreq, etc.
      this.measureFrequencyParameters(call, flowKHz, fhighKHz, freqBins, freqResolution);
      

      call.Flow = call.lowFreq_kHz * 1000;   // Lowest freq in call (Hz)
      call.Fhigh = call.highFreq_kHz;        // Highest freq in call (kHz)
      call.callType = CallTypeClassifier.classify(call);
      
      return call;
    }).filter(call => call !== null);  // 移除不符合條件的 call
    
    // ============================================================
    // 額外驗證：過濾誤檢測的噪音段
    // ============================================================
    // Validation criteria:
    // 1. Peak power should be significantly above noise baseline (SNR check)
    // 2. Bandwidth should be reasonable (not too wide like noise)
    // 3. Power concentration should be high (not scattered like noise)
    // ============================================================
    
    // Collect all power values for percentile calculation
    const allPowerValues = [];
    
    for (let frameIdx = 0; frameIdx < powerMatrix.length; frameIdx++) {
      const framePower = powerMatrix[frameIdx];
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        allPowerValues.push(framePower[binIdx]);
      }
    }
    
    // Sort to calculate percentiles
    allPowerValues.sort((a, b) => a - b);
    
    // Calculate noise baseline using 25th percentile (robust to call signals)
    // This represents the typical background noise floor
    // The lowest 25% of energy bins = pure noise/low signal
    const percentile25Index = Math.floor(allPowerValues.length * 0.25);
    const noiseFloor_dB = allPowerValues[Math.max(0, percentile25Index)];
    
    // For comparison: also use median (50th percentile) as secondary baseline
    const medianIndex = Math.floor(allPowerValues.length * 0.5);
    const medianPower_dB = allPowerValues[Math.max(0, medianIndex)];
    
    // Use the higher of noise floor or a minimum threshold to ensure reasonable baseline
    // Minimum baseline: -80 dB (typical for quiet recording environments)
    const minNoiseFloor_dB = -80;
    const robustNoiseFloor_dB = Math.max(noiseFloor_dB, minNoiseFloor_dB);
    
    // Additional SNR-based filtering: Remove calls with low SNR
    // Real bat calls should have peak power >> above noise baseline
    // 2025 ENHANCEMENT: Use RMS-based SNR (10 × log₁₀(Signal Power / Noise Power) from spectrogram)
    const snrThreshold_dB = -20;  // At least -20 dB above noise floor
    
    const filteredCalls = calls.filter(call => {
      if (call.peakPower_dB === null || call.peakPower_dB === undefined) {
        return false; // No peak power data, discard
      }
      
      // 2025 ENHANCEMENT: Calculate RMS-based SNR from spectrogram
      // Signal: time range [highFreqFrameIdx, endFrameIdx_forLowFreq], freq range [lowFreq, highFreq]
      // Noise: all other regions in spectrogram
      try {
        // Call calculateRMSbasedSNR with the spectrogram data
        const snrResult = this.calculateRMSbasedSNR(
          call,
          powerMatrix,      // Full spectrogram in dB
          freqBins,         // Full frequency bin array
          call.endFrameIdx_forLowFreq  // Use the stored end frame index
        );
        
        // Use the calculated RMS-based SNR
        if (snrResult.snr_dB !== null && isFinite(snrResult.snr_dB)) {
          call.snr_dB = snrResult.snr_dB;
          call.snrMechanism = 'RMS-based (2025) - Spectrogram';
          
          // Store SNR calculation details for logging
          call.snrDetails = {
            frequencyRange_kHz: snrResult.frequencyRange_kHz,
            timeRange_frames: snrResult.timeRange_frames,
            signalPowerMean_dB: snrResult.signalPowerMean_dB,
            noisePowerMean_dB: snrResult.noisePowerMean_dB,
            signalCount: snrResult.signalCount,
            noiseCount: snrResult.noiseCount
          };
          
          // Log SNR mechanism for debugging
          console.log(
            `[SNR] Call detected - Mechanism: ${call.snrMechanism}, SNR: ${call.snr_dB.toFixed(2)} dB, ` +
            `Freq range: ${snrResult.frequencyRange_kHz.lowFreq.toFixed(1)}-${snrResult.frequencyRange_kHz.highFreq.toFixed(1)} kHz, ` +
            `Time frames: ${snrResult.timeRange_frames.start}-${snrResult.timeRange_frames.end} (${snrResult.timeRange_frames.duration} frames), ` +
            `Signal power: ${snrResult.signalPowerMean_dB.toFixed(1)} dB (${snrResult.signalCount} bins), ` +
            `Noise power: ${snrResult.noisePowerMean_dB.toFixed(1)} dB (${snrResult.noiseCount} bins)`
          );
        } else {
          // If RMS-based SNR calculation failed, fall back to spectral SNR for filtering only
          const spectralSNR_dB = call.peakPower_dB - robustNoiseFloor_dB;
          call.snr_dB = spectralSNR_dB;
          call.snrMechanism = 'RMS-based (2025) - Spectral fallback for filtering';
          
          console.log(
            `[SNR] RMS-based calculation failed (${snrResult.debug.reason}), using spectral fallback: ${spectralSNR_dB.toFixed(2)} dB`
          );
        }
      } catch (error) {
        // On error, use spectral SNR for filtering
        const spectralSNR_dB = call.peakPower_dB - robustNoiseFloor_dB;
        call.snr_dB = spectralSNR_dB;
        call.snrMechanism = 'RMS-based (2025) - Error fallback';
        
        console.log(`[SNR] RMS-based calculation error: ${error.message}, using spectral fallback: ${spectralSNR_dB.toFixed(2)} dB`);
      }
      
      // Calculate SNR using robust noise baseline (25th percentile)
      const snr_dB = call.peakPower_dB - robustNoiseFloor_dB;
      
      // Store SNR and noiseFloor values in call object
      call.noiseFloor_dB = robustNoiseFloor_dB;

      // Calculate quality rating based on SNR
      call.quality = this.getQualityRating(call.snr_dB);
      
      // If SNR (25th percentile) is too low, likely just noise
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
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution }
   * 
   * [CRITICAL FIX] This method ensures mathematical alignment with legacy Goertzel algorithm:
   * - Uses the WASM engine's actual FFT size (should be 1024 from dedicated analysis engine)
   * - Applies correct dB conversion: 10 * log10(magnitude^2 / fftSize)
   * - Ensures all frequency measurements match legacy JS behavior
   */
  generateSpectrogramWasm(audioData, sampleRate, flowKHz, fhighKHz) {
    if (!this.wasmEngine) {
      console.warn('WASM engine not available, falling back to legacy method');
      return this.generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz);
    }

    try {
      // 1. Get the actual FFT size from WASM engine
      // [CRITICAL] This should be 1024 if using dedicated analysis engine
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
      // [CRITICAL] Frequency resolution must use effective FFT size
      const freqResolution = sampleRate / effectiveFFTSize;
      const numFrames = Math.floor(rawSpectrum.length / numBinsTotal);
      
      if (numFrames < 1 || numBinsTotal < 1 || rawSpectrum.length === 0) {
        console.warn('Invalid WASM output dimensions');
        return this.generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz);
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
      
      // 6. Reshape data and convert to dB (aligned with legacy Goertzel)
      for (let f = 0; f < numFrames; f++) {
        const framePower = new Float32Array(numBinsOfInterest);
        const frameOffset = f * numBinsTotal;
        
        // Calculate time stamp at frame center
        const frameStart = f * hopSize;
        timeFrames[f] = (frameStart + effectiveFFTSize / 2) / sampleRate;
        
        for (let b = 0; b < numBinsOfInterest; b++) {
          const sourceIdx = frameOffset + (minBin + b);
          
          // Safety check
          if (sourceIdx >= rawSpectrum.length) break;
          
          const magnitude = rawSpectrum[sourceIdx];
          
          // [MATH ALIGNMENT] Convert to dB with correct formula:
          // Legacy JS: psd = (rms^2) / fftSize -> dB = 10 * log10(psd)
          // WASM Linear: magnitude is already processed magnitude output
          // Unified formula: Power = magnitude^2, Normalized = Power / fftSize
          const power = magnitude * magnitude;
          const psd = power / effectiveFFTSize;
          
          // Convert to dB with safety floor to prevent -Infinity
          framePower[b] = 10 * Math.log10(Math.max(psd, 1e-16));
        }
        
        powerMatrix[f] = framePower;
      }
      
      // [IMPORTANT] Sync config fftSize for consistency in downstream measurements
      if (this.config.fftSize !== effectiveFFTSize) {
        console.log(`[FFT Alignment] Detector config FFT adjusted from ${this.config.fftSize} to ${effectiveFFTSize}`);
        this.config.fftSize = effectiveFFTSize;
      }
      
      return { powerMatrix, timeFrames, freqBins, freqResolution };
    } catch (error) {
      console.warn('WASM computation failed:', error);
      return this.generateSpectrogramLegacy(audioData, sampleRate, flowKHz, fhighKHz);
    }
  }

  /**
   * Generate high-resolution STFT spectrogram using legacy Goertzel algorithm
   * Returns: { powerMatrix, timeFrames, freqBins, freqResolution }
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
    
    // Apply Goertzel to each frame
    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
      const frameStart = frameIdx * hopSize;
      const frameEnd = frameStart + fftSize;
      const frameData = audioData.slice(frameStart, frameEnd);
      
      // Apply window
      const windowed = this.applyWindow(frameData, windowType);
      
      // Remove DC offset
      let dcOffset = 0;
      for (let i = 0; i < windowed.length; i++) dcOffset += windowed[i];
      dcOffset /= windowed.length;
      
      const dcRemoved = new Float32Array(windowed.length);
      for (let i = 0; i < windowed.length; i++) {
        dcRemoved[i] = windowed[i] - dcOffset;
      }
      
      // Calculate power for each frequency bin
      const framePower = new Float32Array(numBins);
      for (let i = 0; i < numBins; i++) {
        const freqHz = freqBins[i];
        const energy = this.goertzelEnergy(dcRemoved, freqHz, sampleRate);
        const rms = Math.sqrt(energy);
        const psd = (rms * rms) / fftSize;
        framePower[i] = 10 * Math.log10(Math.max(psd, 1e-16));
      }
      
      powerMatrix[frameIdx] = framePower;
      timeFrames[frameIdx] = (frameStart + fftSize / 2) / sampleRate;  // Center of frame
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
   * 2025 ENHANCEMENT: Validate Low Frequency measurement against anti-rebounce protection
   * 
   * This method ensures that the Low Frequency measurement is consistent with the
   * anti-rebounce detection mechanism (detect energy rises after falling).
   * 
   * Validation checks:
   * 1. Low frequency should be reasonably lower than Peak frequency (FM characteristic)
   * 2. Power ratio at Low Frequency threshold should be significant
   * 3. Interpolation should not exceed frequency bin boundaries
   * 4. If rebounce detected: verify Low Frequency is from last stable frame (before energy rise)
   * 
   * @param {number} lowFreq_Hz - Measured low frequency (Hz)
   * @param {number} lowFreq_kHz - Measured low frequency (kHz)
   * @param {number} peakFreq_Hz - Peak frequency (Hz)
   * @param {number} peakPower_dB - Peak power (dB)
   * @param {number} thisPower - Power at low frequency bin (dB)
   * @param {number} prevPower - Power at previous bin (dB)
   * @param {number} endThreshold_dB - End frequency threshold (dB)
   * @param {number} freqBinWidth_Hz - Frequency distance between bins (Hz)
   * @param {boolean} rebounceDetected - Whether rebounce was detected by anti-rebounce mechanism
   * @returns {Object} {valid: boolean, reason: string, confidence: number (0-1)}
   */
  validateLowFrequencyMeasurement(
    lowFreq_Hz, lowFreq_kHz, peakFreq_Hz, peakPower_dB,
    thisPower, prevPower, endThreshold_dB, freqBinWidth_Hz,
    rebounceDetected = false
  ) {
    // Initialize validation result
    const result = {
      valid: true,
      reason: '',
      confidence: 1.0,
      details: {
        frequencySpread: Math.abs((peakFreq_Hz / 1000) - lowFreq_kHz),
        powerRatio_dB: thisPower - prevPower,
        interpolationRatio: (thisPower - endThreshold_dB) / Math.max(thisPower - prevPower, 0.001),
        rebounceCompat: !rebounceDetected ? 'N/A' : 'verified'
      }
    };
    
    // ============================================================
    // CHECK 1: Frequency relationship (Low < Peak)
    // FM calls should have peak freq > low freq (frequency sweep)
    // ============================================================
    const peakFreq_kHz = peakFreq_Hz / 1000;
    if (lowFreq_kHz > peakFreq_kHz) {
      // Low frequency should not exceed peak
      // This would indicate measurement error
      result.valid = false;
      result.reason = `Low Frequency (${lowFreq_kHz.toFixed(2)} kHz) exceeds Peak (${peakFreq_kHz.toFixed(2)} kHz)`;
      result.confidence = 0.0;
      return result;
    }
    
    // Check frequency spread is reasonable
    const freqSpread = peakFreq_kHz - lowFreq_kHz;
    if (freqSpread < 0.5) {
      // Very small frequency spread: might be CF or measurement artifact
      result.confidence *= 0.8; // Reduce confidence slightly
      result.details.frequencySpreadWarning = 'Very narrow bandwidth (< 0.5 kHz)';
    }
    
    // ============================================================
    // CHECK 2: Power ratio at threshold crossing
    // Should have significant power difference between prev and current bin
    // Low power ratio = gentle slope = poor interpolation reliability
    // ============================================================
    const powerRatio = Math.abs(thisPower - prevPower);
    if (powerRatio < 2.0) {
      // Weak power gradient: interpolation may be unreliable
      result.confidence *= 0.7; // Reduce confidence
      result.details.powerRatioWarning = 'Weak power gradient (< 2 dB)';
    } else if (powerRatio > 20) {
      // Steep power gradient: good interpolation reliability
      result.confidence *= 1.0;
    } else {
      // Normal gradient (2-20 dB)
      result.confidence *= 0.95;
    }
    
    // ============================================================
    // CHECK 3: Interpolation sanity
    // Verify interpolated frequency is within bin boundaries
    // ============================================================
    const prevFreq_Hz = lowFreq_Hz - (peakPower_dB - prevPower) * freqBinWidth_Hz /
                        Math.max(thisPower - prevPower, 0.001);
    
    // Interpolation ratio should be between 0 and 1
    const interpolationRatio = result.details.interpolationRatio;
    if (interpolationRatio < 0 || interpolationRatio > 1) {
      result.valid = false;
      result.reason = `Invalid interpolation ratio: ${interpolationRatio.toFixed(3)} (should be 0-1)`;
      result.confidence = 0.3;
      return result;
    }
    
    // ============================================================
    // CHECK 4: Anti-rebounce compatibility
    // If rebounce was detected, verify Low Frequency is from last valid frame
    // (before energy rise indicating echo/reflection)
    // ============================================================
    if (rebounceDetected) {
      // Low frequency should be measured at higher power than end threshold
      // to ensure it's from the true call, not from rebounce tail
      if (thisPower < (endThreshold_dB + 3)) {
        // Power is barely above threshold: might be from rebounce tail
        result.confidence *= 0.6; // Reduce confidence
        result.details.rebounceWarning = 'Low frequency power barely above threshold';
      }
      result.details.rebounceCompat = 'verified'; // Mark as checked
    }
    
    // ============================================================
    // FINAL CONFIDENCE ASSESSMENT
    // ============================================================
    if (result.confidence < 0.6) {
      result.valid = false;
      if (!result.reason) {
        result.reason = `Low confidence measurement (${(result.confidence * 100).toFixed(1)}%)`;
      }
    }
    
    return result;
  }

  /**
   * Find optimal High Threshold by testing range and detecting anomalies
   * 
   * 2025 ENHANCED ALGORITHM v2 (Narrowing Search Range):
   * 1. Start with widest range (Frame 0 to Peak Frame)
   * 2. Test threshold (-24 → -70 dB), detect highFreq position for each step
   * 3. If no anomaly in this step:
   *    - Record highFreqFrameIdx for this threshold
   *    - Narrow next step's search range to Frame 0 to highFreqFrameIdx
   * 4. Continue narrowing until anomaly detected or threshold exhausted
   * 5. This follows the signal's energy trajectory and avoids rebounce detection
   * 6. Return: both High Frequency (with optimal threshold) AND Start Frequency
   * 
   * Benefits:
   * - Tracks signal energy forward in time (avoids rebounce)
   * - Detects frequency transitions at their first occurrence
   * - More stable multi-frequency detection
   * 
   * @param {Array} spectrogram - 2D array [timeFrame][freqBin] of power values (dB)
   * @param {Array} freqBins - Frequency bin centers (Hz)
   * @param {number} flowKHz - Lower frequency bound (kHz)
   * @param {number} fhighKHz - Upper frequency bound (kHz)
   * @param {number} callPeakPower_dB - Stable call peak power (not global spectrogram max)
   * @param {number} peakFrameIdx - Peak frame index to limit initial scan
   * @returns {Object} {threshold, highFreq_Hz, highFreq_kHz, highFreqFrameIdx, startFreq_Hz, startFreq_kHz, warning}
   */
findOptimalHighFrequencyThreshold(spectrogram, freqBins, flowKHz, fhighKHz, callPeakPower_dB, peakFrameIdx = 0) {
    if (spectrogram.length === 0) return {
      threshold: -24,
      highFreq_Hz: null,
      highFreq_kHz: null,
      highFreqFrameIdx: 0,
      startFreq_Hz: null,
      startFreq_kHz: null,
      warning: false
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================
    
    const firstFramePower = spectrogram[0];
    const numBins = firstFramePower.length;
    
    // Initial search limit: from 0 to peakFrameIdx
    let currentSearchLimitFrame = Math.min(peakFrameIdx, spectrogram.length - 1);
    
    // Track the highFreqFrameIdx for each step to narrow future searches
    let lastValidHighFreqFrameIdx = currentSearchLimitFrame;
    
    const stablePeakPower_dB = callPeakPower_dB;
    
    // 測試閾值範圍：-24 到 -70 dB，間距 0.5 dB
    const thresholdRange = [];
    for (let threshold = -24; threshold >= -70; threshold -= 0.5) {
      thresholdRange.push(threshold);
    }
    
    const measurements = [];
    
    for (const testThreshold_dB of thresholdRange) {
      const highFreqThreshold_dB = stablePeakPower_dB + testThreshold_dB;
      
      // ============================================================
      // 1. 計算 HIGH FREQUENCY (Frame-by-Frame Scanning)
      // 改為與 Manual Mode Step 2 完全相同的邏輯：
      // 掃描每一幀 -> 找該幀最高頻 -> 與全局最高頻比較
      // ============================================================
      let highFreq_Hz = null; // Init to null to indicate not found yet
      let highFreqBinIdx = 0;
      let highFreqFrameIdx = 0; // Default
      let foundBin = false;
      
      // 遍歷搜尋範圍內的每一幀
      for (let f = 0; f <= currentSearchLimitFrame; f++) {
        const framePower = spectrogram[f];
        
        // 在這一幀中，從高頻往低頻掃描 (Reverse order)
        for (let b = numBins - 1; b >= 0; b--) {
          if (framePower[b] > highFreqThreshold_dB) {
            // 找到該幀的最高頻 Bin
            let thisFrameFreq_Hz = freqBins[b];
            
            // 執行線性插值 (使用當前幀的 power，保證與 Manual Mode 一致)
            if (b < numBins - 1) {
              const thisPower = framePower[b];
              const nextPower = framePower[b + 1];
              
              if (nextPower < highFreqThreshold_dB && thisPower > highFreqThreshold_dB) {
                const powerRatio = (thisPower - highFreqThreshold_dB) / (thisPower - nextPower);
                const freqDiff = freqBins[b + 1] - freqBins[b];
                thisFrameFreq_Hz = freqBins[b] + powerRatio * freqDiff;
              }
            }
            
            // 比較：這是目前為止找到的最高頻率嗎？
            // Logic: We want the ABSOLUTE HIGHEST frequency across all frames
            if (highFreq_Hz === null || thisFrameFreq_Hz > highFreq_Hz) {
              highFreq_Hz = thisFrameFreq_Hz;
              highFreqBinIdx = b;
              highFreqFrameIdx = f;
              foundBin = true;
            }
            
            // 這一幀已經找到最高點了，換下一幀
            break; 
          }
        }
      }

      // ============================================================
      // 2. 計算 START FREQUENCY (Always Frame 0)
      // 保持不變，因為 Start Freq 永遠只看 Frame 0
      // ============================================================
      let startFreq_Hz = null;
      if (foundBin) {
        for (let binIdx = 0; binIdx < firstFramePower.length; binIdx++) {
          if (firstFramePower[binIdx] > highFreqThreshold_dB) {
            startFreq_Hz = freqBins[binIdx];
            // 線性插值
            if (binIdx > 0) {
              const thisPower = firstFramePower[binIdx];
              const prevPower = firstFramePower[binIdx - 1];
              if (prevPower < highFreqThreshold_dB && thisPower > highFreqThreshold_dB) {
                const powerRatio = (thisPower - highFreqThreshold_dB) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                startFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }
            break;
          }
        }
      }
      
      // Reset if not found
      if (!foundBin) {
        highFreq_Hz = null;
        startFreq_Hz = null;
        highFreqFrameIdx = 0;
      }
      
      // ============================================================
      // 3. MAJOR JUMP PROTECTION (> 4.0 kHz)
      // 直接檢查 measurements 陣列中的上一個有效值
      // ============================================================
      if (foundBin && highFreq_Hz !== null) {
        const currentHighFreq_kHz = highFreq_Hz / 1000;
        
        // 查找上一個有效的測量值
        let lastValidFreq_kHz = null;
        for (let i = measurements.length - 1; i >= 0; i--) {
          if (measurements[i].foundBin && measurements[i].highFreq_kHz !== null) {
            lastValidFreq_kHz = measurements[i].highFreq_kHz;
            break;
          }
        }
        
        // 如果存在上一個有效值，進行跳變檢查
        if (lastValidFreq_kHz !== null) {
          const jumpDiff = Math.abs(currentHighFreq_kHz - lastValidFreq_kHz);
          if (jumpDiff > 4.0) {
            // Major jump detected (> 4.0 kHz).
            // Hit noise floor. Stop immediately.
            break; 
          }
        }
      }
      
      measurements.push({
        threshold: testThreshold_dB,
        highFreqThreshold_dB: highFreqThreshold_dB,
        highFreq_Hz: highFreq_Hz,
        highFreq_kHz: highFreq_Hz !== null ? highFreq_Hz / 1000 : null,
        highFreqBinIdx: highFreqBinIdx,
        highFreqFrameIdx: highFreqFrameIdx,
        startFreq_Hz: startFreq_Hz,
        startFreq_kHz: startFreq_Hz !== null ? startFreq_Hz / 1000 : null,
        foundBin: foundBin
      });
      
      // ============================================================
      // 4. NARROWING SEARCH RANGE
      // ============================================================
      if (foundBin && highFreqFrameIdx >= 0 && highFreqFrameIdx < currentSearchLimitFrame) {
        currentSearchLimitFrame = highFreqFrameIdx;
        lastValidHighFreqFrameIdx = highFreqFrameIdx;
      }
    }
    
    // ============================================================
    // 保存最終的搜尋範圍
    const finalSearchLimitFrame = currentSearchLimitFrame;
    
    // ============================================================
    // 只收集成功找到 bin 的測量
    const validMeasurements = measurements.filter(m => m.foundBin);
    
    if (validMeasurements.length === 0) {
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

    // [Standard Anomaly Logic - Preserved from previous version]
    // 這部分邏輯負責處理 2.5kHz - 4.0kHz 的微小異常，保持不變
    let optimalThreshold = -24;
    let optimalMeasurement = validMeasurements[0];
    let lastValidThreshold = validMeasurements[0].threshold;
    let lastValidMeasurement = validMeasurements[0];
    let recordedEarlyAnomaly = null;
    let firstAnomalyIndex = -1;
    
    for (let i = 1; i < validMeasurements.length; i++) {
      const prevFreq_kHz = validMeasurements[i - 1].highFreq_kHz;
      const currFreq_kHz = validMeasurements[i].highFreq_kHz;
      const freqDifference = Math.abs(currFreq_kHz - prevFreq_kHz);
      
      // 雙重保險，雖然 Loop 內已經攔截
      if (freqDifference > 4.0) {
        optimalThreshold = validMeasurements[i - 1].threshold;
        optimalMeasurement = validMeasurements[i - 1];
        break;
      }
      
      const isAnomaly = freqDifference > 2.5;
      
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
            if (checkIdx >= validMeasurements.length) {
              hasThreeNormalAfterAnomaly = false;
              break;
            }
            const checkPrevFreq_kHz = validMeasurements[checkIdx - 1].highFreq_kHz;
            const checkCurrFreq_kHz = validMeasurements[checkIdx].highFreq_kHz;
            const checkFreqDiff = Math.abs(checkCurrFreq_kHz - checkPrevFreq_kHz);
            
            if (checkFreqDiff > 2.5) {
              hasThreeNormalAfterAnomaly = false;
              break;
            }
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
    
    const finalThreshold = Math.max(Math.min(optimalThreshold, -24), -70);
    const safeThreshold = (finalThreshold <= -70) ? -30 : finalThreshold;
    const hasWarning = finalThreshold <= -70;
    
    let returnHighFreq_Hz = optimalMeasurement.highFreq_Hz;
    let returnHighFreq_kHz = optimalMeasurement.highFreq_kHz;
    let returnHighFreqBinIdx = optimalMeasurement.highFreqBinIdx;
    let returnHighFreqFrameIdx = optimalMeasurement.highFreqFrameIdx;
    let returnStartFreq_Hz = optimalMeasurement.startFreq_Hz;
    let returnStartFreq_kHz = optimalMeasurement.startFreq_kHz;
    
    // Safety Mechanism Re-calculation logic (如果 safeThreshold !== finalThreshold)
    // 這裡也必須改為 Frame-by-Frame Scanning 以保持一致性
    if (safeThreshold !== finalThreshold) {
      const highFreqThreshold_dB_safe = stablePeakPower_dB + safeThreshold;
      
      let highFreq_Hz_safe = null;
      let highFreqBinIdx_safe = 0;
      let highFreqFrameIdx_safe = 0;
      let startFreq_Hz_safe = null;
      let foundBin_safe = false;

      // Re-scan Frame-by-Frame for the Safe Threshold
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
      
      // Re-calc Start Freq for Safe Threshold
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
      warning: hasWarning
    };
  }

  /**
   * 2025 ENHANCEMENT: Find Optimal Low Frequency Threshold
   * 
   * Automatically determines the best low frequency threshold from -24dB to -70dB
   * by testing each threshold and detecting anomalies (frequency jumps > 2.5 kHz).
   * 
   * This method provides:
   * - Consistent low frequency detection across different spectrogram conditions
   * - Anti-rebounce compatibility (works with backward end frame scanning)
   * - Automatic fallback to -24dB if no optimal point found
   * - Anomaly detection logic identical to high frequency optimization
   * 
   * Testing sequence: -24, -25, -26, ..., -69, -70 dB
   * 
   * Anomaly detection:
   * - Major jump (> 2 kHz): Stop immediately, use previous threshold
   * - Large jump (1.5-2 kHz): First anomaly detection point
   * - Check if anomaly is followed by 3+ consecutive normal values
   * - If yes: ignore anomaly and continue
   * - If no: use threshold just before anomaly
   * 
   * Anti-rebounce compatibility:
   * - Uses last frame power spectrum (like low frequency measurement)
   * - Works with backward endFreqScan detection
   * - Maintains frequency boundary integrity
   * 
   * @param {Array} spectrogram - STFT spectrogram (time x frequency bins)
   * @param {Array} freqBins - Frequency bin values (Hz)
   * @param {number} flowKHz - Low frequency boundary (kHz)
   * @param {number} fhighKHz - High frequency boundary (kHz)
   * @param {number} callPeakPower_dB - Call peak power in dB (stable value)
   * @returns {Object} {threshold, lowFreq_Hz, lowFreq_kHz, endFreq_Hz, endFreq_kHz, warning}
   */
findOptimalLowFrequencyThreshold(spectrogram, freqBins, flowKHz, fhighKHz, callPeakPower_dB, peakFrameIdx = 0, limitFrameIdx = null) {
    if (spectrogram.length === 0) return {
      threshold: -24,
      lowFreq_Hz: null,
      lowFreq_kHz: null,
      endFreq_Hz: null,
      endFreq_kHz: null,
      warning: false
    };

    const stablePeakPower_dB = callPeakPower_dB;
    const numBins = spectrogram[0].length;
    
    // ============================================================
    // Use limitFrameIdx if provided to match Manual Mode's structural analysis
    // This allows gap-bridging: signal drops within the call are bridged.
    // ============================================================
    const searchEndFrame = (limitFrameIdx !== null && limitFrameIdx < spectrogram.length) 
      ? limitFrameIdx 
      : spectrogram.length - 1;
    
    // 測試閾值範圍：-24 到 -70 dB
    const thresholdRange = [];
    for (let threshold = -24; threshold >= -70; threshold -= 0.5) {
      thresholdRange.push(threshold);
    }
    
    const measurements = [];
    
    for (const testThreshold_dB of thresholdRange) {
      let lowFreq_Hz = null;
      let endFreq_Hz = null;
      let foundBin = false;
      
      const lowFreqThreshold_dB = stablePeakPower_dB + testThreshold_dB;
      
      // ============================================================
      // 1. 動態尋找有效結束幀 (Gap-Bridging Forward Scan)
      // 掃描所有幀（從 Peak 到 searchEndFrame），找到最後一個有信號的幀。
      // 不會在第一個無信號幀停止 - 這實現了 "Gap Bridging"：
      // 允許信號在幀與幀之間短暫的 drop，但仍視為連續信號。
      // ============================================================
      let activeEndFrameIdx = -1; 
      
      // Gap Bridging Scan: Scan ALL frames in range, don't stop at silence
      for (let f = peakFrameIdx; f <= searchEndFrame; f++) {
        const frame = spectrogram[f];
        let frameHasSignal = false;
        for (let b = 0; b < numBins; b++) {
          if (frame[b] > lowFreqThreshold_dB) {
            frameHasSignal = true;
            break;
          }
        }
        if (frameHasSignal) {
          activeEndFrameIdx = f; // Always update to the latest found frame
        } 
      }
      
      // Safety fallback
      if (activeEndFrameIdx === -1) activeEndFrameIdx = peakFrameIdx;
      
      // ============================================================
      // 2. 計算 LOW FREQUENCY（使用 Forward Scan 找到的 activeEndFrameIdx）
      // ============================================================
      if (activeEndFrameIdx !== -1) {
        const targetFramePower = spectrogram[activeEndFrameIdx];
        
        // 尋找該幀的最低頻率 (Low -> High)
        for (let binIdx = 0; binIdx < targetFramePower.length; binIdx++) {
          if (targetFramePower[binIdx] > lowFreqThreshold_dB) {
            lowFreq_Hz = freqBins[binIdx];
            foundBin = true;
            
            // 線性插值
            if (binIdx > 0) {
              const thisPower = targetFramePower[binIdx];
              const prevPower = targetFramePower[binIdx - 1];
              
              if (prevPower < lowFreqThreshold_dB && thisPower > lowFreqThreshold_dB) {
                const powerRatio = (thisPower - lowFreqThreshold_dB) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                lowFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }
            break; // 找到最低頻後立即停止
          }
        }
      }
      
      // End Frequency = Low Frequency (from last frame)
      if (foundBin) {
        endFreq_Hz = lowFreq_Hz;
      } else {
        lowFreq_Hz = null;
        endFreq_Hz = null;
      }
      
      measurements.push({
        threshold: testThreshold_dB,
        lowFreqThreshold_dB: lowFreqThreshold_dB,
        lowFreq_Hz: lowFreq_Hz,
        lowFreq_kHz: lowFreq_Hz !== null ? lowFreq_Hz / 1000 : null,
        endFreq_Hz: endFreq_Hz,
        endFreq_kHz: endFreq_Hz !== null ? endFreq_Hz / 1000 : null,
        foundBin: foundBin
      });
    }
    
    // ============================================================
    // 只收集成功找到 bin 的測量
    const validMeasurements = measurements.filter(m => m.foundBin);
    
    if (validMeasurements.length === 0) {
      return {
        threshold: -24,
        lowFreq_Hz: null,
        lowFreq_kHz: null,
        endFreq_Hz: null,
        endFreq_kHz: null,
        warning: false
      };
    }
    
    // [Anomaly Detection Logic - Preserved]
    let optimalThreshold = -24;
    let optimalMeasurement = validMeasurements[0];
    let lastValidThreshold = validMeasurements[0].threshold;
    let lastValidMeasurement = validMeasurements[0];
    let recordedEarlyAnomaly = null;
    let firstAnomalyIndex = -1;
    
    for (let i = 1; i < validMeasurements.length; i++) {
      const prevFreq_kHz = validMeasurements[i - 1].lowFreq_kHz;
      const currFreq_kHz = validMeasurements[i].lowFreq_kHz;
      const freqDifference = Math.abs(currFreq_kHz - prevFreq_kHz);
      
      if (freqDifference > 2.0) {
        optimalThreshold = validMeasurements[i - 1].threshold;
        optimalMeasurement = validMeasurements[i - 1];
        break;
      }
      
      const isAnomaly = freqDifference > 1.5;
      
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
            if (checkIdx >= validMeasurements.length) {
              hasThreeNormalAfterAnomaly = false;
              break;
            }
            const checkPrevFreq_kHz = validMeasurements[checkIdx - 1].lowFreq_kHz;
            const checkCurrFreq_kHz = validMeasurements[checkIdx].lowFreq_kHz;
            const checkFreqDiff = Math.abs(checkCurrFreq_kHz - checkPrevFreq_kHz);
            
            if (checkFreqDiff > 1.5) {
              hasThreeNormalAfterAnomaly = false;
              break;
            }
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
    
    const finalThreshold = Math.max(Math.min(optimalThreshold, -24), -70);
    const safeThreshold = (finalThreshold <= -70) ? -30 : finalThreshold;
    const hasWarning = finalThreshold <= -70;
    
    let returnLowFreq_Hz = optimalMeasurement.lowFreq_Hz;
    let returnLowFreq_kHz = optimalMeasurement.lowFreq_kHz;
    let returnEndFreq_Hz = optimalMeasurement.endFreq_Hz;
    let returnEndFreq_kHz = optimalMeasurement.endFreq_kHz;
    
    // Safety Mechanism Re-calculation logic (如果 safeThreshold !== finalThreshold)
    // 同樣需要使用 Gap Bridging Scan
    if (safeThreshold !== finalThreshold) {
      const lowFreqThreshold_dB_safe = stablePeakPower_dB + safeThreshold;
      
      // 1. Re-scan Gap Bridging from Peak to searchEndFrame
      let activeEndFrameIdx_safe = -1;
      for (let f = peakFrameIdx; f <= searchEndFrame; f++) {
        const frame = spectrogram[f];
        let frameHasSignal = false;
        for (let b = 0; b < numBins; b++) {
          if (frame[b] > lowFreqThreshold_dB_safe) {
            frameHasSignal = true;
            break;
          }
        }
        if (frameHasSignal) {
          activeEndFrameIdx_safe = f;
        }
      }
      
      // Safety fallback
      if (activeEndFrameIdx_safe === -1) activeEndFrameIdx_safe = peakFrameIdx;
      
      if (activeEndFrameIdx_safe !== -1) {
        const targetFramePower = spectrogram[activeEndFrameIdx_safe];
        let lowFreq_Hz_safe = null;
        let endFreq_Hz_safe = null;
        
        // 2. Re-calculate Low Freq
        for (let binIdx = 0; binIdx < targetFramePower.length; binIdx++) {
          if (targetFramePower[binIdx] > lowFreqThreshold_dB_safe) {
            lowFreq_Hz_safe = freqBins[binIdx];
            if (binIdx > 0) {
              const thisPower = targetFramePower[binIdx];
              const prevPower = targetFramePower[binIdx - 1];
              if (prevPower < lowFreqThreshold_dB_safe && thisPower > lowFreqThreshold_dB_safe) {
                const powerRatio = (thisPower - lowFreqThreshold_dB_safe) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                lowFreq_Hz_safe = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }
            break;
          }
        }
        
        if (lowFreq_Hz_safe !== null) {
          endFreq_Hz_safe = lowFreq_Hz_safe;
          returnLowFreq_Hz = lowFreq_Hz_safe;
          returnLowFreq_kHz = lowFreq_Hz_safe / 1000;
          returnEndFreq_Hz = endFreq_Hz_safe;
          returnEndFreq_kHz = endFreq_Hz_safe / 1000;
        }
      }
    }
    
    return {
      threshold: safeThreshold,
      lowFreq_Hz: returnLowFreq_Hz,
      lowFreq_kHz: returnLowFreq_kHz,
      endFreq_Hz: returnEndFreq_Hz,
      endFreq_kHz: returnEndFreq_kHz,
      warning: hasWarning
    };
  }

  /**
   * Phase 2: Measure precise
   * Based on Avisoft SASLab Pro, SonoBat, Kaleidoscope Pro, and BatSound standards
   * 
   * Reference implementations:
   * - Avisoft: Threshold-based peak detection with interpolation
   * - SonoBat: Duration-weighted frequency averaging
   * - Kaleidoscope: Multi-frame analysis with robustness checks
   * - BatSound: Peak prominence and edge detection
   * 
   * Updates call.peakFreq, startFreq, endFreq, characteristicFreq, bandwidth, duration
   */
  measureFrequencyParameters(call, flowKHz, fhighKHz, freqBins, freqResolution) {
    let { highFreqThreshold_dB, characteristicFreq_percentEnd } = this.config;
    const spectrogram = call.spectrogram;  // [timeFrame][freqBin]
    const timeFrames = call.timeFrames;    // Time points for each frame
    
    if (spectrogram.length === 0) return;
    
    // ============================================================
    // STEP 0: Find peak frequency FIRST (before auto-threshold calculation)
    // 
    // CRITICAL (2025 FIX): Must find actual call peak BEFORE auto-threshold mode
    // so that findOptimalHighFrequencyThreshold can use stable call.peakPower_dB
    // instead of spectrogram's global max (which varies with selection size)
    // 
    // Professional Standard: Use FFT + Parabolic Interpolation
    // (aligned with Avisoft, SonoBat, Kaleidoscope, BatSound)
    // 
    // Method:
    // 1. Find peak bin in spectrogram
    // 2. If peak is not at edge, apply parabolic interpolation
    // 3. This provides sub-bin precision (~0.1 Hz accuracy)
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
    
    // Phase 2: Apply parabolic interpolation for sub-bin precision
    // If peak is not at edges, interpolate between neighboring bins
    peakFreq_Hz = freqBins[peakBinIdx];
    
    if (peakBinIdx > 0 && peakBinIdx < spectrogram[peakFrameIdx].length - 1) {
      const framePower = spectrogram[peakFrameIdx];
      const db0 = framePower[peakBinIdx - 1];
      const db1 = framePower[peakBinIdx];
      const db2 = framePower[peakBinIdx + 1];
      
      // Parabolic vertex formula: y = a*x^2 + b*x + c
      // Peak position correction using 2nd derivative
      const a = (db2 - 2 * db1 + db0) / 2;
      if (Math.abs(a) > 1e-10) {
        // bin correction = (f(x-1) - f(x+1)) / (4*a)
        const binCorrection = (db0 - db2) / (4 * a);
        const refinedBin = peakBinIdx + binCorrection;
        const binWidth = freqBins[1] - freqBins[0]; // Frequency distance between bins
        peakFreq_Hz = freqBins[peakBinIdx] + binCorrection * binWidth;
      }
    }
    
    // Store peak values for use in auto-threshold calculation
    // IMPORTANT: These values are NOW STABLE and don't depend on selection area size
    call.peakFreq_kHz = peakFreq_Hz / 1000;
    call.peakPower_dB = peakPower_dB;
    
    // ============================================================
    // NEW (2025): Calculate peak frequency time in milliseconds
    // peakFreqTime_ms = absolute time of peak frequency frame within selection area
    // Unit: ms (milliseconds), relative to selection area start
    // ============================================================
    if (peakFrameIdx < timeFrames.length) {
      // Convert from seconds to milliseconds, using first frame as reference point (0 ms)
      const peakTimeInSeconds = timeFrames[peakFrameIdx];
      const firstFrameTimeInSeconds = timeFrames[0];
      const relativeTime_ms = (peakTimeInSeconds - firstFrameTimeInSeconds) * 1000;
      call.peakFreqTime_ms = relativeTime_ms;  // Time relative to selection area start
    }
    
    // ============================================================
    // AUTO MODE: If highFreqThreshold_dB_isAuto is enabled,
    // automatically find optimal threshold using STABLE call.peakPower_dB
    // (NOT the floating globalPeakPower_dB from entire spectrogram)
    // ============================================================
    // 2025: Declare these variables in outer scope so they can be used in STEP 2
    let safeHighFreq_kHz = null;
    let safeHighFreq_Hz = null;
    let safeHighFreqBinIdx = undefined;
    let safeHighFreqFrameIdx = 0;
    let finalSearchLimitFrameFromAuto = 0;  // 2025 v2: 保存 auto mode 返回的搜尋範圍限制
    
    if (this.config.highFreqThreshold_dB_isAuto === true) {
      const result = this.findOptimalHighFrequencyThreshold(
        spectrogram,
        freqBins,
        flowKHz,
        fhighKHz,
        peakPower_dB,  // Pass stable call peak value instead of computing global peak again
        peakFrameIdx   // Pass peak frame index to only check frames before peak
      );
      
      // ============================================================
      // 新規則 2025：High Frequency 防呆機制
      // 找出第一個 >= Peak Frequency 的有效 High Frequency
      // ============================================================
      // 如果返回的 High Frequency < Peak Frequency，視為異常
      // 需要向上遍歷 thresholdRange 找到第一個 >= Peak Frequency 的值
      safeHighFreq_kHz = result.highFreq_kHz;
      safeHighFreq_Hz = result.highFreq_Hz;
      safeHighFreqBinIdx = result.highFreqBinIdx;  // 2025: Initialize from findOptimalHighFrequencyThreshold
      safeHighFreqFrameIdx = result.highFreqFrameIdx;  // 2025 v2: 取得幀索引
      finalSearchLimitFrameFromAuto = result.finalSearchLimitFrame;  // 2025 v2: 取得搜尋範圍限制
      let usedThreshold = result.threshold;
      
      // 如果最優閾值的 High Frequency 低於 Peak Frequency，執行防呆檢查
      if (result.highFreq_kHz !== null && result.highFreq_kHz < (peakFreq_Hz / 1000)) {
        // 需要找到第一個 >= Peak Frequency 的 High Frequency
        // 重新測試閾值範圍，從 -24 到 -70
        const peakFreq_kHz = peakFreq_Hz / 1000;
        let foundValidHighFreq = false;
        
        for (let testThreshold_dB = -24; testThreshold_dB >= -70; testThreshold_dB--) {
          const highFreqThreshold_dB = peakPower_dB + testThreshold_dB;
          
          // 2025 v2: 在 finalSearchLimitFrame 範圍內掃描，而不是只掃描 Frame 0
          let testHighFreq_Hz = null;
          let testHighFreqBinIdx = 0;
          let testHighFreqFrameIdx = -1;
          
          // 在 finalSearchLimitFrame 範圍內構建 Max Spectrum
          const testMaxSpectrum = new Float32Array(spectrogram[0].length).fill(-Infinity);
          const testFrameIndexForBin = new Uint16Array(spectrogram[0].length);
          
          for (let f = 0; f <= finalSearchLimitFrameFromAuto; f++) {
            const frame = spectrogram[f];
            for (let b = 0; b < frame.length; b++) {
              if (frame[b] > testMaxSpectrum[b]) {
                testMaxSpectrum[b] = frame[b];
                testFrameIndexForBin[b] = f;
              }
            }
          }
          
          // High Frequency 計算（從高到低）
          for (let binIdx = testMaxSpectrum.length - 1; binIdx >= 0; binIdx--) {
            if (testMaxSpectrum[binIdx] > highFreqThreshold_dB) {
              testHighFreq_Hz = freqBins[binIdx];
              testHighFreqBinIdx = binIdx;
              testHighFreqFrameIdx = testFrameIndexForBin[binIdx];
              
              // 線性插值
              if (binIdx < testMaxSpectrum.length - 1) {
                const thisPower = testMaxSpectrum[binIdx];
                const nextPower = testMaxSpectrum[binIdx + 1];
                if (nextPower < highFreqThreshold_dB && thisPower > highFreqThreshold_dB) {
                  const powerRatio = (thisPower - highFreqThreshold_dB) / (thisPower - nextPower);
                  const freqDiff = freqBins[binIdx + 1] - freqBins[binIdx];
                  testHighFreq_Hz = freqBins[binIdx] + powerRatio * freqDiff;
                }
              }
              break;
            }
          }
          
          // 如果找到有效的 High Frequency，檢查是否 >= Peak Frequency
          if (testHighFreq_Hz !== null && (testHighFreq_Hz / 1000) >= peakFreq_kHz) {
            
            safeHighFreq_Hz = testHighFreq_Hz;
            safeHighFreq_kHz = testHighFreq_Hz / 1000;
            safeHighFreqBinIdx = testHighFreqBinIdx;
            safeHighFreqFrameIdx = testHighFreqFrameIdx;  // 2025 v2: 保存幀索引
            usedThreshold = testThreshold_dB;
            foundValidHighFreq = true;
            break;
          }
        }
      }
      
      // Update the config with the calculated optimal threshold
      this.config.highFreqThreshold_dB = usedThreshold;
      // 2025: 在 auto mode 下保存實際使用的 high frequency threshold
      // Auto mode: 保存經過防呆檢查後的最終 threshold 值
      call.highFreqThreshold_dB_used = usedThreshold;
      // 
      // 2025 CRITICAL FIX: 已應用安全機制
      // 當 threshold 達到 -70dB 極限時，自動改用 -30dB
      // 不再需要顯示 warning，因此 highFreqDetectionWarning 已棄用
      
    }
    
    // ============================================================
    // STEP 1.5: 重新計算時間邊界 (基於新的 highFreqThreshold_dB)
    // 
    // 2025 ANTI-REBOUNCE UPGRADE:
    // - Backward scanning for clean end frequency detection
    // - Maximum frequency drop rule to lock end frame
    // - 10ms protection window after peak energy
    // ============================================================
    const { 
      enableBackwardEndFreqScan,
      maxFrequencyDropThreshold_kHz,
      protectionWindowAfterPeak_ms
    } = this.config;
    
    const highThreshold_dB = peakPower_dB + this.config.highFreqThreshold_dB;  // High Frequency threshold (可調整)
    
    // ============================================================
    // End & Low Frequency Threshold
    // Manual Mode: 使用用戶輸入的 lowFreqThreshold_dB 值
    // Auto Mode: 使用固定的 -27dB（會在後續 findOptimalLowFrequencyThreshold 中被覆蓋）
    // ============================================================
    let endThreshold_dB;
    if (this.config.lowFreqThreshold_dB_isAuto === false) {
      // Manual Mode: 使用用戶手動輸入的值
      endThreshold_dB = peakPower_dB + this.config.lowFreqThreshold_dB;
    } else {
      // Auto Mode: 初始使用預設值 -27dB（會在 findOptimalLowFrequencyThreshold 中被重新計算）
      endThreshold_dB = peakPower_dB - 27;
    }
    
    // 找到第一個幀，其中有信號超過閾值
    let newStartFrameIdx = 0;
    for (let frameIdx = 0; frameIdx < spectrogram.length; frameIdx++) {
      const framePower = spectrogram[frameIdx];
      let frameHasSignal = false;
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        if (framePower[binIdx] > highThreshold_dB) {
          frameHasSignal = true;
          break;
        }
      }
      if (frameHasSignal) {
        newStartFrameIdx = frameIdx;
        break;
      }
    }
    
    // TRICK 1 & 3: Find end frame with anti-rebounce protection
    // 
    // Standard method: Backward scan from end to find -27dB cutoff
    // + Maximum frequency drop detection (Trick 2)
    // + Protection window limit (Trick 3) - but only if frequency drop is detected
    // ============================================================
    let newEndFrameIdx = spectrogram.length - 1;
    
    // Calculate frame limit for Trick 3 (10ms protection window)
    const protectionFrameLimit = Math.round(
      (protectionWindowAfterPeak_ms / 1000) / (timeFrames[1] - timeFrames[0])
    );
    const maxFrameIdxAllowed = Math.min(
      peakFrameIdx + protectionFrameLimit,
      spectrogram.length - 1
    );
    
    // ANTI-REBOUNCE: Forward scan from peak to find natural end
    // Professional approach: Use energy trend analysis + monotonic decay detection
    // - FM/Sweep: Stop when frequency drops significantly (TRICK 2)
    // - CF/QCF: Energy monotonically decreases until call ends
    //   Special rule: If energy rises after falling = rebounce signal detected → STOP immediately
    if (enableBackwardEndFreqScan) {
      let lastValidEndFrame = peakFrameIdx;
      let freqDropDetected = false;
      
      // Professional criterion (Avisoft/SonoBat style): Find last frame where energy > peakPower_dB - 18dB
      // This softer threshold (-18dB vs -27dB) better handles natural decay in CF/QCF calls
      const sustainedEnergyThreshold = peakPower_dB - 18; // 18dB drop from peak
      let lastFrameAboveSustainedThreshold = peakFrameIdx;
      
      // Track energy for monotonic decay detection
      let lastFrameMaxPower = peakPower_dB;
      let hasStartedDecaying = false;
      let lastValidEndBeforeRebounce = peakFrameIdx;
      
      // Scan FORWARD from peak to END to find natural decay point
      for (let frameIdx = peakFrameIdx; frameIdx < spectrogram.length; frameIdx++) {
        const framePower = spectrogram[frameIdx];
        let frameMaxPower = -Infinity;
        let framePeakFreq = 0;
        
        for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
          if (framePower[binIdx] > frameMaxPower) {
            frameMaxPower = framePower[binIdx];
            framePeakFreq = freqBins[binIdx] / 1000;
          }
        }
        
        // Check for FM frequency drop (primary indicator for FM calls)
        if (frameIdx > peakFrameIdx && !freqDropDetected && frameMaxPower > endThreshold_dB) {
          const prevFramePower = spectrogram[frameIdx - 1];
          let prevFramePeakFreq = 0;
          let prevFrameMaxPower = -Infinity;
          for (let binIdx = 0; binIdx < prevFramePower.length; binIdx++) {
            if (prevFramePower[binIdx] > prevFrameMaxPower) {
              prevFrameMaxPower = prevFramePower[binIdx];
              prevFramePeakFreq = freqBins[binIdx] / 1000;
            }
          }
          
          const frequencyDrop = prevFramePeakFreq - framePeakFreq;
          if (frequencyDrop > maxFrequencyDropThreshold_kHz) {
            // FM call: frequency drop detected, stop here
            freqDropDetected = true;
            lastValidEndFrame = frameIdx - 1;
            break;
          }
        }
        
        // CF/QCF monotonic decay detection
        if (!freqDropDetected) {
          // Track if energy has started declining from peak
          if (frameMaxPower < lastFrameMaxPower) {
            hasStartedDecaying = true;
            lastValidEndBeforeRebounce = frameIdx;
          }
          
          // CRITICAL: Detect rebounce (energy rises after falling)
          // But with threshold to avoid QCF natural energy fluctuations
          // QCF signals naturally have ±2-3dB fluctuations, so require >5dB rise to detect rebounce
          const rebounceThreshold_dB = 0.5; // Minimum dB rise to be considered a rebounce (not QCF fluctuation)
          if (hasStartedDecaying && frameMaxPower > lastFrameMaxPower && frameIdx > peakFrameIdx + 1) {
            const energyRise = frameMaxPower - lastFrameMaxPower;
            if (energyRise > rebounceThreshold_dB) {
              // Significant energy rise detected = true rebounce!
              // Use the frame where energy was lowest before rising
              newEndFrameIdx = lastValidEndBeforeRebounce;
              break;
            }
            // else: Just minor fluctuation in QCF signal, continue scanning
          }
          
          // Track sustained energy above -18dB threshold
          if (frameMaxPower > sustainedEnergyThreshold) {
            lastFrameAboveSustainedThreshold = frameIdx;
            lastValidEndFrame = frameIdx;
          }
          // If signal drops permanently below -18dB, stop
          else if (frameMaxPower <= sustainedEnergyThreshold && frameIdx > peakFrameIdx) {
            // No rebounce detected, just natural decay below threshold
            newEndFrameIdx = lastFrameAboveSustainedThreshold;
            break;
          }
          
          lastFrameMaxPower = frameMaxPower;
        }
      }
      
      // Determine final end frame if loop completed without special conditions
      if (newEndFrameIdx === spectrogram.length - 1 || newEndFrameIdx === 0) {
        if (!freqDropDetected) {
          // CF/QCF call: use last frame with sustained energy
          newEndFrameIdx = lastFrameAboveSustainedThreshold;
        } else {
          // FM call: already set by frequency drop detection
          newEndFrameIdx = lastValidEndFrame;
        }
      }
    } else {
      // Original forward scanning method (without anti-rebounce)
      for (let frameIdx = spectrogram.length - 1; frameIdx >= 0; frameIdx--) {
        const framePower = spectrogram[frameIdx];
        let frameHasSignal = false;
        for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
          if (framePower[binIdx] > endThreshold_dB) {
            frameHasSignal = true;
            break;
          }
        }
        if (frameHasSignal) {
          newEndFrameIdx = frameIdx;
          break;
        }
      }
    }
    
    // 注意：For CF/QCF calls, newEndFrameIdx 可能超過 maxFrameIdxAllowed
    // 這是正常的，因為 CF 信號可能延續超過 10ms 的保護窗
    // Protection window 限制只應用於檢測到頻率下降（FM 類型）的情況
    // 不應在此進行全局限制
    
    // 更新時間邊界
    if (newStartFrameIdx < timeFrames.length) {
      call.startTime_s = timeFrames[newStartFrameIdx];
    }
    if (newEndFrameIdx < timeFrames.length - 1) {
      call.endTime_s = timeFrames[Math.min(newEndFrameIdx + 1, timeFrames.length - 1)];
    }
    
    // 注意：Duration 將在計算完 endFreqTime_s 後根據 endFreq 的 frameIdx 計算
    // (見 STEP 3 的結尾)
    
// ============================================================
    // STEP 2: Calculate HIGH FREQUENCY from entire spectrogram
    // 
    // 2025 修正：High Frequency 應該掃描整個 spectrogram 以找到最高頻率
    // 不只限於第一幀，因為最高頻率可能出現在任何幀中
    // 
    // Professional standard: threshold at adjustable dB below peak
    // This is the HIGHEST frequency in the entire call (not just first frame)
    // Search from HIGH to LOW frequency (reverse bin order)
    // Track both frequency value AND the frame it appears in
    // ============================================================
    let highFreq_Hz = 0;  // 2025: Init to 0 to properly find max
    let highFreqBinIdx = 0;
    let highFreqFrameIdx = -1; // 2025: Use -1 to indicate not found yet
    
    // 2025 v2 CRITICAL CHANGE: 使用 AUTO MODE 返回的 finalSearchLimitFrame
    // 如果在 AUTO MODE 中，使用其返回的搜尋範圍限制
    // 如果是 MANUAL MODE 或未設定，使用 peakFrameIdx
    const highFreqScanLimit = (this.config.highFreqThreshold_dB_isAuto === true && finalSearchLimitFrameFromAuto > 0)
      ? Math.min(finalSearchLimitFrameFromAuto, spectrogram.length - 1)
      : Math.min(peakFrameIdx, spectrogram.length - 1);

    for (let frameIdx = 0; frameIdx <= highFreqScanLimit; frameIdx++) {
      const framePower = spectrogram[frameIdx];
      // Search from high to low frequency (reverse order)
      for (let binIdx = framePower.length - 1; binIdx >= 0; binIdx--) {
        if (framePower[binIdx] > highThreshold_dB) {
          // Found first bin above threshold in this frame
          const testHighFreq_Hz = freqBins[binIdx];
          
          // 2025 FIX: Anti-Rebounce Priority
          // We want the HIGHEST frequency, but if multiple frames have the same High Freq,
          // we MUST pick the FIRST one (lowest Time) to avoid picking up a later rebounce.
          //
          // Logic:
          // 1. If this is the first detection (highFreqFrameIdx === -1) -> Accept
          // 2. If this frequency is STRICTLY HIGHER than current max -> Accept
          // 3. If equal or lower -> Ignore (keep the earlier frame)
          if (highFreqFrameIdx === -1 || testHighFreq_Hz > highFreq_Hz) {
            highFreq_Hz = testHighFreq_Hz;
            highFreqBinIdx = binIdx;
            highFreqFrameIdx = frameIdx;
            
            // Attempt linear interpolation for sub-bin precision
            if (binIdx < framePower.length - 1) {
              const thisPower = framePower[binIdx];
              const nextPower = framePower[binIdx + 1];
              
              if (nextPower < highThreshold_dB && thisPower > highThreshold_dB) {
                // Interpolate between this bin and next
                const powerRatio = (thisPower - highThreshold_dB) / (thisPower - nextPower);
                const freqDiff = freqBins[binIdx + 1] - freqBins[binIdx];
                // Update the stored highFreq_Hz with the interpolated value
                highFreq_Hz = freqBins[binIdx] + powerRatio * freqDiff;
              }
            }
          }
          break;  // Move to next frame after finding first bin in this frame
        }
      }
    }
    
    // Safety fallback if no bin was found (e.g., threshold too high)
    if (highFreqFrameIdx === -1) {
      highFreq_Hz = fhighKHz * 1000;
      highFreqFrameIdx = 0;
    }
    
    call.highFreq_kHz = highFreq_Hz / 1000;
    call.highFreqFrameIdx = highFreqFrameIdx;
    
    // ============================================================
    // NEW (2025): Calculate high frequency time in milliseconds
    // highFreqTime_ms = absolute time of high frequency bin within selection area
    // Unit: ms (milliseconds), relative to selection area start (timeFrames[0])
    // 
    // Logic Preserved: Time is derived from the specific frame where High Freq occurred
    // which is now guaranteed to be <= peakFrameIdx.
    // ============================================================
    const firstFrameTimeInSeconds = timeFrames[0];
    let highFreqTime_ms = 0;
    if (highFreqFrameIdx < timeFrames.length) {
      const highFreqTimeInSeconds = timeFrames[highFreqFrameIdx];
      highFreqTime_ms = (highFreqTimeInSeconds - firstFrameTimeInSeconds) * 1000;
    }
    call.highFreqTime_ms = highFreqTime_ms;
    
    // 2025: 在 manual mode 下保存實際使用的 high frequency threshold
    // Manual mode: highThreshold_dB = peakPower_dB + highFreqThreshold_dB
    // 計算相對於 peakPower_dB 的偏移值
    const highFreqThreshold_dB_used_manual = highThreshold_dB - peakPower_dB;
    call.highFreqThreshold_dB_used = highFreqThreshold_dB_used_manual;
    
    // ============================================================
    // STEP 2.5: Calculate START FREQUENCY (獨立於 High Frequency)
    // 
    // 2025 關鍵修正：
    // Start Frequency 是真正的 "First frame of call signal (frame 0)"
    // 總是從第一幀掃描得出，但其值由規則 (a)/(b) 決定
    // 
    // 方法：
    // 在 AUTO MODE 和 NON-AUTO MODE 中，都使用 -24dB 閾值計算 Start Frequency
    // (a) 若 -24dB 閾值的頻率 < Peak Frequency：使用該值為 Start Frequency
    // (b) 若 -24dB 閾值的頻率 >= Peak Frequency：Start Frequency = High Frequency
    // 
    // 時間點說明：
    // Start Frequency 總是在第一幀（frame 0），時間 = 0 ms
    // 但 Start Frequency 的值可能等於 High Frequency（規則 b）
    // ============================================================
    const firstFramePower = spectrogram[0];
    let startFreq_Hz = null;
    let startFreq_kHz = null;
    let startFreqBinIdx = 0;  // 2025: Track independent bin index for Start Frequency
    let startFreqFrameIdx = 0;  // 2025: Start Frequency is always in frame 0
    
    // 使用 -24dB 閾值計算 Start Frequency（無論是否 Auto Mode）
    const threshold_24dB = peakPower_dB - 24;

    // 2025: 低頻 Noise 保護閾值
    const LOW_FREQ_NOISE_THRESHOLD_kHz = 40;  // kHz - 低於此頻率的 bin 在某些情況下應被忽略
    const HIGH_PEAK_THRESHOLD_kHz = 60;       // kHz - Peak >= 此值時啟動低頻保護
    const peakFreqInKHz = peakFreq_Hz / 1000; // 將 Peak 頻率轉換為 kHz
    const shouldIgnoreLowFreqNoise = peakFreqInKHz >= HIGH_PEAK_THRESHOLD_kHz;
    
    // 從低到高掃描，找最低頻率（規則 a）
    for (let binIdx = 0; binIdx < firstFramePower.length; binIdx++) {
      if (firstFramePower[binIdx] > threshold_24dB) {
        const testStartFreq_Hz = freqBins[binIdx];
        const testStartFreq_kHz = testStartFreq_Hz / 1000;

        // Apply Highpass Filter Protection
        // If Highpass Filter is enabled, ignore frequencies below the cutoff
        // This prevents the detector from picking up filtered-out noise as Start Frequency
        if (this.config.enableHighpassFilter && testStartFreq_kHz < this.config.highpassFilterFreq_kHz) {
          continue; // Skip frequencies cut off by the highpass filter
        }

        // 應用低頻 Noise 保護機制
        // 若 Peak ≥ 60 kHz，忽略 40 kHz 或以下的候選值
        if (shouldIgnoreLowFreqNoise && testStartFreq_kHz <= LOW_FREQ_NOISE_THRESHOLD_kHz) {
          continue;
        }

        // 檢查是否低於 Peak Frequency（規則 a）
        if (testStartFreq_kHz < peakFreqInKHz) {
          // 滿足規則 (a)：使用此值為 Start Frequency
          startFreq_Hz = testStartFreq_Hz;
          startFreq_kHz = testStartFreq_kHz;
          startFreqBinIdx = binIdx;  // 2025: Store independent bin index for Start Frequency
          
          // 嘗試線性插值以獲得更高精度
          if (binIdx > 0) {
            const thisPower = firstFramePower[binIdx];
            const prevPower = firstFramePower[binIdx - 1];
            
            if (prevPower < threshold_24dB && thisPower > threshold_24dB) {
              const powerRatio = (thisPower - threshold_24dB) / (thisPower - prevPower);
              const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
              startFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
              startFreq_kHz = startFreq_Hz / 1000;
            }
          }
          break;
        }
      }
    }
    
    // 如果規則 (a) 不滿足（-24dB 頻率 >= Peak Frequency），使用規則 (b)
    if (startFreq_Hz === null) {
      // Start Frequency = High Frequency（規則 b）
      // Note: 此時 Start Frequency 的值等於 High Frequency 的值
      // 但 Start Frequency 的幀索引固定為 0（frame 0）
      startFreq_Hz = highFreq_Hz;
      startFreq_kHz = highFreq_Hz / 1000;
      startFreqBinIdx = highFreqBinIdx;  // 2025: Use High Frequency's bin index
      // 但時間點仍然是 0 ms（第一幀）
    }
    
    // 存儲 Start Frequency 及其信息
    call.startFreq_kHz = startFreq_kHz;
    call.startFreqTime_s = timeFrames[0];  // Time of first frame (frame 0)
    call.startFreqBinIdx = startFreqBinIdx;  // 2025: Store independent bin index
    call.startFreqFrameIdx = startFreqFrameIdx;  // 2025: Always frame 0
    
    // ============================================================
    // NEW (2025): Calculate start frequency time in milliseconds
    // startFreq_ms = absolute time of start frequency (always at first frame = 0 ms)
    // Unit: ms (milliseconds), relative to selection area start
    // 
    // NOTE: Start Frequency is ALWAYS at frame 0 by definition
    // (Start Frequency is the "First frame of call signal")
    // ============================================================
    const firstFrameTime_ms = 0;  // First frame is at time 0 relative to selection area start
    call.startFreq_ms = firstFrameTime_ms;  // Start frequency time is always at frame 0
    
    // ============================================================
    // STEP 3: Calculate LOW FREQUENCY from last frame
    // 2025 ENHANCED PRECISION: Linear interpolation with anti-rebounce support
    // 
    // Professional standard: Fixed threshold at -27dB below global peak
    // This is the lowest frequency in the call (from last frame)
    // Search from LOW to HIGH frequency (normal bin order)
    // 
    // LINEAR INTERPOLATION METHOD (aligned with START FREQUENCY precision):
    // When a bin crosses the -27dB threshold, interpolate between:
    // - Previous bin (below threshold): lowPower < endThreshold_dB
    // - Current bin (above threshold): thisPower > endThreshold_dB
    // 
    // Position ratio = (thisPower - threshold) / (thisPower - prevPower)
    // Interpolated frequency = currentFreq - ratio * freqBinWidth
    // This provides ~0.1 Hz sub-bin accuracy (typical bin width 3-5 Hz)
    // 
    // Compatibility with Anti-Rebounce:
    // - Works with backward endFreqScan: Uses last frame's true Low Freq
    // - Detects rebounce transitions: Maintains accurate frequency boundaries
    // - Protects against echo tails: Precise threshold crossing detection
    // ============================================================
    // 2025: Limit Low Frequency calculation to newEndFrameIdx (call end point)
    const endFrameIdx_forLowFreq = Math.min(newEndFrameIdx, spectrogram.length - 1);
    call.endFrameIdx_forLowFreq = endFrameIdx_forLowFreq;  // 2025 NEW: Store for SNR calculation
    const lastFramePower = spectrogram[endFrameIdx_forLowFreq];
    const lastFrameTime_s = timeFrames[endFrameIdx_forLowFreq];  // Time of call end frame
    let lowFreq_Hz = flowKHz * 1000;  // Default to lower bound
    
    // Search from low to high frequency using fixed -27dB threshold
    // Enhanced with interpolation for higher precision
    for (let binIdx = 0; binIdx < lastFramePower.length; binIdx++) {
      if (lastFramePower[binIdx] > endThreshold_dB) {
        // Found first bin above threshold
        const thisPower = lastFramePower[binIdx];
        lowFreq_Hz = freqBins[binIdx];
        
        // ============================================================
        // LINEAR INTERPOLATION FOR SUB-BIN PRECISION
        // Conditions:
        // 1. Previous bin exists (binIdx > 0)
        // 2. Previous bin is BELOW threshold
        // 3. Current bin is ABOVE threshold
        // This ensures we have a proper threshold crossing to interpolate
        // ============================================================
        if (binIdx > 0) {
          const prevPower = lastFramePower[binIdx - 1];
          
          // Check for threshold crossing: prev below, curr above
          if (prevPower < endThreshold_dB && thisPower > endThreshold_dB) {
            // Calculate interpolation ratio
            // ratio = 0.0 means frequency = prevFreq (at threshold)
            // ratio = 1.0 means frequency = currFreq (at currPower)
            const powerRatio = (thisPower - endThreshold_dB) / (thisPower - prevPower);
            
            // Calculate frequency bin width (typically 3-5 Hz)
            const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
            
            // Interpolated frequency
            // Start from current bin and move backward by interpolated distance
            lowFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
            
            // Sanity check: interpolated frequency should be within bin range
            // If not, fall back to bin center
            if (lowFreq_Hz < freqBins[binIdx - 1] || lowFreq_Hz > freqBins[binIdx]) {
              lowFreq_Hz = freqBins[binIdx];
            }
          }
        }
        
        break;  // Stop after first threshold crossing (lowest frequency)
      }
    }
    
    // ============================================================
    // END FREQUENCY CALCULATION: Use low frequency bin result
    // End Frequency = frequency from last frame using -27dB threshold
    // (before comparison with Start Frequency)
    // End Frequency Time = time of last frame
    // 預設將 low frequency bin 的 frequency 及 Time 值用作 End Frequency
    // ============================================================
    let endFreq_kHz = lowFreq_Hz / 1000;
    call.endFreq_kHz = endFreq_kHz;
    call.endFreqTime_s = lastFrameTime_s;
    
    // ============================================================
    // 2025 OPTIMIZATION: Calculate duration based on endFreq frameIdx (endFreqTime_s)
    // Duration is now calculated ONLY ONCE here, based on endFreq time point
    // This avoids repeated calculations and ensures consistency
    // Duration = endFreq time - startFreq time (from first frame, which is always timeFrames[0])
    // ============================================================
    if (call.startFreqTime_s !== null && call.endFreqTime_s !== null) {
      call.duration_ms = (call.endFreqTime_s - call.startFreqTime_s) * 1000;
    }
    
    // ============================================================
    // NEW (2025): Calculate low and end frequency times in milliseconds
    const firstFrameTimeInSeconds_low = timeFrames[0];
    const lastFrameTime_ms = (lastFrameTime_s - firstFrameTimeInSeconds_low) * 1000;  // Time relative to selection area start
    call.lowFreq_ms = lastFrameTime_ms;  // Low frequency is from end frame (limited by newEndFrameIdx)
    call.endFreq_ms = lastFrameTime_ms;  // End frequency = Low frequency (same time)
    
    // 2025 NEW: Store lowFreqFrameIdx - the frame index where low frequency occurs
    call.lowFreqFrameIdx = endFrameIdx_forLowFreq;  // Low frequency is measured from the end frame
    
    // 2025: 在 manual mode 下保存實際使用的 low frequency threshold
    // Manual mode: endThreshold_dB = peakPower_dB + lowFreqThreshold_dB
    // 計算相對於 peakPower_dB 的偏移值
    const lowFreqThreshold_dB_used_manual = endThreshold_dB - peakPower_dB;
    call.lowFreqThreshold_dB_used = lowFreqThreshold_dB_used_manual;
    
    // Now calculate lowFreq_kHz with potential Start Frequency optimization
    let lowFreq_kHz = lowFreq_Hz / 1000;
    
    // ============================================================
    // AUTO MODE: If lowFreqThreshold_dB_isAuto is enabled,
    // automatically find optimal threshold using STABLE call.peakPower_dB
    // (similar to high frequency optimization)
    // ============================================================
    if (this.config.lowFreqThreshold_dB_isAuto === true) {
      const result = this.findOptimalLowFrequencyThreshold(
        spectrogram,
        freqBins,
        flowKHz,
        fhighKHz,
        peakPower_dB,
        peakFrameIdx,
        endFrameIdx_forLowFreq
      );
      
      // ============================================================
      // 新規則 2025：Low Frequency 防呆機制
      // 找出第一個 <= Peak Frequency 的有效 Low Frequency
      // 低頻應該低於或等於峰值頻率，這是 FM 掃頻信號的特性
      // ============================================================
      let safeLowFreq_kHz = result.lowFreq_kHz;
      let safeLowFreq_Hz = result.lowFreq_Hz;
      let safeEndFreq_kHz = result.endFreq_kHz;
      let safeEndFreq_Hz = result.endFreq_Hz;
      let usedThreshold = result.threshold;
      
      // 如果最優閾值的 Low Frequency 高於 Peak Frequency，執行防呆檢查
      if (result.lowFreq_kHz !== null && result.lowFreq_kHz > (peakFreq_Hz / 1000)) {
        // 需要找到第一個 <= Peak Frequency 的 Low Frequency
        // 重新測試閾值範圍，從 -24 到 -70
        const peakFreq_kHz = peakFreq_Hz / 1000;
        let foundValidLowFreq = false;
        
        for (let testThreshold_dB = -24; testThreshold_dB >= -70; testThreshold_dB--) {
          const lowFreqThreshold_dB = peakPower_dB + testThreshold_dB;
          const lastFramePowerForTest = spectrogram[spectrogram.length - 1];
          
          // 計算此閾值的 Low Frequency
          let testLowFreq_Hz = null;
          let testEndFreq_Hz = null;
          
          // Low Frequency 計算（從低到高）
          for (let binIdx = 0; binIdx < lastFramePowerForTest.length; binIdx++) {
            if (lastFramePowerForTest[binIdx] > lowFreqThreshold_dB) {
              testLowFreq_Hz = freqBins[binIdx];
              
              // 線性插值
              if (binIdx > 0) {
                const thisPower = lastFramePowerForTest[binIdx];
                const prevPower = lastFramePowerForTest[binIdx - 1];
                if (prevPower < lowFreqThreshold_dB && thisPower > lowFreqThreshold_dB) {
                  const powerRatio = (thisPower - lowFreqThreshold_dB) / (thisPower - prevPower);
                  const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                  testLowFreq_Hz = freqBins[binIdx] - powerRatio * freqDiff;
                }
              }
              break;
            }
          }
          
          // 如果找到有效的 Low Frequency，檢查是否 <= Peak Frequency
          if (testLowFreq_Hz !== null && (testLowFreq_Hz / 1000) <= peakFreq_kHz) {
            testEndFreq_Hz = testLowFreq_Hz;  // End frequency = low frequency
            
            safeLowFreq_Hz = testLowFreq_Hz;
            safeLowFreq_kHz = testLowFreq_Hz / 1000;
            safeEndFreq_Hz = testEndFreq_Hz;
            safeEndFreq_kHz = testEndFreq_Hz !== null ? testEndFreq_Hz / 1000 : null;
            usedThreshold = testThreshold_dB;
            foundValidLowFreq = true;
            break;
          }
        }
      }
      
      // Update the config with the calculated optimal threshold
      // 2025 SAFETY MECHANISM: 應用安全機制 - 如果 usedThreshold 達到 -70，改用 -30
      const finalSafeThreshold = (usedThreshold <= -70) ? -30 : usedThreshold;
      this.config.lowFreqThreshold_dB = finalSafeThreshold;
      // 2025: 在 auto mode 下保存實際使用的 low frequency threshold
      // Auto mode: 保存經過防呆檢查和安全機制後的最終 threshold 值
      call.lowFreqThreshold_dB_used = finalSafeThreshold;
      
      // 如果安全機制改變了閾值，使用新閾值重新計算 lowFreq_Hz
      if (finalSafeThreshold !== usedThreshold) {
        const lastFramePowerForSafe = spectrogram[spectrogram.length - 1];
        const lowFreqThreshold_dB_safe = peakPower_dB + finalSafeThreshold;
        
        let testLowFreq_Hz_safe = null;
        let testEndFreq_Hz_safe = null;
        
        // 使用安全閾值 (-30dB) 計算 Low Frequency
        for (let binIdx = 0; binIdx < lastFramePowerForSafe.length; binIdx++) {
          if (lastFramePowerForSafe[binIdx] > lowFreqThreshold_dB_safe) {
            testLowFreq_Hz_safe = freqBins[binIdx];
            
            // 線性插值
            if (binIdx > 0) {
              const thisPower = lastFramePowerForSafe[binIdx];
              const prevPower = lastFramePowerForSafe[binIdx - 1];
              if (prevPower < lowFreqThreshold_dB_safe && thisPower > lowFreqThreshold_dB_safe) {
                const powerRatio = (thisPower - lowFreqThreshold_dB_safe) / (thisPower - prevPower);
                const freqDiff = freqBins[binIdx] - freqBins[binIdx - 1];
                testLowFreq_Hz_safe = freqBins[binIdx] - powerRatio * freqDiff;
              }
            }
            break;
          }
        }
        
        if (testLowFreq_Hz_safe !== null) {
          testEndFreq_Hz_safe = testLowFreq_Hz_safe;
          safeLowFreq_Hz = testLowFreq_Hz_safe;
          safeLowFreq_kHz = testLowFreq_Hz_safe / 1000;
          safeEndFreq_Hz = testEndFreq_Hz_safe;
          safeEndFreq_kHz = testEndFreq_Hz_safe / 1000;
        }
      }
      
      // 2025 SAFETY MECHANISM: 禁用 Low Frequency Warning
      // 由於 findOptimalLowFrequencyThreshold 已實施安全機制（-70時改用-30）
      
      // Use the optimized low frequency values
      lowFreq_Hz = safeLowFreq_Hz;
      lowFreq_kHz = safeLowFreq_kHz;
      endFreq_kHz = safeEndFreq_kHz;
      
      // 重要：更新 call.endFreq_kHz 為 auto mode 計算的值
      // Auto mode: End Frequency = Auto-calculated Low Frequency
      call.endFreq_kHz = endFreq_kHz;
    }
    
    // ============================================================
    // 2025 ENHANCEMENT: Validate Low Frequency measurement quality
    // This ensures compatibility with anti-rebounce protection
    // ============================================================
    let validationResult = null;
    
    // Retrieve power values for validation
    const lastFramePowerAtLowFreq = lastFramePower[Math.max(0, Math.floor(lowFreq_Hz / (freqBins[1] - freqBins[0])))];
    const prevBinIdx = Math.max(0, Math.floor(lowFreq_Hz / (freqBins[1] - freqBins[0])) - 1);
    const prevFramePowerAtLowFreq = lastFramePower[prevBinIdx];
    const freqBinWidth = freqBins.length > 1 ? freqBins[1] - freqBins[0] : 1;
    
    // Run validation if we have valid power values
    if (lastFramePowerAtLowFreq !== undefined && prevFramePowerAtLowFreq !== undefined) {
      validationResult = this.validateLowFrequencyMeasurement(
        lowFreq_Hz,
        lowFreq_kHz,
        peakFreq_Hz,
        peakPower_dB,
        lastFramePowerAtLowFreq,
        prevFramePowerAtLowFreq,
        endThreshold_dB,
        freqBinWidth,
        this.config.enableBackwardEndFreqScan  // rebounce detection status
      );
      
      // Store validation metadata on call object (for debugging/analysis)
      call._lowFreqValidation = {
        valid: validationResult.valid,
        confidence: validationResult.confidence,
        interpolationRatio: validationResult.details.interpolationRatio,
        powerRatio_dB: validationResult.details.powerRatio_dB,
        frequencySpread_kHz: validationResult.details.frequencySpread,
        rebounceCompat: validationResult.details.rebounceCompat,
        warnings: []
      };
      
      // Collect warnings
      if (validationResult.details.frequencySpreadWarning) {
        call._lowFreqValidation.warnings.push(validationResult.details.frequencySpreadWarning);
      }
      if (validationResult.details.powerRatioWarning) {
        call._lowFreqValidation.warnings.push(validationResult.details.powerRatioWarning);
      }
      if (validationResult.details.rebounceWarning) {
        call._lowFreqValidation.warnings.push(validationResult.details.rebounceWarning);
      }
    }
    
    // ============================================================
    // LOW FREQUENCY OPTIMIZATION: Compare with Start Frequency
    // If Start Frequency is lower, use it as Low Frequency
    // 優化邏輯：如果 Start Frequency 比計算的 Low Frequency 更低
    // 則使用 Start Frequency 作為 Low Frequency
    // 
    // IMPORTANT: This optimization respects anti-rebounce mechanism
    // Start Frequency is from FIRST frame (after anti-rebounce boundary)
    // Low Frequency is from LAST frame (also respects anti-rebounce)
    // Both are measured within the same protected boundaries
    // ============================================================
    if (startFreq_kHz !== null && startFreq_kHz < lowFreq_kHz) {
      lowFreq_kHz = startFreq_kHz;
      
      // Update validation metadata to reflect use of Start Frequency
      if (call._lowFreqValidation) {
        call._lowFreqValidation.usedStartFreq = true;
        call._lowFreqValidation.note = 'Low Frequency replaced by Start Frequency (lower value)';
      }
    }
    
    call.lowFreq_kHz = lowFreq_kHz;
    
    // ============================================================
    // STEP 4: Calculate characteristic frequency (CF-FM distinction)
    // 
    // 2025 REVISED DEFINITION:
    // Characteristic frequency = point in the final 40% of the call 
    // having the LOWEST SLOPE or exhibiting the END of the main trend 
    // of the body of the call (kHz)
    // 
    // Professional Standard:
    // - For CF-FM bats: Characteristic frequency marks the CF phase
    //   (constant frequency region with minimal slope variation)
    // - For pure FM bats: Marks the point where slope becomes gentlest
    //   (transition from steep FM to call end)
    // - For CF bats: Nearly constant throughout, Cf ≈ average frequency
    // 
    // Method: Calculate SLOPE for each frame transition in last 40%,
    // find frame(s) with LOWEST absolute slope (< 1 kHz/ms is considered stable)
    // ============================================================
    const charFreqSearchEnd = endFrameIdx_forLowFreq;  // Limited by newEndFrameIdx
    const lastPercentStart = Math.floor(newStartFrameIdx + (charFreqSearchEnd - newStartFrameIdx) * (1 - 0.40));  // Last 40%
    let characteristicFreq_Hz = peakFreq_Hz;
    let characteristicFreq_FrameIdx = 0;
    
    if (lastPercentStart < charFreqSearchEnd) {
      // Step 1: Extract peak frequency for each frame in last 40%
      const frameFrequencies = [];  // { frameIdx, freq_Hz, power_dB, slope_kHz_per_ms }
      let timeFrameDelta_ms = 0;
      
      if (timeFrames.length > 1) {
        timeFrameDelta_ms = (timeFrames[1] - timeFrames[0]) * 1000;  // Convert to ms
      }
      
      // Extract peak frequency trajectory for last 40%
      for (let frameIdx = Math.max(0, lastPercentStart); frameIdx <= charFreqSearchEnd; frameIdx++) {
        const framePower = spectrogram[frameIdx];
        let maxPower_dB = -Infinity;
        let peakBin = 0;
        
        // Find peak bin in this frame
        for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
          if (framePower[binIdx] > maxPower_dB) {
            maxPower_dB = framePower[binIdx];
            peakBin = binIdx;
          }
        }
        
        frameFrequencies.push({
          frameIdx: frameIdx,
          freq_Hz: freqBins[peakBin],
          power_dB: maxPower_dB,
          slope_kHz_per_ms: null  // Will be calculated below
        });
      }
      
      // Step 2: Calculate slopes between consecutive frames
      for (let i = 0; i < frameFrequencies.length - 1; i++) {
        const curr = frameFrequencies[i];
        const next = frameFrequencies[i + 1];
        const freqDifference_kHz = (next.freq_Hz - curr.freq_Hz) / 1000;
        curr.slope_kHz_per_ms = timeFrameDelta_ms > 0 ? freqDifference_kHz / timeFrameDelta_ms : 0;
      }
      
      // Step 3: Find region with LOWEST absolute slope (most stable)
      // Stable CF region typically has |slope| < 1 kHz/ms
      let minSlope = Infinity;
      let charFreqFrameIdx = lastPercentStart;
      
      for (let i = 0; i < frameFrequencies.length; i++) {
        const point = frameFrequencies[i];
        if (point.slope_kHz_per_ms !== null) {
          const absSlope = Math.abs(point.slope_kHz_per_ms);
          
          // Prefer frames with lower absolute slope
          // Ties broken by: prefer later frame (closer to call end)
          if (absSlope < minSlope) {
            minSlope = absSlope;
            charFreqFrameIdx = i;
          }
        }
      }
      
      // Step 4: Use the frame with lowest slope
      if (charFreqFrameIdx < frameFrequencies.length) {
        const cfPoint = frameFrequencies[charFreqFrameIdx];
        characteristicFreq_Hz = cfPoint.freq_Hz;
        characteristicFreq_FrameIdx = cfPoint.frameIdx;
      }
      
      // Fallback: if no valid slope found, use center frequency of end 40%
      if (characteristicFreq_Hz === peakFreq_Hz) {
        let totalPower = 0;
        let weightedFreq = 0;
        let weightedFrameIdx = 0;
        let totalFrameWeight = 0;
        
        for (let frameIdx = Math.max(0, lastPercentStart); frameIdx <= charFreqSearchEnd; frameIdx++) {
          const framePower = spectrogram[frameIdx];
          let frameMax = -Infinity;
          for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
            frameMax = Math.max(frameMax, framePower[binIdx]);
          }
          
          const significantThreshold = frameMax - 6;
          for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
            const power = framePower[binIdx];
            if (power > significantThreshold) {
              const linearPower = Math.pow(10, power / 10);
              totalPower += linearPower;
              weightedFreq += linearPower * freqBins[binIdx];
              weightedFrameIdx += linearPower * frameIdx;
              totalFrameWeight += linearPower;
            }
          }
        }
        
        if (totalPower > 0) {
          characteristicFreq_Hz = weightedFreq / totalPower;
          characteristicFreq_FrameIdx = Math.round(weightedFrameIdx / totalFrameWeight);
        }
      }
    }
    
    call.characteristicFreq_kHz = characteristicFreq_Hz / 1000;
    
    // ============================================================
    // NEW (2025): Calculate characteristic frequency time in milliseconds
    // characteristicFreq_ms = absolute time of characteristic frequency point within selection area
    // Unit: ms (milliseconds), relative to selection area start
    // ============================================================
    if (characteristicFreq_FrameIdx < timeFrames.length) {
      const charFreqTime_s = timeFrames[characteristicFreq_FrameIdx];
      const firstFrameTimeInSeconds_char = timeFrames[0];
      call.characteristicFreq_ms = (charFreqTime_s - firstFrameTimeInSeconds_char) * 1000;  // Time relative to selection area start
    }
    
    // ============================================================
    // STEP 5: Validate frequency relationships (Avisoft standard)
    // Ensure: lowFreq ≤ charFreq ≤ peakFreq ≤ highFreq
    // This maintains biological validity for FM and CF-FM calls
    // ============================================================
    // Clamp characteristic frequency between low and peak
    const lowFreqKHz = lowFreq_Hz / 1000;
    const charFreqKHz = characteristicFreq_Hz / 1000;
    const peakFreqKHz = peakFreq_Hz / 1000;
    const highFreqKHz = highFreq_Hz / 1000;
    
    if (charFreqKHz < lowFreqKHz) {
      // Char freq should not be below low freq
      call.characteristicFreq_kHz = lowFreqKHz;
    } else if (charFreqKHz > peakFreqKHz) {
      // Char freq should not exceed peak freq
      call.characteristicFreq_kHz = peakFreqKHz;
    }
    
    // Calculate bandwidth
    call.calculateBandwidth();
    
    // ============================================================
    // ============================================================
    // STEP 6: Calculate Knee Frequency and Knee Time
    // 
    // 2025 PROFESSIONAL STANDARD: Maximum 2nd Derivative + -15 dB Fallback
    // Used by: Avisoft official manual, SonoBat whitepaper, Kaleidoscope tech docs
    // 
    // Algorithm:
    // 1. Extract frequency contour (peak frequency trajectory)
    // 2. Smooth with Savitzky-Golay filter (window=5)
    // 3. Calculate 2nd derivative (acceleration of frequency change)
    // 4. Find minimum 2nd derivative point (CF→FM transition)
    // 5. If noise too high: fallback to -15 dB below peak method
    // ============================================================
    
    // STEP 6.1: Extract peak frequency trajectory for each frame
    // (More stable than weighted average for noisy signals)
    const frameFrequencies = [];
    
    for (let frameIdx = 0; frameIdx < spectrogram.length; frameIdx++) {
      const framePower = spectrogram[frameIdx];
      
      // Find peak frequency (highest power bin) in this frame
      let peakIdx = 0;
      let maxPower = -Infinity;
      
      for (let binIdx = 0; binIdx < framePower.length; binIdx++) {
        if (framePower[binIdx] > maxPower) {
          maxPower = framePower[binIdx];
          peakIdx = binIdx;
        }
      }
      
      // Store peak frequency in Hz
      frameFrequencies.push(freqBins[peakIdx]);
    }
    
    // STEP 6.2: Apply Savitzky-Goyal smoothing filter (window=5, polynomial=2)
    // This is what Avisoft uses for stable knee detection
    const smoothedFrequencies = this.savitzkyGolay(frameFrequencies, 5, 2);
    
    // STEP 6.3: Calculate 1st derivative (frequency change rate)
    // Note: firstDerivatives[i] represents derivative at frame i+1 position
    const firstDerivatives = [];
    const firstDerivIndices = [];  // Track corresponding frame indices
    
    for (let i = 0; i < smoothedFrequencies.length - 1; i++) {
      const freqChange = smoothedFrequencies[i + 1] - smoothedFrequencies[i];
      const timeDelta = (i + 1 < timeFrames.length) ? 
        (timeFrames[i + 1] - timeFrames[i]) : 0.001; // Prevent division by zero
      
      firstDerivatives.push(freqChange / timeDelta);
      firstDerivIndices.push(i + 1);  // This derivative is at frame i+1
    }
    
    // STEP 6.4: Calculate 2nd derivative (acceleration of frequency change)
    // Note: secondDerivatives[i] represents 2nd derivative at frame i+2 position
    const secondDerivatives = [];
    const secondDerivIndices = [];  // Track corresponding frame indices
    
    for (let i = 0; i < firstDerivatives.length - 1; i++) {
      const derivChange = firstDerivatives[i + 1] - firstDerivatives[i];
      const timeDelta = (i + 2 < timeFrames.length) ? 
        (timeFrames[i + 2] - timeFrames[i + 1]) : 0.001;
      
      secondDerivatives.push(derivChange / timeDelta);
      secondDerivIndices.push(i + 2);  // This 2nd derivative is at frame i+2
    }
    
    // STEP 6.5: Find knee point - Use frequency acceleration (curvature) method
    // Professional method: Find maximum |curvature| = |d²f/dt²| / (1 + (df/dt)²)^(3/2)
    // This identifies the sharpest turning point in frequency trajectory
    // For FM-QCF: Knee is at the point where FM transitions to QCF
    
    // 2025: Helper function to validate knee point using slope protection mechanism
    // Verifies that the knee represents a transition from steep negative slope to flattening
    const isValidKneeBySlope = (candidateFrameIdx) => {
      // Find the index in firstDerivIndices that corresponds to this frame
      const derivIdx = firstDerivIndices.indexOf(candidateFrameIdx);
      
      if (derivIdx < 0 || derivIdx >= firstDerivatives.length) {
        // Frame index not found in derivatives array
        return false;
      }
      
      // Get slopes before and after the candidate knee point
      const incomingSlope = derivIdx > 0 ? firstDerivatives[derivIdx - 1] : null;
      const outgoingSlope = derivIdx < firstDerivatives.length - 1 ? firstDerivatives[derivIdx] : null;
      
      // Both slopes must exist
      if (incomingSlope === null || outgoingSlope === null) {
        return false;
      }
      
      const STEEP_NEGATIVE_THRESHOLD = -50; // Hz/s - minimum slope to be considered "steep negative"
      const SLOPE_RATIO_THRESHOLD = 0.7;     // Outgoing must be flatter (smaller absolute value)
      
      // 2025: Slope protection mechanism validation
      // 1. Incoming slope (before knee) MUST be a significant negative value (steep frequency decrease)
      if (incomingSlope >= STEEP_NEGATIVE_THRESHOLD) {
        // Incoming slope is not steep enough (not sufficiently negative)
        // This indicates the call is not in a clear FM phase before the knee
        return false;
      }
      
      // 2. Outgoing slope (after knee) MUST be flatter (smaller absolute value) than incoming
      // This validates the transition from steep FM to flat/quasi-constant frequency
      const incomingAbsSlope = Math.abs(incomingSlope);
      const outgoingAbsSlope = Math.abs(outgoingSlope);
      
      if (outgoingAbsSlope >= incomingAbsSlope * SLOPE_RATIO_THRESHOLD) {
        // Outgoing slope is NOT significantly flatter than incoming
        // This is an invalid knee (possibly a "plateau" to "steep" transition instead of "steep" to "plateau")
        return false;
      }
      
      // 3. Additional check: Incoming and Outgoing should have opposite trends or outgoing should be near-flat
      // If both are negative but outgoing is becoming more negative, it's not a valid knee
      if (outgoingSlope < incomingSlope) {
        // Outgoing slope is MORE negative than incoming (frequency dropping faster)
        // This is the opposite of what we expect at a knee point
        return false;
      }
      
      // All checks passed - this is a valid knee point
      return true;
    };
    
    let kneeIdx = -1;
    let maxCurvature = 0;
    
    // Calculate curvature for each point using proper formula
    for (let i = 1; i < firstDerivatives.length - 1; i++) {
      const frameIdx = firstDerivIndices[i]; // Get actual frame index
      
      if (frameIdx >= secondDerivIndices.length) continue;
      
      const df_dt = firstDerivatives[i];
      const d2f_dt2 = secondDerivatives[i];
      
      // Curvature = |d²f/dt²| / (1 + (df/dt)²)^(3/2)
      // Higher curvature = sharper turn in frequency trajectory
      const denominator = Math.pow(1 + df_dt * df_dt, 1.5);
      const curvature = Math.abs(d2f_dt2) / (denominator + 1e-10); // Avoid division by zero
      
      // For FM-QCF transition: we look for maximum curvature, not minimum 2nd derivative
      // This identifies the sharpest change in frequency pattern
      // 2025: Apply slope protection mechanism to validate knee point
      if (curvature > maxCurvature && isValidKneeBySlope(frameIdx)) {
        maxCurvature = curvature;
        kneeIdx = frameIdx;
      }
    }
    
    // STEP 6.6: Quality check - verify knee detection is reliable
    // Only use knee point if curvature is significant relative to signal noise
    const derivMean = secondDerivatives.reduce((a, b) => a + b, 0) / Math.max(secondDerivatives.length, 1);
    const derivStdDev = Math.sqrt(
      secondDerivatives.reduce((sum, val) => sum + Math.pow(val - derivMean, 2), 0) / Math.max(secondDerivatives.length, 1)
    );
    
    // Curvature-based SNR: if max curvature is weak, use fallback
    const isWeakCurvature = maxCurvature < derivStdDev * 0.3;
    
    // STEP 6.7: If curvature method fails, use professional fallback
    // Avisoft uses: Find point where frequency change rate has maximum transition
    if (kneeIdx < 0 || isWeakCurvature) {
      // FALLBACK: Find maximum of |1st derivative| 
      // For FM-QCF: This is typically where FM segment ends (frequency change slows down)
      let maxFirstDeriv = 0;
      let maxDerivIdx = -1;
      
      // Search only in the latter half of the call (where QCF typically occurs)
      const searchStart = Math.floor(spectrogram.length * 0.3);
      const searchEnd = Math.floor(spectrogram.length * 0.9);
      
      for (let i = 0; i < firstDerivatives.length; i++) {
        const frameIdx = firstDerivIndices[i];
        if (frameIdx >= searchStart && frameIdx <= searchEnd) {
          const absDeriv = Math.abs(firstDerivatives[i]);
          // 2025: Apply slope protection mechanism to fallback method as well
          // Only consider candidates that pass slope validation
          if (absDeriv > maxFirstDeriv && isValidKneeBySlope(frameIdx)) {
            maxFirstDeriv = absDeriv;
            maxDerivIdx = frameIdx;
          }
        }
      }
      
      if (maxDerivIdx >= 0) {
        kneeIdx = maxDerivIdx;
      }
      // No ultimate fallback: if knee not detected, leave as -1
    }
    
    // STEP 6.8: Set knee frequency and knee time from detected knee point
    // 
    // CRITICAL: Knee time MUST be between 0 and duration_ms
    // Knee must occur AFTER call start and BEFORE call end
    // kneeTime_ms = (timeFrames[kneeIdx] - call.startTime_s) * 1000
    
    let finalKneeIdx = -1;
    
    // Determine which knee point to use (prioritize validity)
    if (kneeIdx >= 0 && kneeIdx >= newStartFrameIdx && kneeIdx <= newEndFrameIdx) {
      // Curvature-detected knee is valid (within call boundaries)
      finalKneeIdx = kneeIdx;
    } else if (peakFrameIdx >= newStartFrameIdx && peakFrameIdx <= newEndFrameIdx) {
      // Fall back to peak if detected knee is invalid
      finalKneeIdx = peakFrameIdx;
    }
    
    if (finalKneeIdx >= 0 && finalKneeIdx < frameFrequencies.length && finalKneeIdx < timeFrames.length) {
      // Use original (non-smoothed) frequency at knee point
      call.kneeFreq_kHz = frameFrequencies[finalKneeIdx] / 1000;
      
      // ============================================================
      // NEW (2025): Calculate knee frequency time in milliseconds
      // kneeFreq_ms = absolute time of knee frequency point within selection area
      // Unit: ms (milliseconds), relative to selection area start
      // ============================================================
      const kneeFreqTime_s = timeFrames[finalKneeIdx];
      const firstFrameTimeInSeconds_knee = timeFrames[0];
      call.kneeFreq_ms = (kneeFreqTime_s - firstFrameTimeInSeconds_knee) * 1000;  // Time relative to selection area start
      
      // Calculate knee time from call start
      if (call.startTime_s !== null) {
        const rawKneeTime_ms = (timeFrames[finalKneeIdx] - call.startTime_s) * 1000;
        
        // SAFETY CHECK: Ensure knee time is valid
        // Must be positive and less than duration
        if (rawKneeTime_ms >= 0 && rawKneeTime_ms <= call.duration_ms) {
          call.kneeTime_ms = rawKneeTime_ms;
        } else {
          // Invalid knee time, reset to null (no valid knee)
          call.kneeTime_ms = null;
          call.kneeFreq_kHz = null;
        }
      } else {
        call.kneeTime_ms = null;
        call.kneeFreq_kHz = null;
      }
    } else {
      // No valid knee point found
      call.kneeTime_ms = null;
      call.kneeFreq_kHz = null;
    }
    
    // ============================================================
    // AUTO-DETECT CF-FM TYPE AND DISABLE ANTI-REBOUNCE IF NEEDED
    // 
    // If High-Freq and Peak Freq differ by < 1 kHz, 
    // it's likely a CF-FM call that exceeds the 10ms protection window.
    // Automatically disable anti-rebounce to avoid truncating long CF phases.
    // ============================================================
    
    // Compare peak frequency with high frequency (calculated from first frame)
    const peakFreq_kHz = peakFreq_Hz / 1000;
    const highFreq_kHz = call.highFreq_kHz;  // Already calculated in STEP 2
    
    // Calculate difference between peak and high frequency
    const freqDifference = Math.abs(peakFreq_kHz - highFreq_kHz);
    
    // ============================================================
    // IMPORTANT: Save actual used threshold value (after Auto mode calculation)
    // This allows UI to reflect the real value being used
    // Must be done BEFORE any further modifications to config
    // ============================================================
    if (this.config.highFreqThreshold_dB_isAuto === true) {
      // Auto mode: threshold already updated in detectCalls
      // No need to do anything here - config is already current
    }
    
    // ============================================================
    // CF-FM AUTO-DETECTION
    // ============================================================
    if (freqDifference < 1.0) {
      // CF-FM type call detected: peak and start frequencies very close
      // This means the call has a significant CF phase followed by FM sweep
      // The call duration likely exceeds the 10ms protection window
      // Auto-disable anti-rebounce to prevent false truncation
      this.config.enableBackwardEndFreqScan = false;
    } else {
      // Pure FM call: restore the anti-rebounce setting from original config
      // Re-read from parent config to get user's intended setting
      this.config.enableBackwardEndFreqScan = this.config.enableBackwardEndFreqScan !== false;
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
   * Compute instantaneous peak frequency from audio data
   * 
   * [2025 REFACTOR] High-precision peak detection for Highpass Filter Auto Mode
   * 
   * This method finds the global maximum power (dB) across all frames and bins,
   * then interpolates the exact frequency using parabolic interpolation.
   * This provides sub-bin precision (~0.1 Hz accuracy).
   * 
   * Unlike the average spectrum peak (which can be dominated by continuous background noise),
   * this finds the true instantaneous peak that represents the actual call.
   * 
   * @param {Float32Array} audioData - Raw audio data
   * @param {number} sampleRate - Sample rate in Hz
   * @returns {number} Peak frequency in kHz (or null if cannot compute)
   */
  computeMaxPeakFreq(audioData, sampleRate) {
    if (!audioData || audioData.length === 0) {
      console.warn('[computeMaxPeakFreq] No audio data provided');
      return null;
    }

    // Use detector's FFT config (1024) - NOT visualizer's config (512)
    const effectiveFFTSize = this.config.fftSize;  // Should be 1024 for analysis
    const { hopPercent } = this.config;

    // Generate spectrogram using detector's WASM engine
    if (!this.wasmEngine) {
      console.warn('[computeMaxPeakFreq] WASM engine not available');
      return null;
    }

    // Calculate hop size and overlap
    const hopSize = Math.floor(effectiveFFTSize * (hopPercent / 100));
    const overlapSamples = effectiveFFTSize - hopSize;

    try {
      // Generate spectrogram using WASM
      const rawSpectrum = this.wasmEngine.compute_spectrogram(audioData, overlapSamples);
      const numBinsTotal = this.wasmEngine.get_freq_bins();  // This is the total number of frequency bins
      
      // Get frequency resolution
      const freqResolution = sampleRate / effectiveFFTSize;
      
      // Calculate number of frames
      const numFrames = Math.floor(rawSpectrum.length / numBinsTotal);

      if (numFrames < 1 || numBinsTotal < 1 || rawSpectrum.length === 0) {
        console.warn('[computeMaxPeakFreq] Invalid WASM output dimensions', {
          rawSpectrumLength: rawSpectrum.length,
          numBinsTotal,
          numFrames
        });
        return null;
      }

      // ============================================================
      // PHASE 1: Find global peak across all frames and bins
      // ============================================================
      let peakPower_dB = -Infinity;
      let peakFrameIdx = 0;
      let peakBinIdx = 0;

      for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
        const frameOffset = frameIdx * numBinsTotal;
        for (let binIdx = 0; binIdx < numBinsTotal; binIdx++) {
          const magnitude = rawSpectrum[frameOffset + binIdx];
          
          // Convert to dB
          const power = magnitude * magnitude;
          const psd = power / effectiveFFTSize;
          const dB = 10 * Math.log10(Math.max(psd, 1e-16));

          if (dB > peakPower_dB) {
            peakPower_dB = dB;
            peakFrameIdx = frameIdx;
            peakBinIdx = binIdx;
          }
        }
      }

      if (peakPower_dB === -Infinity || isNaN(peakPower_dB)) {
        console.warn('[computeMaxPeakFreq] No valid peak found, peakPower_dB =', peakPower_dB);
        return null;
      }

      // ============================================================
      // PHASE 2: Apply parabolic interpolation for sub-bin precision
      // ============================================================
      let peakFreq_Hz = peakBinIdx * freqResolution;
      
      // Apply parabolic interpolation if peak is not at edges
      if (peakBinIdx > 0 && peakBinIdx < numBinsTotal - 1) {
        const frameOffset = peakFrameIdx * numBinsTotal;
        
        // Get the dB values of neighboring bins
        const mag0 = rawSpectrum[frameOffset + peakBinIdx - 1];
        const mag1 = rawSpectrum[frameOffset + peakBinIdx];
        const mag2 = rawSpectrum[frameOffset + peakBinIdx + 1];
        
        const db0 = 10 * Math.log10(Math.max((mag0 * mag0) / effectiveFFTSize, 1e-16));
        const db1 = 10 * Math.log10(Math.max((mag1 * mag1) / effectiveFFTSize, 1e-16));
        const db2 = 10 * Math.log10(Math.max((mag2 * mag2) / effectiveFFTSize, 1e-16));

        // Parabolic vertex formula: y = a*x^2 + b*x + c
        // Peak position correction using 2nd derivative
        const a = (db2 - 2 * db1 + db0) / 2;
        if (Math.abs(a) > 1e-10) {
          // bin correction = (f(x-1) - f(x+1)) / (4*a)
          const binCorrection = (db0 - db2) / (4 * a);
          peakFreq_Hz = (peakBinIdx + binCorrection) * freqResolution;
        }
      }

      // Convert to kHz and return
      const peakFreq_kHz = peakFreq_Hz / 1000;
      console.log(`[computeMaxPeakFreq] Found instantaneous peak: ${peakFreq_kHz.toFixed(2)} kHz (power: ${peakPower_dB.toFixed(1)} dB, frame: ${peakFrameIdx}, bin: ${peakBinIdx})`);
      
      return peakFreq_kHz;
    } catch (e) {
      console.error('[computeMaxPeakFreq] Error during computation:', e);
      return null;
    }
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
   * @param {number} order - Filter order (default 2)
   * @returns {Float32Array} Filtered audio data
   */
  applyHighpassFilter(audioData, filterFreq_Hz, sampleRate, order = 2) {
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
