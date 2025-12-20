import { getWavesurfer, getPlugin, getOrCreateWasmEngine } from './wsManager.js';
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
      frequencyHoverControl.clearSelections();
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
    if (e.target.checked) {
      performAutoDetection();
    } else {
      frequencyHoverControl.clearSelections();
    }
  });

  /**
   * Perform auto-detection based on current threshold
   */
  async function performAutoDetection() {
    try {
      const plugin = getPlugin();
      if (!plugin) {
        console.warn('[autoDetectionControl] No spectrogram plugin available');
        return;
      }

      // Get spectrogram data
      const spectrogramData = plugin.getSpectrogram?.();
      if (!spectrogramData || !spectrogramData.values) {
        console.warn('[autoDetectionControl] No spectrogram data available');
        return;
      }

      // Get FFT parameters from plugin
      const fftSize = plugin.getFftSize?.() || 512;
      const hopSize = plugin.getHopSize?.() || 256;
      const sampleRate = plugin.getSampleRate?.() || 44100;

      // Calculate peak max if not already calculated
      if (currentPeakMax === null) {
        currentPeakMax = calculatePeakMax(spectrogramData.values);
      }

      // Calculate threshold in dB
      const sliderValue = parseInt(detectThresholdSlider.value);
      const thresholdDb = currentPeakMax - (48 * (1 - sliderValue / 100));

      console.log(`[autoDetectionControl] Peak Max: ${currentPeakMax.toFixed(2)} dB, Threshold: ${thresholdDb.toFixed(2)} dB`);

      // Get WASM engine to call detect_segments
      const wasmEngine = await getOrCreateWasmEngine();
      if (!wasmEngine || !wasmEngine.detect_segments) {
        console.warn('[autoDetectionControl] WASM detect_segments function not available');
        return;
      }

      // Prepare flat spectrogram array
      const flatArray = new Float32Array(spectrogramData.values.flat());
      const numCols = spectrogramData.values[0]?.length || 128;

      // Call WASM detection function
      const segments = wasmEngine.detect_segments(
        flatArray,
        numCols,
        thresholdDb,
        sampleRate,
        hopSize,
        5.0 // padding in milliseconds
      );

      // Clear previous selections
      frequencyHoverControl.clearSelections();

      // Create selections for each detected segment
      const duration = getDuration();
      const currentFreqMin = minFrequency;
      const currentFreqMax = maxFrequency;

      for (let i = 0; i < segments.length; i += 2) {
        const startTime = segments[i];
        const endTime = segments[i + 1];

        // Only create selections within the current time range
        if (startTime < duration && endTime > 0) {
          const clampedStart = Math.max(0, startTime);
          const clampedEnd = Math.min(duration, endTime);

          if (clampedEnd - clampedStart > 0) {
            frequencyHoverControl.programmaticSelect(
              clampedStart,
              clampedEnd,
              currentFreqMin,
              currentFreqMax
            );
          }
        }
      }

      console.log(`[autoDetectionControl] Created ${Math.floor(segments.length / 2)} selections`);
    } catch (err) {
      console.error('[autoDetectionControl] Error during auto-detection:', err);
    }
  }

  /**
   * Calculate the global peak maximum from spectrogram values
   * @param {Array<Array<number>>} spectrogramValues - 2D spectrogram array
   * @returns {number} Peak maximum in dB
   */
  function calculatePeakMax(spectrogramValues) {
    let max = -Infinity;
    for (let i = 0; i < spectrogramValues.length; i++) {
      for (let j = 0; j < spectrogramValues[i].length; j++) {
        const val = spectrogramValues[i][j];
        if (val > max) {
          max = val;
        }
      }
    }
    return max === -Infinity ? 0 : max;
  }

  // Reset peak max when a new file is loaded
  document.addEventListener('fileLoaded', () => {
    currentPeakMax = null;
    frequencyHoverControl.clearSelections();
  });

  return {
    isActive: () => isAutoDetectModeActive,
    performDetection: performAutoDetection,
    clearSelections: () => frequencyHoverControl.clearSelections(),
    setActive: (active) => {
      isAutoDetectModeActive = active;
      if (active) {
        autoDetectBtn.classList.add('active');
        autoDetectModeToolBar.style.display = '';
      } else {
        autoDetectBtn.classList.remove('active');
        autoDetectModeToolBar.style.display = 'none';
        autoDetectSwitch.checked = false;
        frequencyHoverControl.clearSelections();
      }
    }
  };
}
