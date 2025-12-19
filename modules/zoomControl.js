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
        /* 1. 針對 Container 本身：解除限制 */
        #spectrogram-only,
        #freq-grid {
          min-width: 0 !important;
          max-width: none !important;
          display: block;
        }

        /* 2. 【關鍵修正】針對 Spectrogram 內部的「所有」層級：
           Wavesurfer 會生成 <wave> 或 <div> wrapper，
           我們必須強制它們全部 width: 100%，無視 inline style */
        #spectrogram-only *, 
        #spectrogram-only > div, 
        #spectrogram-only > wave { 
          width: 100% !important;
          min-width: 0 !important;
          max-width: none !important;
          box-sizing: border-box !important; /* 避免 padding 撐大 */
        }

        /* 3. 針對 Canvas：確保拉伸且不模糊 */
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
    // 1. 找到 Shadow Host (通常是 spectrogram-only 的直接子元素 div)
    const host = container.firstElementChild || container.querySelector('div');
    
    if (host && host.shadowRoot) {
      // 檢查是否已經注入過樣式，避免重複
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
      // 將樣式表「植入」到 Shadow DOM 內部
      host.shadowRoot.appendChild(style);
      console.log('Shadow DOM styles injected successfully.');
    } else {
      // 如果 Shadow DOM 還沒生成 (例如檔案剛加載)，可能需要稍後重試
      // 這裡可以設個小 timeout 或在 zoom 時再次檢查
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
    
    _injectShadowDomStyles();

    const width = duration() * zoomLevel;
    const widthPx = `${width}px`;

    // 只設定子元素
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

// --- Wheel Zoom Logic (Ratio Locking / Percentage Based) ---
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    // ============================================================
    // 1. [鎖定比例] 計算當前視窗中心點佔總長度的百分比 (0.0 ~ 1.0)
    // ============================================================
    const viewportWidth = wrapperElement.clientWidth;
    const currentScrollLeft = wrapperElement.scrollLeft;
    const currentScrollWidth = wrapperElement.scrollWidth;

    // 防止除以 0
    let centerRatio = 0;
    if (currentScrollWidth > 0) {
      // 公式：(左側捲動量 + 視窗一半) / 總滾動寬度
      centerRatio = (currentScrollLeft + (viewportWidth / 2)) / currentScrollWidth;
    }

    // ============================================================
    // 2. 計算新的 Zoom Level
    // ============================================================
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // 避免無意義的計算
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    zoomLevel = newZoomLevel;
    
    // ============================================================
    // 3. 應用寬度變更
    // ============================================================
    const newTotalWidth = duration() * zoomLevel;
    const newTotalWidthPx = `${newTotalWidth}px`;
    
    _injectShadowDomStyles();

    // 暫時關閉平滑滾動，確保瞬移
    const originalScrollBehavior = wrapperElement.style.scrollBehavior;
    wrapperElement.style.scrollBehavior = 'auto';

    // 設定 DOM 寬度
    container.style.width = newTotalWidthPx;
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) freqGrid.style.width = newTotalWidthPx;

    // ============================================================
    // 4. [暴力執行] 強制維持比例 (The Enforcer)
    // ============================================================
    // 我們不只設定一次，而是連續設定幾次，對抗瀏覽器的 Clamping 和 Shadow DOM 延遲
    
    let attemptCount = 0;
    const maxAttempts = 5; // 連續強制執行 5 次 (約 80ms)

    function enforcePosition() {
        // 重新讀取當前的實際寬度 (因為它正在變大/變小)
        const liveScrollWidth = wrapperElement.scrollWidth;
        
        // 根據剛才鎖定的 ratio，算出現在該去哪裡
        // 目標中心點像素 = 總寬度 * 比例
        const targetCenterPx = liveScrollWidth * centerRatio;
        
        // 目標 ScrollLeft = 中心點 - 視窗一半
        const targetScrollLeft = targetCenterPx - (viewportWidth / 2);

        // 強制設定
        wrapperElement.scrollLeft = targetScrollLeft;

        attemptCount++;
        if (attemptCount < maxAttempts) {
            requestAnimationFrame(enforcePosition);
        } else {
            // 結束後恢復 scroll behavior
            wrapperElement.style.scrollBehavior = originalScrollBehavior || '';
        }
    }

    // 啟動強制迴圈
    enforcePosition();

    // ============================================================
    // 5. Debounce Redraw (延遲重繪)
    // ============================================================
    if (wheelTimeout) clearTimeout(wheelTimeout);

    wheelTimeout = setTimeout(() => {
      if (ws) {
        ws.zoom(zoomLevel);
        
        // 重繪完成後，再做最後一次精確校正
        // 這是為了防止 wavesurfer 重繪後寬度有微小變化
        const finalScrollWidth = wrapperElement.scrollWidth;
        const finalTargetPx = finalScrollWidth * centerRatio;
        wrapperElement.scrollLeft = finalTargetPx - (viewportWidth / 2);
      }
      
      applyZoomCallback();
      
      // 保險：維持寬度一致
      const finalPx = `${duration() * zoomLevel}px`;
      container.style.width = finalPx;
      if (freqGrid) freqGrid.style.width = finalPx;

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