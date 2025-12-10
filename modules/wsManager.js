// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';
import { SpectrogramEngine } from './spectrogram_wasm.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentPeakMode = false;
let currentPeakThreshold = 0.4;
let currentSmoothMode = true;
let analysisWasmEngine = null;  // [CRITICAL] Dedicated WASM engine for bat call analysis (FFT 1024)

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
  onRendered = null,  // ✅ 傳入 callback
  fftSamples = currentFftSize,
  windowFunc = currentWindowType,
  peakMode = currentPeakMode,
  peakThreshold = currentPeakThreshold,
  onColorMapChanged = null  // 新增：色彩圖變更 callback
) {
  if (!ws) throw new Error('Wavesurfer not initialized.');
  const container = document.getElementById("spectrogram-only");

  // ✅ 改進：完全清理舊 plugin 和 canvas
  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) {
    oldCanvas.remove();
  }

  if (plugin?.destroy) {
    plugin.destroy();
    plugin = null;  // ✅ 確保 plugin 引用被清空
  }

  // ✅ 強制重新設置 container 寬度為預設值（避免殘留的大尺寸）
  container.style.width = '100%';

  currentColorMap = colorMap;

  currentFftSize = fftSamples;
  currentWindowType = windowFunc;
  // If overlapPercent is undefined (auto mode), pass null to plugin so it dynamically calculates
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
    peakThreshold,
  });

  // 如果提供了 onColorMapChanged callback，附加到 plugin 的 colorMapChanged 事件
  if (typeof onColorMapChanged === 'function' && plugin && plugin.on) {
    plugin.on('colorMapChanged', onColorMapChanged);
  }

  ws.registerPlugin(plugin);

  // Apply saved smooth mode to the newly created plugin
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

/**
 * Retrieves the currently active color map name.
 * Prioritizes the running plugin instance (in case user changed it via dropdown).
 * Fallbacks to the stored `currentColorMap` or default 'viridis'.
 */
export function getEffectiveColorMap() {
  // 1. Check active plugin instance first
  const activePlugin = getPlugin();
  if (activePlugin && activePlugin.colorMapName) {
    return activePlugin.colorMapName;
  }
  
  // 2. Fallback to stored state in wsManager
  if (currentColorMap) {
    return currentColorMap;
  }
  
  // 3. Default
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

/**
 * Get or create a dedicated WASM engine for bat call analysis (FFT 1024)
 * This MUST use FFT 1024 to match the default behavior of legacy JS Goertzel algorithm
 * @returns {SpectrogramEngine|null} Dedicated analysis engine or null if WASM not available
 */
export function getAnalysisWasmEngine() {
  // Create only once and reuse for efficiency
  if (analysisWasmEngine === null || analysisWasmEngine === undefined) {
    try {
      // [CRITICAL] Always use FFT 1024 for analysis (matches legacy JS default)
      analysisWasmEngine = new SpectrogramEngine(1024, 'hann', null);
      console.log("✅ [WASM Analysis] Created dedicated WASM Engine (FFT 1024) for bat call analysis");
    } catch (e) {
      console.warn("⚠️ [WASM Analysis] Failed to create WASM Engine, will fallback to JS:", e);
      analysisWasmEngine = null;
    }
  }
  return analysisWasmEngine;
}

/**
 * Get or create a SpectrogramEngine instance for WASM-accelerated analysis
 * IMPORTANT: Automatically detects and uses the FFT size of the currently active Spectrogram plugin
 * to ensure frequency axis alignment between visualizer and detector.
 * @param {number} fftSize - Optional override FFT size (if not provided, uses plugin's FFT)
 * @param {string} windowFunc - Window function (default 'hann')
 * @returns {SpectrogramEngine|null} Returns SpectrogramEngine instance or null if WASM not available
 */
export function getOrCreateWasmEngine(fftSize = null, windowFunc = 'hann') {
  // Check if WASM module is available globally
  if (!globalThis._spectrogramWasm || !globalThis._spectrogramWasm.SpectrogramEngine) {
    console.warn('WASM module not available for bat call detection');
    return null;
  }

  try {
    // [CRITICAL] If no FFT size provided, try to get it from the active Spectrogram plugin
    let effectiveFFTSize = fftSize;
    
    if (effectiveFFTSize === null || effectiveFFTSize === undefined) {
      // Try to get FFT size from the current plugin
      if (plugin && typeof plugin.getFFTSize === 'function') {
        effectiveFFTSize = plugin.getFFTSize();
      } else if (plugin && plugin.fftSamples) {
        effectiveFFTSize = plugin.fftSamples;
      } else {
        // Fallback to currentFftSize variable if available
        effectiveFFTSize = currentFftSize || 1024;
      }
    }
    
    console.log(`[WASM Engine] Creating SpectrogramEngine with FFT size: ${effectiveFFTSize}`);
    return new globalThis._spectrogramWasm.SpectrogramEngine(effectiveFFTSize, windowFunc, null);
  } catch (error) {
    console.warn('Failed to create WASM SpectrogramEngine:', error);
    return null;
  }
}

/**
 * Utility: Create a debounced version of a function
 * Delays function execution and cancels pending calls when a new one comes in
 * Ideal for real-time event handlers (like region-updated) that fire rapidly
 * 
 * @param {Function} func - The function to debounce
 * @param {number} wait - Delay in milliseconds
 * @returns {Function} Debounced function
 * 
 * @example
 * const debouncedHandler = debounce((region) => {
 *   handleSelection(region);
 * }, 30);  // 30ms delay = ~33fps, smooth UI updates
 * 
 * wsRegions.on('region-updated', (region) => {
 *   debouncedHandler(region);
 * });
 */
export function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

/**
 * Enable real-time region selection with debounced updates
 * Sets up listeners for continuous UI feedback while user drags/resizes regions
 * 
 * @param {Object} wsRegions - WaveSurfer regions plugin instance
 * @param {Function} handleSelection - Callback function to handle selection updates
 * @param {number} debounceDelay - Delay in ms for debouncing (default: 30ms = ~33fps)
 * 
 * @example
 * enableRealtimeRegionSelection(
 *   wsRegions,
 *   (region) => { updateAnalysisUI(region); },
 *   30
 * );
 * 
 * This will:
 * 1. Call handleSelection debounced on 'region-updated' (user dragging/resizing)
 * 2. Call handleSelection immediately on 'region-update-end' (user releases mouse)
 * 3. Ensure no pending debounced calls remain after final update
 */
export function enableRealtimeRegionSelection(wsRegions, handleSelection, debounceDelay = 30) {
  if (!wsRegions || typeof handleSelection !== 'function') {
    console.warn('[enableRealtimeRegionSelection] Invalid arguments');
    return;
  }

  // Create debounced handler for real-time feedback (~30fps)
  const debouncedHandleSelection = debounce(handleSelection, debounceDelay);

  // Listen to rapid 'region-updated' events (while dragging/resizing)
  wsRegions.on('region-updated', (region) => {
    console.log('[Region] Updated (debounced):', region.start.toFixed(2), '-', region.end.toFixed(2));
    debouncedHandleSelection(region);
  });

  // Listen to 'region-update-end' event (when user releases mouse)
  // This ensures final, high-precision calculation and clears any pending debounce
  wsRegions.on('region-update-end', (region) => {
    console.log('[Region] Update ended:', region.start.toFixed(2), '-', region.end.toFixed(2));
    // Call immediately to override any pending debounced call
    handleSelection(region);
  });

  console.log(`✅ [Realtime Selection] Enabled with ${debounceDelay}ms debounce`);
}

