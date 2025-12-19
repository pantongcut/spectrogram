// modules/zoomControl.js

/**
 * Zoom Control with Mouse-Anchored Center Stretching
 * 修正：以滑鼠位置為錨點，先視覺拉伸再重繪
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
  let isZooming = false; // 追蹤是否正在 zoom

  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #spectrogram-only,
        #freq-grid {
          min-width: 0 !important;
          max-width: none !important;
          display: block;
          transition: none; /* 移除過渡動畫 */
        }

        #spectrogram-only *, 
        #spectrogram-only > div, 
        #spectrogram-only > wave { 
          width: 100% !important;
          min-width: 0 !important;
          max-width: none !important;
          box-sizing: border-box !important;
        }

        #spectrogram-only canvas,
        #freq-grid {
          width: 100% !important;
          height: 100% !important;
          image-rendering: auto; 
          transform-origin: 0 0;
        }

        /* Zoom 過程中的視覺拉伸效果 */
        .zoom-stretching #spectrogram-only,
        .zoom-stretching #freq-grid {
          transition: transform 0.1s ease-out;
        }
      `;
      document.head.appendChild(style);
    }
  }
  _injectCssForSmoothing();

  function _injectShadowDomStyles() {
    const host = container.firstElementChild || container.querySelector('div');
    
    if (host && host.shadowRoot) {
      if (host.shadowRoot.getElementById('force-shrink-style')) return;

      const style = document.createElement('style');
      style.id = 'force-shrink-style';
      style.textContent = `
        .wrapper {
          width: 100% !important;
          min-width: 0 !important;
          max-width: none !important;
        }
        
        .scroll {
          width: 100% !important;
        }

        canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `;
      host.shadowRoot.appendChild(style);
    } else {
      setTimeout(_injectShadowDomStyles, 100);
    }
  }

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
    const visibleWidth = wrapperElement.clientWidth || 1000;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = Math.floor((visibleWidth - 2) / dur);
    }
  }

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
    
    _injectShadowDomStyles();

    const width = duration() * zoomLevel;
    const widthPx = `${width}px`;

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

  // --- Wheel Zoom Logic with Mouse-Anchored Center ---
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    // ============================================================
    // 1. 計算錨點：使用滑鼠在 viewport 中的位置
    // ============================================================
    const viewportWidth = wrapperElement.clientWidth;
    const currentScrollLeft = wrapperElement.scrollLeft;
    
    // 滑鼠相對於 viewport 的位置
    const rect = wrapperElement.getBoundingClientRect();
    const mouseXInViewport = e.clientX - rect.left;
    
    // 計算滑鼠指向的時間點（秒）
    const mouseXInContent = currentScrollLeft + mouseXInViewport;
    const anchorTime = mouseXInContent / zoomLevel;

    // ============================================================
    // 2. 計算新的 Zoom Level
    // ============================================================
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    const oldZoomLevel = zoomLevel;
    zoomLevel = newZoomLevel;
    
    // ============================================================
    // 3. 立即視覺拉伸（使用 CSS transform）
    // ============================================================
    isZooming = true;
    const visualScale = newZoomLevel / oldZoomLevel;
    
    // 計算 transform-origin（滑鼠在內容中的位置百分比）
    const originPercent = (mouseXInContent / (duration() * oldZoomLevel)) * 100;
    
    container.style.transformOrigin = `${originPercent}% 0`;
    container.style.transform = `scaleX(${visualScale})`;
    
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) {
      freqGrid.style.transformOrigin = `${originPercent}% 0`;
      freqGrid.style.transform = `scaleX(${visualScale})`;
    }

    // ============================================================
    // 4. 計算目標滾動位置
    // ============================================================
    const newTotalWidth = duration() * newZoomLevel;
    const newMouseXInContent = anchorTime * newZoomLevel;
    let targetScrollLeft = newMouseXInContent - mouseXInViewport;
    
    // 邊界處理
    const maxScrollLeft = Math.max(0, newTotalWidth - viewportWidth);
    targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, maxScrollLeft));

    // 暫時關閉平滑滾動
    const originalScrollBehavior = wrapperElement.style.scrollBehavior;
    wrapperElement.style.scrollBehavior = 'auto';

    // ============================================================
    // 5. 設定新寬度並等待 DOM 更新
    // ============================================================
    _injectShadowDomStyles();
    
    const newTotalWidthPx = `${newTotalWidth}px`;
    container.style.width = newTotalWidthPx;
    if (freqGrid) freqGrid.style.width = newTotalWidthPx;

    // 智能等待 DOM 更新後再滾動
    let attempts = 0;
    function applyScrollWhenReady() {
      const currentScrollWidth = wrapperElement.scrollWidth;
      const isReady = currentScrollWidth >= newTotalWidth - 10 || 
                      currentScrollWidth > targetScrollLeft + viewportWidth;

      if (isReady) {
        wrapperElement.scrollLeft = targetScrollLeft;
        wrapperElement.style.scrollBehavior = originalScrollBehavior || '';
      } else {
        attempts++;
        if (attempts < 10) {
          requestAnimationFrame(applyScrollWhenReady);
        } else {
          wrapperElement.scrollLeft = targetScrollLeft;
          wrapperElement.style.scrollBehavior = originalScrollBehavior || '';
        }
      }
    }

    applyScrollWhenReady();

    // ============================================================
    // 6. Debounce 重繪（移除視覺拉伸，用真實內容替換）
    // ============================================================
    if (wheelTimeout) clearTimeout(wheelTimeout);

    wheelTimeout = setTimeout(() => {
      // 移除 transform，準備重繪
      container.style.transform = '';
      container.style.transformOrigin = '';
      if (freqGrid) {
        freqGrid.style.transform = '';
        freqGrid.style.transformOrigin = '';
      }

      // 重繪 spectrogram
      if (ws && typeof ws.zoom === 'function') {
        ws.zoom(zoomLevel);
      }
      
      applyZoomCallback();
      
      // 重繪後精確校正滾動位置
      const finalNewMouseXInContent = anchorTime * zoomLevel;
      const finalScrollLeft = finalNewMouseXInContent - mouseXInViewport;
      const finalMaxScrollLeft = Math.max(0, duration() * zoomLevel - viewportWidth);
      wrapperElement.scrollLeft = Math.max(0, Math.min(finalScrollLeft, finalMaxScrollLeft));

      // 確保寬度正確
      const finalPx = `${duration() * zoomLevel}px`;
      container.style.width = finalPx;
      if (freqGrid) freqGrid.style.width = finalPx;

      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
      isZooming = false;
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