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

      // Get full spectrogram matrix from plugin.getFrequencies()
      // This returns array of frames, each frame contains frequency bins
      const spectrogramMatrix = await plugin.getFrequencies(decodedData);
      if (!spectrogramMatrix || !Array.isArray(spectrogramMatrix) || spectrogramMatrix.length === 0) {
        console.warn('[autoDetectionControl] ❌ No spectrogram data from getFrequencies()');
        return;
      }

      // Get the first channel if multiple channels exist
      let specData = spectrogramMatrix[0] || spectrogramMatrix;
      if (!Array.isArray(specData) || specData.length === 0) {
        console.warn('[autoDetectionControl] ❌ Invalid spectrogram data structure');
        return;
      }

      console.log(`[autoDetectionControl] Spectrogram data available: ${specData.length} frames x ${specData[0]?.length || 0} bins`);

      // Get FFT parameters from plugin
      const fftSize = plugin.getFftSize?.() || 512;
      const hopSize = plugin.getHopSize?.() || 256;
      const sampleRate = plugin.getSampleRate?.() || 44100;

      // Calculate peak max if not already calculated
      if (currentPeakMax === null) {
        // Debug: check the structure of specData
        console.log(`[autoDetectionControl] specData type: ${typeof specData}`);
        console.log(`[autoDetectionControl] specData[0] type: ${typeof specData[0]}`);
        if (specData[0]) {
          console.log(`[autoDetectionControl] specData[0] constructor: ${specData[0].constructor.name}`);
          if (specData[0].length > 0) {
            console.log(`[autoDetectionControl] specData[0][0] value: ${specData[0][0]} (type: ${typeof specData[0][0]})`);
          }
        }
        
        currentPeakMax = calculatePeakMax(specData);
        console.log(`[autoDetectionControl] calculatePeakMax returned: ${currentPeakMax}`);
      }

      // Calculate threshold in dB
      const sliderValue = parseInt(detectThresholdSlider.value);
      const thresholdDb = currentPeakMax - (48 * (1 - sliderValue / 100));

      console.log(`[autoDetectionControl] Peak Max: ${currentPeakMax.toFixed(2)} dB, Threshold: ${thresholdDb.toFixed(2)} dB`);

      // Get WASM module for detect_segments function
      const wasmModule = globalThis._spectrogramWasm;
      if (!wasmModule || !wasmModule.detect_segments) {
        console.warn('[autoDetectionControl] WASM detect_segments function not available');
        console.log('[autoDetectionControl] Available WASM functions:', Object.keys(wasmModule || {}));
        return;
      }

      // Prepare flat spectrogram array from Uint8Array frames
      let flatArray;
      const numFrames = specData.length;
      const numBins = specData[0]?.length || 128;
      
      if (specData[0] instanceof Uint8Array) {
        // Convert Uint8Array frames to flat Float32Array
        flatArray = new Float32Array(numFrames * numBins);
        for (let i = 0; i < numFrames; i++) {
          const frameData = specData[i];
          for (let j = 0; j < numBins; j++) {
            flatArray[i * numBins + j] = frameData[j];
          }
        }
      } else {
        // Assume already flat or array-like
        flatArray = new Float32Array(specData.flat());
      }
      
      const numCols = numBins;

      console.log(`[autoDetectionControl] Calling detect_segments with: flatArray.length=${flatArray.length}, numCols=${numCols}, threshold=${thresholdDb.toFixed(2)}, sampleRate=${sampleRate}, hopSize=${hopSize}`);

      // Call WASM detection function
      const segments = wasmModule.detect_segments(
        flatArray,
        numCols,
        thresholdDb,
        sampleRate,
        hopSize,
        5.0 // padding in milliseconds
      );

      console.log(`[autoDetectionControl] detect_segments returned ${segments.length} values (${Math.floor(segments.length / 2)} segments)`);

      // Clear previous selections
      if (frequencyHoverControl) {
        frequencyHoverControl.clearSelections();
      }

      // Create selections for each detected segment
      const duration = getDuration();
      const currentFreqMin = minFrequency;
      const currentFreqMax = maxFrequency;
      
      console.log(`[autoDetectionControl] Creating selections with freqRange: ${currentFreqMin}-${currentFreqMax} kHz, duration: ${duration}s`);

      for (let i = 0; i < segments.length; i += 2) {
        const startTime = segments[i];
        const endTime = segments[i + 1];
        
        console.log(`[autoDetectionControl] Segment ${Math.floor(i/2)}: time=${startTime.toFixed(3)}-${endTime.toFixed(3)}s, freqMin=${currentFreqMin}, freqMax=${currentFreqMax}`);

        // Only create selections within the current time range
        if (startTime < duration && endTime > 0) {
          const clampedStart = Math.max(0, startTime);
          const clampedEnd = Math.min(duration, endTime);

          if (clampedEnd - clampedStart > 0 && frequencyHoverControl) {
            console.log(`[autoDetectionControl] Calling programmaticSelect(${clampedStart.toFixed(3)}, ${clampedEnd.toFixed(3)}, ${currentFreqMin}, ${currentFreqMax})`);
            const selection = frequencyHoverControl.programmaticSelect(
              clampedStart,
              clampedEnd,
              currentFreqMin,
              currentFreqMax
            );
            console.log(`[autoDetectionControl] Selection created:`, selection);
          } else {
            console.log(`[autoDetectionControl] Skipped: clamped duration=${clampedEnd - clampedStart}, frequencyHoverControl=${!!frequencyHoverControl}`);
          }
        } else {
          console.log(`[autoDetectionControl] Skipped segment: startTime=${startTime} >= duration=${duration} or endTime=${endTime} <= 0`);
        }
      }

      console.log(`[autoDetectionControl] Created ${Math.floor(segments.length / 2)} selections`);
    } catch (err) {
      console.error('[autoDetectionControl] Error during auto-detection:', err);
    }
  }

  /**
   * Calculate the global peak maximum from spectrogram values
   * @param {Array} spectrogramValues - Spectrogram data (array of Uint8Array or 2D array)
   * @returns {number} Peak maximum in dB
   */
  function calculatePeakMax(spectrogramValues) {
    console.log(`[calculatePeakMax] Input type: ${spectrogramValues.constructor.name}, length: ${spectrogramValues.length}`);
    
    // Spectrogram values should be Uint8Array (0-255 scale) in array format
    // We need to find the maximum value and convert to dB
    
    let maxU8 = 0;
    let scannedFrames = 0;
    let scannedBins = 0;
    
    if (Array.isArray(spectrogramValues) && spectrogramValues.length > 0) {
      // Check if this is an array of Uint8Array (2D)
      if (spectrogramValues[0] instanceof Uint8Array) {
        // Multi-frame data: [[Uint8Array], [Uint8Array], ...]
        for (let i = 0; i < spectrogramValues.length; i++) {
          const frame = spectrogramValues[i];
          if (frame && frame.length > 0) {
            for (let j = 0; j < frame.length; j++) {
              const val = frame[j];
              if (val > maxU8) {
                maxU8 = val;
              }
              scannedBins++;
            }
            scannedFrames++;
          }
        }
      } else if (spectrogramValues[0] instanceof Float32Array || typeof spectrogramValues[0] === 'number') {
        // Single-frame data: [val1, val2, val3, ...] or Float32Array
        for (let j = 0; j < spectrogramValues.length; j++) {
          const val = spectrogramValues[j];
          if (typeof val === 'number' && val > maxU8) {
            maxU8 = val;
          }
        }
        scannedFrames = 1;
        scannedBins = spectrogramValues.length;
      }
    }
    
    console.log(`[calculatePeakMax] Scanned: ${scannedFrames} frames, ${scannedBins} bins total`);
    console.log(`[calculatePeakMax] Max U8 value found: ${maxU8}`);
    
    // If we found a value, convert from U8 scale (0-255) to dB scale
    // Assume default 80 dB range: 255 -> 0dB, 0 -> -80dB
    if (maxU8 > 0) {
      const rangeDB = 80;
      const peakMaxDb = (maxU8 / 255.0) * rangeDB - rangeDB;
      console.log(`[calculatePeakMax] Conversion: (${maxU8} / 255) * 80 - 80 = ${peakMaxDb.toFixed(2)} dB`);
      return peakMaxDb;
    }
    
    console.log(`[calculatePeakMax] No data found or all zeros, returning 0`);
    return 0;
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
