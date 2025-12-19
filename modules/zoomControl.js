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
    
    // 確保 Shadow DOM 樣式存在 (以防 Wavesurfer 重建了 DOM)
    _injectShadowDomStyles();

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

    // 1. [錨點計算 Step A] 在任何改變發生前，鎖定當前的中心點比例
    const viewportWidth = wrapperElement.clientWidth;
    const currentScrollLeft = wrapperElement.scrollLeft;
    
    // 使用「邏輯寬度」而非 DOM 寬度，這樣更精確，不受渲染延遲影響
    // 注意：這裡用當前的 zoomLevel
    const currentTotalWidth = duration() * zoomLevel; 
    
    // 算出中心點在整段音訊中的相對位置 (0.0 ~ 1.0)
    // 防呆：如果寬度為 0，比例設為 0
    const centerRatio = currentTotalWidth > 0 
      ? (currentScrollLeft + (viewportWidth / 2)) / currentTotalWidth
      : 0;

    // 2. 計算新的 Zoom Level
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    const delta = -e.deltaY;
    // 微調：縮放係數可以根據手感調整，1.05 代表每次滾動變大 5%
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // 避免無意義的計算
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // 更新狀態
    zoomLevel = newZoomLevel;
    
    // 3. 視覺變形 (Visual Stretch)
    const newTotalWidth = duration() * zoomLevel;
    const newTotalWidthPx = `${newTotalWidth}px`;
    
    // 確保 Shadow DOM 樣式存在 (這是上一題的關鍵解法)
    _injectShadowDomStyles();

    // 設定寬度 (Spectrogram & Grid)
    container.style.width = newTotalWidthPx;
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) {
      freqGrid.style.width = newTotalWidthPx;
    }

    // 4. [錨點計算 Step B] 立即校正 Scroll 位置
    // 根據新的總寬度，利用之前的比例 (Ratio) 推算出新的中心點，再減去視窗的一半
    const newScrollLeft = (newTotalWidth * centerRatio) - (viewportWidth / 2);
    
    // 這是瀏覽器同步行為，會立刻生效，讓使用者感覺畫面是「從中心放大」
    wrapperElement.scrollLeft = newScrollLeft;

    // 5. Debounce Redraw (延遲重繪)
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      // 呼叫 wavesurfer zoom (高解析度重繪)
      if (ws) {
        ws.zoom(zoomLevel);
        
        // [雙重保險] 重繪後，DOM 可能會有微小變動，再次校正位置以防跳動
        // 這裡必須再次計算，因為 ws.zoom() 可能會導致實際寬度與計算有些微 pixel 誤差
        const finalTotalWidth = duration() * zoomLevel;
        const finalScroll = (finalTotalWidth * centerRatio) - (viewportWidth / 2);
        wrapperElement.scrollLeft = finalScroll;
      }
      
      applyZoomCallback();
      
      // 再次確保樣式正確
      container.style.width = `${duration() * zoomLevel}px`;
      if (freqGrid) {
         freqGrid.style.width = `${duration() * zoomLevel}px`;
      }

      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
    }, 500); // 500ms 後重繪
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