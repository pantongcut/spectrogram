// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';
import { SpectrogramEngine } from './spectrogram_wasm.js';
import { BatCallDetector } from './batCallDetector.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentPeakMode = false;
let currentPeakThreshold = 0.4;
let currentSmoothMode = true;
let analysisWasmEngine = null;
let cachedDetectedCalls = [];
let detectionSensitivity = 0.5;
let autoDetectionEnabled = false;
let debounceTimeout = null;

export function initWavesurfer({
  container,
  url,
  sampleRate = 256000,
}) {
  ws = WaveSurfer.create({
    container,
    height: 0,
    interact: false,
    cursorWidth: 0,
    url,
    sampleRate,
  });

  return ws;
}

export function createSpectrogramPlugin({
  colorMap,
  height = 800,
  frequencyMin = 10,
  frequencyMax = 128,
  fftSamples = 1024,
  noverlap = null,
  windowFunc = 'hann',
  peakMode = false,
  peakThreshold = 0.4,
}) {
  // [DEBUG] 打印創建插件時的參數，確認 wsManager 收到的值是否正確
  console.log(`[wsManager] Creating Plugin -> PeakMode: ${peakMode}, Threshold: ${peakThreshold}`);

  const baseOptions = {
    labels: false,
    height,
    fftSamples,
    frequencyMin: frequencyMin * 1000,
    frequencyMax: frequencyMax * 1000,
    scale: 'linear',
    windowFunc,
    colorMap,
    peakMode,
    peakThreshold,
  };

  if (noverlap !== null) {
    baseOptions.noverlap = noverlap;
  }

  return Spectrogram.create(baseOptions);
}

export function replacePlugin(
  colorMap,
  height = 800,
  frequencyMin = 10,
  frequencyMax = 128,
  overlapPercent = null,
  onRendered = null,
  fftSamples = currentFftSize,
  windowFunc = currentWindowType,
  peakMode = currentPeakMode,
  peakThreshold = currentPeakThreshold,
  onColorMapChanged = null
) {
  if (!ws) throw new Error('Wavesurfer not initialized.');
  const container = document.getElementById("spectrogram-only");

  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) {
    oldCanvas.remove();
  }

  if (plugin?.destroy) {
    plugin.destroy();
    plugin = null;
  }

  container.style.width = '100%';

  // 更新內部狀態
  currentColorMap = colorMap;
  currentFftSize = fftSamples;
  currentWindowType = windowFunc;
  
  // [Fix] 確保 Peak 相關的全局狀態也被更新
  // 這保證了 wsManager 的內部狀態與最後一次渲染的插件一致
  currentPeakMode = peakMode;
  currentPeakThreshold = peakThreshold;

  const noverlap = (overlapPercent !== null && overlapPercent !== undefined)
    ? Math.floor(fftSamples * (overlapPercent / 100))
    : null;

  plugin = createSpectrogramPlugin({
    colorMap,
    height,
    frequencyMin,
    frequencyMax,
    fftSamples,
    noverlap,
    windowFunc,
    peakMode,
    peakThreshold, // 這裡會傳遞正確的參數值
  });

  if (typeof onColorMapChanged === 'function' && plugin && plugin.on) {
    plugin.on('colorMapChanged', onColorMapChanged);
  }

  ws.registerPlugin(plugin);

  if (plugin && plugin.setSmoothMode) {
    plugin.setSmoothMode(currentSmoothMode);
  }

  try {
    plugin.render();
    requestAnimationFrame(() => {
      if (typeof onRendered === 'function') onRendered();
    });
  } catch (err) {
    console.warn('⚠️ Spectrogram render failed:', err);
  }
}

export function getWavesurfer() {
  return ws;
}

export function getPlugin() {
  return plugin;
}

export function getCurrentColorMap() {
  return currentColorMap;
}

export function getEffectiveColorMap() {
  const activePlugin = getPlugin();
  if (activePlugin && activePlugin.colorMapName) {
    return activePlugin.colorMapName;
  }
  if (currentColorMap) {
    return currentColorMap;
  }
  return 'viridis';
}

export function getCurrentFftSize() {
  return currentFftSize;
}

export function getCurrentWindowType() {
  return currentWindowType;
}

export function setPeakMode(peakMode) {
  currentPeakMode = peakMode;
}

export function setPeakThreshold(peakThreshold) {
  currentPeakThreshold = peakThreshold;
}

export function getPeakThreshold() {
  return currentPeakThreshold;
}

export function setSmoothMode(isSmooth) {
  currentSmoothMode = isSmooth;
  if (plugin && plugin.setSmoothMode) {
    plugin.setSmoothMode(isSmooth);
  }
}

export function initScrollSync({
  scrollSourceId,
  scrollTargetId,
}) {
  const source = document.getElementById(scrollSourceId);
  const target = document.getElementById(scrollTargetId);

  if (!source || !target) {
    console.warn(`[scrollSync] One or both elements not found.`);
    return;
  }

  source.addEventListener('scroll', () => {
    target.scrollLeft = source.scrollLeft;
  });
}

export function getAnalysisWasmEngine() {
  if (analysisWasmEngine === null || analysisWasmEngine === undefined) {
    try {
      analysisWasmEngine = new SpectrogramEngine(1024, 'hann', null);
      console.log("✅ [WASM Analysis] Created dedicated WASM Engine (FFT 1024) for bat call analysis");
    } catch (e) {
      console.warn("⚠️ [WASM Analysis] Failed to create WASM Engine, will fallback to JS:", e);
      analysisWasmEngine = null;
    }
  }
  return analysisWasmEngine;
}

export function getOrCreateWasmEngine(fftSize = null, windowFunc = 'hann') {
  if (!globalThis._spectrogramWasm || !globalThis._spectrogramWasm.SpectrogramEngine) {
    console.warn('WASM module not available for bat call detection');
    return null;
  }

  try {
    let effectiveFFTSize = fftSize;
    
    if (effectiveFFTSize === null || effectiveFFTSize === undefined) {
      if (plugin && typeof plugin.getFFTSize === 'function') {
        effectiveFFTSize = plugin.getFFTSize();
      } else if (plugin && plugin.fftSamples) {
        effectiveFFTSize = plugin.fftSamples;
      } else {
        effectiveFFTSize = currentFftSize || 1024;
      }
    }
    
    // console.log(`[WASM Engine] Creating SpectrogramEngine with FFT size: ${effectiveFFTSize}`);
    return new globalThis._spectrogramWasm.SpectrogramEngine(effectiveFFTSize, windowFunc, null);
  } catch (error) {
    console.warn('Failed to create WASM SpectrogramEngine:', error);
    return null;
  }
}

/**
 * Map sensitivity slider (0.0-1.0) to dB threshold
 * 0.0 = -10 dB (strict, low sensitivity)
 * 0.5 = -24 dB (default, standard)
 * 1.0 = -60 dB (loose, high sensitivity)
 */
function mapSensitivityToDb(sensitivity) {
  if (sensitivity < 0) sensitivity = 0;
  if (sensitivity > 1) sensitivity = 1;
  
  // Linear interpolation: -10dB + sensitivity * (-50dB)
  return -10 + (sensitivity * -50);
}

/**
 * Run Auto Detection asynchronously
 * This is the main orchestration point for the detection pipeline
 */
export async function runAutoDetection(sensitivityValue = detectionSensitivity) {
  if (!ws) {
    console.warn('[AutoDetect] Wavesurfer not initialized');
    return;
  }
  
  try {
    // 1. Map Slider (0.0 - 1.0) to Decibels
    const sensitivityDB = mapSensitivityToDb(sensitivityValue);
    
    console.log(`[AutoDetect] Running with sensitivity: ${sensitivityDB.toFixed(1)} dB`);
    
    // [CRITICAL CHANGE] Use fixed Analysis Settings, NOT View Settings
    // This ensures detection is consistent regardless of UI zoom level
    const ANALYSIS_FFT_SIZE = 1024;
    const ANALYSIS_WINDOW = 'hann';
    
    // 2. Get/Create WASM Engine with fixed settings
    // This ensures the detector always runs at 1024 FFT regardless of zoom level
    const wasmEngine = getOrCreateWasmEngine(ANALYSIS_FFT_SIZE, ANALYSIS_WINDOW);
    if (!wasmEngine) {
      console.warn('[AutoDetect] WASM Engine not available, falling back to basic detection');
      return;
    }
    
    // 3. Create detector instance
    const detector = new BatCallDetector();
    detector.setWasmEngine(wasmEngine);
    
    // 4. [CRITICAL FIX] Enforce Standard Analysis Settings
    // Detector uses fixed, optimal settings to ensure consistency
    // NOT dependent on currentFftSize or currentWindowType from the UI View
    detector.config.callThreshold_dB = sensitivityDB;
    detector.config.fftSize = ANALYSIS_FFT_SIZE;        // Fixed at 1024
    detector.config.windowType = ANALYSIS_WINDOW;       // Fixed at 'hann'
    detector.config.enableBackwardEndFreqScan = false;   // Ensure Anti-rebounce enabled
    
    // 5. Get audio data from decoded buffer
    const decodedData = ws.getDecodedData();
    if (!decodedData) {
      console.warn('[AutoDetect] No decoded audio data available');
      return;
    }
    
    const audioData = decodedData.getChannelData(0);
    const sampleRate = ws.options.sampleRate;
    
    if (!audioData || audioData.length === 0) {
      console.warn('[AutoDetect] Audio data is empty');
      return;
    }
    
    // 6. [CRITICAL FIX] Run detection with High Precision
    // We MUST disable fastMode to get accurate parameters and Anti-Rebounce protection
    // This ensures visual consistency between Auto Detection and Selection Tool
    const calls = await detector.detectCalls(audioData, sampleRate, 0, sampleRate / 2000, {
      skipSNR: true,           // Still skip SNR to save some time
      fastMode: false,         // [CRITICAL] Disable fast mode for parameter accuracy and echo removal
      computeShapes: true      // Compute frequency trajectory for visualization
    });
    
    // 7. Cache results
    cachedDetectedCalls = calls || [];
    console.log(`[AutoDetect] Detected ${cachedDetectedCalls.length} call segments`);
    
    // 8. Update spectrogram plugin with detected calls
    if (plugin && typeof plugin.setDetectedCalls === 'function') {
      plugin.setDetectedCalls(cachedDetectedCalls);
      // Trigger re-render of overlay without recomputing FFT
      plugin.render();
    }
    
  } catch (error) {
    console.error('[AutoDetect] Error during detection:', error);
  }
}

/**
 * Debounced auto detection trigger
 * Prevents excessive recalculations during rapid slider changes
 */
export function triggerAutoDetection(sensitivityValue = detectionSensitivity) {
  if (!autoDetectionEnabled) return;
  
  // Clear previous timeout
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
  
  // Set new debounced call (300ms delay)
  debounceTimeout = setTimeout(() => {
    runAutoDetection(sensitivityValue);
  }, 300);
}

/**
 * Enable/disable auto detection
 */
export function setAutoDetectionEnabled(enabled) {
  autoDetectionEnabled = enabled;
  if (enabled && ws && ws.getDecodedData()) {
    runAutoDetection(detectionSensitivity);
  } else if (!enabled && plugin) {
    // Clear detection overlay
    cachedDetectedCalls = [];
    plugin.setDetectedCalls([]);
    plugin.render();
  }
}

/**
 * Update detection sensitivity and trigger detection
 */
export function setDetectionSensitivity(sensitivity) {
  detectionSensitivity = sensitivity;
  if (autoDetectionEnabled) {
    triggerAutoDetection(sensitivity);
  }
}

/**
 * Get cached detected calls
 */
export function getDetectedCalls() {
  return cachedDetectedCalls;
}