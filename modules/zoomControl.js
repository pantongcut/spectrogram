// modules/zoomControl.js

/**
 * Zoom Control with "Double-Lock" Scroll Sync.
 * Ensures the spectrogram stays centered under the mouse by applying scroll 
 * corrections both synchronously and asynchronously to bypass browser clamping.
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
  let isWheelZooming = false;

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
          image-rendering: auto; 
          transform-origin: 0 0;
        }
        /* Important: Prevents browser smooth-scrolling from fighting our math */
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

  /**
   * Precise Mouse Wheel Zoom Logic
   */
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // --- 1. Calculate Pivot Point (Before Zoom) ---
    const wrapperRect = wrapperElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Position of mouse inside the viewport (0 to wrapperWidth)
    const mouseXInViewport = e.clientX - wrapperRect.left;
    
    // Calculate the mouse's relative position (0.0 to 1.0) across the ENTIRE audio
    // Formula: (CurrentScroll + MouseViewX) / CurrentTotalWidth
    const currentScrollLeft = wrapperElement.scrollLeft;
    const currentTotalWidth = containerRect.width || 1;
    const pivotRatio = (currentScrollLeft + mouseXInViewport) / currentTotalWidth;

    // --- 2. Calculate New Zoom ---
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    // --- 3. Apply Visual Changes ---
    zoomLevel = newZoomLevel;
    isWheelZooming = true;

    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    
    // Set Width
    container.style.width = `${newTotalWidth}px`;

    // [CRITICAL] Force Reflow: Read property to ensure browser accepts new width
    void container.offsetWidth; 

    // Calculate Target Scroll
    // TargetPos = (TotalWidth * Ratio) - MouseViewX
    const targetScroll = (newTotalWidth * pivotRatio) - mouseXInViewport;

    // Attempt 1: Sync set
    wrapperElement.scrollLeft = targetScroll;

    // Attempt 2: Async set (Double-Lock) to handle browser clamping lag
    requestAnimationFrame(() => {
        wrapperElement.scrollLeft = targetScroll;
        // Optional: One more check for Safari/Firefox specific rendering queues
        requestAnimationFrame(() => {
             if (Math.abs(wrapperElement.scrollLeft - targetScroll) > 5) {
                 wrapperElement.scrollLeft = targetScroll;
             }
        });
    });

    // --- 4. Debounce Heavy Rendering ---
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      isWheelZooming = false;
      
      if (ws) {
        ws.zoom(zoomLevel);
        
        // Re-calculate perfectly after WaveSurfer's internal updates
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * pivotRatio) - mouseXInViewport;
        wrapperElement.scrollLeft = finalScroll;
      }
      
      applyZoomCallback();
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 20);
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