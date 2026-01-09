// modules/zoomControl.js

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
  // [重要修改] 排除 selection-rect, draggable-tooltip, selection-btn-group 以避免被強制拉伸
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
        }

        /* 排除 selection-rect, draggable-tooltip, selection-btn-group 以避免被強制拉伸 */
        #spectrogram-only > :not(.selection-rect):not(.draggable-tooltip):not(.selection-btn-group), 
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
      `;
      document.head.appendChild(style);
    }
  }
  _injectCssForSmoothing();

// [Shadow DOM Fix] 專門處理 Wavesurfer 內部的 Shadow DOM 樣式
  function _injectShadowDomStyles() {
    const host = container.firstElementChild || container.querySelector('div');
    
    if (host && host.shadowRoot) {
      if (host.shadowRoot.getElementById('force-shrink-style')) return;

      const style = document.createElement('style');
      style.id = 'force-shrink-style';
      style.textContent = `
        /* 強制 Shadow DOM 內部的 wrapper 跟隨外部寬度 */
        .wrapper {
          width: 100% !important; /* 覆寫 inline style */
          min-width: 0 !important;
          max-width: none !important;
        }
        
        .scroll {
          width: 100% !important;
        }

        /* 確保內部的 Canvas 也跟隨拉伸 */
        canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `;
      host.shadowRoot.appendChild(style);
      console.log('Shadow DOM styles injected successfully.');
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
        if (dur < 600) return 100000;
        if (dur < 1000) return 60000;
        if (dur < 3000) return 15000;
      }
    }
    return 5000;
  }

  function computeMinZoomLevel() {
    // 確保 wrapper 有寬度，避免除以 0
    const visibleWidth = wrapperElement.clientWidth || 1000;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = visibleWidth / dur;
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
    
    _injectShadowDomStyles();

    if (Math.abs(zoomLevel - minZoomLevel) < 0.01) {
        container.style.width = '100%';
        const freqGrid = document.getElementById('freq-grid');
        if (freqGrid) {
          freqGrid.style.width = '100%';
        }
    } else {
        // 否則使用像素計算寬度 (Zoom In 狀態)
        const width = duration() * zoomLevel;
        const widthPx = `${width}px`;

        container.style.width = widthPx;
        
        const freqGrid = document.getElementById('freq-grid');
        if (freqGrid) {
          freqGrid.style.width = widthPx;
        }
    }
  
    applyZoomCallback();
    if (typeof onAfterZoom === 'function') onAfterZoom();    
    updateZoomButtons();
  }
  
  // [New] 專供 Resize 拖曳期間使用：只更新數值狀態，不觸發 ws.zoom() 重繪
  // 解決 Resize 時 Spectrogram 變黑/效能問題
  function syncZoomLevelNoRender() {
    computeMinZoomLevel(); // 根據新的容器寬度重新計算 Min
    const maxZoom = computeMaxZoomLevel();
    
    // 如果之前是處於 Fit-To-Window 狀態 (zoomLevel 接近舊的 min)，
    // 或者現在 zoomLevel 比新的 min 還小，就強制貼合新的 min
    if (Math.abs(zoomLevel - minZoomLevel) < 0.1 || zoomLevel < minZoomLevel) {
      zoomLevel = minZoomLevel;
      // 在 Fit 模式下，因為 CSS 設為 100%，DOM 已經跟隨變動，無需設定 container.style.width
    } else {
      // 在 Zoom-In 模式下，雖然我們不重繪 Spectrogram (依靠拉伸)，
      // 但我們需要讓 zoomLevel 變數保持不變，這樣 Axis 繪製才會正確
      zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);
    }
    
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

// --- Wheel Zoom Logic (Smart Wait-For-Ready) ---
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    // 1. [錨點計算]
    const viewportWidth = wrapperElement.clientWidth;
    const currentScrollLeft = wrapperElement.scrollLeft;
    const centerPx = currentScrollLeft + (viewportWidth / 2);
    const centerTime = centerPx / zoomLevel;

    // 2. 計算新的 Zoom Level
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // 避免無意義的計算
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // 更新全域變數
    zoomLevel = newZoomLevel;
    
    // ============================================================
    // 3. 設定新的寬度 (鋪路)
    // [修改重點] 判斷是否為 Min Zoom，如果是則強制 100% 以消除 Scrollbar
    // ============================================================
    const isAtMin = Math.abs(zoomLevel - minZoomLevel) < 0.1; // 寬鬆判定
    
    _injectShadowDomStyles();

    // 暫時關閉平滑滾動
    const originalScrollBehavior = wrapperElement.style.scrollBehavior;
    wrapperElement.style.scrollBehavior = 'auto';

    if (isAtMin) {
        // [修正] 到達最小縮放時，強制使用 100%
        container.style.width = '100%';
        const freqGrid = document.getElementById('freq-grid');
        if (freqGrid) freqGrid.style.width = '100%';
    } else {
        // [原本邏輯] 正常縮放使用像素
        const newTotalWidth = duration() * zoomLevel;
        const newTotalWidthPx = `${newTotalWidth}px`;

        container.style.width = newTotalWidthPx;
        const freqGrid = document.getElementById('freq-grid');
        if (freqGrid) freqGrid.style.width = newTotalWidthPx;
    }

    // [上一題建議的優化] 即時更新軸線
    requestAnimationFrame(() => {
        applyZoomCallback();
    });

    // ============================================================
    // 4. [智能捲動] ... (保持不變)
    // ============================================================
    const targetCenterPx = centerTime * newZoomLevel;
    let targetScrollLeft = targetCenterPx - (viewportWidth / 2);
    targetScrollLeft = Math.max(0, targetScrollLeft);

    let attempts = 0;
    const finalWidthForReadyCheck = duration() * zoomLevel; // 用於判斷 scrollWidth 的參考值

    function applyScrollWhenReady() {
        const currentScrollWidth = wrapperElement.scrollWidth;
        
        // 判斷是否準備好 (容許誤差)
        const isReady = currentScrollWidth >= finalWidthForReadyCheck - 100 || currentScrollWidth > targetScrollLeft + viewportWidth;

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
    // 5. Debounce Redraw (延遲高畫質重繪)
    // ============================================================
    if (wheelTimeout) clearTimeout(wheelTimeout);

    wheelTimeout = setTimeout(() => {
      if (ws) {
        ws.zoom(zoomLevel);
        
        const finalCenterPx = centerTime * zoomLevel;
        wrapperElement.scrollLeft = finalCenterPx - (viewportWidth / 2);
      }
      
      applyZoomCallback();
      
      // [修改重點] 重繪後再次確認，如果是 Min Zoom 確保是 100%
      const isStillAtMin = Math.abs(zoomLevel - minZoomLevel) < 0.1;
      const freqGrid = document.getElementById('freq-grid');

      if (isStillAtMin) {
          container.style.width = '100%';
          if (freqGrid) freqGrid.style.width = '100%';
      } else {
          const finalPx = `${duration() * zoomLevel}px`;
          container.style.width = finalPx;
          if (freqGrid) freqGrid.style.width = finalPx;
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
    isAtMinZoom: () => Math.abs(zoomLevel - minZoomLevel) < 0.1, 
    setZoomLevel,
    resetZoomState,
    syncZoomLevelNoRender, // Export new function
  };
}