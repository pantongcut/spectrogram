import init, * as spectrogramWasm from './modules/spectrogram_wasm.js';

// 初始化並暴露 WASM 模塊到全局變量，讓 WaveSurfer 可以訪問
init().then(() => {
    globalThis._spectrogramWasm = spectrogramWasm;
}).catch(e => {
    console.error('WASM 模塊初始化失敗:', e);
});

import {
initWavesurfer,
getWavesurfer,
getPlugin,
replacePlugin,
createSpectrogramPlugin,
getCurrentColorMap,
getEffectiveColorMap,
initScrollSync,
setPeakMode,
setPeakThreshold,
setSmoothMode,
} from './modules/wsManager.js';

import { initZoomControls } from './modules/zoomControl.js';
import { initFileLoader, getWavSampleRate } from './modules/fileLoader.js';
import { initBrightnessControl } from './modules/brightnessControl.js';
import { initFrequencyHover } from './modules/frequencyHover.js';
import { getColorMapDefaults } from './modules/spectrogram.esm.js';
import { getIconString } from './modules/icons.js';
import { cropWavBlob } from './modules/cropAudio.js';
import { drawTimeAxis, drawFrequencyGrid } from './modules/axisRenderer.js';
import { initExport, exportBatCallsToXlsx } from './modules/export.js';
import { initTrashProgram } from './modules/trashProgram.js';
import { initDragDropLoader } from './modules/dragDropLoader.js';
import { initMapPopup } from './modules/mapPopup.js';
import { initSidebar } from './modules/sidebar.js';
import { initTagControl } from './modules/tagControl.js';
import { initDropdown } from './modules/dropdown.js';
import { showMessageBox } from './modules/messageBox.js';
import { initAutoIdPanel } from './modules/autoIdPanel.js';
import { initFreqContextMenu } from './modules/freqContextMenu.js';
import { initPeakControl, isPeakModeActive, getPeakThreshold } from './modules/peakControl.js';
import { initAutoDetectionControl } from './modules/autoDetectionControl.js';
import { initCallSummaryTable } from './modules/callSummaryTable.js';
import { getCurrentIndex, getFileList, toggleFileIcon, setFileList, clearFileList, getFileIconState, getFileNote, setFileNote, getFileMetadata, setFileMetadata, clearTrashFiles, getTrashFileCount, getCurrentFile, getTimeExpansionMode, setTimeExpansionMode, toggleTimeExpansionMode } from './modules/fileState.js';

const spectrogramHeight = 800;
let sidebarControl;
let fileLoaderControl;
let brightnessController = null; // Global reference to brightness control for settings restoration

/**
 * 在 Wavesurfer Spectrogram 上應用紅色 Peak 線
 */
function applyPeakLineToCanvas() {
  // 獲取 spectrogram 容器中的 canvas
  const container = document.getElementById('spectrogram-only');
  const canvas = container?.querySelector('canvas');
  
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  // 在 canvas 上繪製紅色垂直線，標記 peak 位置
  // TODO: 實現從 Spectrogram 對象獲取 peakBand 信息的方式
  // 暫時這是一個佔位符
  console.log('[applyPeakLineToCanvas] Would draw peak line on canvas');
}

/**
 * Restore image enhancement settings to the current plugin
 * Called after plugin recreation (peak mode toggle, FFT change, etc.)
 */
function restoreImageEnhancement() {
  if (brightnessController && brightnessController.getSettings) {
    const { brightness, contrast, gain } = brightnessController.getSettings();
    const plugin = getPlugin();
    if (plugin && plugin.setImageEnhancement) {
      plugin.setImageEnhancement(brightness, contrast, gain);
    }
  }
}

const container = document.getElementById('spectrogram-only');
const viewer = document.getElementById('viewer-container');
const timeAxis = document.getElementById('time-axis');
const timeWrapper = document.getElementById('time-axis-wrapper');
const timeLabel = document.getElementById('time-label');
const freqGrid = document.getElementById('freq-grid');
const freqAxisContainer = document.getElementById('freq-axis');
const hoverLineElem = document.getElementById('hover-line');
const hoverLineVElem = document.getElementById('hover-line-vertical');
const progressLineElem = document.getElementById('progress-line');
const hoverLabelElem = document.getElementById('hover-label');
const zoomControlsElem = document.getElementById('zoom-controls');
const playPauseBtn = document.getElementById('playPauseBtn');
const stopBtn = document.getElementById('stopBtn');
let containerWidth = container.clientWidth;
let isDraggingProgress = false;
let manualSeekTime = null;
let duration = 0;
let lastLoadedFileName = null;
let currentFreqMin = 10;
let currentFreqMax = 128;
let currentSampleRate = 256000;
let selectedSampleRate = 'auto';
let currentFftSize = 1024;
let currentWindowType = 'hann';
let currentOverlap = 'auto';
let currentAudioBufferLength = 0;
let savedAudioBufferLengthBeforeExpand = null;
let overlapWarningShown = false;
let freqHoverControl = null;
let autoIdControl = null;
let freqMenuControl = null;
let demoFetchController = null;
const sampleRateBtn = document.getElementById('sampleRateInput');
const fftSizeBtn = document.getElementById('fftSizeInput');
let selectionExpandMode = false;
let expandHistory = [];
let currentExpandBlob = null;
// When true, prevent applySampleRate from auto-adjusting the displayed
// freqMin/freqMax input values. Used when reloading the file due to
// UI-only actions (e.g. toggling Time Expansion) where we don't want to
// override user's displayed frequency settings.
let suppressFreqValueAdjustment = false;
const expandBackBtn = document.getElementById('expandBackBtn');
const expandBackCount = document.getElementById('expandBackCount');
let ignoreNextPause = false;

const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobileDevice) {
  [
    'toggleTagModeBtn',
    'autoIdBtn',
    'exportBtn',
    'mapBtn',
    'spectrogram-settings',
    'drop-overlay'
  ]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('mobile-hidden');
    });
  // 預設收合 sidebar
  requestAnimationFrame(() => {
    const sidebarElem = document.getElementById('sidebar');
    if (sidebarElem && !sidebarElem.classList.contains('collapsed')) {
      sidebarElem.classList.add('collapsed');
      const toggleBtn = document.getElementById('toggleSidebarBtn');
      if (toggleBtn) toggleBtn.title = 'Open File List';
    }
    requestAnimationFrame(() => {
      alert('SonoRadar is optimized for desktop use. Android devices support viewer functionality only.');
    });
  });
}
function updateExpandBackBtn() {
  const count = expandHistory.length;
  expandBackBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  if (expandBackCount) {
    expandBackCount.textContent = String(count);
    expandBackCount.style.display = count > 0 ? 'flex' : 'none';
  }
}
// Time Expansion UI helper
const timeExpBtn = document.getElementById('timeexpBtn');
if (timeExpBtn) {
    timeExpBtn.innerHTML = getIconString('timeExpansion');
}

function applyTimeExpansionUI() {
  const active = getTimeExpansionMode();
  if (timeExpBtn) {
    if (active) {
      timeExpBtn.classList.add('active');
      timeExpBtn.title = 'Exit 10x Time Expansion';
    } else {
      timeExpBtn.classList.remove('active');
      timeExpBtn.title = '10x Time Expansion';
    }
  }
  document.body.classList.toggle('timeexp-open', active);
  // adjust displayed freq input maxima and values
  const maxFreq = currentSampleRate / 2000;
  const dispMax = active ? (maxFreq * 10) : maxFreq;
  freqMaxInput.max = dispMax;
  freqMinInput.max = dispMax;
}

if (timeExpBtn) {
  timeExpBtn.addEventListener('click', async () => {
    // If currently in Time Expansion mode and the user is attempting to
    // exit it, disallow exiting when the currently loaded audio is
    // longer than 20 seconds.
    const currentlyActive = getTimeExpansionMode();
    if (currentlyActive) {
      const ws = getWavesurfer();
      const curDur = ws ? ws.getDuration() : 0;
      if (curDur > 20) {
        showMessageBox({
          title: 'Warning',
          message: 'Cannot exit time-expansion mode for >20s recording.'
        });
        return;
      }
    }

    // 如果沒有加載任何文件，只切換 UI 狀態，不重繪
    const ws = getWavesurfer();
    const curDur = ws ? ws.getDuration() : 0;
    if (curDur === 0) {
      const newState = toggleTimeExpansionMode();
      setTimeExpansionMode(newState);
      applyTimeExpansionUI();
      return;
    }

    const newState = toggleTimeExpansionMode();
    setTimeExpansionMode(newState); // ensure saved
    applyTimeExpansionUI();


    try {
      const idx = getCurrentIndex();
      if (idx >= 0 && fileLoaderControl && typeof fileLoaderControl.loadFileAtIndex === 'function') {
        suppressFreqValueAdjustment = true;
        try {
          await fileLoaderControl.loadFileAtIndex(idx);
        } finally {
          suppressFreqValueAdjustment = false;
        }
      } else {
        replacePlugin(
          getEffectiveColorMap(),
          spectrogramHeight,
          currentFreqMin,
          currentFreqMax,
          getOverlapPercent(),
          () => {
            duration = getWavesurfer().getDuration();
            zoomControl.applyZoom();
            renderAxes();
            freqHoverControl?.refreshHover();
            autoIdControl?.updateMarkers();
            updateSpectrogramSettingsText();
          },
          undefined,  // fftSamples (use default)
          undefined,  // windowFunc (use default)
          isPeakModeActive(),  // peakMode (use default)
          getPeakThreshold(),  // peakThreshold (use default)
          handleColorMapChange  // onColorMapChanged callback
        );
      }
    } catch (err) {
      console.error('Error reloading file after Time Expansion toggle', err);
    }
  });
}
let stopBtnRafId = null;
function showStopButton() {
  if (stopBtnRafId !== null) {
    cancelAnimationFrame(stopBtnRafId);
    stopBtnRafId = null;
  }
  stopBtn.style.display = 'inline-flex';
  stopBtnRafId = requestAnimationFrame(() => {
    stopBtnRafId = null;
    stopBtn.classList.add('show');
  });
}
function hideStopButton() {
  if (stopBtnRafId !== null) {
    cancelAnimationFrame(stopBtnRafId);
    stopBtnRafId = null;
  }
  stopBtn.classList.remove('show');
  stopBtn.addEventListener('transitionend', function handler() {
    stopBtn.removeEventListener('transitionend', handler);
    if (!stopBtn.classList.contains('show')) {
      stopBtn.style.display = 'none';
    }
  }, { once: true });
}
playPauseBtn.disabled = true;
hideStopButton();
const getDuration = () => duration;

const guanoOutput = document.getElementById('guano-output');
const metadataDiv = document.getElementById('Metadata');
const fileListElem = document.getElementById('fileList');
const metadataToggle = document.getElementById('metadata-toggle');
metadataToggle.addEventListener('click', () => {
const collapsed = metadataDiv.classList.toggle('collapsed');
fileListElem.classList.toggle('metadata-collapsed', collapsed);
metadataToggle.classList.toggle('fa-caret-down', !collapsed);
metadataToggle.classList.toggle('fa-caret-up', collapsed);
});

initWavesurfer({
  container,
  sampleRate: currentSampleRate,
});
getWavesurfer().on('finish', () => {
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  ignoreNextPause = true;
  hideStopButton();
});

getWavesurfer().on('play', () => {
  progressLineElem.style.display = 'block';
  progressLineElem.style.pointerEvents = 'none';
  playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
  playPauseBtn.title = 'Pause';
  playPauseBtn.classList.add('playing');
  playPauseBtn.classList.remove('paused');
  showStopButton();
});

getWavesurfer().on('pause', () => {
  if (ignoreNextPause) {
    ignoreNextPause = false;
    return;
  }
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Continue (Ctrl + P)';
  playPauseBtn.classList.add('paused');
  playPauseBtn.classList.remove('playing');
  progressLineElem.style.pointerEvents = 'auto';
  if (getWavesurfer().getCurrentTime() === 0) {
    hideStopButton();
  } else {
    showStopButton();
  }
});

getWavesurfer().on('audioprocess', (time) => {
  updateProgressLine(time);
});

getWavesurfer().on('seek', (prog) => {
  updateProgressLine(prog * duration);
});

document.addEventListener('file-loaded', () => {
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  playPauseBtn.disabled = false;
  hideStopButton();
  updateProgressLine(0);
    if (document.body.classList.contains('autoid-open')) {
        freqHoverControl?.setPersistentLinesEnabled(false);
    }
});

playPauseBtn.addEventListener('click', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  if (ws.isPlaying()) {
    ws.pause();
    // Update button immediately in case the pause event is delayed
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    playPauseBtn.title = 'Continue (Ctrl + P)';
    playPauseBtn.classList.add('paused');
    playPauseBtn.classList.remove('playing');
    progressLineElem.style.pointerEvents = 'auto';
  } else {
    if (manualSeekTime !== null) {
      ws.setTime(manualSeekTime);
      manualSeekTime = null;
    }
    ws.play();
    // Reflect playing state immediately
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    playPauseBtn.title = 'Pause';
    playPauseBtn.classList.add('playing');
    playPauseBtn.classList.remove('paused');
    progressLineElem.style.pointerEvents = 'none';
  }
});

stopBtn.addEventListener('click', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  ignoreNextPause = true;
  ws.stop();
  playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
  playPauseBtn.title = 'Play (Ctrl + P)';
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  updateProgressLine(0);
  hideStopButton();
});

// Theme Toggle Button
const themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) {
  // Check if user has a saved preference in localStorage
  const savedTheme = localStorage.getItem('theme-mode');

  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }

  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    
    const isLightMode = document.body.classList.contains('light-mode');
    
    localStorage.setItem('theme-mode', isLightMode ? 'light' : 'dark');
    console.log('Theme toggled to:', isLightMode ? 'Light' : 'Dark');
  });
}

const overlay = document.getElementById('drop-overlay');
const loadingOverlay = document.getElementById('loading-overlay');
const uploadOverlay = document.getElementById('upload-overlay');

// Initialize loading overlay theme styles
function initLoadingOverlayTheme() {
  if (!document.getElementById('loading-overlay-theme-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'loading-overlay-theme-style';
    styleEl.textContent = `
      #loading-overlay {
        background: none;
      }
      
      #loading-overlay .spinner {
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top: 4px solid #ffffff;
      }
      
      #viewer-wrapper.theme-light #loading-overlay {
        background-color: rgba(255, 255, 255, 0.6);
      }
      
      #viewer-wrapper.theme-light #loading-overlay .spinner {
        border: 4px solid rgba(0, 0, 0, 0.3);
        border-top: 4px solid #333;
      }
    `;
    document.head.appendChild(styleEl);
  }
}

// Initialize on load
initLoadingOverlayTheme();

function showDropOverlay() {
overlay.style.display = 'flex';
overlay.style.pointerEvents = 'auto';
hoverLineElem.style.display = 'none';
hoverLineVElem.style.display = 'none';
hoverLabelElem.style.display = 'none';
viewer.classList.remove('hide-cursor');
freqHoverControl?.setPersistentLinesEnabled(false);
}

function hideDropOverlay() {
overlay.style.display = 'none';
overlay.style.pointerEvents = 'none';
  freqHoverControl?.hideHover();
  freqHoverControl?.setPersistentLinesEnabled(true);
  freqHoverControl?.refreshHover();
  autoIdControl?.updateMarkers();
}

showDropOverlay();
document.addEventListener('drop-overlay-show', showDropOverlay);
document.addEventListener('drop-overlay-hide', hideDropOverlay);
updateSpectrogramSettingsText();

fileLoaderControl = initFileLoader({
fileInputId: 'fileInput',
wavesurfer: getWavesurfer(),
spectrogramHeight,
colorMap: [],
onPluginReplaced: () => {},
onFileLoaded: (file) => {
hideDropOverlay();
zoomControlsElem.style.display = 'flex';
sidebarControl.refresh(file.name);
},
onBeforeLoad: () => {
  if (demoFetchController) {
    demoFetchController.abort();
    demoFetchController = null;
  }
  if (uploadOverlay.style.display !== 'flex') {
    loadingOverlay.style.display = 'flex';
  }
  
  freqHoverControl?.hideHover();
  freqHoverControl?.clearSelections();
  if (selectionExpandMode) {
    selectionExpandMode = false;
    sampleRateBtn.disabled = false;
    expandHistory = [];
    currentExpandBlob = null;
    updateExpandBackBtn();
    // restore original audio length if we saved it
    if (savedAudioBufferLengthBeforeExpand !== null) {
      currentAudioBufferLength = savedAudioBufferLengthBeforeExpand;
      savedAudioBufferLengthBeforeExpand = null;
    }
  }
},
  onAfterLoad: () => {
    if (uploadOverlay.style.display !== 'flex') {
      loadingOverlay.style.display = 'none';
    }
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    updateSpectrogramSettingsText();
  },
onSampleRateDetected: autoSetSampleRate
});
sidebarControl = initSidebar({
onFileSelected: (index) => {
fileLoaderControl.loadFileAtIndex(index);
hideDropOverlay();
}
});
const sidebarElem = document.getElementById('sidebar');
sidebarElem.addEventListener('sidebar-toggle', () => {
  setTimeout(() => {
    const prev = containerWidth;
    zoomControl.applyZoom();
    if (container.clientWidth !== prev) {
      containerWidth = container.clientWidth;
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
    }
  }, 310);
});

// [New] 監聽 Sidebar 拖動事件
// 策略：拖動時只更新變數與軸線，讓 Spectrogram 透過 CSS 自動拉伸 (避免變黑/卡頓)
sidebarElem.addEventListener('sidebar-resizing', () => {
  containerWidth = container.clientWidth;
  
  // 只同步 Zoom Level 數值，不觸發 ws.zoom()
  zoomControl.syncZoomLevelNoRender();
  
  // 重新繪製時間軸 (讓 Grid 跟隨)
  renderAxes();
  
  freqHoverControl?.refreshHover();
  autoIdControl?.updateMarkers();
});

// [New] 監聽 Sidebar 拖動結束
// 策略：拖動結束後，才執行一次高品質重繪
sidebarElem.addEventListener('sidebar-resize-end', () => {
  if (zoomControl.isAtMinZoom()) {
    zoomControl.resetZoomState();
  } else {
    zoomControl.applyZoom();
  }
  renderAxes();
});

const tagControl = initTagControl();

(async () => {
  demoFetchController = new AbortController();
  try {
    const resp = await fetch(
      './recording/demo_recording.wav',
      { signal: demoFetchController.signal }
    );
    const blob = await resp.blob();
    if (demoFetchController.signal.aborted) return;
    const demoFile = new File([blob], 'demo_recording.wav', { type: 'audio/wav' });
    setFileList([demoFile], -1);
    toggleFileIcon(0, 'trash');
    toggleFileIcon(0, 'star');
    toggleFileIcon(0, 'question');
    sidebarControl.refresh(demoFile.name);
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Failed to preload demo file', err);
    }
  } finally {
    demoFetchController = null;
  }
})();

document.addEventListener('keydown', (e) => {
const idx = getCurrentIndex();
if (idx < 0) return;
if (e.key === 'Delete') {
toggleFileIcon(idx, 'trash');
sidebarControl.refresh(getFileList()[idx].name, false);
} else if (e.key === '*') {
toggleFileIcon(idx, 'star');
sidebarControl.refresh(getFileList()[idx].name, false);
} else if (e.key === '?') {
toggleFileIcon(idx, 'question');
sidebarControl.refresh(getFileList()[idx].name, false);
}
});

const toggleGridSwitch = document.getElementById('toggleGridSwitch');

freqGrid.style.display = 'none';
toggleGridSwitch.checked = false;
toggleGridSwitch.addEventListener('change', () => {
freqGrid.style.display = toggleGridSwitch.checked ? 'block' : 'none';
});

// Smooth rendering toggle
const toggleSmoothSwitch = document.getElementById('toggleSmoothSwitch');

if (toggleSmoothSwitch) {
  // Initialize: default to true (smooth mode)
  toggleSmoothSwitch.checked = true;
  
  // Listen for switch changes and call setSmoothMode
  toggleSmoothSwitch.addEventListener('change', (e) => {
    setSmoothMode(e.target.checked);
  });
}

// [MODIFIED] 增加 shouldRender 参数，允许更新状态但不触发重绘
async function applySampleRate(rate, reloadFile = true, shouldRender = true) {
  const prevRate = currentSampleRate;
  currentSampleRate = rate;
  const maxFreq = currentSampleRate / 2000;
  // Displayed max should reflect Time Expansion mode (UI shows values *10)
  const dispMax = getTimeExpansionMode() ? (maxFreq * 10) : maxFreq;
  freqMaxInput.max = dispMax;
  freqMinInput.max = dispMax;

  const isManual = selectedSampleRate !== 'auto';

  // When updating displayed inputs, convert back and forth between display
  // values and internal kHz values. Displayed values are multiplied by 10 in
  // time expansion mode, so convert accordingly when reading input values.
  const divisor = getTimeExpansionMode() ? 10 : 1;
  if (!suppressFreqValueAdjustment) {
    if (isManual && rate < prevRate) {
      freqMaxInput.value = formatFreqValue(maxFreq);
    } else if (parseFloat(freqMaxInput.value) > (maxFreq * divisor)) {
      freqMaxInput.value = formatFreqValue(maxFreq);
    }
  }

  if (parseFloat(freqMinInput.value) > (maxFreq * divisor)) {
    freqMinInput.value = formatFreqValue(maxFreq);
  }

  currentFreqMax = parseFloat(freqMaxInput.value) / divisor;
  currentFreqMin = parseFloat(freqMinInput.value) / divisor;

  if (getWavesurfer()) {
    getWavesurfer().options.sampleRate = currentSampleRate;
    if (reloadFile) {
      const idx = getCurrentIndex();
      if (idx >= 0) {
        await fileLoaderControl.loadFileAtIndex(idx);
      }
    }
  }

  // [MODIFIED] 只有当 shouldRender 为 true 时才调用 replacePlugin
  // 在文件加载过程中，我们设为 false，让 decode 事件来处理唯一的渲染
  if (shouldRender) {
    freqHoverControl?.hideHover();
    replacePlugin(
      getEffectiveColorMap(),
      spectrogramHeight,
      currentFreqMin,
      currentFreqMax,
      getOverlapPercent(),
      () => {
        duration = getWavesurfer().getDuration();
        if (getWavesurfer().getDecodedData()) {
            zoomControl.applyZoom();
        }
        renderAxes();
        freqHoverControl?.refreshHover();
        autoIdControl?.updateMarkers();
        updateSpectrogramSettingsText();
        restoreImageEnhancement(); // ✅ Restore Brightness/Contrast/Gain
      },
      undefined, // fftSamples (use default)
      undefined, // windowFunc (use default)
      isPeakModeActive(), // peakMode (use default)
      getPeakThreshold(), // peakThreshold (use default)
      handleColorMapChange // onColorMapChanged callback
    );
  } else {
    // 即使不渲染，也要更新文字显示，确保 UI 状态正确
    updateSpectrogramSettingsText();
  }
}

async function handleSampleRate(rate) {
selectedSampleRate = rate;
if (rate === 'auto') {
const cur = getCurrentFile();
if (cur) {
const autoRate = await getWavSampleRate(cur);
await autoSetSampleRate(autoRate);
} else {
updateSpectrogramSettingsText();
}
return;
}
await applySampleRate(rate);
}

async function autoSetSampleRate(rate, skipReload = false) {
  if (selectedSampleRate === 'auto' && rate) {
    // [MODIFIED] 传入 false 作为第三个参数 (shouldRender)
    // 这样只会更新 currentSampleRate 变量，真正的渲染交给 wavesurfer 的 decode 事件
    await applySampleRate(rate, !skipReload, false);
  } else if (selectedSampleRate === 'auto') {
    updateSpectrogramSettingsText();
  }
}

const renderAxes = () => {
  containerWidth = container.clientWidth;
  
  // 使用批量更新優化，避免多次重排。在單個 RAF 中同時更新時間軸和頻率網格
  requestAnimationFrame(() => {
    drawTimeAxis({
      containerWidth,
      duration,
      zoomLevel: zoomControl.getZoomLevel(),
      axisElement: timeAxis,
      labelElement: timeLabel,
      timeExpansion: getTimeExpansionMode(),
    });
    
    drawFrequencyGrid({
      gridCanvas: freqGrid,
      labelContainer: freqAxisContainer,
      containerElement: container,
      spectrogramHeight,
      maxFrequency: currentFreqMax - currentFreqMin,
      offsetKHz: currentFreqMin,
      timeExpansion: getTimeExpansionMode(),
    });

    if (!freqHoverControl) {
      freqHoverControl = initFrequencyHover({
        viewerId: 'viewer-container',
        wrapperId: 'viewer-wrapper',
        hoverLineId: 'hover-line',
        hoverLineVId: 'hover-line-vertical',
        freqLabelId: 'hover-label',
        spectrogramHeight,
        spectrogramWidth: containerWidth,
        maxFrequency: currentFreqMax,
        minFrequency: currentFreqMin,
        totalDuration: duration,
        getZoomLevel: () => zoomControl.getZoomLevel(),
        getDuration: () => duration
      });
    } else {
      freqHoverControl.setFrequencyRange(currentFreqMin, currentFreqMax);
      autoIdControl?.updateMarkers();
    }
    updateProgressLine(getWavesurfer().getCurrentTime());
  });
};

const wrapper = document.getElementById('viewer-wrapper');
const zoomControl = initZoomControls(
  getWavesurfer(),
  container,
  getDuration,
  renderAxes,
  wrapper,
  () => { freqHoverControl?.hideHover(); },
  () => {
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    updateSpectrogramSettingsText();
  },
  () => selectionExpandMode,
  () => {
    const sel = freqHoverControl?.getHoveredSelection?.();
    if (sel) {
      viewer.dispatchEvent(new CustomEvent('expand-selection', {
        detail: { startTime: sel.data.startTime, endTime: sel.data.endTime }
      }));
      return true;
    }
    return false;
  }
);

// [NEW 2025] Event Listener: Auto-create Selection Boxes from detected bat calls
// When wsManager.setPeakMode() dispatches 'bat-calls-detected' event,
// this listener calls frequencyHover.addAutoSelections() to create interactive UI elements
document.addEventListener('bat-calls-detected', (e) => {
  const calls = e.detail;
  if (freqHoverControl && typeof freqHoverControl.addAutoSelections === 'function') {
    console.log(`[Main] Received 'bat-calls-detected' event with ${calls.length} calls`);
    console.log(`[Main] Auto-creating Selection Boxes...`);
    freqHoverControl.addAutoSelections(calls);
  } else {
    console.warn('[Main] freqHoverControl not initialized or addAutoSelections not available');
  }
  
  // [NEW] Update Call Summary Table with detected calls
  if (callSummaryTableControl && typeof callSummaryTableControl.updateTable === 'function') {
    callSummaryTableControl.updateTable(calls);
  }
});

function updateProgressLine(time) {
  if (isDraggingProgress) return;
  const t = (manualSeekTime !== null && !getWavesurfer().isPlaying()) ? manualSeekTime : time;
  const x = t * zoomControl.getZoomLevel() - viewer.scrollLeft;
  progressLineElem.style.left = `${x}px`;
}

viewer.addEventListener('scroll', () => {
  const ws = getWavesurfer();
  if (!ws) return;
  updateProgressLine(ws.getCurrentTime());
  autoIdControl?.updateMarkers();
});

progressLineElem.addEventListener('mousedown', (e) => {
  const ws = getWavesurfer();
  if (!ws || ws.isPlaying()) return;
  isDraggingProgress = true;
  e.preventDefault();
});

viewer.addEventListener('mousemove', (e) => {
  if (!isDraggingProgress) return;
  const rect = viewer.getBoundingClientRect();
  let x = e.clientX - rect.left;
  x = Math.max(0, Math.min(rect.width, x));
  manualSeekTime = Math.max(0, Math.min(duration, (x + viewer.scrollLeft) / zoomControl.getZoomLevel()));
  progressLineElem.style.left = `${x}px`;
});

document.addEventListener('mouseup', () => {
  if (isDraggingProgress) {
    isDraggingProgress = false;
  }
});

viewer.addEventListener('expand-selection', async (e) => {
  const { startTime, endTime } = e.detail;
  if (endTime > startTime) {
    freqHoverControl?.hideHover();
    const base = currentExpandBlob || getCurrentFile();
    const blob = await cropWavBlob(base, startTime, endTime);
    if (blob) {
      expandHistory.push({ src: base, freqMin: currentFreqMin, freqMax: currentFreqMax });
      // Save original audio length so we can restore when leaving expansion
      savedAudioBufferLengthBeforeExpand = currentAudioBufferLength;
      // Set selectionExpandMode true BEFORE loadBlob so decode handler sees it
      selectionExpandMode = true;
      try {
        await getWavesurfer().loadBlob(blob);
      } catch (err) {
        // if load fails, revert selectionExpandMode and rethrow
        selectionExpandMode = false;
        savedAudioBufferLengthBeforeExpand = null;
        throw err;
      }
      currentExpandBlob = blob;
      zoomControl.resetZoomState();
      container.style.width = '100%';
      
      sampleRateBtn.disabled = true;
      renderAxes();
      freqHoverControl?.hideHover();
      freqHoverControl?.clearSelections();
      updateExpandBackBtn();
      autoIdControl?.reset();
      viewer.dispatchEvent(new CustomEvent('force-hover-enable'));
      freqHoverControl?.refreshHover();
    }
  }
});

viewer.addEventListener('fit-window-selection', async (e) => {
  const { startTime, endTime, Flow, Fhigh } = e.detail;
  if (endTime > startTime) {
    freqHoverControl?.hideHover();
    const base = currentExpandBlob || getCurrentFile();
    const blob = await cropWavBlob(base, startTime, endTime);
    if (blob) {
      expandHistory.push({ src: base, freqMin: currentFreqMin, freqMax: currentFreqMax });
      // Ensure selectionExpandMode is set before decoding so getAutoOverlapPercent() can use backend buffer
      selectionExpandMode = true;
      try {
        await getWavesurfer().loadBlob(blob);
      } catch (err) {
        selectionExpandMode = false;
        savedAudioBufferLengthBeforeExpand = null;
        throw err;
      }
      currentExpandBlob = blob;
      zoomControl.resetZoomState();  // ✅ 使用完整重置
      
      // ✅ 強制重置 container 寬度
      container.style.width = '100%';
      
      sampleRateBtn.disabled = true;
      freqMinInput.value = formatFreqValue(Flow);
      freqMaxInput.value = formatFreqValue(Fhigh);
      updateFrequencyRange(Flow, Fhigh);
      freqHoverControl?.hideHover();
      freqHoverControl?.clearSelections();
      updateExpandBackBtn();
      autoIdControl?.reset();
      // ✅ 移除此處的 updateSpectrogramSettingsText()，讓 decode 事件處理器負責
      // updateSpectrogramSettingsText();
    }
  }
});

// Handle color map changes: auto-apply defaults and update hover theme
function handleColorMapChange(event) {
  const { name: colorMapName, settings: defaults } = event;
  console.log('[ColorMapChanged] Updating UI for:', colorMapName, defaults);
  
  // Update slider values to color map defaults
  if (brightnessController && brightnessController.setValues) {
    brightnessController.setValues(defaults);
  }
  
  // Update hover line colors and toggle theme based on color map
  if (freqHoverControl && freqHoverControl.updateHoverTheme) {
    freqHoverControl.updateHoverTheme(colorMapName);
  }

  // Update loading overlay theme to match color map theme
  const wrapper = document.getElementById('viewer-wrapper');
  if (wrapper) {
    if (colorMapName === 'mono_light' || colorMapName === 'rainbow') {
      // Light theme: loading overlay uses light background
      wrapper.classList.add('theme-light');
    } else {
      // Dark theme: loading overlay uses dark background
      wrapper.classList.remove('theme-light');
    }
  }

  // Re-render axes (Grid) to adapt color to the new theme immediately
  // drawFrequencyGrid in axisRenderer.js checks the 'theme-light' class to decide line color
  renderAxes();
}

brightnessController = initBrightnessControl({
  brightnessSliderId: 'brightnessSlider',
  gainSliderId: 'gainSlider',
  contrastSliderId: 'contrastSlider',
  brightnessValId: 'brightnessVal',
  gainValId: 'gainVal',
  contrastValId: 'contrastVal',
  resetBtnId: 'resetButton',
  // Callback to get reset values based on current color map
  getResetValues: () => {
    const mapName = getEffectiveColorMap();
    return getColorMapDefaults(mapName);
  },
  // Connect UI directly to Spectrogram's image enhancement method
  onSettingsChanged: ({ brightness, contrast, gain }) => {
    const plugin = getPlugin();
    if (plugin && plugin.setImageEnhancement) {
      plugin.setImageEnhancement(brightness, contrast, gain);
    }
  }
});

initDragDropLoader({
targetElementId: 'viewer-wrapper',
wavesurfer: getWavesurfer(),
spectrogramHeight,
colorMap: [],
onPluginReplaced: () => {},
onFileLoaded: (file) => {
hideDropOverlay();
zoomControlsElem.style.display = 'flex';
sidebarControl.refresh(file.name);
},
onBeforeLoad: () => {
if (uploadOverlay.style.display !== 'flex') {
loadingOverlay.style.display = 'flex';
}
freqHoverControl?.hideHover();
freqHoverControl?.clearSelections();
},
  onAfterLoad: () => {
    if (uploadOverlay.style.display !== 'flex') {
      loadingOverlay.style.display = 'none';
    }
    freqHoverControl?.refreshHover();
    autoIdControl?.updateMarkers();
    updateSpectrogramSettingsText();
  },
onSampleRateDetected: autoSetSampleRate
});

initScrollSync({
scrollSourceId: 'viewer-container',
scrollTargetId: 'time-axis-wrapper',
});

getWavesurfer().on('ready', () => {
    duration = getWavesurfer().getDuration();
    
    // ✅ 強制重置所有寬度，確保不受先前 zoom 影響
    container.style.width = '100%';
    wrapper.style.width = '100%';
    
    // ✅ 調用完整 reset，會基於 100% 寬度計算 minZoomLevel
    zoomControl.resetZoomState();

    progressLineElem.style.display = 'none';
    updateProgressLine(0);

    // [DELETED] 移除這行，因為 decode 事件已經處理了渲染
    // getPlugin()?.render();
    
    requestAnimationFrame(() => {
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
    });
  });

getWavesurfer().on('decode', () => {
  duration = getWavesurfer().getDuration();
  
  if (selectionExpandMode) {
    const newBufferLength = getWavesurfer()?.getDecodedData()?.length || getWavesurfer()?.backend?.buffer?.length;
    if (newBufferLength) {
      currentAudioBufferLength = newBufferLength;
    }
  }
  
  // Force layout update
  container.style.width = '100%';
  wrapper.style.width = '100%';
  void container.offsetWidth; 
  
  zoomControl.resetZoomState();
  progressLineElem.style.display = 'none';
  updateProgressLine(0);

  setTimeout(() => {
      const colorMap = getEffectiveColorMap();
      
      // [STEP 1] Calculate the correct initial overlap explicitly
      // Since 'updateSpectrogramSettingsText' shows the correct value, we know this function works.
      let initialOverlap = getOverlapPercent(); // undefined for 'auto'
      
      if (initialOverlap === undefined) {
          // Manually calculate the optimal overlap (e.g., 86) to fix Initial Load (Scenario 1)
          initialOverlap = getAutoOverlapPercent();
      }

      replacePlugin(
        colorMap,
        spectrogramHeight,
        currentFreqMin,
        currentFreqMax,
        initialOverlap, // [STEP 2] Inject the specific value (86) for the FIRST render
        () => {
            // onRendered Callback
            
            // [STEP 3] Unlock! Restore "Auto" mode for future Zooms (Scenario 2)
            // We set the internal noverlap to null so the plugin recalculates on next redraw
            const plugin = getPlugin();
            if (plugin && currentOverlap === 'auto') {
                plugin.noverlap = null; 
            }

            renderAxes();
            freqHoverControl?.refreshHover();
            autoIdControl?.updateMarkers();
            updateSpectrogramSettingsText();
            restoreImageEnhancement();
        },
        currentFftSize,
        currentWindowType,
        isPeakModeActive(),
        getPeakThreshold(),
        handleColorMapChange
      );
  }, 0);
});

document.body.addEventListener('touchstart', () => {
if (getWavesurfer()?.backend?.ac?.state === 'suspended') {
getWavesurfer().backend.ac.resume();
}
}, { once: true });

const freqMinInput = document.getElementById('freqMinInput');
const freqMaxInput = document.getElementById('freqMaxInput');
const applyFreqRangeBtn = document.getElementById('applyFreqRangeBtn');

// initialize displayed max according to Time Expansion mode
const initMaxFreq = currentSampleRate / 2000;
const initDispMax = getTimeExpansionMode() ? (initMaxFreq * 10) : initMaxFreq;
freqMaxInput.max = initDispMax;
freqMinInput.max = initDispMax;
// Ensure UI reflects current Time Expansion mode on startup
applyTimeExpansionUI();

const sampleRateDropdown = initDropdown('sampleRateInput', [
{ label: 'Auto', value: 'auto' },
{ label: '96', value: 96000 },
{ label: '192', value: 192000 },
{ label: '256', value: 256000 },
{ label: '384', value: 384000 },
{ label: '500', value: 500000 },
], { onChange: (item) => handleSampleRate(item.value) });
sampleRateDropdown.select(0);

const fftSizeDropdown = initDropdown('fftSizeInput', [
{ label: '512', value: 512 },
{ label: '1024', value: 1024 },
{ label: '2048', value: 2048 },
], { onChange: (item) => handleFftSize(item.value) });
fftSizeDropdown.select(0);

const windowTypeDropdown = initDropdown('windowTypeInput', [
  { label: 'Blackman', value: 'blackman' },
  { label: 'Gauss', value: 'gauss' },
  { label: 'Hamming', value: 'hamming' },
  { label: 'Hann', value: 'hann' },
  { label: 'Rectangular', value: 'rectangular' },
  { label: 'Triangular', value: 'triangular' },
], { onChange: (item) => handleWindowType(item.value) });
windowTypeDropdown.select(3);

const overlapInput = document.getElementById('overlapInput');
overlapInput.value = '';
overlapInput.addEventListener('change', () => {
const val = overlapInput.value.trim();
if (val === '') {
currentOverlap = 'auto';
handleOverlapChange();
return;
}

const num = parseInt(val, 10);
if (!isNaN(num) && num >= 1 && num <= 99) {
const proceed = () => {
currentOverlap = num;
handleOverlapChange();
};
if (num >= 80 && !overlapWarningShown) {
showMessageBox({
title: 'Reminder',
message: `Using an overlap size above 80% can significantly increase rendering time. If the .wav file is longer than 8 seconds or high-level zoom-in is enabled, large overlap sizes are not recommended.`,
confirmText: 'OK',
cancelText: 'Cancel',
onConfirm: () => {
overlapWarningShown = true;
proceed();
},
onCancel: () => {
overlapInput.value = '';
currentOverlap = 'auto';
}
});
return;
}
proceed();
} else {
alert('Overlap must be between 1 and 99.');
overlapInput.value = '';
currentOverlap = 'auto';
handleOverlapChange();
}
});

const quickPresetBtn = document.getElementById('quickPresetBtn');
let quickPresetActive = false;
let prevSampleRateIndex = null;
let prevFftSizeIndex = null;
quickPresetBtn.addEventListener('click', () => {
  if (!quickPresetActive) {
    prevSampleRateIndex = sampleRateDropdown.selectedIndex;
    prevFftSizeIndex = fftSizeDropdown.selectedIndex;
    fftSizeDropdown.select(0);
    fftSizeBtn.disabled = true;
    sampleRateDropdown.select(3);
    sampleRateBtn.disabled = true;
    quickPresetBtn.style.color = 'rgb(249, 191, 0)';
    quickPresetBtn.title = 'Exit Quick Screening Mode';
    quickPresetActive = true;
  } else {
    sampleRateBtn.disabled = false;
    fftSizeBtn.disabled = false;
    if (prevFftSizeIndex != null) fftSizeDropdown.select(prevFftSizeIndex);
    if (prevSampleRateIndex != null) sampleRateDropdown.select(prevSampleRateIndex);
    quickPresetBtn.style.color = '';
    quickPresetBtn.style.textShadow = '';
    quickPresetBtn.title = 'Quick Screening Mode';
    quickPresetActive = false;
  }
  overlapInput.value = '';
  currentOverlap = 'auto';
  handleOverlapChange();
});

function updateSpectrogramSettingsText() {
  const textElem = document.getElementById('spectrogram-settings-text');
  const sampleRate = currentSampleRate;
  const fftSize = currentFftSize;
  const overlap = currentOverlap === 'auto'
    ? getAutoOverlapPercent()
    : getPluginUsedOverlapPercentFromManual(currentOverlap);
  const windowType = currentWindowType.charAt(0).toUpperCase() + currentWindowType.slice(1);

  const overlapText = currentOverlap === 'auto'
    ? `Auto${overlap !== null ? ` (${overlap}%)` : ''}`
    : `${overlap}%`;
  if (textElem) {
    textElem.textContent =
      `Sampling rate: ${sampleRate / 1000}kHz, FFT size: ${fftSize}, Overlap size: ${overlapText}, ${windowType} window`;
  }
}

function getOverlapPercent() {
  if (currentOverlap === 'auto') {
    return undefined;
  }
  // Manual overlap handling
  const parsed = parseInt(currentOverlap, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Convert a user-specified overlap percent to the percent that the plugin
 * will actually use (plugin computes noverlap = floor(fft * pct / 100)).
 */
function getPluginUsedOverlapPercentFromManual(pct) {
  const parsed = parseInt(pct, 10);
  if (isNaN(parsed)) return null;
  const fft = currentFftSize;
  if (!fft) return null;
  const noverlap = Math.round(fft * (parsed / 100));
  return Math.round((noverlap / fft) * 100);
}

function getAutoOverlapPercent(overriddenBufferLength = null) {
  // 優先使用傳入的 bufferLength，其次是 currentAudioBufferLength，最後回退到 wavesurfer backend
  const bufferLength = overriddenBufferLength !== null
    ? overriddenBufferLength
    : (
      // If not in selectionExpandMode, prefer wavesurfer internal decoded length (original wav)
      (!selectionExpandMode && getWavesurfer()?.getDecodedData()?.length) ||
      currentAudioBufferLength ||
      getWavesurfer()?.getDecodedData()?.length ||
      getWavesurfer()?.backend?.buffer?.length
    );
  const canvasWidth = document
    .querySelector('#spectrogram-only canvas')
    ?.width || container.clientWidth;
  const fft = currentFftSize;
  if (bufferLength && canvasWidth && fft) {
    const samplesPerCol = bufferLength / canvasWidth;
    const noverlap = Math.max(0, Math.round(fft - samplesPerCol));
    const pct = Math.round((noverlap / fft) * 100);
    return Math.max(5, pct);
  }
  return null;
}

function formatFreqValue(value) {
  const timeExp = getTimeExpansionMode();
  const display = timeExp ? (value * 10) : value;
  return Math.abs(display - Math.round(display)) < 0.001
    ? String(Math.round(display))
    : display.toFixed(1);
}

applyFreqRangeBtn.addEventListener('click', () => {
  const dispMin = Math.max(0, parseFloat(freqMinInput.value));
  const maxAllowed = currentSampleRate / 2000;
  const divisor = getTimeExpansionMode() ? 10 : 1;
  const dispMax = Math.min(maxAllowed * divisor, parseFloat(freqMaxInput.value));

  if (isNaN(dispMin) || isNaN(dispMax) || dispMin >= dispMax) {
    alert('Please enter valid frequency values. Min must be less than Max.');
    return;
  }

  const min = dispMin / divisor;
  const max = dispMax / divisor;
  updateFrequencyRange(min, max);
});

document.getElementById('fileInputBtn').addEventListener('click', () => {
document.getElementById('fileInput').click();
});

function handleFftSize(size) {
  currentFftSize = size;
  const colorMap = getEffectiveColorMap();
  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      duration = getWavesurfer().getDuration();
      if (getWavesurfer().getDecodedData()) {
          zoomControl.applyZoom();
      }
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
      restoreImageEnhancement(); // Restore brightness/contrast/gain settings
    },
    currentFftSize,
    currentWindowType,
    isPeakModeActive(),  // peakMode (use default)
    getPeakThreshold(),  // peakThreshold (use default)
    handleColorMapChange  // onColorMapChanged callback
  );
}

function handleWindowType(type) {
  currentWindowType = type;
  const colorMap = getEffectiveColorMap();
  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      duration = getWavesurfer().getDuration();
      if (getWavesurfer().getDecodedData()) {
          zoomControl.applyZoom();
      }
      renderAxes();
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      updateSpectrogramSettingsText();
      restoreImageEnhancement(); // Restore brightness/contrast/gain settings
    },
    currentFftSize,
    currentWindowType,
    isPeakModeActive(),  // peakMode (use default)
    getPeakThreshold(),  // peakThreshold (use default)
    handleColorMapChange  // onColorMapChanged callback
  );
}

function handleOverlapChange() {
  const colorMap = getEffectiveColorMap();
  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      duration = getWavesurfer().getDuration();
      if (getWavesurfer().getDecodedData()) {
          zoomControl.applyZoom();
      }
      renderAxes();
      updateSpectrogramSettingsText();
      restoreImageEnhancement(); // Restore brightness/contrast/gain settings
    },
    undefined, // fftSamples (use default)
    undefined, // windowFunc (use default)
    isPeakModeActive(), // peakMode (use default)
    getPeakThreshold(), // peakThreshold (use default)
    handleColorMapChange // onColorMapChanged callback
  );
}

function updateFrequencyRange(freqMin, freqMax) {
  const colorMap = getEffectiveColorMap();
  currentFreqMin = freqMin;
  currentFreqMax = freqMax;

  freqHoverControl?.hideHover();
  replacePlugin(
    colorMap,
    spectrogramHeight,
    freqMin,
    freqMax,
    getOverlapPercent(),
    () => {
      freqHoverControl?.refreshHover();
      autoIdControl?.updateMarkers();
      duration = getWavesurfer().getDuration();
      if (getWavesurfer().getDecodedData()) {
          zoomControl.applyZoom();
      }
      renderAxes();
      if (freqHoverControl) {
        freqHoverControl.setFrequencyRange(currentFreqMin, currentFreqMax);
        autoIdControl?.updateMarkers();
      }
      updateSpectrogramSettingsText();
      restoreImageEnhancement(); // Restore brightness/contrast/gain settings
    },
    undefined, // fftSamples (use default)
    undefined, // windowFunc (use default)
    isPeakModeActive(), // peakMode (use default)
    getPeakThreshold(), // peakThreshold (use default)
    handleColorMapChange // onColorMapChanged callback
  );
}

const clearAllBtn = document.getElementById('clearAllBtn');
clearAllBtn.addEventListener('click', () => {
  clearFileList();
  sidebarControl.refresh('');
  replacePlugin(
    getEffectiveColorMap(),
    spectrogramHeight,
    currentFreqMin,
    currentFreqMax,
    getOverlapPercent(),
    () => {
      updateSpectrogramSettingsText();
    }
  );
  showDropOverlay();
  loadingOverlay.style.display = 'none';
  zoomControlsElem.style.display = 'none';
  guanoOutput.textContent = '(no file selected)';
  tagControl.updateTagButtonStates();
  document.dispatchEvent(new Event('file-list-cleared'));
});

const clearTrashBtn = document.getElementById('clearTrashBtn');
clearTrashBtn.addEventListener('click', () => {
  const count = getTrashFileCount();
  if (count === 0) return;

  showMessageBox({
    title: 'Message',
    message: `Confirm to clear ${count} trash flagged file(s) from the list?`,
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {
      const prevIdx = getCurrentIndex();
      const filesBefore = getFileList();
      let nextFile = null;
      if (prevIdx >= 0 && getFileIconState(prevIdx).trash) {
        for (let i = prevIdx + 1; i < filesBefore.length; i++) {
          if (!getFileIconState(i).trash) {
            nextFile = filesBefore[i];
            break;
          }
        }
        if (!nextFile) {
          for (let i = prevIdx - 1; i >= 0; i--) {
            if (!getFileIconState(i).trash) {
              nextFile = filesBefore[i];
              break;
            }
          }
        }
      }

      const removed = clearTrashFiles();
      if (removed > 0) {
        const remaining = getFileList();
        if (remaining.length === 0) {
          sidebarControl.refresh('');
          replacePlugin(
            getEffectiveColorMap(),
            spectrogramHeight,
            currentFreqMin,
            currentFreqMax,
            getOverlapPercent(),
            () => {
              updateSpectrogramSettingsText();
            },
            undefined,  // fftSamples (use default)
            undefined,  // windowFunc (use default)
            isPeakModeActive(),  // peakMode (use default)
            getPeakThreshold(),  // peakThreshold (use default)
            handleColorMapChange  // onColorMapChanged callback
          );
          showDropOverlay();
          loadingOverlay.style.display = 'none';
          zoomControlsElem.style.display = 'none';
          guanoOutput.textContent = '(no file selected)';
        } else {
          let currentName = '';
          if (nextFile) {
            currentName = nextFile.name;
          } else {
            const cur = getCurrentFile();
            currentName = cur ? cur.name : '';
          }
          sidebarControl.refresh(currentName);
          if (nextFile) {
            const idx = remaining.findIndex(f => f === nextFile);
            if (idx >= 0) {
              fileLoaderControl.loadFileAtIndex(idx);
            }
          }
        }
        tagControl.updateTagButtonStates();
        document.dispatchEvent(new Event('file-list-changed'));
      }
    }
  });
});

const settingBtn = document.getElementById('setting');
const toolBar = document.getElementById('tool-bar');

settingBtn.addEventListener('click', () => {
const isOpen = toolBar.classList.toggle('open');
document.body.classList.toggle('settings-open', isOpen);
});

initExport({ buttonId: 'exportBtn' });
initTrashProgram();
initMapPopup();
const callSummaryTableControl = initCallSummaryTable({
  onCallSelected: (index) => {
    // 當 Table Row 被點擊時，通知 FrequencyHover 高亮對應方框
    if (freqHoverControl && typeof freqHoverControl.highlightSelection === 'function') {
      freqHoverControl.highlightSelection(index);
    }
  }
});

// 初始化 Peak Control
initPeakControl({
  peakBtnId: 'peakBtn',
  onPeakModeToggled: (isActive) => {
    // 設置 Peak Mode 狀態
    setPeakMode(isActive);
    // 重新創建 Spectrogram 插件以應用 Peak Mode
    replacePlugin(
      getEffectiveColorMap(),
      spectrogramHeight,
      currentFreqMin,
      currentFreqMax,
      getOverlapPercent(),
      () => {
        zoomControl.applyZoom();
        renderAxes();
        freqHoverControl?.refreshHover();
        autoIdControl?.updateMarkers();
        updateSpectrogramSettingsText();
        restoreImageEnhancement(); // Restore brightness/contrast/gain settings
      },
      currentFftSize,
      currentWindowType,
      isActive,
      getPeakThreshold(),  // peakThreshold (use default)
      handleColorMapChange  // onColorMapChanged callback
    );
  },
  onThresholdChanged: (threshold) => {
    // 設置 Peak Threshold 並重新渲染
    setPeakThreshold(threshold);
    replacePlugin(
      getEffectiveColorMap(),
      spectrogramHeight,
      currentFreqMin,
      currentFreqMax,
      getOverlapPercent(),
      () => {
        zoomControl.applyZoom();
        renderAxes();
        freqHoverControl?.refreshHover();
        autoIdControl?.updateMarkers();
        updateSpectrogramSettingsText();
        restoreImageEnhancement(); // Restore brightness/contrast/gain settings
      },
      currentFftSize,
      currentWindowType,
      isPeakModeActive(),
      threshold,
      handleColorMapChange  // onColorMapChanged callback
    );
  }
});

// [NEW 2025] 初始化 Auto Detection Control
initAutoDetectionControl();

// [NEW 2025] 監聽導出請求事件 (來自 Auto Detection Toolbar 的 Export 按鈕)
document.addEventListener('request-export-calls', () => {
  if (freqHoverControl && typeof freqHoverControl.getBatCalls === 'function') {
    const calls = freqHoverControl.getBatCalls();
    
    if (calls.length === 0) {
      alert("No detected calls to export.");
      return;
    }

    console.log(`[Main] Exporting ${calls.length} calls to Excel...`);
    
    const baseName = window.__currentFileName ? window.__currentFileName.replace(/\.[^/.]+$/, "") : "bat_calls";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${baseName}_analysis_${timestamp}.xlsx`;

    exportBatCallsToXlsx(calls, filename);
    
  } else {
    console.warn('[Main] Cannot export: freqHoverControl not ready or getBatCalls not available');
  }
});

autoIdControl = initAutoIdPanel({
  spectrogramHeight,
  getDuration,
  getFreqRange: () => ({ min: currentFreqMin, max: currentFreqMax }),
  hideHover: () => freqHoverControl?.hideHover(),
  refreshHover: () => freqHoverControl?.refreshHover()
});
freqMenuControl = initFreqContextMenu({
  viewerId: 'viewer-container',
  wrapperId: 'viewer-wrapper',
  containerId: 'spectrogram-only',
  spectrogramHeight,
  getDuration,
  getFreqRange: () => ({ min: currentFreqMin, max: currentFreqMax }),
  autoId: autoIdControl
});
document.addEventListener('autoid-open', () => {
  freqHoverControl?.setPersistentLinesEnabled(false);
});
document.addEventListener('autoid-close', () => {
  freqHoverControl?.setPersistentLinesEnabled(true);
  freqMenuControl?.hide();
});
document.addEventListener('hide-spectrogram-hover', () => {
  freqHoverControl?.hideHover();
});
document.addEventListener('keydown', (e) => {
if (!e.ctrlKey) return;
if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
switch (e.key.toLowerCase()) {
case 'm':
e.preventDefault();
document.getElementById('mapBtn')?.click();
break;
case 's':
e.preventDefault();
settingBtn.click();
break;
case 'p':
e.preventDefault();
playPauseBtn.click();
break;
case 'i':
e.preventDefault();
document.getElementById('autoIdBtn')?.click();
break;
}
});
document.addEventListener('map-file-selected', (e) => {
const idx = e.detail?.index;
if (typeof idx === 'number') {
fileLoaderControl.loadFileAtIndex(idx);
}
});

expandBackBtn.addEventListener('click', async () => {
  if (expandHistory.length === 0) return;
  const wasSingle = expandHistory.length === 1;
  const prevState = expandHistory.pop();
  const prev = prevState.src;
  const prevMin = prevState.freqMin;
  const prevMax = prevState.freqMax;

  if (prev && prev.name !== undefined) {
    if (wasSingle) {
      await getWavesurfer().loadBlob(prev);
      duration = getWavesurfer().getDuration();
      currentExpandBlob = null;
      selectionExpandMode = false;
      // Restore original audio buffer length if we saved it before expansion
      if (savedAudioBufferLengthBeforeExpand !== null) {
        currentAudioBufferLength = savedAudioBufferLengthBeforeExpand;
        savedAudioBufferLengthBeforeExpand = null;
      }
      sampleRateBtn.disabled = false;
      zoomControl.setZoomLevel(0);
      renderAxes();
      freqHoverControl?.clearSelections();
      expandHistory = [];
    } else {
      currentExpandBlob = null;
      await fileLoaderControl.loadFileAtIndex(getCurrentIndex());
    }
  } else if (prev) {
    await getWavesurfer().loadBlob(prev);
    currentExpandBlob = prev;
    selectionExpandMode = true;
    zoomControl.setZoomLevel(0);
    sampleRateBtn.disabled = true;
    renderAxes();
    freqHoverControl?.clearSelections();
  }

  freqMinInput.value = formatFreqValue(prevMin);
  freqMaxInput.value = formatFreqValue(prevMax);
  updateFrequencyRange(prevMin, prevMax);

  updateExpandBackBtn();
  autoIdControl?.reset();
  updateSpectrogramSettingsText();
});

document.addEventListener('keydown', (e) => {
if (e.key === 'Backspace' && expandHistory.length > 0 &&
!(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
e.preventDefault();
expandBackBtn.click();
}
});

document.addEventListener("file-loaded", async () => {
  // [FIX - MEMORY LEAK] 在讀取新狀態前，先強制釋放上一輪可能的殘留引用
  if (currentExpandBlob) {
      // 如果不是在 expand 模式，卻有 blob 殘留，清空它
      if (!selectionExpandMode) currentExpandBlob = null;
  }
  
  const currentFile = getCurrentFile();
  duration = getWavesurfer().getDuration();
  zoomControl.setZoomLevel(0);
  playPauseBtn.classList.remove('playing', 'paused');
  progressLineElem.style.display = 'none';
  progressLineElem.style.pointerEvents = 'none';
  manualSeekTime = null;
  playPauseBtn.disabled = false;
  hideStopButton();
  updateProgressLine(0);
  lastLoadedFileName = currentFile ? currentFile.name : null;
  selectionExpandMode = false;
  sampleRateBtn.disabled = quickPresetActive ? true : false;
  fftSizeBtn.disabled = quickPresetActive ? true : false;
  expandHistory = [];
  currentExpandBlob = null;
  updateExpandBackBtn();
  autoIdControl?.reset();

  if (currentFile) {
    const wsDecodedData = getWavesurfer()?.getDecodedData();
    if (wsDecodedData) {
        currentAudioBufferLength = wsDecodedData.length;
    } else {
        currentAudioBufferLength = 0; 
    }
    updateSpectrogramSettingsText();
  }
});

document.addEventListener('file-list-cleared', () => {
selectionExpandMode = false;
  sampleRateBtn.disabled = quickPresetActive ? true : false;
  fftSizeBtn.disabled = quickPresetActive ? true : false;
expandHistory = [];
currentExpandBlob = null;
updateExpandBackBtn();
  currentAudioBufferLength = 0;
  savedAudioBufferLengthBeforeExpand = null;
  playPauseBtn.disabled = true;
  hideStopButton();
  updateSpectrogramSettingsText();
});

// 用於防抖動的 Timer
let resizeTimeout;

window.addEventListener('resize', () => {
  // 1. 即時更新座標軸 (保持視覺響應)
  if (container.clientWidth !== containerWidth) {
    containerWidth = container.clientWidth;
    renderAxes();
  }

  // 2. 防抖動重繪
  if (resizeTimeout) clearTimeout(resizeTimeout);
  
  resizeTimeout = setTimeout(() => {
    if (zoomControl) {
      zoomControl.resetZoomState();
    }
    
    if (freqHoverControl) freqHoverControl.refreshHover();
    if (autoIdControl) autoIdControl.updateMarkers();
    
    updateSpectrogramSettingsText();
  }, 30); 
});

// Warn user before closing the tab/window so they must confirm.
window.addEventListener('beforeunload', (e) => {
  // Standard way to trigger a confirmation dialog in modern browsers.
  // Browsers will typically show a generic message; custom text is ignored.
  e.preventDefault();
  e.returnValue = '';
});

// 暴露 spectrogram 設置供 Power Spectrum 使用
window.__spectrogramSettings = {
  get fftSize() { return currentFftSize; },
  get windowType() { return currentWindowType; },
  get sampleRate() { return currentSampleRate; },
  get overlap() { return currentOverlap; }
};

// 暴露當前 expand blob 和文件名供 export 模組使用
Object.defineProperty(window, '__currentExpandBlob', {
  get: () => currentExpandBlob,
  configurable: true
});

Object.defineProperty(window, '__currentFileName', {
  get: () => {
    const file = getCurrentFile();
    return file ? file.name : null;
  },
  configurable: true
});