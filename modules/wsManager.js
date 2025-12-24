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
let analysisWasmEngine = null;

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
  onRendered = null,
  fftSamples = currentFftSize,
  windowFunc = currentWindowType,
  peakMode = currentPeakMode,
  peakThreshold = currentPeakThreshold,
  onColorMapChanged = null
) {
  if (!ws) throw new Error('Wavesurfer not initialized.');
  const container = document.getElementById("spectrogram-only");

  // 計算目標 overlap 點數
  const targetNoverlap = (overlapPercent !== null && overlapPercent !== undefined)
      ? Math.floor(fftSamples * (overlapPercent / 100))
      : null;

  // [FIX] 從 Rebuild 條件中移除 targetNoverlap
  // 只有當 FFT Size, Window, ColorMap 或 頻率範圍改變時才 Rebuild
  const needsRebuild = 
    !plugin ||
    colorMap !== currentColorMap ||
    fftSamples !== currentFftSize ||
    windowFunc !== currentWindowType ||
    Math.abs(frequencyMin * 1000 - (plugin.options.frequencyMin || 0)) > 1 || 
    Math.abs(frequencyMax * 1000 - (plugin.options.frequencyMax || 0)) > 1;

  if (needsRebuild) {
    // 銷毀舊插件
const oldCanvas = container.querySelector("canvas");
    if (oldCanvas) {
      oldCanvas.remove();
    }

    if (plugin) {
      if (typeof plugin.destroy === 'function') {
        plugin.destroy();
      }
      plugin = null;
      
      if (analysisWasmEngine) {
        try {
          if (typeof analysisWasmEngine.free === 'function') {
            analysisWasmEngine.free();
          }
        } catch (err) {
          console.warn('⚠️ [wsManager] Error freeing analysisWasmEngine:', err);
        }
        analysisWasmEngine = null;
      }
    }

    currentColorMap = colorMap;
    currentFftSize = fftSamples;
    currentWindowType = windowFunc;
    
    // [LOG] Debugging initialization
    console.log(`[wsManager] Rebuilding plugin. PeakMode: ${peakMode}, Threshold: ${peakThreshold}`);

    plugin = createSpectrogramPlugin({
      colorMap,
      height,
      frequencyMin,
      frequencyMax,
      fftSamples,
      noverlap: targetNoverlap, 
      windowFunc,
      peakMode,
      peakThreshold,
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

  } else {
    // [FIX] 軟更新邏輯優化
    let shouldRender = false;
    let shouldUpdateOverlayOnly = false;

    // 1. 檢查 Peak Mode 切換
    if (currentPeakMode !== peakMode) {
        console.log(`[wsManager] Peak Mode Toggled: ${currentPeakMode} -> ${peakMode}`);
        currentPeakMode = peakMode;
        if (plugin && plugin.options) {
            plugin.options.peakMode = peakMode;
        }
        // [CRITICAL FIX] 如果切換 Peak Mode，必須重算(render)才能生成/清除數據
        // updatePeakOverlay 無法計算數據，只能畫圖。
        shouldRender = true; 
    }

    // 2. 檢查 Peak Threshold 變化
    if (Math.abs(currentPeakThreshold - peakThreshold) > 0.001) {
        console.log(`[wsManager] Threshold Changed: ${currentPeakThreshold} -> ${peakThreshold}`);
        currentPeakThreshold = peakThreshold;
        if (plugin && plugin.options) {
            plugin.options.peakThreshold = peakThreshold;
        }
        // 如果只是調整閾值，且當前已經是 Peak Mode，則不需要重算 FFT，只需要重畫 Overlay
        if (currentPeakMode && !shouldRender) {
            shouldUpdateOverlayOnly = true;
        }
    }

    // 3. 檢查 Overlap 是否改變
    if (plugin && targetNoverlap !== null && targetNoverlap !== plugin.noverlap) {
        console.log(`[wsManager] Overlap Changed. Re-rendering.`);
        plugin.noverlap = targetNoverlap;
        if (plugin.options) plugin.options.noverlap = targetNoverlap;
        shouldRender = true;
    }

    try {
        if (shouldRender) {
            console.log('[wsManager] Triggering full render to calculate peaks/spectrogram...');
            plugin.render();
        } else if (shouldUpdateOverlayOnly) {
            console.log('[wsManager] Triggering overlay update only...');
            if (plugin && typeof plugin.updatePeakOverlay === 'function') {
                plugin.updatePeakOverlay();
            } else {
                plugin.render();
            }
        }
        
        requestAnimationFrame(() => {
            if (typeof onRendered === 'function') onRendered();
        });
    } catch (err) {
        console.warn('⚠️ Plugin update failed:', err);
    }
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
    
    return new globalThis._spectrogramWasm.SpectrogramEngine(effectiveFFTSize, windowFunc, null);
  } catch (error) {
    console.warn('Failed to create WASM SpectrogramEngine:', error);
    return null;
  }
}