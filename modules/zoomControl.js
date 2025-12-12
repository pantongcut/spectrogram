// modules/zoomControl.js

/**
 * Initializes zoom controls with smooth, stepless, mouse-centered zooming.
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
  
  // Timer for Debounce (Performance optimization)
  let wheelTimeout = null;
  // Flag to indicate if we are currently manipulating CSS only
  let isWheelZooming = false;

  // [CRITICAL FIX] Inject CSS to ensure Canvas stretches visually during CSS zooming
  // This allows the "Blurry" stretch effect (GPU) instead of laggy redraws
  function _injectCssForSmoothing() {
    const styleId = 'spectrogram-smooth-zoom-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
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
   * Execute actual WaveSurfer Zoom and Redraw (Expensive operation)
   * This is called only when zooming stops or via buttons.
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
    
    // 2. Set Container Width (The scrollable content)
    const width = duration() * zoomLevel;
    container.style.width = `${width}px`;
    
    // [CRITICAL FIX] NEVER set wrapperElement width. 
    // wrapperElement is the viewport (overflow: scroll), it must remain fixed size.

    applyZoomCallback(); // Triggers Spectrogram render()
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
    // Reset widths to 100% to allow proper min-zoom calculation based on viewport
    if (container) container.style.width = '100%';
    
    computeMinZoomLevel();
    zoomLevel = minZoomLevel;
    applyZoom();
  }

  /**
   * Handle smooth mouse wheel zoom
   * Strategy: Manipulate CSS width directly for immediate feedback, then debounce redraw.
   */
  function handleWheelZoom(e) {
    // Standard UI pattern: Ctrl + Scroll = Zoom. 
    // If you want Zoom without Ctrl, remove this line.
    if (!e.ctrlKey) return; 

    e.preventDefault();

    computeMinZoomLevel();
    const maxZoom = computeMaxZoomLevel();
    
    // 1. Determine "Anchor Point" (Time under mouse)
    // We need to know EXACTLY what time in the audio the mouse is pointing at.
    const rect = wrapperElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left; // Mouse X relative to the viewport
    const currentScroll = wrapperElement.scrollLeft;
    
    // Audio Time = (Pixel Offset from Start) / PixelsPerSecond
    const mouseTime = (currentScroll + mouseX) / zoomLevel;

    // 2. Calculate New Zoom Level
    const delta = -e.deltaY;
    // Smoother scaling factor (e.g. 10% change per tick)
    const scaleFactor = 1 + (delta * 0.001); 
    
    let newZoomLevel = zoomLevel * scaleFactor;
    newZoomLevel = Math.min(Math.max(newZoomLevel, minZoomLevel), maxZoom);

    // If limits reached, do nothing
    if (newZoomLevel === zoomLevel) return;

    // 3. Apply VISUAL Scaling (CSS Only) - The "Smooth" part
    // We strictly assume the canvas inside uses width: 100% (injected by _injectCssForSmoothing)
    const dur = duration();
    const newTotalWidth = dur * newZoomLevel;
    
    // Apply width to the CONTENT container only.
    container.style.width = `${newTotalWidth}px`;

    // 4. Apply Scroll Correction (Mouse Centering)
    // We want: (NewScroll + MouseX) / NewZoom = MouseTime
    // NewScroll = (MouseTime * NewZoom) - MouseX
    const newScroll = (mouseTime * newZoomLevel) - mouseX;
    wrapperElement.scrollLeft = newScroll;

    // Update internal state
    zoomLevel = newZoomLevel;
    isWheelZooming = true;

    // 5. Debounce the Expensive Redraw
    if (wheelTimeout) {
      clearTimeout(wheelTimeout);
    }

    wheelTimeout = setTimeout(() => {
      isWheelZooming = false;
      
      // Now we perform the heavy lifting (WASM Redraw)
      if (ws) {
        ws.zoom(zoomLevel);
        // Re-apply scroll because WS might try to reset it during redraw
        wrapperElement.scrollLeft = newScroll; 
      }
      
      applyZoomCallback(); // Trigger Spectrogram render
      if (typeof onAfterZoom === 'function') onAfterZoom();
      updateZoomButtons();
      
    }, 30); // Wait 30ms after scroll stops
  }

  // Initialize wheel listener on the Wrapper (the element that has the scrollbar)
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
