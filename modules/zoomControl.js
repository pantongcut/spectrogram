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
  
  // Timer for Debounce
  let wheelTimeout = null;
  // Flag for wheel zooming status
  let isWheelZooming = false;

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
   * Execute actual WaveSurfer Zoom and Redraw (Expensive operation)
   */
  function applyZoom() {
    computeMinZoomLevel();
    if (typeof onBeforeZoom === 'function') onBeforeZoom();
    
    const maxZoom = computeMaxZoomLevel();
    zoomLevel = Math.min(Math.max(zoomLevel, minZoomLevel), maxZoom);

    // Actual render call
    if (ws && typeof ws.zoom === 'function' &&
        typeof ws.getDuration === 'function' && ws.getDuration() > 0) {
      ws.zoom(zoomLevel);
    }
    
    // Ensure container width matches zoom level
    const width = duration() * zoomLevel;
    container.style.width = `${width}px`;
    wrapperElement.style.width = `${width}px`;

    applyZoomCallback(); // Triggers Spectrogram redraw
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

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return; 

    if (e.key === 'ArrowUp' && typeof onCtrlArrowUp === 'function') {
      const handled = onCtrlArrowUp();
      if (handled) {
        e.preventDefault();
        return;
      }
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (zoomInBtn) zoomInBtn.click();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (zoomOutBtn) zoomOutBtn.click();
        break;
      case '0':
        e.preventDefault();
        if (expandBtn) expandBtn.click();
        break;
    }
  });  

  function resetZoomState() {
    if (wrapperElement) wrapperElement.style.width = '100%';
    if (container) container.style.width = '100%';
    computeMinZoomLevel();
    zoomLevel = minZoomLevel;
    applyZoom();
  }

  /**
   * Handle smooth mouse wheel zoom
   * Logic: CSS Scaling first (smooth) -> Debounced Redraw (performance)
   */
  function handleWheelZoom(e) {
    // Only trigger on Ctrl + Scroll (standard behavior)
    if (!e.ctrlKey) return; 

    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // 1. Calculate zoom factor
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (newZoomLevel === zoomLevel) return;

    // 2. Calculate mouse-centered scroll offset
    const rect = wrapperElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const currentScroll = wrapperElement.scrollLeft;
    
    // Audio time under mouse cursor
    const mouseTime = (currentScroll + mouseX) / zoomLevel;

    // 3. Apply Visual Scaling (CSS) - Critical for smooth 60fps feel
    const dur = duration();
    const newWidth = dur * newZoomLevel;
    
    container.style.width = `${newWidth}px`;
    wrapperElement.style.width = `${newWidth}px`;

    // 4. Adjust Scroll to keep mouse centered on the same audio time
    const newScroll = (mouseTime * newZoomLevel) - mouseX;
    wrapperElement.scrollLeft = newScroll;

    // Update state
    zoomLevel = newZoomLevel;
    isWheelZooming = true;

    // 5. Debounce the expensive redraw
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      isWheelZooming = false;
      
      if (ws) {
        ws.zoom(zoomLevel);
        // Re-apply scroll after WS redraws (WS might reset it)
        wrapperElement.scrollLeft = newScroll; 
      }
      
      applyZoomCallback(); // Trigger WASM/Canvas redraw
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 150); // 150ms delay
  }

  // Initialize wheel listener
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
