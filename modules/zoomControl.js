// modules/zoomControl.js

/**
 * Zoom Control with Geometric Ratio Anchoring and Layout Synchronization.
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

  // [CRITICAL] Inject CSS to ensure smooth scaling and DISABLE native smooth scrolling
  // Native smooth scrolling interferes with programmatic exact positioning.
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
        /* Force wrapper to update scroll instantly */
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
    let visibleWidth = wrapperElement.clientWidth;
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
   * Robust Mouse-Centered Zoom Logic
   */
  function handleWheelZoom(e) {
    if (!e.ctrlKey) return; 
    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // --- PHASE 1: CALCULATE ANCHOR RATIO ---
    // We use getBoundingClientRect() to get the EXACT visual width, ignoring logic errors.
    // Ratio = (Where we are in pixels) / (Total Width)
    
    const wrapperRect = wrapperElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect(); // Current actual width
    
    // Mouse X relative to the wrapper viewport
    const mouseXInWrapper = e.clientX - wrapperRect.left;
    
    // Mouse X relative to the content (Absolute X)
    const currentScroll = wrapperElement.scrollLeft;
    const mouseAbsX = currentScroll + mouseXInWrapper;
    
    // Calculate ratio (0.0 to 1.0) - "The mouse is at 45.3% of the audio"
    // Using Math.max to avoid division by zero
    const currentTotalWidth = containerRect.width || 1; 
    const anchorRatio = mouseAbsX / currentTotalWidth;

    // --- PHASE 2: CALCULATE NEW ZOOM ---
    const delta = -e.deltaY;
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    if (Math.abs(newZoomLevel - zoomLevel) < 0.01) return;

    zoomLevel = newZoomLevel;
    isWheelZooming = true;

    // --- PHASE 3: APPLY CSS & FORCE LAYOUT UPDATE ---
    const dur = duration();
    const newTotalWidth = dur * zoomLevel;
    
    // 1. Set new width
    container.style.width = `${newTotalWidth}px`;

    // 2. [CRITICAL] Force Browser Layout Reflow
    // Accessing 'scrollWidth' forces the browser to recalculate the scrollable area immediately.
    // Without this, the browser might clip the next scrollLeft assignment to the OLD width.
    const _forceLayout = wrapperElement.scrollWidth;

    // 3. Apply corrected scroll position
    // Target Absolute X = New Width * Anchor Ratio
    // Target Scroll = Target Absolute X - Mouse Position in Viewport
    const newScroll = (newTotalWidth * anchorRatio) - mouseXInWrapper;
    
    wrapperElement.scrollLeft = newScroll;

    // --- PHASE 4: DEBOUNCE REDRAW ---
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      isWheelZooming = false;
      
      if (ws) {
        ws.zoom(zoomLevel);
        
        // Re-enforce the scroll position after WS redraws the canvas
        // (WS zoom sometimes resets scroll position)
        const finalWidth = duration() * zoomLevel;
        const finalScroll = (finalWidth * anchorRatio) - mouseXInWrapper;
        
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