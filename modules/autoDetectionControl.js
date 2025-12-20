import { getWavesurfer, getPlugin } from './wsManager.js';
import { getTimeExpansionMode } from './fileState.js';

/**
 * Initialize Auto Detection Mode
 * @param {Object} config - Configuration object
 * @param {Object} config.frequencyHoverControl - Reference to frequency hover control
 * @param {Function} config.getDuration - Function to get current audio duration
 * @param {Function} config.getZoomLevel - Function to get current zoom level
 * @param {number} config.spectrogramHeight - Height of spectrogram in pixels
 * @param {number} config.minFrequency - Minimum frequency displayed (kHz)
 * @param {number} config.maxFrequency - Maximum frequency displayed (kHz)
 */
export function initAutoDetection(config) {
  const {
    frequencyHoverControl,
    getDuration,
    getZoomLevel,
    spectrogramHeight,
    minFrequency = 10,
    maxFrequency = 128
  } = config;

  const autoDetectBtn = document.getElementById('autoDetectBtn');
  const autoDetectModeToolBar = document.getElementById('auto-detect-mode-tool-bar');
  const detectThresholdSlider = document.getElementById('detectThresholdSlider');
  const detectThresholdVal = document.getElementById('detectThresholdVal');
  const autoDetectSwitch = document.getElementById('autoDetectSwitch');

  let isAutoDetectModeActive = false;
  let currentPeakMax = null; // Store the global peak for calculations

  // Toggle Auto Detection Mode
  autoDetectBtn.addEventListener('click', () => {
    isAutoDetectModeActive = !isAutoDetectModeActive;
    
    if (isAutoDetectModeActive) {
      autoDetectBtn.classList.add('active');
      autoDetectModeToolBar.style.display = '';
    } else {
      autoDetectBtn.classList.remove('active');
      autoDetectModeToolBar.style.display = 'none';
      autoDetectSwitch.checked = false;
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    }
  });

  // Update threshold value display
  detectThresholdSlider.addEventListener('input', (e) => {
    detectThresholdVal.textContent = `${e.target.value}%`;
    
    // If auto-detect is enabled, re-run detection
    if (autoDetectSwitch.checked) {
      performAutoDetection();
    }
  });

  // Handle auto-detect switch toggle
  autoDetectSwitch.addEventListener('change', (e) => {
    console.log(`[autoDetectionControl] Switch toggled: ${e.target.checked ? 'ON' : 'OFF'}`);
    if (e.target.checked) {
      console.log('[autoDetectionControl] Starting detection...');
      performAutoDetection();
    } else {
      console.log('[autoDetectionControl] Clearing selections...');
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    }
  });

  /**
   * Perform auto-detection based on current threshold
   */
  async function performAutoDetection() {
    console.log('[autoDetectionControl] ✅ performAutoDetection called');
    try {
      const plugin = getPlugin();
      if (!plugin) {
        console.warn('[autoDetectionControl] ❌ No spectrogram plugin available');
        return;
      }

      // Get WaveSurfer instance and decoded audio data
      const wavesurfer = getWavesurfer();
      if (!wavesurfer) {
        console.warn('[autoDetectionControl] ❌ No WaveSurfer instance available');
        return;
      }

      const decodedData = wavesurfer.getDecodedData();
      if (!decodedData) {
        console.warn('[autoDetectionControl] ❌ No decoded audio data available');
        return;
      }

      // Get FFT parameters from plugin BEFORE computing spectrogram
      const fftSize = plugin.getFftSize?.() || 512;
      const hopSize = plugin.getHopSize?.() || 256;
      const sampleRate = plugin.getSampleRate?.() || 44100;

      // CRITICAL: Get LINEAR MAGNITUDE spectrogram using compute_spectrogram()
      // This gives us actual frequency bin magnitudes, not U8 visualization data
      const wasmModule = globalThis._spectrogramWasm;
      if (!wasmModule || !wasmModule.compute_spectrogram) {
        console.warn('[autoDetectionControl] ❌ WASM compute_spectrogram not available');
        return;
      }

      // Get audio data from first channel
      const audioData = decodedData.getChannelData(0);
      
      // Calculate noverlap based on FFT size
      let noverlap = Math.floor(fftSize * 0.75); // 75% overlap by default
      if (plugin.noverlap !== undefined) {
        noverlap = plugin.noverlap;
      }
      
      console.log(`[autoDetectionControl] Computing linear magnitude spectrogram: fftSize=${fftSize}, noverlap=${noverlap}, hopSize=${hopSize}`);
      
      // Get linear magnitude spectrogram (NOT U8!)
      const linearSpectrogram = wasmModule.compute_spectrogram(audioData, noverlap);
      if (!linearSpectrogram || linearSpectrogram.length === 0) {
        console.warn('[autoDetectionControl] ❌ No linear spectrogram data from WASM');
        return;
      }

      const numBins = fftSize / 2; // Number of frequency bins in FFT
      const numFrames = Math.floor(linearSpectrogram.length / numBins);
      
      console.log(`[autoDetectionControl] Linear spectrogram available: ${numFrames} frames x ${numBins} bins (total ${linearSpectrogram.length} values)`);

      // Calculate peak max if not already calculated
      if (currentPeakMax === null) {
        currentPeakMax = calculatePeakMax(linearSpectrogram, fftSize);
        console.log(`[autoDetectionControl] ✅ calculatePeakMax returned: ${currentPeakMax.toFixed(2)} dB`);
      }

      // Calculate threshold in dB
      const sliderValue = parseInt(detectThresholdSlider.value);
      const thresholdDb = currentPeakMax - (48 * (1 - sliderValue / 100));

      console.log(`[autoDetectionControl] Peak Max: ${currentPeakMax.toFixed(2)} dB, Slider: ${sliderValue}%, Threshold: ${thresholdDb.toFixed(2)} dB`);

      // CRITICAL: Convert dB threshold back to linear magnitude for WASM comparison
      // The WASM function expects dB values in the spectrogram array
      // But our linearSpectrogram contains linear magnitudes
      // We need to convert the threshold back to match the domain
      // Formula: linear = 10^(dB/20) for magnitude, or 10^(dB/10) for power
      
      // Since we're using power-based dB (10*log10), convert back:
      const thresholdLinearPower = Math.pow(10, thresholdDb / 10);
      
      console.log(`[autoDetectionControl] Threshold conversion: ${thresholdDb.toFixed(2)} dB → ${thresholdLinearPower.toFixed(9)} linear power (normalized)`);

      // Convert linear magnitude spectrogram to dB for WASM
      // WASM expects dB values, so we need to convert our linear magnitudes
      const dbSpectrogram = new Float32Array(linearSpectrogram.length);
      for (let i = 0; i < linearSpectrogram.length; i++) {
        const linearMag = linearSpectrogram[i];
        const powerLinear = (linearMag * linearMag) / fftSize;
        dbSpectrogram[i] = 10 * Math.log10(Math.max(powerLinear, 1e-16));
      }

      console.log(`[autoDetectionControl] Converted linear spectrogram to dB values. Sample: dbSpectrogram[0]=${dbSpectrogram[0].toFixed(2)} dB`);

      // Get WASM detect_segments function
      if (!wasmModule.detect_segments) {
        console.warn('[autoDetectionControl] WASM detect_segments function not available');
        return;
      }

      console.log(`[autoDetectionControl] Calling detect_segments with: flatArray.length=${dbSpectrogram.length}, numCols=${numBins}, threshold=${thresholdDb.toFixed(2)} dB, sampleRate=${sampleRate}, hopSize=${hopSize}`);

      // Call WASM detection function with dB values
      const segments = wasmModule.detect_segments(
        dbSpectrogram,
        numBins,
        thresholdDb,
        sampleRate,
        hopSize,
        5.0 // padding in milliseconds
      );

      console.log(`[autoDetectionControl] ✅ detect_segments returned ${segments.length} values (${Math.floor(segments.length / 2)} segments)`);

      // Clear previous selections
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }

      // Create selections for each detected segment
      const duration = getDuration();
      const currentFreqMin = minFrequency;
      const currentFreqMax = maxFrequency;
      
      console.log(`[autoDetectionControl] Creating selections with freqRange: ${currentFreqMin}-${currentFreqMax} kHz, duration: ${duration}s`);
      console.log(`[autoDetectionControl] frequencyHoverControl available: ${!!frequencyHoverControl}`);

      for (let i = 0; i < segments.length; i += 2) {
        const startTime = segments[i];
        const endTime = segments[i + 1];
        
        // Only create selections within the current time range
        if (startTime < duration && endTime > 0) {
          const clampedStart = Math.max(0, startTime);
          const clampedEnd = Math.min(duration, endTime);

          if (clampedEnd - clampedStart > 0 && frequencyHoverControl) {
            console.log(`[autoDetectionControl] Segment ${Math.floor(i/2)}: ${clampedStart.toFixed(3)}-${clampedEnd.toFixed(3)}s, freq: ${currentFreqMin}-${currentFreqMax} kHz`);
            const selection = frequencyHoverControl.programmaticSelect(
              clampedStart,
              clampedEnd,
              currentFreqMin,
              currentFreqMax
            );
            console.log(`[autoDetectionControl] ✅ Selection created at [${clampedStart.toFixed(3)}, ${clampedEnd.toFixed(3)}]`);
          }
        }
      }

      console.log(`[autoDetectionControl] ✅ Created ${Math.floor(segments.length / 2)} selections`);
    } catch (err) {
      console.error('[autoDetectionControl] Error during auto-detection:', err);
    }
  }

  /**
   * Calculate the global peak maximum from linear magnitude spectrogram
   * Matches batCallDetector.js methodology: 10 * Math.log10(linearMagnitude)
   * @param {Float32Array} linearSpectrogram - Linear magnitude spectrogram data
   * @param {number} fftSize - FFT size (used for power calculation)
   * @returns {number} Peak maximum in dB
   */
  function calculatePeakMax(linearSpectrogram, fftSize = 512) {
    console.log(`[calculatePeakMax] Input type: ${linearSpectrogram.constructor.name}, length: ${linearSpectrogram.length}, FFT size: ${fftSize}`);
    
    // Find peak linear magnitude value across all bins
    let maxLinearMagnitude = 0;
    let binCount = 0;
    
    for (let i = 0; i < linearSpectrogram.length; i++) {
      const linearMag = linearSpectrogram[i];
      if (linearMag > maxLinearMagnitude) {
        maxLinearMagnitude = linearMag;
      }
      binCount++;
    }
    
    console.log(`[calculatePeakMax] Scanned ${binCount} bins, max linear magnitude: ${maxLinearMagnitude.toFixed(6)}`);
    
    // Convert linear magnitude to power (magnitude squared) and then to dB
    // Following batCallDetector.js formula: 10 * Math.log10(power)
    // power = (linearMagnitude^2) / fftSize (normalized power spectral density)
    if (maxLinearMagnitude > 0) {
      const powerLinear = (maxLinearMagnitude * maxLinearMagnitude) / fftSize;
      const peakMaxDb = 10 * Math.log10(Math.max(powerLinear, 1e-16));
      console.log(`[calculatePeakMax] Conversion: linear_mag=${maxLinearMagnitude.toFixed(6)} → power=(mag²/fftSize)=${powerLinear.toFixed(9)} → dB=10*log10(${powerLinear.toFixed(9)}) = ${peakMaxDb.toFixed(2)} dB`);
      return peakMaxDb;
    }
    
    console.log(`[calculatePeakMax] No data found, returning -100 dB (silence)`);
    return -100;  // Return very low dB when no data
  }

  // Reset peak max when a new file is loaded
  document.addEventListener('fileLoaded', () => {
    currentPeakMax = null;
    if (frequencyHoverControl) {
      frequencyHoverControl.clearSelections();
    }
  });

  return {
    isActive: () => isAutoDetectModeActive,
    performDetection: performAutoDetection,
    clearSelections: () => {
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }
    },
    setActive: (active) => {
      isAutoDetectModeActive = active;
      if (active) {
        autoDetectBtn.classList.add('active');
        autoDetectModeToolBar.style.display = '';
      } else {
        autoDetectBtn.classList.remove('active');
        autoDetectModeToolBar.style.display = 'none';
        autoDetectSwitch.checked = false;
        if (frequencyHoverControl) {
          frequencyHoverControl.clearSelections();
        }
      }
    }
  };
}
