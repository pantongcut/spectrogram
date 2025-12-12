// modules/zoomControl.js

/**
 * Zoom Control using "Time-Anchor" Strategy.
 * This guarantees the mouse stays over the exact same audio timestamp during zoom.
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
  
  // Inject CSS for smooth visual stretching (Hardware Acceleration)
  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        #spectrogram-only canvas {
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

  function computeMaxZoomLevel() {
    const dur = duration();
    // Safety caps based on file length
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
   * Official Zoom Execution (Heavy)
   */
  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    // Sync container size
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

  // --- Button Handlers ---
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
   * Handle Mouse Wheel with "Time-Anchor" logic.
   * This is the most accurate way to keep the mouse centered.
   */
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    const dur = duration();

    // --- 1. Capture the Anchor (The Time under the mouse) ---
    const rect = wrapperElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left; // Mouse pixel position in Viewport
    const currentScroll = wrapperElement.scrollLeft;
    
    // Math: AbsolutePixel / PixelsPerSecond = Seconds
    // This represents the exact second in the audio the user is pointing at.
    const mouseTime = (currentScroll + mouseX) / zoomLevel;

    // --- 2. Calculate New Zoom ---
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); // Smooth factor
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // Stop if no significant change
    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    zoomLevel = newZoomLevel;

    // --- 3. Update Visuals (CSS Only - No Redraw yet) ---
    // Calculate new total width in pixels
    const newTotalWidth = dur * zoomLevel;
    
    // Apply width immediately to the container
    container.style.width = `${newTotalWidth}px`;

    // --- 4. Restore the Anchor (Centering) ---
    // We want 'mouseTime' to still be at 'mouseX' position in the viewport.
    // NewScroll + MouseX = mouseTime * newZoomLevel
    // NewScroll = (mouseTime * newZoomLevel) - MouseX
    const newScroll = (mouseTime * zoomLevel) - mouseX;
    
    wrapperElement.scrollLeft = newScroll;

    // --- 5. Debounce the Heavy Redraw ---
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      // Finalize the zoom with WaveSurfer (Heavy WASM operation)
      if (ws) {
        ws.zoom(zoomLevel);
        // Re-enforce scroll after WS redraws (as WS might clamp/reset it)
        wrapperElement.scrollLeft = newScroll;
      }
      
      applyZoomCallback();
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 30);
  }

  if (wrapperElement) {
    // 'passive: false' is required to prevent default browser zooming
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