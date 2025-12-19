// modules/zoomControl.js

/**
 * Zoom Control Optimized for "Center-Anchored" Visual Stretching.
 * * Behavior:
 * 1. During Zoom (Ctrl+Scroll): Changes CSS width immediately causing the browser to 
 * stretch the existing canvas image. Anchors strictly to the center of the viewport.
 * 2. After Zoom: Debounces the expensive redraw (ws.zoom) to prevent lag.
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

  // [CSS] Force smooth visual scaling and remove scroll lag
  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #spectrogram-only canvas {
          width: 100% !important;
          height: 100% !important;
          /* Use linear interpolation for smoother stretching during zoom */
          image-rendering: auto; 
          transform-origin: 0 0;
        }
        /* Prevents browser smooth-scrolling from fighting our precise math */
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
    const visibleWidth = wrapperElement.clientWidth;
    const dur = duration();
    if (dur > 0) {
      minZoomLevel = Math.floor((visibleWidth - 2) / dur);
    }
  }

  // Standard Button/API Zoom (Non-Wheel)
  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    // For button clicks, we redraw immediately
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

  // Button Listeners
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

  // Keyboard Shortcuts
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
   * Precise Center-Anchored Wheel Zoom Logic
   */
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // --- 1. Calculate Pivot Point (CENTER of Viewport) ---
    // Instead of mouse position, we strictly use the visual center.
    const viewportWidth = wrapperElement.clientWidth;
    const centerInViewport = viewportWidth / 2;
    
    // Get current dimensions
    const currentScrollLeft = wrapperElement.scrollLeft;
    // Use container width or current calculated width
    const currentTotalWidth = container.getBoundingClientRect().width || 1;
    
    // Calculate the "Time Ratio" at the center of the screen (0.0 - 1.0)
    // Formula: (ScrollLeft + ViewportCenter) / TotalWidth
    const pivotRatio = (currentScrollLeft + centerInViewport) / currentTotalWidth;

    // --- 2. Calculate New Zoom Level ---
    const delta = -e.deltaY;
    // Smoother scaling factor
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // Prevent micro-updates
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // --- 3. Apply Visual Changes Immediately (Stretch Mode) ---
    zoomLevel = newZoomLevel;

    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    
    // [KEY CHANGE]: Update CSS Width. 
    // Since ws.zoom() is NOT called yet, the browser just stretches the existing canvas.
    container.style.width = `${newTotalWidth}px`;

    // --- 4. Synchronize Scroll to Maintain Center Anchor ---
    // NewScroll = (NewWidth * OldCenterRatio) - CenterOffset
    const targetScroll = (newTotalWidth * pivotRatio) - centerInViewport;

    // Apply scroll IMMEDIATELY to prevent visual jumping during the stretch
    wrapperElement.scrollLeft = targetScroll;

    // --- 5. Debounce the Heavy Redraw ---
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    // Wait until scrolling stops (e.g., 100ms) before redrawing the high-res spectrogram
    wheelTimeout = setTimeout(() => {
      
      if (ws) {
        // Now we actually redraw the spectrogram at the new resolution
        ws.zoom(zoomLevel);
        
        // Re-align perfectly one last time after the DOM update
        // (WaveSurfer might slightly adjust pixel widths during render)
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - centerInViewport;
        wrapperElement.scrollLeft = finalScroll;
      }
      
      // Update axes, grids, and UI
      applyZoomCallback();
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 100); 
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