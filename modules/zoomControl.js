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
        /* 1. 允許被壓扁/拉長 (解除剛性限制) */
        #spectrogram-only, 
        #spectrogram-only canvas,
        #viewer-container,
        #freq-grid {
          min-width: 0 !important;
          max-width: none !important;
        }

        /* 2. 僅針對 spectrogram 內部的 canvas 強制 100% (因為它是 container 的子元素) */
        #spectrogram-only canvas {
          width: 100% !important;
          height: 100% !important;
          image-rendering: auto; 
          transform-origin: 0 0;
        }
        
        /* 3. freq-grid 必須由 JS 控制寬度，或者設為 absolute 跟隨內容。
           這裡確保它不會模糊，但不強制 width: 100% !important，以免擋住 JS 修改 */
        #freq-grid {
          image-rendering: auto; 
          transform-origin: 0 0;
          /* 確保它是左對齊 */
          display: block; 
        }

        #${wrapperElement.id || 'viewer-wrapper'} {
          scroll-behavior: auto !important;
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

function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    // 計算新的像素寬度
    const width = duration() * zoomLevel;
    const widthPx = `${width}px`;

    // 1. 設定 Container (spectrogram-only) 寬度
    container.style.width = widthPx;

    // 2. [新增] 同步設定 Freq Grid 寬度
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
    
    const viewportWidth = wrapperElement.clientWidth;
    const centerInViewport = viewportWidth / 2;
    const currentScrollLeft = wrapperElement.scrollLeft;
    // 使用 getBoundingClientRect 確保拿到當前視覺寬度
    const currentTotalWidth = container.getBoundingClientRect().width || 1;
    
    const pivotRatio = (currentScrollLeft + centerInViewport) / currentTotalWidth;

    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    zoomLevel = newZoomLevel;
    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    const newTotalWidthPx = `${newTotalWidth}px`;
    
    // 1. 視覺拉伸 Spectrogram Container
    container.style.width = newTotalWidthPx;

    // 2. [新增] 視覺拉伸 Freq Grid (讓網格線跟著變寬/變窄)
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) {
      freqGrid.style.width = newTotalWidthPx;
    }

    // Update Scroll
    const targetScroll = (newTotalWidth * pivotRatio) - centerInViewport;
    wrapperElement.scrollLeft = targetScroll;

    // Debounce Redraw
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      if (ws) {
        ws.zoom(zoomLevel);
        // 重繪後的校正
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - centerInViewport;
        wrapperElement.scrollLeft = finalScroll;
      }
      
      // 注意：這裡通常會呼叫 drawGrid 之類的函數重繪 Canvas 內容
      // 確保重繪時將 canvas.width 屬性 (解析度) 也更新，而不只是 style.width
      applyZoomCallback();
      
      // [新增] 確保重繪後 Grid 的 style.width 還是正確的 (雖然後面 applyZoom 會處理，但雙重保險)
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