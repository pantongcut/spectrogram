/**
 * Call Summary Table Module
 * Handles the popup window for displaying bat call analysis results in a table format
 */

export function initCallSummaryTable({
  buttonId = 'viewTableBtn',
  popupId = 'callSummaryPopup',
  containerId = 'callSummaryTableContainer'
} = {}) {
  const btn = document.getElementById(buttonId);
  const popup = document.getElementById(popupId);
  const container = document.getElementById(containerId);
  
  if (!btn || !popup || !container) {
    console.warn('[CallSummaryTable] Missing required elements:', { btn, popup, container });
    return null;
  }

  // Window state and storage
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let popupStartX = 0;
  let popupStartY = 0;
  
  let isMaximized = false;
  let preMaximizeState = {};

  let isDocked = false; // Changed from 'isMinimized' to 'isDocked' to avoid confusion
  let preDockState = {};

  // Restore popup size from localStorage
  let popupWidth = parseInt(localStorage.getItem('callSummaryPopupWidth'), 10);
  let popupHeight = parseInt(localStorage.getItem('callSummaryPopupHeight'), 10);
  if (isNaN(popupWidth) || popupWidth <= 0) popupWidth = 1000;
  if (isNaN(popupHeight) || popupHeight <= 0) popupHeight = 300;
  
  // Apply initial style
  popup.style.width = `${popupWidth}px`;
  popup.style.height = `${popupHeight}px`;
  popup.style.position = 'absolute'; // Default to absolute

  // Get control elements
  const dragBar = popup.querySelector('.popup-drag-bar');
  const closeBtn = popup.querySelector('.popup-close-btn');
  const minBtn = popup.querySelector('.popup-min-btn');
  const maxBtn = popup.querySelector('.popup-max-btn');

  if (!dragBar || !closeBtn || !minBtn || !maxBtn) {
    console.warn('[CallSummaryTable] Missing control buttons in popup');
    return null;
  }

  // Column definitions
  // label: Display text in header
  // tooltip: Text shown on hover (contains units)
  // digits: Number of decimal places (undefined for integers/strings)
  const columns = [
    { key: 'id', label: 'ID', tooltip: 'ID', width: '30px' }, // No digits
    { key: 'startTime_s', label: 'Start Time', tooltip: 'Start Time (s)', width: '70px', digits: 4 },
    { key: 'endTime_s', label: 'End Time', tooltip: 'End Time (s)', width: '70px', digits: 4 },
    { key: 'duration_ms', label: 'Duration', tooltip: 'Duration (ms)', width: '70px', digits: 2 },

    // Frequency & Time Pairs
    { key: 'lowFreq_kHz', label: 'Low Freq', tooltip: 'Low Freq (kHz)', width: '70px', digits: 2 },
    { key: 'lowFreq_ms', label: 'Low Time', tooltip: 'Low Freq Time (ms)', width: '70px', digits: 2 },

    { key: 'highFreq_kHz', label: 'High Freq', tooltip: 'High Freq (kHz)', width: '70px', digits: 2 },
    { key: 'highFreqTime_ms', label: 'High Time', tooltip: 'High Freq Time (ms)', width: '70px', digits: 2 },

    { key: 'peakFreq_kHz', label: 'Peak Freq', tooltip: 'Peak Freq (kHz)', width: '70px', digits: 2 },
    { key: 'peakFreqTime_ms', label: 'Peak Time', tooltip: 'Peak Freq Time (ms)', width: '70px', digits: 2 },
    { key: 'kneeFreq_kHz', label: 'Knee Freq', tooltip: 'Knee Freq (kHz)', width: '70px', digits: 2 },
    { key: 'kneeFreq_ms', label: 'Knee Time', tooltip: 'Knee Freq Time (ms)', width: '70px', digits: 2 },

    { key: 'heelFreq_kHz', label: 'Heel Freq', tooltip: 'Heel Freq (kHz)', width: '70px', digits: 2 },
    { key: 'heelFreq_ms', label: 'Heel Time', tooltip: 'Heel Freq Time (ms)', width: '70px', digits: 2 },
    { key: 'characteristicFreq_kHz', label: 'Char Freq', tooltip: 'Char Freq (kHz)', width: '70px', digits: 2 },
    { key: 'characteristicFreq_ms', label: 'Char Time', tooltip: 'Char Freq Time (ms)', width: '70px', digits: 2 },

    // Other Freqs
    { key: 'startFreq_kHz', label: 'Start Freq', tooltip: 'Start Freq (kHz)', width: '70px', digits: 2 },
    { key: 'endFreq_kHz', label: 'End Freq', tooltip: 'End Freq (kHz)', width: '70px', digits: 2 },

    // Power & Quality
    { key: 'bandwidth_kHz', label: 'Bandwidth', tooltip: 'Bandwidth (kHz)', width: '70px', digits: 2 },
    { key: 'peakPower_dB', label: 'Peak Power', tooltip: 'Peak Power (dB)', width: '70px', digits: 1 },
    { key: 'snr_dB', label: 'SNR', tooltip: 'SNR (dB)', width: '70px', digits: 1 },
    { key: 'quality', label: 'Quality', tooltip: 'Quality', width: '70px' }
  ];

  let currentCalls = [];

  // Close popup
  function closePopup() {
    popup.style.display = 'none';
    // Save final size only if in "Normal" state (not maximized or docked)
    if (!isMaximized && !isMinimized) {
        localStorage.setItem('callSummaryPopupWidth', popup.style.width);
        localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  }

  /**
   * Toggle Minimize (Dock to Bottom)
   * Behavior: Width 100%, Height 300px, Positioned at the very bottom
   */
  function toggleDock() {
    if (isDocked) {
      // Restore from Docked state
      popup.classList.remove('docked');
      
      if (isMaximized) {
         // Restore to maximized
         popup.style.position = 'absolute';
         popup.style.width = '100vw';
         popup.style.height = '100vh';
         popup.style.left = '0';
         popup.style.top = '0';
      } else {
         // Restore to normal window
         popup.style.position = 'absolute';
         popup.style.width = preDockState.width;
         popup.style.height = preDockState.height;
         popup.style.left = preDockState.left;
         popup.style.top = preDockState.top;
         popup.style.bottom = ''; // Clear bottom
      }
      
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      isDocked = false;

    } else {
      // Enter Docked state (Browser Bottom)
      // Save current state
      preDockState = {
        width: popup.style.width,
        height: popup.style.height,
        left: popup.style.left,
        top: popup.style.top
      };

      popup.classList.add('docked');
      
      // Apply Dock Styles: Fixed at bottom
      popup.style.position = 'fixed'; 
      popup.style.width = '100vw'; 
      popup.style.height = '150px'; 
      popup.style.left = '0';
      popup.style.top = 'auto'; // Clear top
      popup.style.bottom = '0'; // Stick to bottom

      minBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>';
      minBtn.title = 'Restore Up';
      isDocked = true;
    }
  }

  // Toggle maximize
  function toggleMaximize() {
    // If currently docked, un-dock first
    if (isDocked) {
        toggleDock(); 
        if (isMaximized) return; 
    }

    if (isMaximized) {
      // Restore Down
      popup.style.width = preMaximizeState.width;
      popup.style.height = preMaximizeState.height;
      popup.style.left = preMaximizeState.left;
      popup.style.top = preMaximizeState.top;
      
      popup.classList.remove('maximized');
      isMaximized = false;

      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
    } else {
      // Maximize
      preMaximizeState = {
        width: popup.style.width,
        height: popup.style.height,
        left: popup.style.left,
        top: popup.style.top
      };
      
      popup.style.left = '0';
      popup.style.top = '0';
      popup.style.width = '100vw';
      popup.style.height = '100vh';
      
      popup.classList.add('maximized');
      isMaximized = true;

      maxBtn.innerHTML = '<i class="fa-regular fa-clone"></i>';
      maxBtn.title = 'Restore Down';
    }
  }

  // Start dragging
  function onDragStart(e) {
    if (e.target.closest('button')) return;
    // Prevent drag if Maximized or Docked
    if (isMaximized || isDocked) return; 
    
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    popupStartX = popup.offsetLeft;
    popupStartY = popup.offsetTop;
  }

  // Handle dragging
  function onDragMove(e) {
    if (!isDragging || isMaximized || isDocked) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    popup.style.left = `${popupStartX + deltaX}px`;
    popup.style.top = `${popupStartY + deltaY}px`;
  }

  // End dragging
  function onDragEnd() {
    isDragging = false;
  }

  // Render table with call data
  function renderTable(calls) {
    if (!calls || calls.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">No call data available</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'summary-table';

    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.tooltip) {
          th.title = col.tooltip;
      }
      th.style.width = col.width;
      th.style.whiteSpace = 'nowrap';
      th.style.cursor = 'help';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    calls.forEach((call, idx) => {
      const row = document.createElement('tr');
      row.setAttribute('data-call-index', idx);
      
      columns.forEach(col => {
        const td = document.createElement('td');
        let value;

        if (col.key === 'id') {
            value = idx + 1;
        } else {
            value = call[col.key];
        }
        
        if (typeof value === 'number') {
          if (col.digits !== undefined) {
             value = value.toFixed(col.digits);
          } else {
             value = value.toString(); 
          }
        } else if (value === undefined || value === null) {
          value = '-';
        }
        
        td.textContent = value;
        row.appendChild(td);
      });
      
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);
  }

  // Update table data
  function updateTable(calls) {
    currentCalls = calls || [];
    renderTable(currentCalls);
  }

  // Open popup
  function openPopup() {
    popup.style.display = 'block';
    
    // Ensure visibility (reset position if weird)
    if (!isDocked && !isMaximized) {
        const savedWidth = localStorage.getItem('callSummaryPopupWidth');
        const savedHeight = localStorage.getItem('callSummaryPopupHeight');
        if (savedWidth) popup.style.width = savedWidth;
        if (savedHeight) popup.style.height = savedHeight;
        
        // Safety check: if off-screen, reset to center
        const rect = popup.getBoundingClientRect();
        if (rect.top < 0 || rect.left < 0) {
            popup.style.top = '100px';
            popup.style.left = '100px';
        }
    }
  }

  // Event listeners for button and controls
  btn.addEventListener('click', openPopup);
  closeBtn.addEventListener('click', closePopup);
  minBtn.addEventListener('click', toggleDock);
  maxBtn.addEventListener('click', toggleMaximize);

  // Drag functionality
  dragBar.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // Save size on window resize
  const observer = new ResizeObserver(() => {
    if (!isMaximized && !isDocked && popup.style.display !== 'none') {
      localStorage.setItem('callSummaryPopupWidth', popup.style.width);
      localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  });
  observer.observe(popup);

  // Public API
  return {
    updateTable,
    openPopup,
    closePopup,
    getCurrentCalls: () => currentCalls
  };
}