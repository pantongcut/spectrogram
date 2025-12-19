// modules/zoomControl.js

/**
 * Zoom Control with "Center-Anchored" Visual Stretching.
 * Updated: Ensures #freq-grid also stretches/shrinks visually during zoom operations.
 */
export function initZoomControls(ws, container, duration, applyZoomCallback,
                                wrapperElement, onBeforeZoom = null,
                                onAfterZoom = null, isSelectionExpandMode = () => false,
                                onCtrlArrowUp = null) {
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const expandBtn = document.getElementById('expand-btn');

  // Internal State
  let zoomLevel = 500;
  let minZoomLevel = 250;
  let wheelTimeout = null;

  // [CSS Fix] 強制瀏覽器允許容器小於 Canvas 的原始寬度
  // 修正重點：加入 #freq-grid 讓網格層也能跟隨容器進行視覺上的拉伸縮放
function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        /* 關鍵修復：
           只針對 spectrogram 和 freq-grid 解除最小寬度限制。
           這允許它們在 JS 設定 style.width 變小時，能夠視覺上縮小。
           不碰 #viewer-wrapper，保護 Scrollbar 樣式。
        */
        #spectrogram-only,
        #freq-grid {
          min-width: 0 !important;
          max-width: none !important;
          /* 確保 Canvas 不會被當作文字行內元素，避免莫名其妙的間距 */
          display: block; 
        }

        /* 讓內部的 Canvas 永遠填滿它的容器 (#spectrogram-only div) */
        #spectrogram-only canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `;
      document.head.appendChild(style);
    }
  }
  _injectCssForSmoothing();

  function computeMaxZoomLevel() {
    const dur = duration();
    if (dur > 15000) return 1500;
    if (dur > 10000) return 2000;
    if (isSelectionExpandMode()) {
      if (dur > 0) {
        if (dur < 1000) return 15000;
        if (dur < 3000) return 3000;
      }
    }
    return 5000;
  }

  function computeMinZoomLevel() {
    // 確保 wrapper 有寬度，避免除以 0
    const visibleWidth = wrapperElement.clientWidth || 1000;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = Math.floor((visibleWidth - 2) / dur);
    }
  }

// Helper：取得父容器 (統一控制寬度的地方)
  function getViewerContainer() {
    return document.getElementById('viewer-container') || container;
  }

function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    const width = duration() * zoomLevel;
    const widthPx = `${width}px`;

    // 同步更新兩者
    container.style.width = widthPx;
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) {
      freqGrid.style.width = widthPx;
    }

    applyZoomCallback();
    if (typeof onAfterZoom === 'function') onAfterZoom();    
    updateZoomButtons();
  }

  function setZoomLevel(newZoom) {
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(newZoom, minZoomLevel), maxZoom);
    applyZoom();
  }

  function updateZoomButtons() {
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    if (zoomInBtn) zoomInBtn.disabled = zoomLevel >= maxZoom;
    if (zoomOutBtn) zoomOutBtn.disabled = zoomLevel <= minZoomLevel;
  }

  if (zoomInBtn) {
    zoomInBtn.onclick = () => {
      const maxZoom = computeMaxZoomLevel();
      if (zoomLevel < maxZoom) {
        zoomLevel = Math.min(zoomLevel + 500, maxZoom);
        applyZoom();
      }
    };
  }

  if (zoomOutBtn) {
    zoomOutBtn.onclick = () => {
      computeMinZoomLevel();
      if (zoomLevel > minZoomLevel) {
        zoomLevel = Math.max(zoomLevel - 500, minZoomLevel);
        applyZoom();
      }
    };
  }

  if (expandBtn) {
    expandBtn.onclick = () => {
      setZoomLevel(minZoomLevel);
    };
  }

  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return; 
    if (e.key === 'ArrowUp' && typeof onCtrlArrowUp === 'function') {
      const handled = onCtrlArrowUp();
      if (handled) { e.preventDefault(); return; }
    }
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); if (zoomInBtn) zoomInBtn.click(); break;
      case 'ArrowDown': e.preventDefault(); if (zoomOutBtn) zoomOutBtn.click(); break;
      case '0': e.preventDefault(); if (expandBtn) expandBtn.click(); break;
    }
  });  

  function resetZoomState() {
    if (container) container.style.width = '100%';
    computeMinZoomLevel();
    zoomLevel = minZoomLevel;
    applyZoom();
  }

// --- Wheel Zoom Logic ---
function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // 1. 計算 Pivot (維持滑鼠中心點)
    // 必須使用當前被拉伸過的實際寬度 (getBoundingClientRect)
    const currentRect = container.getBoundingClientRect();
    const currentTotalWidth = currentRect.width || 1;
    
    const viewportWidth = wrapperElement.clientWidth;
    const centerInViewport = viewportWidth / 2;
    const currentScrollLeft = wrapperElement.scrollLeft;
    const pivotRatio = (currentScrollLeft + centerInViewport) / currentTotalWidth;

    // 2. 計算新的 Zoom Level
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // 避免微小抖動
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    zoomLevel = newZoomLevel;
    
    // 3. 計算新的像素寬度
    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    const newTotalWidthPx = `${newTotalWidth}px`;
    
    // --- 核心修復開始 ---
    // 直接控制兩個元素，不依賴父容器佈局，這是最穩的
    
    // A. 設定 Spectrogram 寬度 (container 是傳入的 spectrogram-only div)
    container.style.width = newTotalWidthPx;

    // B. 設定 Freq Grid 寬度 (明確抓取 DOM)
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) {
      freqGrid.style.width = newTotalWidthPx;
    }
    // --- 核心修復結束 ---

    // 4. 同步 Scroll 位置
    const targetScroll = (newTotalWidth * pivotRatio) - centerInViewport;
    wrapperElement.scrollLeft = targetScroll;

    // 5. Debounce 重繪
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      // 呼叫 wavesurfer zoom (這會重繪 spectrogram)
      if (ws) {
        ws.zoom(zoomLevel);
        
        // 再次校正 Scroll (避免重繪後的微小位移)
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - centerInViewport;
        wrapperElement.scrollLeft = finalScroll;
      }
      
      // 呼叫外部 callback (這會重繪 freq-grid 的 canvas 解析度)
      applyZoomCallback();
      
      // 保險起見：重繪後再次強制確保 style.width 正確
      container.style.width = `${duration() * zoomLevel}px`;
      if (freqGrid) {
         freqGrid.style.width = `${duration() * zoomLevel}px`;
      }

      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
    }, 500); 
  }

  if (wrapperElement) {
    wrapperElement.addEventListener('wheel', handleWheelZoom, { passive: false });
  }

  return {
    applyZoom,
    updateZoomButtons,
    getZoomLevel: () => zoomLevel,
    setZoomLevel,
    resetZoomState,
  };
}