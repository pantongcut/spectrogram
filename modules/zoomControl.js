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
    const visibleWidth = (wrapperElement && wrapperElement.clientWidth) ? wrapperElement.clientWidth : 1000;
    const dur = duration();
    if (dur > 0) {
      // 最低 zoom 會是讓整段剛好填滿視窗的值
      const candidate = Math.floor((visibleWidth - 2) / dur);
      minZoomLevel = Math.max(1, candidate); // 防止 0 或負值
    } else {
      minZoomLevel = 1;
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

  // --- Wheel Zoom Logic (Smart Wait-For-Ready) ---
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    // 保存舊的 zoomLevel（變更前）
    const oldZoom = zoomLevel;
    const oldTotalWidth = duration() * oldZoom;

    // 取得視窗寬度與目前捲動位置
    const viewportWidth = wrapperElement.clientWidth || 800;
    const currentScrollLeft = wrapperElement.scrollLeft || 0;

    // ============================================================
    // 1. [錨點計算] 使用「時間 (秒)」作為絕對錨點
    //    並 clamp 到舊的總寬度範圍內，避免超出邊界
    // ============================================================
    let centerPx = currentScrollLeft + (viewportWidth / 2);
    // 防呆：限制 centerPx 在可用寬度範圍 [0, oldTotalWidth]
    if (centerPx < 0) centerPx = 0;
    if (centerPx > oldTotalWidth) centerPx = oldTotalWidth;

    const centerTime = (oldZoom > 0) ? (centerPx / oldZoom) : 0;

    // ============================================================
    // 2. 計算新的 Zoom Level（但不要馬上覆寫 oldZoom 邏輯）
    // ============================================================
    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // 避免無意義的計算
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // 先用 newZoomLevel 計算 newTotalWidth，但暫不立刻覆寫 zoomLevel（等 debounced 時再設定）
    const newTotalWidth = duration() * newZoomLevel;

    // ============================================================
    // 3. 設定新的寬度 (讓瀏覽器做視覺拉伸)
    // ============================================================
    const newTotalWidthPx = `${newTotalWidth}px`;
    _injectShadowDomStyles();

    // 暫時關閉平滑滾動，避免動畫導致位置計算錯誤
    const originalScrollBehavior = wrapperElement.style.scrollBehavior;
    wrapperElement.style.scrollBehavior = 'auto';

    // 設定 DOM 寬度（視覺拉伸）
    container.style.width = newTotalWidthPx;
    const freqGrid = document.getElementById('freq-grid');
    if (freqGrid) freqGrid.style.width = newTotalWidthPx;

    // ============================================================
    // 4. [智能捲動] 計算目標 scrollLeft，並在 DOM 準備好後應用
    // ============================================================
    // 目標中心的像素（新的 zoom 下）
    const targetCenterPx = centerTime * newZoomLevel;
    let targetScrollLeft = targetCenterPx - (viewportWidth / 2);

    // 計算可允許的最大 scrollLeft（保護邊界）
    const maxScrollLeft = Math.max(0, newTotalWidth - viewportWidth);

    // clamp
    if (targetScrollLeft < 0) targetScrollLeft = 0;
    if (targetScrollLeft > maxScrollLeft) targetScrollLeft = maxScrollLeft;

    // 如果使用者本來是在極限（very start / very end），保留這個極端意圖
    const atLeftEdge = currentScrollLeft <= 1;
    const atRightEdge = currentScrollLeft >= Math.max(0, oldTotalWidth - viewportWidth - 1);
    if (atLeftEdge) targetScrollLeft = 0;
    if (atRightEdge) targetScrollLeft = maxScrollLeft;

    // 定義一個檢查函數，確認 wrapperElement.scrollWidth 已更新到接近 newTotalWidth
    let attempts = 0;
    function applyScrollWhenReady() {
        const currentScrollWidth = wrapperElement.scrollWidth || (container ? container.offsetWidth : 0);

        // 判斷是否準備好：scrollWidth 必須能容納目標位置
        const ready = (currentScrollWidth >= newTotalWidth - 2) || (currentScrollWidth >= targetScrollLeft + viewportWidth);

        if (ready) {
            // 設定捲動（確保 clamp）
            const finalLeft = Math.max(0, Math.min(targetScrollLeft, Math.max(0, (wrapperElement.scrollWidth - viewportWidth))));
            wrapperElement.scrollLeft = finalLeft;
            // 恢復 scroll behavior
            wrapperElement.style.scrollBehavior = originalScrollBehavior || '';
        } else {
            attempts++;
            if (attempts < 30) { // 最多試 30 幀 (~500ms)
                requestAnimationFrame(applyScrollWhenReady);
            } else {
                // 超時仍未準備好 -> 強制設定一次（但也 clamp）
                const finalLeft = Math.max(0, Math.min(targetScrollLeft, Math.max(0, (wrapperElement.scrollWidth - viewportWidth))));
                wrapperElement.scrollLeft = finalLeft;
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
      // 當真正要重繪時，才把全域 zoomLevel 更新為 newZoomLevel
      zoomLevel = newZoomLevel;

      if (ws) {
        // 觸發 wavesurfer 的 zoom（重繪）
        ws.zoom(zoomLevel);
      }
      
      // 重繪後做最後一次精確校正（以防微小誤差）
      const finalCenterPx = centerTime * zoomLevel;
      const finalScrollLeft = Math.max(0, Math.min(finalCenterPx - (viewportWidth / 2),
                                Math.max(0, (duration() * zoomLevel) - viewportWidth)));
      wrapperElement.scrollLeft = finalScrollLeft;

      applyZoomCallback();

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
