// modules/zoomControl.js

/**
 * Optimized Zoom Control with "Pivot Zoom" (Mouse-Centering) and CSS Scaling.
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
  
  // Timer for Debounce
  let wheelTimeout = null;
  // Flag for wheel zooming status
  let isWheelZooming = false;

  // Ensure CSS is injected for smooth scaling
  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #spectrogram-only canvas {
          width: 100% !important;
          height: 100% !important;
          image-rendering: auto; /* Bilinear interpolation for smooth stretching */
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
    let visibleWidth = wrapperElement.clientWidth;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = Math.floor((visibleWidth - 2) / dur);
    }
  }

  /**
   * Execute actual WaveSurfer Zoom and Redraw
   */
  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    // 1. Apply zoom to WaveSurfer (Triggers WASM calculation)
    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    // 2. Set Container Width
    const width = duration() * zoomLevel;
    container.style.width = `${width}px`;
    
    // Note: Do NOT change wrapperElement width.

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

  /**
   * Handle Mouse Wheel Zoom with Strict Pivoting
   */
  function handleWheelZoom(e) {
    // Only Zoom if Ctrl is pressed (Standard UX)
    if (!e.ctrlKey) return; 

    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // --- STEP 1: CALCULATE PIVOT RATIO ---
    // We need to know exactly where the mouse is relative to the TOTAL audio length.
    // 0.0 = Start of file, 1.0 = End of file.
    
    const rect = wrapperElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left; // Mouse pixel position relative to view
    const currentScroll = wrapperElement.scrollLeft;
    
    // Use getBoundingClientRect().width for sub-pixel precision of the total content width
    const currentContentWidth = container.getBoundingClientRect().width;
    
    if (currentContentWidth <= 0) return;

    // The absolute pixel position of the mouse in the whole spectrogram
    const mouseAbsX = currentScroll + mouseX;
    const pivotRatio = mouseAbsX / currentContentWidth;

    // --- STEP 2: CALCULATE NEW ZOOM ---
    const delta = -e.deltaY;
    // Zoom Speed Factor
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // --- STEP 3: APPLY VISUAL SCALING ---
    zoomLevel = newZoomLevel;
    isWheelZooming = true;

    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    
    // 1. Update CSS Width
    container.style.width = `${newTotalWidth}px`;

    // 2. [IMPORTANT] Force Browser Reflow
    // We read offsetWidth to force the browser to recalculate the layout *before* we set scroll.
    // Without this, the browser might clamp the scrollLeft to the OLD width limit.
    void container.offsetWidth; 

    // 3. Calculate and Apply New Scroll
    // We want the Pivot Ratio to remain at the same visual spot (mouseX).
    // NewAbsX = NewWidth * PivotRatio
    // NewScroll = NewAbsX - MouseX
    const newScroll = (newTotalWidth * pivotRatio) - mouseX;
    wrapperElement.scrollLeft = newScroll;

    // --- STEP 4: DEBOUNCE REDRAW ---
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      isWheelZooming = false;
      
      // Perform heavy update
      if (ws) {
        ws.zoom(zoomLevel);
        
        // Re-apply scroll logic perfectly after WS updates
        // WS might slightly adjust dimensions or scroll, so we force it back to our pivot
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - mouseX;
        
        // Use requestAnimationFrame to ensure this scroll happens after WS DOM updates
        requestAnimationFrame(() => {
            wrapperElement.scrollLeft = finalScroll;
        });
      }
      
      applyZoomCallback();
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 30);
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