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
// [FIX] 全局鎖，防止快速操作導致的競爭條件
let isReplacing = false;

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

// [FIX] 改為 Async 函數以支持等待 GC
export async function replacePlugin(
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
  
  // [FIX 1] 排隊機制：如果上一個替換還在進行，我們等待它完成
  // 這將「並行」的快速點擊轉換為「序列」執行，確保每一次都有機會執行銷毀和 GC
  while (isReplacing) {
      // 每 50ms 檢查一次，直到上一個任務完成
      await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  isReplacing = true;

  try {
      const container = document.getElementById("spectrogram-only");

      // 計算目標 overlap 點數
      const targetNoverlap = (overlapPercent !== null && overlapPercent !== undefined)
          ? Math.floor(fftSamples * (overlapPercent / 100))
          : null;

      // 判斷是否需要完全重建 Plugin
      const needsRebuild = 
        !plugin ||
        colorMap !== currentColorMap ||
        fftSamples !== currentFftSize ||
        windowFunc !== currentWindowType ||
        Math.abs(frequencyMin * 1000 - (plugin.options.frequencyMin || 0)) > 1 || 
        Math.abs(frequencyMax * 1000 - (plugin.options.frequencyMax || 0)) > 1;

      if (needsRebuild) {
        // [FIX 2] 強制清理舊 Canvas 以釋放 GPU 記憶體 (顯存)
        // 在快速切換時，瀏覽器往往來不及回收 Canvas 佔用的顯存，這步很關鍵
        const oldCanvases = container.querySelectorAll("canvas");
        oldCanvases.forEach(canvas => {
            canvas.width = 0;  // 歸零寬高是釋放顯存的最快方法
            canvas.height = 0;
            canvas.remove();
        });

        // 銷毀舊插件
        if (plugin) {
          if (typeof plugin.destroy === 'function') {
            plugin.destroy();
          }
          plugin = null;
          
          // 清理 WASM 引擎
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
          
          // [FIX 3] 關鍵：暫停 100ms 讓瀏覽器執行垃圾回收 (GC)
          // 當你快速連續 load 時，這個「空檔」能讓 JS 引擎有機會回收上一個 5MB 的 wav buffer
          // 如果設得太短 (如 10ms)，GC 可能還沒來得及啟動
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        currentColorMap = colorMap;
        currentFftSize = fftSamples;
        currentWindowType = windowFunc;

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
          // 使用 RAF 避免阻塞 UI
          requestAnimationFrame(() => {
              // 再次檢查 plugin 是否存在 (防止在 await 期間被銷毀)
              if (plugin) plugin.render();
              if (typeof onRendered === 'function') onRendered();
          });
        } catch (err) {
          console.warn('⚠️ Spectrogram render failed:', err);
        }
      } else {
        // [軟更新邏輯保持不變...]
        let shouldRender = false;
        if (currentPeakMode !== peakMode || currentPeakThreshold !== peakThreshold) {
            currentPeakMode = peakMode;
            currentPeakThreshold = peakThreshold;
            if (plugin && plugin.options) {
                plugin.options.peakMode = peakMode;
                plugin.options.peakThreshold = peakThreshold;
            }
        }
        if (plugin && targetNoverlap !== plugin.noverlap) {
            plugin.noverlap = targetNoverlap;
            if (plugin.options) plugin.options.noverlap = targetNoverlap;
            shouldRender = true;
        }

        try {
            if (shouldRender) {
                plugin.render();
            } else {
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
  } finally {
      // 釋放鎖，讓隊列中的下一個請求執行
      isReplacing = false;
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