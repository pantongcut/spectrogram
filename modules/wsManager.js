// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';
import { SpectrogramEngine } from './spectrogram_wasm.js';
import { defaultDetector } from './batCallDetector.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentPeakMode = false;
let currentPeakThreshold = 0.4;
let currentSmoothMode = true;
let analysisWasmEngine = null;
let isDetecting = false;  // NEW: Flag to prevent concurrent detection

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

  // 1. 總是同步全局狀態 (以防萬一 main.js 沒有調用 setPeakMode)
  currentPeakMode = peakMode;
  currentPeakThreshold = peakThreshold;

  const targetNoverlap = (overlapPercent !== null && overlapPercent !== undefined)
    ? Math.floor(fftSamples * (overlapPercent / 100))
    : null;

  const needsRebuild =
    !plugin ||
    colorMap !== currentColorMap ||
    fftSamples !== currentFftSize ||
    windowFunc !== currentWindowType ||
    Math.abs(frequencyMin * 1000 - (plugin.options.frequencyMin || 0)) > 1 ||
    Math.abs(frequencyMax * 1000 - (plugin.options.frequencyMax || 0)) > 1;

  if (needsRebuild) {
    // === 硬重啟 (Rebuild) ===
    const oldCanvas = container.querySelector("canvas");
    if (oldCanvas) oldCanvas.remove();

    if (plugin) {
      if (typeof plugin.destroy === 'function') plugin.destroy();
      // [NEW] 顯式斷開引用
      plugin = null;

      // 強制建議垃圾回收 (雖然 JS 做不到，但斷開引用是第一步)
      if (analysisWasmEngine) {
        // ... (你原本的 free 代碼)
        analysisWasmEngine = null;
      }
    }

    currentColorMap = colorMap;
    currentFftSize = fftSamples;
    currentWindowType = windowFunc;

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
    if (plugin && plugin.setSmoothMode) plugin.setSmoothMode(currentSmoothMode);

    try {
      plugin.render();
      requestAnimationFrame(() => { if (typeof onRendered === 'function') onRendered(); });
    } catch (err) { console.warn('⚠️ Spectrogram render failed:', err); }

  } else {
    // === 軟更新 (Soft Update) ===
    let shouldRender = false;
    let shouldUpdateOverlayOnly = false;

    // [CRITICAL FIX] 比較「傳入參數」與「插件現有設定」，而不是比較全局變量
    if (plugin && plugin.options) {

      // 1. 檢查 Peak Mode
      if (plugin.options.peakMode !== peakMode) {
        console.log(`[wsManager] Peak Mode Toggled: ${plugin.options.peakMode} -> ${peakMode}`);
        plugin.options.peakMode = peakMode; // 更新插件內部設定
        shouldRender = true; // 必須重算 FFT 才能生成/清除 Peak 數據
      }

      // 2. 檢查 Peak Threshold
      // 使用 epsilon 比較浮點數
      if (Math.abs((plugin.options.peakThreshold || 0) - peakThreshold) > 0.001) {
        console.log(`[wsManager] Threshold Changed: ${plugin.options.peakThreshold} -> ${peakThreshold}`);
        plugin.options.peakThreshold = peakThreshold; // 更新插件內部設定

        // 如果 Peak Mode 開啟且不需要全渲染，則只更新 Overlay
        if (peakMode && !shouldRender) {
          shouldUpdateOverlayOnly = true;
        }
      }

      // 3. 檢查 Overlap
      // [MODIFIED] 增加檢查：如果 targetNoverlap 有值，且與當前不同，才更新
      if (targetNoverlap !== null && targetNoverlap !== plugin.noverlap) {
        // 如果這是初始創建後的第一次調整，且不需要重建，通常不需要 log 這麼大聲
        // console.log(`[wsManager] Overlap Changed: ${plugin.noverlap} -> ${targetNoverlap}`);

        plugin.noverlap = targetNoverlap;
        plugin.options.noverlap = targetNoverlap;
        shouldRender = true;
      }
    }

    // 執行更新
    try {
      if (shouldRender) {
        console.log('[wsManager] Triggering FULL render (calculating frequencies)...');
        plugin.render();
      } else if (shouldUpdateOverlayOnly) {
        console.log('[wsManager] Triggering OVERLAY update only...');
        if (typeof plugin.updatePeakOverlay === 'function') {
          plugin.updatePeakOverlay();
        } else {
          plugin.render();
        }
      }

      requestAnimationFrame(() => { if (typeof onRendered === 'function') onRendered(); });
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

/**
 * [NEW 2025] 執行自動偵測的函數
 * 這是獨立的功能，由 Auto Detection Toolbar 觸發
 * @param {number} threshold_dB - 偵測閾值 (dB)，預設為 -60
 */
export function runAutoDetection(threshold_dB = -60) {
  if (!ws) return;
  const buffer = ws.getDecodedData();

  if (buffer && !isDetecting) {
    isDetecting = true;

    // Show loading indicator
    const loadingEl = document.getElementById('loading-overlay');
    if (loadingEl) loadingEl.style.display = 'flex';

    // 注入 WASM 引擎
    const wasmEngine = getAnalysisWasmEngine();
    if (wasmEngine) {
      defaultDetector.wasmEngine = wasmEngine;
      console.log("[wsManager] ✅ Injected WASM engine for Auto Detection");
    } else {
      console.warn("[wsManager] ⚠️ WASM engine unavailable, will fall back to JS");
    }

    // 獲取頻率範圍設置
    let freqMin = 10;
    let freqMax = 128;
    if (plugin && plugin.options) {
      freqMin = (plugin.options.frequencyMin || 10000) / 1000;
      freqMax = (plugin.options.frequencyMax || 128000) / 1000;
    }

    // 執行偵測流程
    (async () => {
      try {
        const calls = await defaultDetector.processFullFile(
          buffer.getChannelData(0),
          buffer.sampleRate,
          freqMin,
          freqMax,
          {
            threshold_dB: threshold_dB,  // 使用 Slider 傳入的值
            padding_ms: 10
          }
        );

        console.log(`[wsManager] Auto Detection complete: ${calls.length} calls detected (Threshold: ${threshold_dB}dB)`);

        document.dispatchEvent(new CustomEvent('bat-calls-detected', {
          detail: calls,
          bubbles: true,
          cancelable: true
        }));

      } catch (e) {
        console.error('[wsManager] Auto detection failed:', e);
      } finally {
        isDetecting = false;
        if (loadingEl) loadingEl.style.display = 'none';
      }
    })();
  }
}

/**
 * [REVERTED 2025] Peak Mode - 純視覺模式，不執行偵測
 * 只更新內部狀態，Spectrogram 會根據 peakMode flag 顯示/隱藏 Peak Points
 */
export function setPeakMode(peakMode) {
  currentPeakMode = peakMode;
  console.log(`[wsManager] Peak Mode set to: ${peakMode} (Visual-only, no detection)`);

  // 如果需要立即重新渲染，可以調用 replacePlugin
  // 但通常 Plugin 已經在監聽狀態變化
  if (plugin) {
    // 更新 plugin 的 peak mode 選項
    plugin.peakMode = peakMode;
    console.log(`[wsManager] Updated plugin.peakMode to: ${peakMode}`);
  }
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