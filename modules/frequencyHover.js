import { getTimeExpansionMode } from './fileState.js';
import { getWavesurfer, getPlugin, getOrCreateWasmEngine, getAnalysisWasmEngine } from './wsManager.js';
import { showCallAnalysisPopup, calculateSpectrumWithOverlap, findPeakFrequency } from './callAnalysisPopup.js';
import { defaultDetector } from './batCallDetector.js';

// ============================================================
// 全局 Call Analysis 窗口狀態管理
// ============================================================
// 存儲所有打開的 Call Analysis popup 及其關聯的 selection
const openCallAnalysisPopups = new Map();  // Map<popupElement, {selection, selectionContextMenu}>

// 添加或更新 popup 狀態
function registerCallAnalysisPopup(popupElement, selection) {
  openCallAnalysisPopups.set(popupElement, { selection });
}

// 移除 popup 狀態並啟用相關的 Call analysis 菜單項
function unregisterCallAnalysisPopup(popupElement) {
  const data = openCallAnalysisPopups.get(popupElement);
  if (data && data.selection) {
    // 啟用該 selection 的 Call analysis 菜單項
    enableCallAnalysisMenuItem(data.selection);
  }
  openCallAnalysisPopups.delete(popupElement);
}

// 檢查該 selection 是否已有打開的 popup
function hasOpenPopup(selection) {
  for (const [popup, data] of openCallAnalysisPopups) {
    if (data.selection === selection) {
      return true;
    }
  }
  return false;
}

// 禁用指定 selection 的 Call analysis 菜單項
function disableCallAnalysisMenuItem(selection) {
  if (selection && selection._callAnalysisMenuItem) {
    selection._callAnalysisMenuItem.classList.add('disabled');
    selection._callAnalysisMenuItem.style.opacity = '0.5';
    selection._callAnalysisMenuItem.style.pointerEvents = 'none';
  }
}

// 啟用指定 selection 的 Call analysis 菜單項
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
  // Inject CSS for hover theme switching (only once)
  if (!document.getElementById('hover-theme-style')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'hover-theme-style';
    styleEl.textContent = `
      :root {
        /* Default (Dark Mode) Variables */
        --hover-color: #ffffff;
        --selection-border: #ffffff;
        --selection-bg: rgba(255, 255, 255, 0.03);
        --selection-bg-hover: rgba(255, 255, 255, 0.1);
        --btn-group-bg: rgba(255, 255, 255, 0.3);
        --btn-group-color: #333;
      }
      
      #viewer-wrapper.theme-light {
        /* Light Mode Variables */
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

  // 監聽 main.js 觸發的強制解除 hover 狀態事件
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

  // 右上角 selection time info 元素
  const selectionTimeInfo = document.getElementById('selection-time-info');

  function showSelectionTimeInfo(startMs, endMs) {
    const timeExp = getTimeExpansionMode();
    const s = Math.min(startMs, endMs);
    const e = Math.max(startMs, endMs);
    const d = e - s;
    // startMs/endMs are in ms (internal). In Time Expansion mode we display
    // time values divided by 10.
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
    viewer.appendChild(selectionRect);

    const moveEv = type === 'touch' ? 'touchmove' : 'mousemove';
    const upEv = type === 'touch' ? 'touchend' : 'mouseup';

    // Ctrl-key state while drawing
    let ctrlPressed = false;
    // track current selection duration (ms) while drawing so we can
    // suppress Ctrl icon and auto-expand for very short selections
    let currentSelectionDurationMs = 0;
    // Create ctrl icon element and keyboard handlers; visibility controlled below
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
        // only show icon when selection duration is >= 100ms
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
    // Attach keyboard listeners while drawing so icon responds even without mouse move
    window.addEventListener('keydown', keyDownHandler);
    window.addEventListener('keyup', keyUpHandler);

    const moveHandler = (ev) => {
      if (!isDrawing) return;
      const viewerRect = viewer.getBoundingClientRect();
      const cx = type === 'touch' ? ev.touches[0].clientX : ev.clientX;
      const cy = type === 'touch' ? ev.touches[0].clientY : ev.clientY;
      let currentX = cx - viewerRect.left + viewer.scrollLeft;
      let currentY = cy - viewerRect.top;
      currentX = clamp(currentX, 0, viewer.scrollWidth);
      currentY = clamp(currentY, 0, viewer.clientHeight - getScrollbarThickness());
      const x = Math.min(currentX, startX);
      const width = Math.abs(currentX - startX);
      // 計算時間
      const actualWidth = getDuration() * getZoomLevel();
      const startTimeMs = (startX / actualWidth) * getDuration() * 1000;
      const endTimeMs = (currentX / actualWidth) * getDuration() * 1000;
      currentSelectionDurationMs = Math.abs(endTimeMs - startTimeMs);
      showSelectionTimeInfo(startTimeMs, endTimeMs);
      // 畫框
      const y = Math.min(currentY, startY);
      const height = Math.abs(currentY - startY);
      selectionRect.style.left = `${x}px`;
      selectionRect.style.top = `${y}px`;
      selectionRect.style.width = `${width}px`;
      selectionRect.style.height = `${height}px`;

      // Update ctrl icon visibility depending on current ctrl state (mouse event or keyboard)
      const evtCtrl = type === 'touch' ? false : !!(ev.ctrlKey);
      // Only show ctrl icon for selections that are at least 100ms
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

      const rect = selectionRect.getBoundingClientRect();
      const viewerRect = viewer.getBoundingClientRect();
      const left = rect.left - viewerRect.left + viewer.scrollLeft;
      const top = rect.top - viewerRect.top;
      const width = rect.width;
      const height = rect.height;
      const minThreshold = 3;
      if (width <= minThreshold || height <= minThreshold) {
        viewer.removeChild(selectionRect);
        // cleanup keyboard handlers added during drawing
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
      const actualWidth = getDuration() * getZoomLevel();
      const startTime = (left / actualWidth) * getDuration();
      const endTime = ((left + width) / actualWidth) * getDuration();
      const Duration = endTime - startTime;
      const newSel = createTooltip(left, top, width, height, Fhigh, Flow, Bandwidth, Duration, selectionRect, startTime, endTime);
      selectionRect = null;
      suppressHover = false;
      // 建立 selection area 後，直接設為 hoveredSelection
      hoveredSelection = newSel;

      if (lastClientX !== null && lastClientY !== null) {
        const box = newSel.rect.getBoundingClientRect();
        if (lastClientX >= box.left && lastClientX <= box.right &&
            lastClientY >= box.top && lastClientY <= box.bottom) {
          hoveredSelection = newSel;
        }
      }
      // If Ctrl was pressed during selection completion, immediately trigger expand-selection
      const completedWithCtrl = ctrlPressed || (ev && ev.ctrlKey);
      // Only allow immediate Ctrl-expand for selections >= 100ms
      const selDurationMs = (newSel.data.endTime - newSel.data.startTime) * 1000;
      if (completedWithCtrl && selDurationMs >= 100) {
        // behave like clicking expand button
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
        // remove the created selection visuals (no btn group / duration)
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

  // 改為 Ctrl + 右鍵 (contextmenu) 創建/刪除 persistent line
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

      // 根據 Time Expansion 模式計算用於判斷的持續時間
      const timeExp = getTimeExpansionMode();
      const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
      
      // 只有 displayTime < 100ms 時才計算
      if (judgeDurationMs >= 100) return null;

      const sampleRate = window.__spectrogramSettings?.sampleRate || 256000;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor(endTime * sampleRate);

      if (endSample <= startSample) return null;

      const decodedData = ws.getDecodedData();
      if (!decodedData) return null;

      // 提取音頻數據
      const audioData = new Float32Array(decodedData.getChannelData(0).slice(startSample, endSample));

      const calls = await defaultDetector.detectCalls(
        audioData, 
        sampleRate, 
        Flow,      // kHz
        Fhigh,     // kHz
        { skipSNR: false } // 進行完整分析包含 SNR
      );

      if (calls && calls.length > 0) {
        // 取第一個或最顯著的 call
        const bestCall = calls[0];
        
        // 將分析結果存入 selection data
        sel.data.batCall = bestCall;
        
        // 立即更新 tooltip 顯示
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

  function createTooltip(left, top, width, height, Fhigh, Flow, Bandwidth, Duration, rectObj, startTime, endTime) {
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
      createBtnGroup(selObj, true);  // isShortSelection = true
    } else {
      createBtnGroup(selObj, false);  // isShortSelection = false
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

    if (judgeDurationMs < 100) {
      calculateBatCallParams(selObj).catch(err => {
        console.error('計算詳細參數失敗:', err);
      });
    }

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
        if (document.body.contains(popupElement)) {
          popupElement.remove();
        }
      }
      sel.powerSpectrumPopup = null;
    }

    const index = selections.indexOf(sel);
    if (index !== -1) {
      viewer.removeChild(selections[index].rect);
      if (selections[index].tooltip) viewer.removeChild(selections[index].tooltip);
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
    tooltip.style.left = `${left + width + 10}px`;
    tooltip.style.top = `${top}px`;
    const timeExp = getTimeExpansionMode();
    const freqMul = timeExp ? 10 : 1;
    const timeDiv = timeExp ? 10 : 1;
    const dispFhigh = Fhigh * freqMul;
    const dispFlow = Flow * freqMul;
    const dispBandwidth = Bandwidth * freqMul;
    const dispDurationMs = (Duration * 1000) / timeDiv;
    
    tooltip.innerHTML = `
      <table class="freq-tooltip-table">
        <tr>
          <td class="label">Freq.High:</td>
          <td class="value"><span class="fhigh">${dispFhigh.toFixed(1)}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Freq.Low:</td>
          <td class="value"><span class="flow">${dispFlow.toFixed(1)}</span> kHz</td>
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
          <td class="value"><span class="bandwidth">${dispBandwidth.toFixed(1)}</span> kHz</td>
        </tr>
        <tr>
          <td class="label">Duration:</td>
          <td class="value"><span class="duration">${dispDurationMs.toFixed(1)}</span> ms</td>
        </tr>
      </table>
      <div class="tooltip-close-btn">×</div>
    `;
    tooltip.addEventListener('mouseenter', () => { isOverTooltip = true; suppressHover = true; hideAll(); });
    tooltip.addEventListener('mouseleave', () => { isOverTooltip = false; suppressHover = false; });
    tooltip.querySelector('.tooltip-close-btn').addEventListener('click', () => {
      removeSelection(sel);
      isOverTooltip = false;
      suppressHover = false;
    });
    viewer.appendChild(tooltip);
    enableDrag(tooltip);
    requestAnimationFrame(() => repositionTooltip(sel, left, top, width));
    return tooltip;
  }

  function createBtnGroup(sel, isShortSelection = false) {
    const group = document.createElement('div');
    group.className = 'selection-btn-group';

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
    const tooltip = sel.tooltip;
    const tooltipWidth = tooltip.offsetWidth;
    const viewerLeft = viewer.scrollLeft || 0;
    const viewerRight = viewerLeft + viewer.clientWidth;

    let tooltipLeft = left + width + 10;
    if (tooltipLeft + tooltipWidth > viewerRight) {
      tooltipLeft = left - tooltipWidth - 10;
    }

    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.style.top = `${top}px`;
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
  
        updateSelections();

        const durationMs = (sel.data.endTime - sel.data.startTime) * 1000;
        const timeExp = getTimeExpansionMode();
        const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
        
        if (judgeDurationMs < 100) {
          calculateBatCallParams(sel).catch(err => {
            console.error('Resize 時計算詳細參數失敗:', err);
          });
        }
      };
  
      const upHandler = () => {
        resizing = false;
        isResizing = false;
        lockedHorizontal = null;
        lockedVertical = null;
        
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
        }
        
        lastPowerSpectrumUpdateTime = 0;
        
        window.removeEventListener('mousemove', moveHandler);
        window.removeEventListener('mouseup', upHandler);

        const durationMs = (sel.data.endTime - sel.data.startTime) * 1000;
        const timeExp = getTimeExpansionMode();
        const judgeDurationMs = timeExp ? (durationMs / 10) : durationMs;
        
        if (judgeDurationMs < 100) {
          if (sel.data.batCall) delete sel.data.batCall;
          calculateBatCallParams(sel).catch(err => {
            console.error('Resize 後計算參數失敗:', err);
          });
        } else {
          if (sel.data.batCall) delete sel.data.batCall;
          if (sel.data.peakFreq) delete sel.data.peakFreq;
          updateTooltipValues(sel, 0, 0, 0, 0);
        }
      };
  
      window.addEventListener('mousemove', moveHandler, { passive: true });
      window.addEventListener('mouseup', upHandler);
    });
  }
  
  function updateTooltipValues(sel, left, top, width, height) {
    const { data, tooltip } = sel;
    
    const Flow = data.Flow;
    const Fhigh = data.Fhigh;
    const Bandwidth = Fhigh - Flow;
    const Duration = (data.endTime - data.startTime);
    
    const timeExp = getTimeExpansionMode();
    const freqMul = timeExp ? 10 : 1;
    const timeDiv = timeExp ? 10 : 1;
    
    let dispFhigh = Fhigh * freqMul;
    let dispFlow = Flow * freqMul;
    let dispBandwidth = Bandwidth * freqMul;
    let dispDurationMs = (Duration * 1000) / timeDiv;
    
    let dispPeak = '-';
    let dispChar = '-';
    let dispKnee = '-';

    if (data.batCall) {
      const call = data.batCall;
      
      if (call.highFreq_kHz != null) dispFhigh = call.highFreq_kHz * freqMul;
      if (call.lowFreq_kHz != null) dispFlow = call.lowFreq_kHz * freqMul;
      if (call.bandwidth_kHz != null) dispBandwidth = call.bandwidth_kHz * freqMul;
      if (call.duration_ms != null) dispDurationMs = call.duration_ms / timeDiv;
      
      if (call.peakFreq_kHz != null) dispPeak = (call.peakFreq_kHz * freqMul).toFixed(2);
      if (call.characteristicFreq_kHz != null) dispChar = (call.characteristicFreq_kHz * freqMul).toFixed(2);
      if (call.kneeFreq_kHz != null) dispKnee = (call.kneeFreq_kHz * freqMul).toFixed(2);
    } 
    else if (data.peakFreq !== undefined) {
      dispPeak = (data.peakFreq * freqMul).toFixed(2);
    }

    if (!tooltip) {
      if (sel.durationLabel) sel.durationLabel.textContent = `${dispDurationMs.toFixed(1)} ms`;
      return;
    }
    if (sel.durationLabel) sel.durationLabel.textContent = `${dispDurationMs.toFixed(1)} ms`;

    const q = (selector) => tooltip.querySelector(selector);
    
    if (q('.fhigh')) q('.fhigh').textContent = dispFhigh.toFixed(2);
    if (q('.flow')) q('.flow').textContent = dispFlow.toFixed(2);
    if (q('.fpeak')) q('.fpeak').textContent = dispPeak;
    if (q('.fchar')) q('.fchar').textContent = dispChar;
    if (q('.fknee')) q('.fknee').textContent = dispKnee;
    if (q('.bandwidth')) q('.bandwidth').textContent = dispBandwidth.toFixed(2);
    if (q('.duration')) q('.duration').textContent = dispDurationMs.toFixed(2);
  }

  function updateSelections() {
    const actualWidth = getDuration() * getZoomLevel();
    const freqRange = maxFrequency - minFrequency;

    selections.forEach(sel => {
      const { startTime, endTime, Flow, Fhigh } = sel.data;
      const left = (startTime / getDuration()) * actualWidth;
      const width = ((endTime - startTime) / getDuration()) * actualWidth;
      const top = (1 - (Fhigh - minFrequency) / freqRange) * spectrogramHeight;
      const height = ((Fhigh - Flow) / freqRange) * spectrogramHeight;

      sel.rect.style.left = `${left}px`;
      sel.rect.style.top = `${top}px`;
      sel.rect.style.width = `${width}px`;
      sel.rect.style.height = `${height}px`;

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
          sel.tooltip = buildTooltip(sel, left, top, width);
        }
      } else {
        if (sel.tooltip) {
          viewer.removeChild(sel.tooltip);
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

      repositionTooltip(sel, left, top, width);

      updateTooltipValues(sel, left, top, width, height);
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
      viewer.removeChild(sel.rect);
      if (sel.tooltip) viewer.removeChild(sel.tooltip);
    });
    selections.length = 0;
    hoveredSelection = null;
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
      const viewerRect = viewer.getBoundingClientRect();
      const newX = e.clientX - viewerRect.left + viewer.scrollLeft - offsetX;
      const newY = e.clientY - viewerRect.top - offsetY;
      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
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
          const peakListener = (ev) => {
            try {
              const peakFreq = ev?.detail?.peakFreq;
              if (peakFreq !== null && peakFreq !== undefined) {
                selection.data.peakFreq = peakFreq;
                if (selection.tooltip && selection.tooltip.querySelector('.fpeak')) {
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
            if (selection.tooltip && selection.tooltip.querySelector('.fpeak')) {
              const freqMul = getTimeExpansionMode() ? 10 : 1;
              selection.tooltip.querySelector('.fpeak').textContent = (currentPeak * freqMul).toFixed(1);
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
  }

  return {
    updateSelections,
    clearSelections,
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