// modules/wsManager.js

import WaveSurfer from './wavesurfer.esm.js';
import Spectrogram from './spectrogram.esm.js';

let ws = null;
let plugin = null;
let currentColorMap = null;
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentPeakMode = false;
let currentPeakThreshold = 0.4;
let currentSmoothMode = true;

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
