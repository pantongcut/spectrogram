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
      plugin = null;
      if (analysisWasmEngine) {
        try { if (typeof analysisWasmEngine.free === 'function') analysisWasmEngine.free(); } 
        catch (err) { console.warn('⚠️ [wsManager] Error freeing analysisWasmEngine:', err); }
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
        if (targetNoverlap !== null && targetNoverlap !== plugin.noverlap) {
            console.log(`[wsManager] Overlap Changed: ${plugin.noverlap} -> ${targetNoverlap}`);
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

export function setPeakMode(peakMode) {
  currentPeakMode = peakMode;
  
  // NEW (2025): If turning on Peak Mode, trigger full file detection
  if (peakMode && ws) {
    const buffer = ws.getDecodedData();
    
    // Prevent concurrent detection
    if (buffer && !isDetecting) {
      isDetecting = true;
      
      // Show loading indicator (optional)
      const loadingEl = document.getElementById('loading-overlay');
      if (loadingEl) loadingEl.style.display = 'flex';

      // [FIX] 確保 Detector 擁有 WASM 引擎實例
      // 獲取或創建 Analysis 專用引擎 (FFT 1024)
      const wasmEngine = getAnalysisWasmEngine();
      if (wasmEngine) {
        defaultDetector.wasmEngine = wasmEngine;
        console.log("[wsManager] ✅ Injected WASM engine into BatCallDetector (FastScan will use 20-50x acceleration)");
      } else {
        console.warn("[wsManager] ⚠️ WASM engine unavailable, will fall back to JS (slower)");
      }

      // Get frequency parameters from plugin or defaults
      let freqMin = 10;    // kHz
      let freqMax = 128;   // kHz
      
      if (plugin && plugin.options) {
        freqMin = (plugin.options.frequencyMin || 10000) / 1000;
        freqMax = (plugin.options.frequencyMax || 128000) / 1000;
      }

      (async () => {
        try {
          // Call processFullFile for two-pass detection
          const calls = await defaultDetector.processFullFile(
            buffer.getChannelData(0), 
            buffer.sampleRate, 
            freqMin, 
            freqMax,
            { 
              threshold_dB: -60,  // Fast scan threshold
              padding_ms: 10      // Padding before/after segments (ms)
            }
          );
          
          console.log(`[wsManager] Two-Pass Detection complete: ${calls.length} calls detected`);
          
          // [MODIFIED 2025] Event-based system: dispatch detected calls to UI layer
          // Instead of calling plugin.setBatCalls(), emit a custom event
          // This allows frequencyHover.js to create Selection Boxes directly
          document.dispatchEvent(new CustomEvent('bat-calls-detected', { 
            detail: calls,
            bubbles: true,
            cancelable: true
          }));
          
          console.log(`[wsManager] ✅ Dispatched 'bat-calls-detected' event with ${calls.length} calls`);
          
        } catch (e) {
          console.error('[wsManager] Full file detection failed:', e);
        } finally {
          isDetecting = false;
          if (loadingEl) loadingEl.style.display = 'none';
        }
      })();
    }
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