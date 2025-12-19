// modules/zoomControl.js

/**
 * Zoom Control with "Center-Anchored" Visual Stretching.
 * Update: Fixes Zoom-Out "stuck" issue by overriding CSS min-width constraints.
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
  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      
      // 獲取傳入 container 的 ID，在您的 main.js 中這對應 'spectrogram-only'
      const containerId = container.id || 'spectrogram-only';

      style.textContent = `
        /* 1. 解除外部容器的最小寬度限制 */
        #${wrapperElement.id || 'viewer-wrapper'},
        #viewer-container {
           min-width: 0 !important;
           max-width: none !important;
        }

        /* 2. 關鍵修復：針對 WaveSurfer 的內部 Wrapper (container 的直接子層) 
           WaveSurfer 會在這裡寫死 width: xxxx px，導致 Zoom Out 時卡住。
           我們強制它使用 100% 寬度，這樣它就會聽從父層 (#spectrogram-only) 的縮放。
        */
        #${containerId} > div, 
        #${containerId} > ::shadow > div { /* 預防未來版本使用 ShadowDOM */
           width: 100% !important;
           max-width: none !important;
           min-width: 0 !important;
        }

        /* 3. 確保 Canvas 跟隨 Wrapper 縮放 */
        #${containerId}, 
        #${containerId} canvas {
          min-width: 0 !important;
          max-width: none !important;
          width: 100% !important;
          /* height 保持由外部控制，不強制設為 100%，避免某些佈局高度塌陷 */
          image-rendering: auto; 
          transform-origin: 0 0;
        }

        /* 4. 移除 Scroll 行為干擾，確保 JS 控制的 Scroll 同步順暢 */
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
    
    const width = duration() * zoomLevel;
    container.style.width = `${width}px`;

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
    
    // 1. Calculate Pivot (Center of Viewport)
    const viewportWidth = wrapperElement.clientWidth;
    const centerInViewport = viewportWidth / 2;
    const currentScrollLeft = wrapperElement.scrollLeft;
    // 使用 getBoundingClientRect 確保拿到的是當前視覺寬度
    const currentTotalWidth = container.getBoundingClientRect().width || 1;
    
    // Pivot Ratio (0.0 to 1.0)
    const pivotRatio = (currentScrollLeft + centerInViewport) / currentTotalWidth;

    // 2. Calculate New Zoom
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // 3. Apply Visual Stretch
    zoomLevel = newZoomLevel;
    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    
    // 這行會觸發 CSS 寬度變化。
    // 如果沒有上面的 min-width: 0 !important; CSS，Zoom Out 時這裡會無效。
    container.style.width = `${newTotalWidth}px`;

    // 4. Update Scroll Position (Sync)
    const targetScroll = (newTotalWidth * pivotRatio) - centerInViewport;
    wrapperElement.scrollLeft = targetScroll;

    // 5. Debounce Redraw
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    // 100ms 延遲讓視覺上有時間顯示拉伸效果
    wheelTimeout = setTimeout(() => {
      if (ws) {
        ws.zoom(zoomLevel);
        
        // Final Alignment correction
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