/**
 * Call Summary Table Module
 * Handles the popup window for displaying bat call analysis results in a table format
 * Features: Sorting, Filtering, Resizing, Discarding, Column Visibility
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

  // --- State Management ---
  let isDraggingWindow = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let popupStartX = 0;
  let popupStartY = 0;
  
  let isMaximized = false;
  let preMaximizeState = {};

  let isDocked = false;
  let preDockState = {};

  // Data State
  let allCalls = [];       // Original data source
  let displayCalls = [];   // Filtered and sorted data
  let sortState = { key: null, direction: 'none' }; // 'asc', 'desc', 'none'
  let filterState = {};    // key -> filter string
  let discardedIds = new Set(); // Set of call indices that are discarded

  // --- Initial Window Setup ---
  let popupWidth = parseInt(localStorage.getItem('callSummaryPopupWidth'), 10);
  let popupHeight = parseInt(localStorage.getItem('callSummaryPopupHeight'), 10);
  if (isNaN(popupWidth) || popupWidth <= 0) popupWidth = 1000;
  if (isNaN(popupHeight) || popupHeight <= 0) popupHeight = 300;
  
  popup.style.width = `${popupWidth}px`;
  popup.style.height = `${popupHeight}px`;
  popup.style.position = 'absolute';

  const dragBar = popup.querySelector('.popup-drag-bar');
  const closeBtn = popup.querySelector('.popup-close-btn');
  const minBtn = popup.querySelector('.popup-min-btn');
  const maxBtn = popup.querySelector('.popup-max-btn');

  // --- Column Configuration ---
  const initialColumns = [
    { key: '__discard', label: 'X', tooltip: 'Discard', width: 30, noSort: true, noFilter: true },
    { key: 'id', label: 'ID', tooltip: 'ID', width: 50 },
    { key: 'startTime_s', label: 'Start Time', tooltip: 'Start Time (s)', width: 90, digits: 4 },
    { key: 'endTime_s', label: 'End Time', tooltip: 'End Time (s)', width: 90, digits: 4 },
    { key: 'duration_ms', label: 'Duration', tooltip: 'Duration (ms)', width: 90, digits: 2 },
    
    // Frequency & Time Pairs
    { key: 'lowFreq_kHz', label: 'Low Freq', tooltip: 'Low Freq (kHz)', width: 90, digits: 2 },
    { key: 'lowFreq_ms', label: 'Low Time', tooltip: 'Low Freq Time (ms)', width: 90, digits: 2 },
    { key: 'highFreq_kHz', label: 'High Freq', tooltip: 'High Freq (kHz)', width: 90, digits: 2 },
    { key: 'highFreqTime_ms', label: 'High Time', tooltip: 'High Freq Time (ms)', width: 90, digits: 2 },
    { key: 'peakFreq_kHz', label: 'Peak Freq', tooltip: 'Peak Freq (kHz)', width: 90, digits: 2 },
    { key: 'peakFreqTime_ms', label: 'Peak Time', tooltip: 'Peak Freq Time (ms)', width: 90, digits: 2 },
    { key: 'kneeFreq_kHz', label: 'Knee Freq', tooltip: 'Knee Freq (kHz)', width: 90, digits: 2 },
    { key: 'kneeFreq_ms', label: 'Knee Time', tooltip: 'Knee Freq Time (ms)', width: 90, digits: 2 },
    { key: 'heelFreq_kHz', label: 'Heel Freq', tooltip: 'Heel Freq (kHz)', width: 90, digits: 2 },
    { key: 'heelFreq_ms', label: 'Heel Time', tooltip: 'Heel Freq Time (ms)', width: 90, digits: 2 },
    { key: 'characteristicFreq_kHz', label: 'Char Freq', tooltip: 'Char Freq (kHz)', width: 90, digits: 2 },
    { key: 'characteristicFreq_ms', label: 'Char Time', tooltip: 'Char Freq Time (ms)', width: 90, digits: 2 },

    // Other
    { key: 'startFreq_kHz', label: 'Start Freq', tooltip: 'Start Freq (kHz)', width: 90, digits: 2 },
    { key: 'endFreq_kHz', label: 'End Freq', tooltip: 'End Freq (kHz)', width: 90, digits: 2 },
    
    // Power & Quality
    { key: 'bandwidth_kHz', label: 'Bandwidth', tooltip: 'Bandwidth (kHz)', width: 90, digits: 2 },
    { key: 'peakPower_dB', label: 'Peak Power', tooltip: 'Peak Power (dB)', width: 90, digits: 1 },
    { key: 'snr_dB', label: 'SNR', tooltip: 'SNR (dB)', width: 80, digits: 1 },
    { key: 'quality', label: 'Quality', tooltip: 'Quality', width: 80 }
  ];

  // State for column visibility and width
  // Deep copy to separate instances
  let columns = initialColumns.map(c => ({...c, visible: true}));

  // --- Logic Functions ---

  // --- Data Helper: Get Unique Values for Filter List ---
  function getSortedUniqueValues(columnKey) {
    const uniqueSet = new Set();
    
    // 1. 收集所有不重複值
    allCalls.forEach(call => {
      let val = (columnKey === 'id') ? allCalls.indexOf(call) + 1 : call[columnKey];
      
      // 處理空白或無效值
      if (val === undefined || val === null || val === '') {
        uniqueSet.add('(Blanks)');
      } else {
        uniqueSet.add(val);
      }
    });

    // 2. 轉為陣列並排序
    return Array.from(uniqueSet).sort((a, b) => {
      // 確保 (Blanks) 永遠排最後
      if (a === '(Blanks)') return 1;
      if (b === '(Blanks)') return -1;
      
      // 數值排序 vs 文字排序
      if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
      }
      return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
    });
  }

  function closePopup() {
    popup.style.display = 'none';
    if (!isMaximized && !isDocked) {
        localStorage.setItem('callSummaryPopupWidth', popup.style.width);
        localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  }

  function toggleDock() {
    if (isDocked) {
      popup.classList.remove('docked');
      if (isMaximized) {
         Object.assign(popup.style, { position: 'absolute', width: '100vw', height: '100vh', left: '0', top: '0', bottom: '' });
      } else {
         Object.assign(popup.style, { position: 'absolute', width: preDockState.width, height: preDockState.height, left: preDockState.left, top: preDockState.top, bottom: '' });
      }
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      isDocked = false;
    } else {
      preDockState = { width: popup.style.width, height: popup.style.height, left: popup.style.left, top: popup.style.top };
      popup.classList.add('docked');
      Object.assign(popup.style, { position: 'fixed', width: '100vw', height: '300px', left: '0', top: 'auto', bottom: '0' });
      minBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>';
      minBtn.title = 'Restore Up';
      isDocked = true;
    }
  }

  function toggleMaximize() {
    if (isDocked) { toggleDock(); if (isMaximized) return; }
    if (isMaximized) {
      Object.assign(popup.style, { width: preMaximizeState.width, height: preMaximizeState.height, left: preMaximizeState.left, top: preMaximizeState.top });
      popup.classList.remove('maximized');
      isMaximized = false;
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
    } else {
      preMaximizeState = { width: popup.style.width, height: popup.style.height, left: popup.style.left, top: popup.style.top };
      Object.assign(popup.style, { left: '0', top: '0', width: '100vw', height: '100vh' });
      popup.classList.add('maximized');
      isMaximized = true;
      maxBtn.innerHTML = '<i class="fa-regular fa-clone"></i>';
      maxBtn.title = 'Restore Down';
    }
  }

  // --- Window Dragging ---
  function onWindowDragStart(e) {
    if (e.target.closest('button')) return;
    if (isMaximized || isDocked) return;
    isDraggingWindow = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    popupStartX = popup.offsetLeft; popupStartY = popup.offsetTop;
  }
  function onWindowDragMove(e) {
    if (!isDraggingWindow || isMaximized || isDocked) return;
    popup.style.left = `${popupStartX + (e.clientX - dragStartX)}px`;
    popup.style.top = `${popupStartY + (e.clientY - dragStartY)}px`;
  }
  function onWindowDragEnd() { isDraggingWindow = false; }

  // --- Column Resizing ---
  let isResizingCol = false;
  let resizingColIndex = -1;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function onColumnResizeStart(e, index) {
    e.preventDefault();
    e.stopPropagation();
    isResizingCol = true;
    resizingColIndex = index;
    resizeStartX = e.clientX;
    resizeStartWidth = columns[index].width;
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onColumnResizeMove);
    document.addEventListener('mouseup', onColumnResizeEnd);
  }

  function onColumnResizeMove(e) {
    if (!isResizingCol) return;
    const diff = e.clientX - resizeStartX;
    const newWidth = Math.max(30, resizeStartWidth + diff);
    columns[resizingColIndex].width = newWidth;
    renderTable(); // Re-render to update widths
  }

  function onColumnResizeEnd() {
    isResizingCol = false;
    resizingColIndex = -1;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onColumnResizeMove);
    document.removeEventListener('mouseup', onColumnResizeEnd);
  }

  // --- Sorting & Filtering Logic ---
  
  function processData() {
    // 1. Filtering
    let filtered = allCalls.filter((call, idx) => {
      // 遍歷每一個有過濾條件的欄位
      for (const [key, filterVal] of Object.entries(filterState)) {
        // 如果過濾條件是空的，跳過
        if (!filterVal) continue;

        // 取得當前資料行的該欄位數值
        let cellValue;
        if (key === 'id') cellValue = idx + 1;
        else cellValue = call[key];
        
        // 統一將 null/undefined 轉為系統內部的 '(Blanks)' 標記，以便比對
        const compareValue = (cellValue === undefined || cellValue === null || cellValue === '') 
                             ? '(Blanks)' 
                             : cellValue;

        // --- [NEW] Set 類型 (來自 Checkbox 多選) ---
        if (filterVal instanceof Set) {
            // 如果當前值 不在 白名單(Set) 中，就過濾掉
            if (!filterVal.has(compareValue)) return false;
        } 
        
        // --- [Legacy] String 類型 (來自舊版輸入框或數學運算) ---
        else if (typeof filterVal === 'string') {
            if (key === '__discard') continue;
            
            const fLower = filterVal.toLowerCase();
            
            if (typeof cellValue === 'number') {
              // 處理 >, <, >=, <=
              const cleanFilter = filterVal.trim();
              if (cleanFilter.startsWith('>=')) {
                 if (!(cellValue >= parseFloat(cleanFilter.substring(2)))) return false;
              } else if (cleanFilter.startsWith('<=')) {
                 if (!(cellValue <= parseFloat(cleanFilter.substring(2)))) return false;
              } else if (cleanFilter.startsWith('>')) {
                 if (!(cellValue > parseFloat(cleanFilter.substring(1)))) return false;
              } else if (cleanFilter.startsWith('<')) {
                 if (!(cellValue < parseFloat(cleanFilter.substring(1)))) return false;
              } else {
                 // 數字模糊搜尋
                 if (!String(cellValue).includes(filterVal)) return false;
              }
            } else {
              // 文字模糊搜尋
              if (!String(compareValue).toLowerCase().includes(fLower)) return false;
            }
        }
      }
      return true; // 通過所有過濾器
    });

    // 2. Sorting (保持不變)
    if (sortState.key && sortState.direction !== 'none') {
      filtered.sort((a, b) => {
        let valA, valB;
        if (sortState.key === 'id') {
            valA = allCalls.indexOf(a);
            valB = allCalls.indexOf(b);
        } else {
            valA = a[sortState.key];
            valB = b[sortState.key];
        }

        if (valA === valB) return 0;
        if (valA === undefined || valA === null) return 1;
        if (valB === undefined || valB === null) return -1;

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return sortState.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    displayCalls = filtered;
  }

  function handleSort(key) {
    if (key === '__discard') return; // Cannot sort by discard checkbox directly (or add logic if needed)

    if (sortState.key === key) {
      if (sortState.direction === 'none') sortState.direction = 'asc';
      else if (sortState.direction === 'asc') sortState.direction = 'desc';
      else sortState.direction = 'none';
    } else {
      sortState.key = key;
      sortState.direction = 'asc';
    }
    renderTable();
  }

  function handleFilterInput(key, value) {
    filterState[key] = value;
    renderTable(); // Re-process and render
  }

  function handleDiscardToggle(originalIndex, isChecked) {
    if (isChecked) {
      discardedIds.add(originalIndex);
    } else {
      discardedIds.delete(originalIndex);
    }
    // Update visual row style immediately
    const row = container.querySelector(`tr[data-original-index="${originalIndex}"]`);
    if (row) {
      if (isChecked) row.classList.add('discarded');
      else row.classList.remove('discarded');
    }
  }

  // --- Context Menu (Column Visibility) ---
  function showContextMenu(e) {
    e.preventDefault();
    // Remove existing menu
    const existing = document.getElementById('col-ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'col-ctx-menu';
    menu.className = 'col-ctx-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    columns.forEach((col, idx) => {
      const item = document.createElement('div');
      item.className = 'col-ctx-item';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = col.visible;
      cb.onclick = (ev) => {
        ev.stopPropagation();
        col.visible = cb.checked;
        renderTable();
      };

      const lbl = document.createElement('span');
      lbl.textContent = col.label;

      item.appendChild(cb);
      item.appendChild(lbl);
      item.onclick = () => {
        cb.checked = !cb.checked;
        col.visible = cb.checked;
        renderTable();
      };
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Close menu on click elsewhere
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    // Delay slightly to avoid immediate trigger
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  // --- Rendering ---
  function renderTable() {
    processData(); // Sort and Filter first

    // Clean container
    container.innerHTML = '';

    if (displayCalls.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">No data found</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'summary-table';

    // 1. Header Row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    columns.forEach((col, idx) => {
      if (!col.visible) return;

      // -- Main Header --
      const th = document.createElement('th');
      th.style.width = `${col.width}px`;
      if (col.tooltip) th.title = col.tooltip; // Tooltip 對於縮略文字很重要

      const thContent = document.createElement('div');
      thContent.className = 'th-content';
      
      // 1. 左側：標題文字 + 排序箭頭
      const labelContainer = document.createElement('div');
      labelContainer.className = 'th-label-container';
      
      const textSpan = document.createElement('span');
      textSpan.className = 'th-text';
      textSpan.textContent = col.label;
      labelContainer.appendChild(textSpan);

      // Sort Icon (只在有排序時顯示，或你可以讓它一直佔位)
      if (sortState.key === col.key && sortState.direction !== 'none') {
        const sortIcon = document.createElement('i');
        sortIcon.className = 'sort-icon fa-solid';
        sortIcon.className += (sortState.direction === 'asc') ? ' fa-arrow-up' : ' fa-arrow-down';
        labelContainer.appendChild(sortIcon);
      }
      
      // 點擊左側文字區域觸發排序
      if (!col.noSort) {
        labelContainer.onclick = () => handleSort(col.key);
      }
      
      thContent.appendChild(labelContainer);

      // 2. 右側：Filter 圖示
      if (!col.noFilter) {
          const filterIcon = document.createElement('i');
          // 判斷是否過濾中，如果是，加上 .active class
          const isActive = filterState[col.key] !== undefined;
          filterIcon.className = `fa-solid fa-filter filter-icon-btn ${isActive ? 'active' : ''}`;
          filterIcon.title = 'Filter';
          
          filterIcon.onclick = (e) => {
              e.stopPropagation(); // 防止觸發排序
              createFilterMenu(th, col.key);
          };
          thContent.appendChild(filterIcon);
      }
      
      thContent.oncontextmenu = (e) => showContextMenu(e);

      // Resize Handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.onmousedown = (e) => onColumnResizeStart(e, idx);

      th.appendChild(thContent);
      th.appendChild(resizeHandle);
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // 3. Body
    const tbody = document.createElement('tbody');
    displayCalls.forEach((call) => {
      // Find original index for Discard logic
      const originalIndex = allCalls.indexOf(call);
      const isDiscarded = discardedIds.has(originalIndex);

      const row = document.createElement('tr');
      row.setAttribute('data-original-index', originalIndex);
      if (isDiscarded) row.classList.add('discarded');

      columns.forEach(col => {
        if (!col.visible) return;

        const td = document.createElement('td');
        
        if (col.key === '__discard') {
          // Discard Checkbox
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = isDiscarded;
          cb.onchange = (e) => handleDiscardToggle(originalIndex, e.target.checked);
          td.appendChild(cb);
          td.style.textAlign = 'center';
        } else {
          let value;
          if (col.key === 'id') {
            value = originalIndex + 1;
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
          td.title = value; // Tooltip for truncated content
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function updateTable(calls) {
    allCalls = calls || [];
    // Reset transient states on new data load? Maybe keep filters?
    // Let's keep filters/sort to allow refreshing data without losing context.
    renderTable();
  }

  function openPopup() {
    popup.style.display = 'block';
    if (!isDocked && !isMaximized) {
        const savedWidth = localStorage.getItem('callSummaryPopupWidth');
        const savedHeight = localStorage.getItem('callSummaryPopupHeight');
        if (savedWidth) popup.style.width = savedWidth;
        if (savedHeight) popup.style.height = savedHeight;
        
        // Basic position check
        const rect = popup.getBoundingClientRect();
        if (rect.top < 0 || rect.left < 0) {
            popup.style.top = '100px'; popup.style.left = '100px';
        }
    }
  }

  // --- Initialization ---
  btn.addEventListener('click', openPopup);
  closeBtn.addEventListener('click', closePopup);
  minBtn.addEventListener('click', toggleDock);
  maxBtn.addEventListener('click', toggleMaximize);

  dragBar.addEventListener('mousedown', onWindowDragStart);
  document.addEventListener('mousemove', onWindowDragMove);
  document.addEventListener('mouseup', onWindowDragEnd);

  const observer = new ResizeObserver(() => {
    if (!isMaximized && !isDocked && popup.style.display !== 'none') {
      localStorage.setItem('callSummaryPopupWidth', popup.style.width);
      localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  });
  observer.observe(popup);

  // --- Google Sheets Style Filter UI (Fully Functional) ---
  function createFilterMenu(targetTh, columnKey) {
    // 1. 關閉現有的選單
    const existing = document.getElementById('gs-filter-popup');
    if (existing) existing.remove();

    // 2. 獲取真實數據列表 (Sorted Unique Values)
    const uniqueList = getSortedUniqueValues(columnKey);
    
    // 3. 判斷目前的勾選狀態
    // 如果 filterState 裡沒有這個 key，代表「全選 (沒有過濾)」
    // 如果有，則只勾選 Set 裡有的值
    const currentSet = filterState[columnKey];
    const isFilterActive = (currentSet instanceof Set);

    // 4. 建立容器
    const menu = document.createElement('div');
    menu.id = 'gs-filter-popup';
    menu.className = 'gs-filter-menu';

    // 5. 構建 HTML (Search + Action + List)
    menu.innerHTML = `
      <div class="gs-menu-item" id="sort-asc">
        <i class="fa-solid fa-arrow-down-a-z"></i> Sort A to Z
      </div>
      <div class="gs-menu-item" id="sort-desc">
        <i class="fa-solid fa-arrow-down-z-a"></i> Sort Z to A
      </div>
      
      <div class="gs-divider"></div>
      
      <div class="gs-section-header">Filter by values</div>
      
      <div class="gs-search-container">
        <input type="text" class="gs-search-input" placeholder="Search...">
      </div>
      
      <div class="gs-quick-actions">
        <span class="gs-action-link" id="action-select-all">Select all</span> - 
        <span class="gs-action-link" id="action-clear">Clear</span>
      </div>
      
      <div class="gs-value-list" id="gs-value-list-container">
        </div>
      
      <div class="gs-divider"></div>
      
      <div class="gs-footer">
        <button class="gs-btn gs-btn-cancel">Cancel</button>
        <button class="gs-btn gs-btn-ok">OK</button>
      </div>
    `;

    // 6. 生成列表項目 (Populate List)
    const listContainer = menu.querySelector('#gs-value-list-container');
    
    uniqueList.forEach((val, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'gs-value-item';
      
      // 判斷是否勾選：如果沒有過濾器(全選狀態) 或 值在Set裡面 -> Checked
      const isChecked = !isFilterActive || currentSet.has(val);
      
      // 我們將真實值儲存在 data-value 屬性中，方便之後讀取 (注意處理雙引號)
      // 使用 JSON.stringify 安全地處理特殊字符
      const safeValue = encodeURIComponent(String(val));

      itemDiv.innerHTML = `
        <input type="checkbox" id="chk-${idx}" data-val="${safeValue}" ${isChecked ? 'checked' : ''}>
        <label for="chk-${idx}">${val}</label>
      `;
      
      // 點擊整行都能觸發 checkbox
      itemDiv.onclick = (e) => {
        if(e.target.tagName !== 'INPUT') {
          const cb = itemDiv.querySelector('input');
          cb.checked = !cb.checked;
        }
      };
      
      listContainer.appendChild(itemDiv);
    });

    // 7. 定位選單
    const rect = targetTh.getBoundingClientRect();
    // 邊界檢查：如果太靠右，選單往左長
    const leftPos = (rect.left + 280 > window.innerWidth) ? (window.innerWidth - 290) : rect.left;
    
    menu.style.left = `${leftPos}px`;
    menu.style.top = `${rect.bottom + 2}px`;

    document.body.appendChild(menu);

    // --- Event Listeners ---

    // A. 排序功能
    menu.querySelector('#sort-asc').onclick = () => {
        sortState.key = columnKey;
        sortState.direction = 'asc';
        renderTable();
        menu.remove();
    };
    menu.querySelector('#sort-desc').onclick = () => {
        sortState.key = columnKey;
        sortState.direction = 'desc';
        renderTable();
        menu.remove();
    };

    // B. Search Box Filter Logic (前端視覺過濾)
    const searchInput = menu.querySelector('.gs-search-input');
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const items = listContainer.querySelectorAll('.gs-value-item');
        items.forEach(item => {
            const text = item.querySelector('label').textContent.toLowerCase();
            if (text.includes(term)) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    });
    searchInput.focus(); // 打開選單直接聚焦輸入框

    // C. Select All / Clear (只影響目前搜尋看得到的項目)
    menu.querySelector('#action-select-all').onclick = () => {
        const visibleItems = Array.from(listContainer.querySelectorAll('.gs-value-item'))
                                  .filter(el => el.style.display !== 'none');
        visibleItems.forEach(el => el.querySelector('input').checked = true);
    };

    menu.querySelector('#action-clear').onclick = () => {
        const visibleItems = Array.from(listContainer.querySelectorAll('.gs-value-item'))
                                  .filter(el => el.style.display !== 'none');
        visibleItems.forEach(el => el.querySelector('input').checked = false);
    };

    // D. Cancel
    menu.querySelector('.gs-btn-cancel').onclick = () => menu.remove();

    // E. OK Button (Apply Filter)
    menu.querySelector('.gs-btn-ok').onclick = () => {
        // 1. 收集所有被勾選的值
        const checkedInputs = listContainer.querySelectorAll('input[type="checkbox"]:checked');
        const allInputs = listContainer.querySelectorAll('input[type="checkbox"]');
        
        // 2. 判斷是否全選了 (如果是全選，我們通常清空 filterState 以節省效能)
        if (checkedInputs.length === allInputs.length) {
            delete filterState[columnKey]; // 移除過濾器 = 顯示全部
        } else {
            // 3. 建立白名單 Set
            const allowedSet = new Set();
            checkedInputs.forEach(input => {
                // 解碼回原始值
                let valStr = decodeURIComponent(input.getAttribute('data-val'));
                // 嘗試還原數字類型 (如果原本是數字)
                // 這裡簡化處理：因為 Set 比較需要類型一致。
                // 我們的 getSortedUniqueValues 混合了數字和字串。
                // 為了安全，我們在 processData 裡都轉字串比對，或者在這裡還原類型。
                // 比較好的做法是：依照 columnKey 查找原始數據判斷類型，但這裡我們用簡單的「嘗試轉數字」
                
                // 修正：為了精確匹配，我們應該保持原始類型。
                // 方法：從 uniqueList 裡透過 index 取回原始值最安全！
                const index = parseInt(input.id.split('-')[1]);
                allowedSet.add(uniqueList[index]); 
            });
            
            filterState[columnKey] = allowedSet;
        }

        // 4. 更新 UI (Icon 顏色) 和 表格
        const icon = targetTh.querySelector('.filter-icon-btn');
        if (filterState[columnKey]) {
            icon.classList.add('active'); // CSS 需對應增加 .active 顏色變綠
        } else {
            icon.classList.remove('active');
        }

        renderTable();
        menu.remove();
    };

    // F. Click Outside Close
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && !targetTh.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
  }


  // Return API
  return {
    updateTable,
    openPopup,
    closePopup,
    getCurrentCalls: () => displayCalls
  };
}