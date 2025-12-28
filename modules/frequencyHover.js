import { getTimeExpansionMode } from './fileState.js';
import { getWavesurfer, getPlugin, getOrCreateWasmEngine, getAnalysisWasmEngine } from './wsManager.js';
import { showCallAnalysisPopup, calculateSpectrumWithOverlap, findPeakFrequency } from './callAnalysisPopup.js';
import { defaultDetector } from './batCallDetector.js';

// ============================================================
// 全局 Call Analysis 窗口狀態管理
// ============================================================
const openCallAnalysisPopups = new Map();

function registerCallAnalysisPopup(popupElement, selection) {
  openCallAnalysisPopups.set(popupElement, { selection });
}

function unregisterCallAnalysisPopup(popupElement) {
  const data = openCallAnalysisPopups.get(popupElement);
  if (data && data.selection) {
    enableCallAnalysisMenuItem(data.selection);
  }
  openCallAnalysisPopups.delete(popupElement);
}

function hasOpenPopup(selection) {
  for (const [popup, data] of openCallAnalysisPopups) {
    if (data.selection === selection) {
      return true;
    }
  }
  return false;
}

function disableCallAnalysisMenuItem(selection) {
  if (selection && selection._callAnalysisMenuItem) {
    selection._callAnalysisMenuItem.classList.add('disabled');
    selection._callAnalysisMenuItem.style.opacity = '0.5';
    selection._callAnalysisMenuItem.style.pointerEvents = 'none';
  }
}

function enableCallAnalysisMenuItem(selection) {
  if (selection && selection._callAnalysisMenuItem) {
    selection._callAnalysisMenuItem.classList.remove('disabled');
    selection._callAnalysisMenuItem.style.opacity = '1';
    selection._callAnalysisMenuItem.style.pointerEvents = 'auto';
  }
}

export function initFrequencyHover({
  viewerId,
  wrapperId = 'viewer-wrapper',
  hoverLineId,
  hoverLineVId,
  freqLabelId,
  spectrogramHeight = 800,
  spectrogramWidth = 1024,
  maxFrequency = 128,
  minFrequency = 10,
  totalDuration = 1000,
  getZoomLevel,
  getDuration
}) {
  if (!document.getElementById('hover-theme-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'hover-theme-style';
    styleEl.textContent = `
      :root {
        --hover-color: #ffffff;
        --selection-border: #ffffff;
        --selection-bg: rgba(255, 255, 255, 0.03);
        --selection-bg-hover: rgba(255, 255, 255, 0.1);
        --btn-group-bg: rgba(255, 255, 255, 0.3);
        --btn-group-color: #333;
      }
      #viewer-wrapper.theme-light {
        --hover-color: #000000;
        --selection-border: #000000;
        --selection-bg: rgba(0, 0, 0, 0.05);
        --selection-bg-hover: rgba(0, 0, 0, 0.1);
        --btn-group-bg: rgba(0, 0, 0, 0.7);
        --btn-group-color: #000;
      }
      #hover-line-vertical, #hover-line {
        border-color: var(--hover-color);
        background-color: var(--hover-color);
      }
      .selection-rect {
        border-color: var(--selection-border);
        background-color: var(--selection-bg);
        transition: background-color 0.1s ease;
      }
      .selection-rect:hover {
        background-color: var(--selection-bg-hover) !important;
      }
      .selection-btn-group {
        background-color: var(--btn-group-bg) !important;
        color: var(--btn-group-color);
      }
    `;
    document.head.appendChild(styleEl);
  }

  const viewer = document.getElementById(viewerId);
  const wrapper = document.getElementById(wrapperId);
  const hoverLine = document.getElementById(hoverLineId);
  const hoverLineV = document.getElementById(hoverLineVId);
  const freqLabel = document.getElementById(freqLabelId);
  const fixedOverlay = document.getElementById('fixed-overlay');
  const zoomControls = document.getElementById('zoom-controls');
  const container = document.getElementById('spectrogram-only');
  const persistentLines = [];
  const selections = [];
  let hoveredSelection = null;
  let persistentLinesEnabled = true;
  let disablePersistentLinesForScrollbar = false;
  const defaultScrollbarThickness = 10;
  const getScrollbarThickness = () =>
    container.scrollWidth > viewer.clientWidth ? 0 : defaultScrollbarThickness;
  const edgeThreshold = 5;
  
  let suppressHover = false;
  let isOverTooltip = false;
  let isResizing = false;
  let isDrawing = false;
  let isOverBtnGroup = false;
  let startX = 0, startY = 0;
  let selectionRect = null;
  let lastClientX = null, lastClientY = null;
  let isCursorInside = false;
  let lastTapTime = 0;
  let tapTimer = null;
  const doubleTapDelay = 300;

  viewer.addEventListener('force-hover-enable', () => {
    suppressHover = false;
    isOverBtnGroup = false;
  });

  const hideAll = () => {
    hoverLine.style.display = 'none';
    hoverLineV.style.display = 'none';
    freqLabel.style.display = 'none';
  };

  const updateHoverDisplay = (e) => {
    isCursorInside = true;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (suppressHover || isResizing || isOverBtnGroup) {
      hideAll();
      return;
    }
    
    const rect = viewer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const threshold = getScrollbarThickness();
    if (y > (viewer.clientHeight - threshold)) {
      hideAll();
      viewer.classList.remove('hide-cursor');
      disablePersistentLinesForScrollbar = true;
      return;
    }
    disablePersistentLinesForScrollbar = false;
    viewer.classList.add('hide-cursor');

    const scrollLeft = viewer.scrollLeft || 0;
    const freq = (1 - y / spectrogramHeight) * (maxFrequency - minFrequency) + minFrequency;
    const actualWidth = container.scrollWidth;
    const time = ((x + scrollLeft) / actualWidth) * getDuration();

    hoverLine.style.top = `${y}px`;
    hoverLine.style.display = 'block';

    hoverLineV.style.left = `${x}px`;
    hoverLineV.style.display = 'block';

    const viewerWidth = viewer.clientWidth;
    const labelOffset = 12;
    let labelLeft;

    if ((viewerWidth - x) < 120) {
      freqLabel.style.transform = 'translate(-100%, -50%)';
      labelLeft = `${x - labelOffset}px`;
    } else {
      freqLabel.style.transform = 'translate(0, -50%)';
      labelLeft = `${x + labelOffset}px`;
    }

    freqLabel.style.top = `${y}px`;
    freqLabel.style.left = labelLeft;
    freqLabel.style.display = 'block';
    const timeExp = getTimeExpansionMode();
    const displayFreq = timeExp ? (freq * 10) : freq;
    const displayTimeMs = timeExp ? (time * 1000 / 10) : (time * 1000);
    const freqText = Number(displayFreq.toFixed(1)).toString();
    freqLabel.textContent = `${freqText} kHz  ${displayTimeMs.toFixed(1)} ms`;
  };

  viewer.addEventListener('mousemove', updateHoverDisplay, { passive: true });
  wrapper.addEventListener('mouseleave', () => { isCursorInside = false; hideAll(); });
  viewer.addEventListener('mouseenter', () => { viewer.classList.add('hide-cursor'); isCursorInside = true; });
  viewer.addEventListener('mouseleave', () => { viewer.classList.remove('hide-cursor'); isCursorInside = false; });

  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  if (zoomControls) {
    zoomControls.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
    zoomControls.addEventListener('mouseleave', () => { suppressHover = false; });
  }

  const selectionTimeInfo = document.getElementById('selection-time-info');

  function showSelectionTimeInfo(startMs, endMs) {
    const timeExp = getTimeExpansionMode();
    const s = Math.min(startMs, endMs);
    const e = Math.max(startMs, endMs);
    const d = e - s;
    const displayS = timeExp ? (s / 10) : s;
    const displayE = timeExp ? (e / 10) : e;
    const displayD = timeExp ? (d / 10) : d;
    selectionTimeInfo.textContent = `Selection time: ${displayS.toFixed(1)} - ${displayE.toFixed(1)} (${displayD.toFixed(1)}ms)`;
    selectionTimeInfo.style.display = '';
  }
  function hideSelectionTimeInfo() {
    selectionTimeInfo.style.display = 'none';
  }

  function startSelection(clientX, clientY, type) {
    const rect = viewer.getBoundingClientRect();
    startX = clientX - rect.left + viewer.scrollLeft;
    startY = clientY - rect.top;
    if (startY > (viewer.clientHeight - getScrollbarThickness())) return;
    isDrawing = true;
    suppressHover = true;
    hideAll();
    selectionRect = document.createElement('div');
    selectionRect.className = 'selection-rect';
    // [修改 2] 將 selectionRect 加入 container (spectrogram-only) 而不是 viewer
    // 這樣 container 被拉寬時，它也會跟著動
    container.appendChild(selectionRect);

    const moveEv = type === 'touch' ? 'touchmove' : 'mousemove';
    const upEv = type === 'touch' ? 'touchend' : 'mouseup';

    let ctrlPressed = false;
    let currentSelectionDurationMs = 0;
    const ctrlIcon = document.createElement('i');
    ctrlIcon.className = 'fa-solid fa-magnifying-glass selection-ctrl-icon';
    ctrlIcon.style.position = 'absolute';
    ctrlIcon.style.left = '50%';
    ctrlIcon.style.top = '50%';
    ctrlIcon.style.transform = 'translate(-50%, -50%)';
    ctrlIcon.style.pointerEvents = 'none';
    ctrlIcon.style.display = 'none';
    selectionRect.appendChild(ctrlIcon);

    const keyDownHandler = (ev) => {
      if (ev.key === 'Control') {
        ctrlPressed = true;
        if (currentSelectionDurationMs >= 100) {
          ctrlIcon.style.display = '';
        }
      }
    };
    const keyUpHandler = (ev) => {
      if (ev.key === 'Control') {
        ctrlPressed = false;
        ctrlIcon.style.display = 'none';
      }
    };
    window.addEventListener('keydown', keyDownHandler);
    window.addEventListener('keyup', keyUpHandler);

    const moveHandler = (ev) => {
      if (!isDrawing) return;
      const viewerRect = viewer.getBoundingClientRect();
      const cx = type === 'touch' ? ev.touches[0].clientX : ev.clientX;
      const cy = type === 'touch' ? ev.touches[0].clientY : ev.clientY;
      let currentX = cx - viewerRect.left + viewer.scrollLeft;
      let currentY = cy - viewerRect.top;
      // 限制範圍，使用 container 寬度
      currentX = clamp(currentX, 0, container.scrollWidth);
      currentY = clamp(currentY, 0, viewer.clientHeight - getScrollbarThickness());
      const x = Math.min(currentX, startX);
      const width = Math.abs(currentX - startX);
      
      const actualWidth = getDuration() * getZoomLevel();
      const startTimeMs = (startX / actualWidth) * getDuration() * 1000;
      const endTimeMs = (currentX / actualWidth) * getDuration() * 1000;
      currentSelectionDurationMs = Math.abs(endTimeMs - startTimeMs);
      showSelectionTimeInfo(startTimeMs, endTimeMs);
      
      const y = Math.min(currentY, startY);
      const height = Math.abs(currentY - startY);
      selectionRect.style.left = `${x}px`;
      selectionRect.style.top = `${y}px`;
      selectionRect.style.width = `${width}px`;
      selectionRect.style.height = `${height}px`;

      const evtCtrl = type === 'touch' ? false : !!(ev.ctrlKey);
      if ((evtCtrl || ctrlPressed) && currentSelectionDurationMs >= 100) {
        ctrlIcon.style.display = '';
      } else {
        ctrlIcon.style.display = 'none';
      }
    };

    const upHandler = (ev) => {
      if (!isDrawing) return;
      isDrawing = false;
      window.removeEventListener(moveEv, moveHandler);
      window.removeEventListener(upEv, upHandler);
      window.removeEventListener('keydown', keyDownHandler);
      window.removeEventListener('keyup', keyUpHandler);
      hideSelectionTimeInfo();

      // 取得最終的 left/width (px) 相對於 container
      // 注意：此時 selectionRect 已經在 container 內，offsetLeft 即為相對於 content 的 X
      const left = selectionRect.offsetLeft; 
      const top = selectionRect.offsetTop;
      const width = selectionRect.offsetWidth;
      const height = selectionRect.offsetHeight;
      
      const minThreshold = 3;
      if (width <= minThreshold || height <= minThreshold) {
        // [修改] 從 container 移除
        container.removeChild(selectionRect);
        window.removeEventListener('keydown', keyDownHandler);
        window.removeEventListener('keyup', keyUpHandler);
        selectionRect = null;
        suppressHover = false;
        if (type === 'touch') {
          const cx = ev.changedTouches ? ev.changedTouches[0].clientX : ev.clientX;
          const cy = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
          updateHoverDisplay({ clientX: cx, clientY: cy });
        } else {
          updateHoverDisplay(ev);
        }
        return;
      }
      const Flow = (1 - (top + height) / spectrogramHeight) * (maxFrequency - minFrequency) + minFrequency;
      const Fhigh = (1 - top / spectrogramHeight) * (maxFrequency - minFrequency) + minFrequency;
      const Bandwidth = Fhigh - Flow;
      
      // 這裡計算出準確的時間 (秒)
      const actualWidth = getDuration() * getZoomLevel();
      const startTime = (left / actualWidth) * getDuration();
      const endTime = ((left + width) / actualWidth) * getDuration();
      const Duration = endTime - startTime;

      // 創建正式 Selection
      const newSel = createTooltip(left, top, width, height, Fhigh, Flow, Bandwidth, Duration, selectionRect, startTime, endTime);
      selectionRect = null;
      suppressHover = false;
      hoveredSelection = newSel;

      if (lastClientX !== null && lastClientY !== null) {
        const box = newSel.rect.getBoundingClientRect();
        if (lastClientX >= box.left && lastClientX <= box.right &&
            lastClientY >= box.top && lastClientY <= box.bottom) {
          hoveredSelection = newSel;
        }
      }
      
      const completedWithCtrl = ctrlPressed || (ev && ev.ctrlKey);
      const selDurationMs = (newSel.data.endTime - newSel.data.startTime) * 1000;
      if (completedWithCtrl && selDurationMs >= 100) {
        suppressHover = false;
        isOverBtnGroup = false;
        viewer.dispatchEvent(new CustomEvent('expand-selection', {
          detail: { startTime: newSel.data.startTime, endTime: newSel.data.endTime }
        }));
        if (lastClientX !== null && lastClientY !== null) {
          setTimeout(() => {
            updateHoverDisplay({ clientX: lastClientX, clientY: lastClientY });
          }, 0);
        }
        removeSelection(newSel);
      }
    };

    window.addEventListener(moveEv, moveHandler, { passive: type === 'touch' ? false : true });
    window.addEventListener(upEv, upHandler);
  }

  viewer.addEventListener('mousedown', (e) => {
    if (isOverTooltip || isResizing) return;
    if (e.button !== 0) return;
    startSelection(e.clientX, e.clientY, 'mouse');
  });

  viewer.addEventListener('touchstart', (e) => {
    if (isOverTooltip || isResizing) return;
    if (e.touches.length !== 1) return;
    const now = Date.now();
    if (now - lastTapTime < doubleTapDelay) {
      clearTimeout(tapTimer);
      e.preventDefault();
      startSelection(e.touches[0].clientX, e.touches[0].clientY, 'touch');
    } else {
      lastTapTime = now;
      tapTimer = setTimeout(() => { lastTapTime = 0; }, doubleTapDelay);
    }
  });

  viewer.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    if (!e.ctrlKey) return;

    if (e.target.closest('.selection-rect')) {
      return;
    }
    
    if (e.target.closest('.draggable-tooltip')) {
        return;
    }

    if (!persistentLinesEnabled || disablePersistentLinesForScrollbar || isOverTooltip) return;
    if (e.target.closest('.selection-expand-btn') || e.target.closest('.selection-fit-btn') || e.target.closest('.selection-btn-group')) return;
    
    const rect = fixedOverlay.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const freq = (1 - y / spectrogramHeight) * (maxFrequency - minFrequency) + minFrequency;
    const threshold = 1;
    const existingIndex = persistentLines.findIndex(line => Math.abs(line.freq - freq) < threshold);

    if (existingIndex !== -1) {
      fixedOverlay.removeChild(persistentLines[existingIndex].div);
      persistentLines.splice(existingIndex, 1);
    } else {
      if (persistentLines.length >= 5) return;
      const yPos = Math.round((1 - (freq - minFrequency) / (maxFrequency - minFrequency)) * spectrogramHeight);
      const line = document.createElement('div');
      line.className = 'persistent-line';
      line.style.top = `${yPos}px`;
      fixedOverlay.appendChild(line);
      persistentLines.push({ freq, div: line });
    }
  });

  // 異步計算詳細的 Bat Call 參數
async function calculateBatCallParams(sel) {
    try {
      const ws = getWavesurfer();
      if (!ws) return null;

      const { startTime, endTime, Flow, Fhigh } = sel.data;
      const durationMs = (endTime - startTime) * 1000;

      const timeExp = getTimeExpansionMode();
      const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
      
      // Limit detailed calculation to short calls (same as popup logic)
      if (judgeDurationMs >= 100) return null;

      const sampleRate = window.__spectrogramSettings?.sampleRate || 256000;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);

      if (endSample <= startSample) return null;

      const decodedData = ws.getDecodedData();
      if (!decodedData) return null;

      // Extract Raw Audio (Unfiltered)
      const rawAudioData = new Float32Array(decodedData.getChannelData(0).slice(startSample, endSample));

      // ============================================================
      // 1. 同步全局配置 (Sync Configuration)
      // 確保使用與 Call Analysis Popup 完全一致的參數
      // ============================================================
      const memory = window.__batCallControlsMemory || {};
      
      // Update detector config
      Object.assign(defaultDetector.config, {
        callThreshold_dB: memory.callThreshold_dB,
        highFreqThreshold_dB: memory.highFreqThreshold_dB,
        highFreqThreshold_dB_isAuto: memory.highFreqThreshold_dB_isAuto !== false,
        lowFreqThreshold_dB: memory.lowFreqThreshold_dB,
        lowFreqThreshold_dB_isAuto: memory.lowFreqThreshold_dB_isAuto !== false,
        characteristicFreq_percentEnd: memory.characteristicFreq_percentEnd,
        minCallDuration_ms: memory.minCallDuration_ms,
        fftSize: parseInt(memory.fftSize) || 1024,
        hopPercent: memory.hopPercent,
        windowType: window.__spectrogramSettings?.windowType || 'hann', // Sync window type
        
        // Anti-Rebounce
        enableBackwardEndFreqScan: memory.enableBackwardEndFreqScan !== false,
        maxFrequencyDropThreshold_kHz: memory.maxFrequencyDropThreshold_kHz || 10,
        protectionWindowAfterPeak_ms: memory.protectionWindowAfterPeak_ms || 10,
        
        // Highpass Filter
        enableHighpassFilter: memory.enableHighpassFilter !== false,
        highpassFilterFreq_kHz: memory.highpassFilterFreq_kHz || 40,
        highpassFilterFreq_kHz_isAuto: memory.highpassFilterFreq_kHz_isAuto !== false,
        highpassFilterOrder: memory.highpassFilterOrder || 4
      });

      // ============================================================
      // 2. 注入 WASM Engine
      // ============================================================
      const analysisWasmEngine = getAnalysisWasmEngine();
      defaultDetector.wasmEngine = analysisWasmEngine;

      // ============================================================
      // 3. 處理 Highpass Filter (Auto Mode Logic)
      // 這是數值不一致的主要原因。Popup 會先計算 Peak Freq 來決定 Filter Freq，
      // 這裡必須模仿該邏輯。
      // ============================================================
      let audioDataForDetection = rawAudioData;

      if (defaultDetector.config.enableHighpassFilter) {
        let filterFreq_kHz = defaultDetector.config.highpassFilterFreq_kHz;

        // 如果是 Auto 模式，先快速測量 Raw Audio 的 Peak Frequency
        if (defaultDetector.config.highpassFilterFreq_kHz_isAuto) {
          // 使用 measureDirectSelection 快速獲取未濾波數據的峰值
          const tempAnalysis = defaultDetector.measureDirectSelection(
            rawAudioData, 
            sampleRate, 
            Flow, 
            Fhigh
          );
          
          if (tempAnalysis && tempAnalysis.peakFreq_kHz) {
            // 使用 Detector 的計算邏輯決定 Auto Frequency
            filterFreq_kHz = defaultDetector.calculateAutoHighpassFilterFreq(tempAnalysis.peakFreq_kHz);
            
            // 重要：更新 Config 以便 detection 內部知道使用了什麼頻率
            defaultDetector.config.highpassFilterFreq_kHz = filterFreq_kHz;
          }
        }

        // 應用濾波器
        const highpassFreq_Hz = filterFreq_kHz * 1000;
        audioDataForDetection = defaultDetector.applyHighpassFilter(
          rawAudioData, 
          highpassFreq_Hz, 
          sampleRate, 
          defaultDetector.config.highpassFilterOrder
        );
      }

      // ============================================================
      // 4. 執行檢測 (Detect Calls)
      // ============================================================
      const calls = await defaultDetector.detectCalls(
        audioDataForDetection, 
        sampleRate, 
        Flow,
        Fhigh,
        { skipSNR: false } // 計算 SNR 以保持數據結構完整
      );

      if (calls && calls.length > 0) {
        // 取第一個最顯著的 Call
        const bestCall = calls[0];
        
        // 更新到 selection data
        sel.data.batCall = bestCall;
        
        // 立即更新 Tooltip 顯示
        if (sel.tooltip) {
          updateTooltipValues(sel, 0, 0, 0, 0);
        }
        return bestCall;
      }
    } catch (err) {
      console.warn('計算 Bat Call 參數時出錯:', err);
    }
    return null;
  }

function createTooltip(left, top, width, height, Fhigh, Flow, Bandwidth, Duration, rectObj, startTime, endTime, existingBatCall = null) {
    const selObj = { 
      data: { startTime, endTime, Flow, Fhigh }, 
      rect: rectObj, 
      tooltip: null, 
      expandBtn: null, 
      closeBtn: null, 
      btnGroup: null, 
      durationLabel: null,
      powerSpectrumPopup: null
    };

    const timeExp = getTimeExpansionMode();
    const durationMs = Duration * 1000;
    const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
    
    if (judgeDurationMs <= 100) {
      selObj.tooltip = buildTooltip(selObj, left, top, width);
    }

    const durationLabel = document.createElement('div');
    durationLabel.className = 'selection-duration';
    const displayDurationMs = timeExp ? (Duration * 1000 / 10) : (Duration * 1000);
    durationLabel.textContent = `${displayDurationMs.toFixed(1)} ms`;
    rectObj.appendChild(durationLabel);
    selObj.durationLabel = durationLabel;

    selections.push(selObj);

    if (judgeDurationMs <= 100) {
      createBtnGroup(selObj, true);
    } else {
      createBtnGroup(selObj, false);
    }

    enableResize(selObj);
    selObj.rect.addEventListener('mouseenter', () => { hoveredSelection = selObj; });
    selObj.rect.addEventListener('mouseleave', (e) => {
      const related = e.relatedTarget;
      const inBtnGroup = related && (related.closest && related.closest('.selection-btn-group'));
      if (hoveredSelection === selObj && !inBtnGroup) {
        hoveredSelection = null;
      }
    });
    
    selObj.rect.addEventListener('contextmenu', (e) => {
      const timeExp = getTimeExpansionMode();
      const durationMs = (selObj.data.endTime - selObj.data.startTime) * 1000;
      const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
      
      if (judgeDurationMs >= 100) {
        return;
      }
      
      if (e.target.closest('.selection-btn-group')) {
        return;
      }
      
      e.preventDefault();
      showSelectionContextMenu(e, selObj);
    });

    // [修正] 邏輯分流：如果有傳入 existingBatCall，直接使用，不重新計算
    if (existingBatCall) {
        // 情況 A: 來自 Auto Detection，直接使用黃金數據
        selObj.data.batCall = existingBatCall;
        
        // 立即更新 Tooltip 顯示
        if (selObj.tooltip) {
            updateTooltipValues(selObj, 0, 0, 0, 0);
        }
    } else if (judgeDurationMs < 100) {
        // 情況 B: 手動畫框，執行異步計算
        calculateBatCallParams(selObj).catch(err => {
            console.error('計算詳細參數失敗:', err);
        });
    }

    // [重要] 呼叫一次 updateSelections 來設定正確的 % 位置
    // 這會覆蓋掉初始狀態，確保它變成響應式
    updateSelections();

    return selObj;
  }

  function removeSelection(sel) {
    if (sel.powerSpectrumPopup) {
      const popupElement = sel.powerSpectrumPopup.popup;
      if (popupElement) {
        if (sel._popupPeakListener) {
          try {
            popupElement.removeEventListener('peakUpdated', sel._popupPeakListener);
          } catch (e) {}
          delete sel._popupPeakListener;
        }
        if (sel._batCallDetectionListener) {
          try {
            popupElement.removeEventListener('batCallDetectionCompleted', sel._batCallDetectionListener);
          } catch (e) {}
          delete sel._batCallDetectionListener;
        }
        if (popupElement && document.body.contains(popupElement)) {
          popupElement.remove();
        }
      }
      sel.powerSpectrumPopup = null;
    }

    const index = selections.indexOf(sel);
    if (index !== -1) {
      // [修改 6] 從 container 移除
      if (sel.rect.parentNode) sel.rect.parentNode.removeChild(sel.rect);
      if (sel.tooltip && sel.tooltip.parentNode) sel.tooltip.parentNode.removeChild(sel.tooltip);
      
      selections.splice(index, 1);
      if (hoveredSelection === sel) hoveredSelection = null;
    }
  }

  function buildTooltip(sel, left, top, width) {
    const { Flow, Fhigh, startTime, endTime } = sel.data;
    const Bandwidth = Fhigh - Flow;
    const Duration = (endTime - startTime);

    const tooltip = document.createElement('div');
    tooltip.className = 'draggable-tooltip freq-tooltip';
    
    container.appendChild(tooltip);
    
    // Initial State: Show dashes
    const dispStart = '-';
    const dispFhigh = '-';
    const dispFlow = '-';
    const dispBandwidth = '-';
    const dispDurationMs = '-';
    
    tooltip.innerHTML = `
      <table class="freq-tooltip-table">
        <tr>
          <td class="label">Freq.Start:</td>
          <td class="value"><span class="fstart">${dispStart}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.High:</td>
          <td class="value"><span class="fhigh">${dispFhigh}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.Low:</td>
          <td class="value"><span class="flow">${dispFlow}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.Peak:</td>
          <td class="value"><span class="fpeak">-</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.Char:</td>
          <td class="value"><span class="fchar">-</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.Knee:</td>
          <td class="value"><span class="fknee">-</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Bandwidth:</td>
          <td class="value"><span class="bandwidth">${dispBandwidth}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Duration:</td>
          <td class="value"><span class="duration">${dispDurationMs}</span> ms</td>
        </tr>
      </table>
      <div class="tooltip-close-btn">×</div>
    `;
    tooltip.addEventListener('mouseenter', () => { isOverTooltip = true; suppressHover = true; hideAll(); });
    tooltip.addEventListener('mouseleave', () => { isOverTooltip = false; suppressHover = false; });
    tooltip.querySelector('.tooltip-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();            // 防止事件冒泡
      tooltip.style.display = 'none'; // 僅隱藏 Tooltip，保留 Selection 區域
      isOverTooltip = false;          // 重置滑鼠狀態
      suppressHover = false;          // 恢復 Hover 線條顯示
    });
    enableDrag(tooltip);
    requestAnimationFrame(() => repositionTooltip(sel, left, top, width));
    return tooltip;
  }

function createBtnGroup(sel, isShortSelection = false) {
    const group = document.createElement('div');
    group.className = 'selection-btn-group';

    // 1. Close Button (現有代碼)
    const closeBtn = document.createElement('i');
    closeBtn.className = 'fa-solid fa-xmark selection-close-btn';
    closeBtn.title = 'Close selection';
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeSelection(sel);
      suppressHover = false;
      isOverBtnGroup = false;
      if (lastClientX !== null && lastClientY !== null) {
        updateHoverDisplay({ clientX: lastClientX, clientY: lastClientY });
      }
    });
    closeBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
    closeBtn.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
    closeBtn.addEventListener('mouseleave', () => { suppressHover = false; });

    group.appendChild(closeBtn);

    if (isShortSelection) {
      // 1. Toggle Tooltip Button
      const toggleTooltipBtn = document.createElement('i');
      toggleTooltipBtn.className = 'fa-regular fa-square selection-toggle-tooltip-btn';
      toggleTooltipBtn.title = 'Show/Hide Info';
      
      toggleTooltipBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (sel.tooltip) {
          // 切換顯示狀態
          if (sel.tooltip.style.display === 'none') {
            sel.tooltip.style.display = 'block';
          } else {
            sel.tooltip.style.display = 'none';
          }
        }
      });
      
      // 防止干擾 Hover 行為
      toggleTooltipBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
      toggleTooltipBtn.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
      toggleTooltipBtn.addEventListener('mouseleave', () => { suppressHover = false; });

      group.appendChild(toggleTooltipBtn);

      // 2. Call Analysis Button
      const callAnalysisBtn = document.createElement('i');
      callAnalysisBtn.className = 'fa-solid fa-info selection-call-analysis-btn';
      callAnalysisBtn.title = 'Call analysis';
      callAnalysisBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handleShowPowerSpectrum(sel);
      });
      callAnalysisBtn.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });
      callAnalysisBtn.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
      callAnalysisBtn.addEventListener('mouseleave', () => { suppressHover = false; });
      
      group.appendChild(callAnalysisBtn);
      sel.callAnalysisBtn = callAnalysisBtn;
    } else {
      const expandBtn = document.createElement('i');
      expandBtn.className = 'fa-solid fa-arrows-left-right-to-line selection-expand-btn';
      expandBtn.title = 'Crop and expand this session';
      expandBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        suppressHover = false;
        isOverBtnGroup = false;
        viewer.dispatchEvent(new CustomEvent('expand-selection', {
          detail: { startTime: sel.data.startTime, endTime: sel.data.endTime }
        }));
        if (lastClientX !== null && lastClientY !== null) {
          setTimeout(() => {
            updateHoverDisplay({ clientX: lastClientX, clientY: lastClientY });
          }, 0);
        }
      });
      expandBtn.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
      expandBtn.addEventListener('mouseleave', () => { suppressHover = false; });

      const fitBtn = document.createElement('i');
      fitBtn.className = 'fa-solid fa-up-right-and-down-left-from-center selection-fit-btn';
      fitBtn.title = 'Fit to window';
      fitBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        viewer.dispatchEvent(new CustomEvent('fit-window-selection', {
          detail: {
            startTime: sel.data.startTime,
            endTime: sel.data.endTime,
            Flow: sel.data.Flow,
            Fhigh: sel.data.Fhigh,
          }
        }));
        suppressHover = false;
        isOverBtnGroup = false;
      });
      fitBtn.addEventListener('mouseenter', () => { suppressHover = true; hideAll(); });
      fitBtn.addEventListener('mouseleave', () => { suppressHover = false; });

      group.appendChild(expandBtn);
      group.appendChild(fitBtn);
      
      sel.expandBtn = expandBtn;
      sel.fitBtn = fitBtn;
    }

    group.addEventListener('mouseenter', () => {
      isOverBtnGroup = true;
      if (lastClientX !== null && lastClientY !== null) {
        updateHoverDisplay({ clientX: lastClientX, clientY: lastClientY });
      } else {
        hideAll();
      }
      sel.rect.style.cursor = 'default';
      hoveredSelection = sel;
    });
    group.addEventListener('mouseleave', (e) => {
      isOverBtnGroup = false;
      const related = e.relatedTarget;
      const inSelectionArea = related && (related.closest && related.closest('.selection-rect'));
      const inBtnGroup = related && (related.closest && related.closest('.selection-btn-group'));
      if (!inSelectionArea && !inBtnGroup) {
        hoveredSelection = null;
      }
    });
    group.addEventListener('mousedown', (ev) => { ev.stopPropagation(); });

    sel.rect.appendChild(group);

    sel.btnGroup = group;
    sel.closeBtn = closeBtn;

    repositionBtnGroup(sel);
  }

  function repositionBtnGroup(sel) {
    if (!sel.btnGroup) return;
    const group = sel.btnGroup;
    group.style.left = '';
    group.style.right = '-35px';
    const groupRect = group.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (groupRect.right > containerRect.right) {
      group.style.right = 'auto';
      group.style.left = '-35px';
    }
  }

  function repositionTooltip(sel, left, top, width) {
    if (!sel.tooltip) return;
    // [修改] 因为 Tooltip 现在使用百分比定位，由 updateSelections 处理
    // 这个函数现在主要用于初始化时的位置设置
    // Tooltip 会自动跟随 Selection 的百分比位置，不需要额外计算
  }

  function enableResize(sel) {
    const rect = sel.rect;
    let resizing = false;
    let lockedHorizontal = null;
    let lockedVertical = null;
    let lastPowerSpectrumUpdateTime = 0;
  
    rect.addEventListener('mousemove', (e) => {
      if (isDrawing || resizing) return;
      if (isOverBtnGroup || e.target.closest('.selection-close-btn') || e.target.closest('.selection-expand-btn') || e.target.closest('.selection-fit-btn') || e.target.closest('.selection-btn-group')) {
        rect.style.cursor = 'default';
        return;
      }
  
      const rectBox = rect.getBoundingClientRect();
      const offsetX = e.clientX - rectBox.left;
      const offsetY = e.clientY - rectBox.top;
      let cursor = 'default';

      const onLeft = offsetX < edgeThreshold;
      const onRight = offsetX > rectBox.width - edgeThreshold;
      const onTop = offsetY < edgeThreshold;
      const onBottom = offsetY > rectBox.height - edgeThreshold;

      if ((onLeft && onTop) || (onRight && onBottom)) {
        cursor = 'nwse-resize';
      } else if ((onRight && onTop) || (onLeft && onBottom)) {
        cursor = 'nesw-resize';
      } else if (onLeft || onRight) {
        cursor = 'ew-resize';
      } else if (onTop || onBottom) {
        cursor = 'ns-resize';
      }

      rect.style.cursor = cursor;
    }, { passive: true });
  
    rect.addEventListener('mousedown', (e) => {
      if (resizing) return;
      if (isOverBtnGroup || e.target.closest('.selection-close-btn') || e.target.closest('.selection-expand-btn') || e.target.closest('.selection-fit-btn') || e.target.closest('.selection-btn-group')) return;
      const rectBox = rect.getBoundingClientRect();
      const offsetX = e.clientX - rectBox.left;
      const offsetY = e.clientY - rectBox.top;
  
      const onLeft = offsetX < edgeThreshold;
      const onRight = offsetX > rectBox.width - edgeThreshold;
      const onTop = offsetY < edgeThreshold;
      const onBottom = offsetY > rectBox.height - edgeThreshold;

      lockedHorizontal = onLeft ? 'left' : onRight ? 'right' : null;
      lockedVertical = onTop ? 'top' : onBottom ? 'bottom' : null;

      if (!lockedHorizontal && !lockedVertical) return;

      rect.classList.remove('auto-created');
  
      resizing = true;
      isResizing = true;
      e.preventDefault();
  
      const moveHandler = (e) => {
        if (!resizing) return;

        const viewerRect = viewer.getBoundingClientRect();
        const scrollLeft = viewer.scrollLeft || 0;
        let mouseX = e.clientX - viewerRect.left + scrollLeft;
        let mouseY = e.clientY - viewerRect.top;

        const actualWidth = getDuration() * getZoomLevel();
        const freqRange = maxFrequency - minFrequency;

        mouseX = Math.min(Math.max(mouseX, 0), actualWidth);
        mouseY = Math.min(Math.max(mouseY, 0), spectrogramHeight);

        if (lockedHorizontal === 'left') {
          let newStartTime = (mouseX / actualWidth) * getDuration();
          newStartTime = Math.min(newStartTime, sel.data.endTime - 0.001);
          sel.data.startTime = newStartTime;
        }

        if (lockedHorizontal === 'right') {
          let newEndTime = (mouseX / actualWidth) * getDuration();
          newEndTime = Math.max(newEndTime, sel.data.startTime + 0.001);
          sel.data.endTime = newEndTime;
        }

        if (lockedVertical === 'top') {
          let newFhigh = (1 - mouseY / spectrogramHeight) * freqRange + minFrequency;
          newFhigh = Math.max(newFhigh, sel.data.Flow + 0.1);
          sel.data.Fhigh = newFhigh;
        }

        if (lockedVertical === 'bottom') {
          let newFlow = (1 - mouseY / spectrogramHeight) * freqRange + minFrequency;
          newFlow = Math.min(newFlow, sel.data.Fhigh - 0.1);
          sel.data.Flow = newFlow;
        }
  
        // 2025: Clear old analysis data during resize
        if (sel.data.batCall) delete sel.data.batCall;
        if (sel.data.peakFreq) delete sel.data.peakFreq;
        
        updateSelections();
      };
  
      const upHandler = () => {
        resizing = false;
        isResizing = false;
        lockedHorizontal = null;
        lockedVertical = null;
        
        // 標記 Popup 是否處理了這次更新
        let popupHandled = false;

        // 路徑一：如果 Popup 打開，讓 Popup 負責計算
        if (sel.powerSpectrumPopup && sel.powerSpectrumPopup.isOpen()) {
          const updatePromise = sel.powerSpectrumPopup.update({
            startTime: sel.data.startTime,
            endTime: sel.data.endTime,
            Flow: sel.data.Flow,
            Fhigh: sel.data.Fhigh
          });
          
          if (updatePromise && typeof updatePromise.then === 'function') {
            updatePromise.catch(() => {});
          }
          popupHandled = true; // 標記為已處理
        }
        
        lastPowerSpectrumUpdateTime = 0;
        
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);

        // Calculate parameters only after resize ends
        const durationMs = (sel.data.endTime - sel.data.startTime) * 1000;
        const timeExp = getTimeExpansionMode();
        const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
        
        // 路徑二：只有當 Popup 沒打開 (popupHandled === false) 時，才執行背景計算
        if (judgeDurationMs < 100 && !popupHandled) { 
          if (sel.data.batCall) delete sel.data.batCall;
          calculateBatCallParams(sel).catch(err => {
            console.error('Resize 後計算參數失敗:', err);
          });
        } else {
          // 如果 Popup 已經接手處理，或是時間太長不計算，我們只更新 UI 顯示（避免舊數據殘留）
          // 注意：如果 popupHandled = true，這裡暫時不刪除 batCall，
          // 等待 Popup 的事件回調來覆蓋它，這樣視覺上比較平滑
          if (!popupHandled) {
             if (sel.data.batCall) delete sel.data.batCall;
             if (sel.data.peakFreq) delete sel.data.peakFreq;
          }
          updateTooltipValues(sel, 0, 0, 0, 0);
        }
      };
  
      window.addEventListener('mousemove', moveHandler, { passive: true });
      window.addEventListener('mouseup', upHandler);
    });
  }
  
  function updateTooltipValues(sel, left, top, width, height) {
    const { data, tooltip } = sel;
    
    // Time Expansion parameters
    const timeExp = getTimeExpansionMode();
    const freqMul = timeExp ? 10 : 1;
    const timeDiv = timeExp ? 10 : 1;
    
    // Default values
    let dispStart = '-'; // NEW
    let dispFhigh = '-';
    let dispFlow = '-';
    let dispBandwidth = '-';
    let dispDurationMs = '-';
    
    let dispPeak = '-';
    let dispChar = '-';
    let dispKnee = '-';

    // Populate with batCall data if available
    // 這裡的值現在會與 Popup 完全一致，因為計算邏輯與參數已同步
    if (data.batCall) {
      const call = data.batCall;
      
      if (call.startFreq_kHz != null) dispStart = (call.startFreq_kHz * freqMul).toFixed(2); // NEW
      if (call.highFreq_kHz != null) dispFhigh = (call.highFreq_kHz * freqMul).toFixed(2);
      if (call.lowFreq_kHz != null) dispFlow = (call.lowFreq_kHz * freqMul).toFixed(2);
      if (call.peakFreq_kHz != null) dispPeak = (call.peakFreq_kHz * freqMul).toFixed(2);
      if (call.characteristicFreq_kHz != null) dispChar = (call.characteristicFreq_kHz * freqMul).toFixed(2);
      if (call.kneeFreq_kHz != null) dispKnee = (call.kneeFreq_kHz * freqMul).toFixed(2);
      if (call.bandwidth_kHz != null) dispBandwidth = (call.bandwidth_kHz * freqMul).toFixed(2);
      if (call.duration_ms != null) dispDurationMs = (call.duration_ms / timeDiv).toFixed(2);
      
    } else if (data.peakFreq != null) {
        // Fallback if batCall detection failed but we have a raw peak
        dispPeak = (data.peakFreq * freqMul).toFixed(2);
    }

    // Update label under the selection box
    if (sel.durationLabel) {
      // Prefer precise call duration if available, otherwise geometric duration
      const geometricDurationMs = (data.endTime - data.startTime) * 1000;
      let displayMs = geometricDurationMs;
      
      // Uncomment to use detected duration on label instead of geometric
      // if (data.batCall && data.batCall.duration_ms) displayMs = data.batCall.duration_ms;
      
      const displayLabelDuration = timeExp ? (displayMs / 10) : displayMs;
      sel.durationLabel.textContent = `${displayLabelDuration.toFixed(1)} ms`;
    }

    if (!tooltip) return;

    const q = (selector) => tooltip.querySelector(selector);
    
    if (q('.fstart')) q('.fstart').textContent = dispStart; // NEW
    if (q('.fhigh')) q('.fhigh').textContent = dispFhigh;
    if (q('.flow')) q('.flow').textContent = dispFlow;
    if (q('.fpeak')) q('.fpeak').textContent = dispPeak;
    if (q('.fchar')) q('.fchar').textContent = dispChar;
    if (q('.fknee')) q('.fknee').textContent = dispKnee;
    if (q('.bandwidth')) q('.bandwidth').textContent = dispBandwidth;
    if (q('.duration')) q('.duration').textContent = dispDurationMs;
  }

  function updateSelections() {
    
    const totalDur = getDuration();
    if (totalDur <= 0) return;

    const freqRange = maxFrequency - minFrequency;

    selections.forEach(sel => {
      const { startTime, endTime, Flow, Fhigh } = sel.data;
      
      // 計算百分比 (0 ~ 100)
      const leftPct = (startTime / totalDur) * 100;
      const widthPct = ((endTime - startTime) / totalDur) * 100;
      
      // 垂直方向維持像素 (因為高度不隨 Zoom 改變)
      const top = (1 - (Fhigh - minFrequency) / freqRange) * spectrogramHeight;
      const height = ((Fhigh - Flow) / freqRange) * spectrogramHeight;

      // 應用樣式
      sel.rect.style.left = `${leftPct}%`;
      sel.rect.style.width = `${widthPct}%`; // 使用百分比寬度！
      sel.rect.style.top = `${top}px`;
      sel.rect.style.height = `${height}px`;

      // 處理 Tooltip 位置
      if (sel.tooltip) {
        // Tooltip 我們希望它跟著 Selection 右邊走
        // 我們可以使用 CSS left: %，加上一個固定的 margin-left (px)
        const tooltipLeftPct = (endTime / totalDur) * 100;
        sel.tooltip.style.left = `${tooltipLeftPct}%`;
        sel.tooltip.style.top = `${top}px`;
        // 利用 transform 或 margin 讓它稍微往右移一點，避免蓋住線
        sel.tooltip.style.marginLeft = '10px'; 
      }

      const durationMs = (endTime - startTime) * 1000;
      const timeExp = getTimeExpansionMode();
      const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
      
      const wasShortSelection = sel._isShortSelection;
      const isShortSelection = judgeDurationMs <= 100;
      
      if (isShortSelection) {
        if (!sel.btnGroup || (wasShortSelection !== isShortSelection)) {
          if (sel.btnGroup) {
            sel.rect.removeChild(sel.btnGroup);
            sel.btnGroup = null;
          }
          createBtnGroup(sel, true);
        } else {
          sel.btnGroup.style.display = '';
        }
        
        if (!sel.tooltip) {
          sel.tooltip = buildTooltip(sel, 0, top, 0);
        }
      } else {
        if (sel.tooltip && sel.tooltip.parentNode) {
          sel.tooltip.parentNode.removeChild(sel.tooltip);
          sel.tooltip = null;
        }

        if (!sel.btnGroup || (wasShortSelection !== isShortSelection)) {
          if (sel.btnGroup) {
            sel.rect.removeChild(sel.btnGroup);
            sel.btnGroup = null;
          }
          createBtnGroup(sel, false);
        } else {
          sel.btnGroup.style.display = '';
        }
      }

      sel._isShortSelection = isShortSelection;

      updateTooltipValues(sel, 0, 0, 0, 0);
      repositionBtnGroup(sel);
    });
  }

  function clearSelections() {
    selections.forEach(sel => {
      if (sel.powerSpectrumPopup) {
        const popupElement = sel.powerSpectrumPopup.popup;
        if (popupElement && sel._popupPeakListener) {
          try { popupElement.removeEventListener('peakUpdated', sel._popupPeakListener); } catch(e) {}
          delete sel._popupPeakListener;
        }
        if (popupElement && sel._batCallDetectionListener) {
          try { popupElement.removeEventListener('batCallDetectionCompleted', sel._batCallDetectionListener); } catch(e) {}
          delete sel._batCallDetectionListener;
        }
        if (popupElement && sel._popupMutationObserver) {
          try { sel._popupMutationObserver.disconnect(); } catch(e) {}
          delete sel._popupMutationObserver;
        }
        if (popupElement && document.body.contains(popupElement)) {
          popupElement.remove();
        }
        unregisterCallAnalysisPopup(popupElement);
        sel.powerSpectrumPopup = null;
      }
      // [修改] 從 container 移除而不是 viewer
      if (sel.rect.parentNode) sel.rect.parentNode.removeChild(sel.rect);
      if (sel.tooltip && sel.tooltip.parentNode) sel.tooltip.parentNode.removeChild(sel.tooltip);
    });
    selections.length = 0;
    hoveredSelection = null;
  }

  /**
   * [NEW 2025] Auto-create Selection Boxes from detected BatCall objects
   * Called by event system when bat calls are detected
   * @param {Array} calls - Array of BatCall objects from batCallDetector
   */
  function addAutoSelections(calls) {
    clearSelections();

    if (!calls || calls.length === 0) return;

    const freqRange = maxFrequency - minFrequency;

    calls.forEach(call => {

      let signalStartTime = call.startFreqTime_s;
      let signalEndTime = call.endFreqTime_s;

      // Fallback: 防呆，如果精確時間為 null，使用切片時間
      if (signalStartTime === null || signalStartTime === undefined) {
          signalStartTime = call.startTime_s;
      }
      if (signalEndTime === null || signalEndTime === undefined) {
          signalEndTime = call.endTime_s;
      }

      const startTime = Math.max(0, signalStartTime);
      const endTime = Math.min(getDuration(), signalEndTime);
      const flow = Math.max(minFrequency, call.lowFreq_kHz);
      const fhigh = Math.min(maxFrequency, call.highFreq_kHz);

      // 2. 計算垂直座標...
      const top = (1 - (fhigh - minFrequency) / freqRange) * spectrogramHeight;
      const height = ((fhigh - flow) / freqRange) * spectrogramHeight;

      const selectionRect = document.createElement('div');
      selectionRect.className = 'selection-rect auto-created';
      container.appendChild(selectionRect);

      const Bandwidth = fhigh - flow;
      const Duration = endTime - startTime;

      const selObj = createTooltip(
        0, top, 0, height, 
        fhigh, flow, Bandwidth, Duration, 
        selectionRect, startTime, endTime,
        call 
      );

      selObj.data.peakFreq = call.peakFreq_kHz;

      if (selObj.tooltip) {
        updateTooltipValues(selObj, 0, 0, 0, 0);
        selObj.tooltip.style.display = 'none';
      }
      
      console.log(`[FrequencyHover] Created auto selection: Time ${startTime.toFixed(3)}-${endTime.toFixed(3)}s`);
    });
  }


  function enableDrag(element) {
    let offsetX, offsetY, isDragging = false;
    element.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('tooltip-close-btn')) return;
      isDragging = true;
      const rect = element.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const containerRect = container.getBoundingClientRect(); // 使用 container
      
      // 計算相對於 container 的 px
      let newLeftPx = e.clientX - containerRect.left - offsetX;
      const newTopPx = e.clientY - containerRect.top - offsetY;

      // 即時轉換為 % 以保持 Zoom 相容性
      const leftPct = (newLeftPx / containerRect.width) * 100;

      element.style.left = `${leftPct}%`;
      element.style.top = `${newTopPx}px`;
      element.style.marginLeft = '0'; // 拖曳時移除預設 margin
    }, { passive: true });
    
    window.addEventListener('mouseup', () => { isDragging = false; });
  }

  function showSelectionContextMenu(e, selection) {
    const existingMenu = document.querySelector('.selection-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'selection-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const menuItem = document.createElement('div');
    menuItem.className = 'selection-context-menu-item';
    menuItem.textContent = 'Call analysis';

    selection._callAnalysisMenuItem = menuItem;

    if (hasOpenPopup(selection)) {
      disableCallAnalysisMenuItem(selection);
    }

    menuItem.addEventListener('click', () => {
      if (menuItem.classList.contains('disabled')) return;
      handleShowPowerSpectrum(selection);
      menu.remove();
    });

    menu.appendChild(menuItem);
    document.body.appendChild(menu);

    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  function handleShowPowerSpectrum(selection) {
    const ws = getWavesurfer();
    if (!ws) return;

    if (selection.tooltip) {
      selection.tooltip.style.display = 'none';
    }

    const currentSettings = {
      fftSize: window.__spectrogramSettings?.fftSize || 1024,
      windowType: window.__spectrogramSettings?.windowType || 'hann',
      sampleRate: window.__spectrogramSettings?.sampleRate || 256000,
      overlap: window.__spectrogramSettings?.overlap || 'auto'
    };

    const analysisWasmEngine = getAnalysisWasmEngine();

    const popupObj = showCallAnalysisPopup({
      selection: selection.data,
      wavesurfer: ws,
      currentSettings,
      wasmEngine: analysisWasmEngine
    });

    if (popupObj) {
      selection.powerSpectrumPopup = popupObj;
      const popupElement = popupObj.popup;

      registerCallAnalysisPopup(popupElement, selection);
      disableCallAnalysisMenuItem(selection);
      
      if (popupElement) {
        const closeBtn = popupElement && popupElement.querySelector('.popup-close-btn');
        if (closeBtn) {
          const closeHandler = () => {
            if (selection.tooltip) {
              selection.tooltip.style.display = 'block';
            }
            unregisterCallAnalysisPopup(popupElement);
          };
          closeBtn.addEventListener('click', closeHandler);
          selection._popupCloseHandler = closeHandler;
        }

        const mutationObserver = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.removedNodes.length > 0) {
              for (let node of mutation.removedNodes) {
                if (node === popupElement) {
                  unregisterCallAnalysisPopup(popupElement);
                  mutationObserver.disconnect();
                }
              }
            }
          });
        });
        mutationObserver.observe(document.body, { childList: true });
        selection._popupMutationObserver = mutationObserver;

        if (popupObj.popup && popupObj.popup.addEventListener) {
          // [NEW] Listen for batCallDetectionCompleted to sync exact values
          const batCallListener = (ev) => {
            if (ev.detail && ev.detail.call) {
              // Update selection data with the EXACT call object from popup
              selection.data.batCall = ev.detail.call;
              
              // Force update the tooltip to match popup values
              if (selection.tooltip) {
                // Pass dummy values as updateTooltipValues now prioritizes batCall data
                updateTooltipValues(selection, 0, 0, 0, 0);
              }
            }
          };
          
          popupObj.popup.addEventListener('batCallDetectionCompleted', batCallListener);
          selection._batCallDetectionListener = batCallListener;

          // Keep peak listener as backup (though batCallListener supercedes it)
          const peakListener = (ev) => {
            try {
              const peakFreq = ev?.detail?.peakFreq;
              if (peakFreq !== null && peakFreq !== undefined) {
                selection.data.peakFreq = peakFreq;
                // Only update if no batCall data (to avoid conflict)
                if (!selection.data.batCall && selection.tooltip && selection.tooltip.querySelector('.fpeak')) {
                  const freqMul = getTimeExpansionMode() ? 10 : 1;
                  selection.tooltip.querySelector('.fpeak').textContent = (peakFreq * freqMul).toFixed(1);
                }
              }
            } catch (e) {
            }
          };

          popupObj.popup.addEventListener('peakUpdated', peakListener);
          selection._popupPeakListener = peakListener;
        }

        try {
          const currentPeak = popupObj.getPeakFrequency && popupObj.getPeakFrequency();
          if (currentPeak !== null && currentPeak !== undefined) {
            selection.data.peakFreq = currentPeak;
            if (!selection.data.batCall && selection.tooltip && selection.tooltip.querySelector('.fpeak')) {
              const freqMul = getTimeExpansionMode() ? 10 : 1;
              selection.tooltip.querySelector('.fpeak').textContent = (currentPeak * freqMul).toFixed(1);
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  /**
   * [NEW 2025] 導出所有 Selection Box 對應的 Bat Call 數據
   * 用於導出到 Excel 或其他格式
   */
  function getBatCalls() {
    const sortedSelections = selections.sort((a, b) => a.data.startTime - b.data.startTime);
    return sortedSelections.map(sel => {
      if (sel.data.batCall) {
        return sel.data.batCall;
      }
      // Fallback: 從 selection 數據構建基礎 call 對象
      return {
        startTime_s: sel.data.startTime,
        endTime_s: sel.data.endTime,
        lowFreq_kHz: sel.data.Flow,
        highFreq_kHz: sel.data.Fhigh,
        peakFreq_kHz: sel.data.peakFreq || null,
        duration_ms: (sel.data.endTime - sel.data.startTime) * 1000,
        bandwidth_kHz: sel.data.Fhigh - sel.data.Flow
      };
    });
  }

  return {
    updateSelections,
    clearSelections,
    addAutoSelections,  // [NEW 2025] Export for event system
    getBatCalls,        // [NEW 2025] Export for Excel generation
    setFrequencyRange: (min, max) => {
      minFrequency = min;
      maxFrequency = max;
      updateSelections();
    },
    hideHover: hideAll,
    refreshHover: () => {
      if (lastClientX !== null && lastClientY !== null && isCursorInside) {
        updateHoverDisplay({ clientX: lastClientX, clientY: lastClientY });
      }
    },
    setPersistentLinesEnabled: (val) => { persistentLinesEnabled = val; },
    getHoveredSelection: () => (selections.includes(hoveredSelection) ? hoveredSelection : null),
    updateHoverTheme: (colorMapName) => {
      if (colorMapName === 'mono_light' || colorMapName === 'rainbow') {
        wrapper.classList.add('theme-light');
      } else {
        wrapper.classList.remove('theme-light');
      }
    }
  };
}