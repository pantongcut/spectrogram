/**
 * Auto Detection Control Module
 * Manages Auto Bat Call Detection mode toggle and detection sensitivity
 */

let autoDetectionActive = false;
let detectionSensitivity = 0.5;  // Default: 0.5 (maps to -24dB threshold)
let peakToolBarOpen = false;

/**
 * Initialize Auto Detection Control
 * @param {Object} options - Configuration options
 * @param {string} options.peakBtnId - Auto Detect Button ID
 * @param {Function} options.onAutoDetectionToggled - Callback when detection is toggled (newState)
 * @param {Function} options.onSensitivityChanged - Callback when sensitivity changes (newSensitivity)
 */
export function initPeakControl(options = {}) {
  const {
    peakBtnId = 'peakBtn',
    onAutoDetectionToggled = () => {},
    onSensitivityChanged = () => {}
  } = options;

  const peakBtn = document.getElementById(peakBtnId);
  const peakModeToolBar = document.getElementById('peak-mode-tool-bar');
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  const peakThresholdSlider = document.getElementById('peakThresholdSlider');
  const peakThresholdVal = document.getElementById('peakThresholdVal');
  const toolBar = document.getElementById('tool-bar');

  if (!peakBtn) {
    console.warn(`[autoDetection] Button with ID "${peakBtnId}" not found`);
    return { toggle: () => {}, isActive: () => autoDetectionActive };
  }

  // Auto Detect Button click - toggle toolbar visibility
  peakBtn.addEventListener('click', () => {
    if (peakModeToolBar) {
      peakModeToolBar.classList.toggle('open');
      peakToolBarOpen = peakModeToolBar.classList.contains('open');
      updateAutoDetectionButtonUI();
    }
  });

  // Monitor toolbar open/close
  if (peakModeToolBar) {
    const observer = new MutationObserver(() => {
      peakToolBarOpen = peakModeToolBar.classList.contains('open');
      updateAutoDetectionButtonUI();
    });
    observer.observe(peakModeToolBar, { attributes: true, attributeFilter: ['class'] });
  }

  // Monitor main toolbar open/close (for positioning)
  if (toolBar) {
    const observer = new MutationObserver(() => {
      updateAutoDetectionButtonUI();
    });
    observer.observe(toolBar, { attributes: true, attributeFilter: ['class'] });
  }

  // Auto Detection Toggle event
  if (peakModeSwitch) {
    peakModeSwitch.addEventListener('change', () => {
      autoDetectionActive = peakModeSwitch.checked;
      updateAutoDetectionButtonUI();
      onAutoDetectionToggled(autoDetectionActive);
    });
  }

  // Detection Sensitivity Slider event
  // Slider range: 0.0 (Low/Strict) to 1.0 (High/Loose)
  // Maps to dB thresholds: -10dB to -60dB with default -24dB at 0.5
  if (peakThresholdSlider) {
    peakThresholdSlider.addEventListener('input', (e) => {
      detectionSensitivity = parseFloat(e.target.value);
      if (peakThresholdVal) {
        // Display as percentage for UI clarity
        peakThresholdVal.textContent = Math.round(detectionSensitivity * 100) + '%';
      }
      // Trigger debounced sensitivity change event
      onSensitivityChanged(detectionSensitivity);
    });
  }

  return {
    toggle: toggleAutoDetection,
    isActive: () => autoDetectionActive,
    getState: () => ({ autoDetectionActive, detectionSensitivity }),
    getSensitivity: () => detectionSensitivity,
    setSensitivity: (sensitivity) => {
      detectionSensitivity = sensitivity;
      if (peakThresholdSlider) peakThresholdSlider.value = sensitivity;
      if (peakThresholdVal) peakThresholdVal.textContent = Math.round(sensitivity * 100) + '%';
    }
  };
}

/**
 * Toggle Auto Detection state
 */
function toggleAutoDetection() {
  autoDetectionActive = !autoDetectionActive;
  updateAutoDetectionButtonUI();
  
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  if (peakModeSwitch) {
    peakModeSwitch.checked = autoDetectionActive;
  }
}

/**
 * Update Auto Detect Button UI state
 * Status priority:
 * 1. Red: Auto Detection active (autoDetectionActive = true)
 * 2. Blue: Toolbar open but Auto Detection inactive (peakToolBarOpen = true)
 * 3. Gray: Default state
 */
function updateAutoDetectionButtonUI() {
  const peakBtn = document.getElementById('peakBtn');
  if (!peakBtn) return;

  // Remove all state classes
  peakBtn.classList.remove('active', 'toolbar-open');
  
  if (autoDetectionActive) {
    // Status 1: Auto Detection active → Red
    peakBtn.classList.add('active');
    peakBtn.title = 'Auto Bat Call Detection (Active)';
  } else if (peakToolBarOpen) {
    // Status 2: Toolbar open, Auto Detection inactive → Blue
    peakBtn.classList.add('toolbar-open');
    peakBtn.title = 'Auto Bat Call Detection (Toolbar Open)';
  } else {
    // Status 3: Default → Gray
    peakBtn.title = 'Auto Bat Call Detection';
  }
}

/**
 * Get Auto Detection active state
 */
export function isPeakModeActive() {
  return autoDetectionActive;
}

/**
 * Set Auto Detection state
 */
export function setPeakModeActive(active) {
  autoDetectionActive = active;
  updateAutoDetectionButtonUI();
  
  const peakModeSwitch = document.getElementById('peakModeSwitch');
  if (peakModeSwitch) {
    peakModeSwitch.checked = active;
  }
}

/**
 * Get Detection Sensitivity (mapped from 0.0 to 1.0)
 */
export function getPeakThreshold() {
  return detectionSensitivity;
}

/**
 * Set Detection Sensitivity
 */
export function setPeakThreshold(sensitivity) {
  detectionSensitivity = sensitivity;
  const peakThresholdSlider = document.getElementById('peakThresholdSlider');
  const peakThresholdVal = document.getElementById('peakThresholdVal');
  
  if (peakThresholdSlider) {
    peakThresholdSlider.value = sensitivity;
  }
  if (peakThresholdVal) {
    peakThresholdVal.textContent = Math.round(sensitivity * 100) + '%';
  }
}