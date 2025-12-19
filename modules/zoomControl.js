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
        /* 1. 解除剛性限制，允許縮小 */
        #viewer-container,
        #spectrogram-only,
        #freq-grid,
        #spectrogram-only canvas,
        #spectrogram-only wave { /* 加入 wave 以防萬一 */
          min-width: 0 !important;
          max-width: none !important;
        }

        /* 2. 核心修正：強制所有子元素填滿父容器 (#viewer-container) */
        /* 這樣我們在 JS 只要改 viewer-container 的寬度，下面全部都會跟著動 */
        #spectrogram-only,
        #freq-grid {
          width: 100% !important; /* 鎖定為父容器寬度，無視 inline style */
          height: 100% !important;
          display: block;
        }

        /* 3. 強制 Canvas 拉伸 (視覺變形效果) */
        #spectrogram-only canvas,
        #spectrogram-only wave,
        #freq-grid {
          width: 100% !important;
          height: 100% !important;
          image-rendering: auto; 
          transform-origin: 0 0;
        }

        /* 4. 確保 wrapper 滾動行為正常 */
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

// Helper：取得父容器 (統一控制寬度的地方)
  function getViewerContainer() {
    return document.getElementById('viewer-container') || container;
  }

  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    // 這裡只負責數據層面的 zoom
    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    // 計算新的像素寬度
    const width = duration() * zoomLevel;
    const widthPx = `${width}px`;

    // 核心修正：直接改變父容器寬度，CSS 會讓內部所有元素自動跟隨 (100%)
    const viewerContainer = getViewerContainer();
    viewerContainer.style.width = widthPx;

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
    
    // 取得操作對象 (父容器)
    const viewerContainer = getViewerContainer();

    const viewportWidth = wrapperElement.clientWidth;
    const centerInViewport = viewportWidth / 2;
    const currentScrollLeft = wrapperElement.scrollLeft;
    
    // 使用 viewerContainer 的實際寬度來計算比例
    const currentTotalWidth = viewerContainer.getBoundingClientRect().width || 1;
    
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
    
    // 核心修正：只調整父容器寬度。
    // 因為 CSS 設定了 #spectrogram-only 和 #freq-grid 為 width: 100% !important
    // 所以它們會立刻跟著父容器縮放，不會有任何延遲或剛性限制。
    viewerContainer.style.width = newTotalWidthPx;

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
        // 校正
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - centerInViewport;
        wrapperElement.scrollLeft = finalScroll;
      }
      
      applyZoomCallback();
      
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