/**
 * Call Summary Table Module
 * Handles the popup window for displaying bat call analysis results in a table format
 * Features: Sorting, Filtering, Resizing, Discarding, Column Visibility
 */

import { getIconString } from './icons.js';

export function initCallSummaryTable({
  buttonId = 'viewTableBtn',
  popupId = 'callSummaryPopup',
  containerId = 'callSummaryTableContainer',
  onCallSelected = null,
  onDeleteCalls = null,
  onClearAll = null
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

  let isSplitMode = false;     // Split 狀態
  let preSplitState = {};      // 記錄 Split 前的位置與大小
  let isResizingSplit = false; // Split Resizer 拖曳狀態

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
  const maxBtn = popup.querySelector('.popup-max-btn');
  
  // 取得相關元素
  const splitBtn = popup.querySelector('.popup-split-btn');
  const splitResizer = document.getElementById('split-resizer');
  const mainArea = document.getElementById('mainarea');

  // --- Resizing Logic Variables ---
  const edgeThreshold = 5; // 邊緣偵測範圍 (px)
  let isResizingWindow = false;
  let resizeLeft = false, resizeRight = false, resizeTop = false, resizeBottom = false;
  let startX = 0, startY = 0;
  let startWidth = 0, startHeight = 0, startLeft = 0, startTop = 0;

  // --- Resizing Helper Functions ---
  function getEdgeState(clientX, clientY) {
    const rect = popup.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const withinVertical = y >= -edgeThreshold && y <= rect.height + edgeThreshold;
    const withinHorizontal = x >= -edgeThreshold && x <= rect.width + edgeThreshold;

    const onLeft = Math.abs(x - 0) <= edgeThreshold && withinVertical;
    const onRight = Math.abs(x - rect.width) <= edgeThreshold && withinVertical;
    const onTop = Math.abs(y - 0) <= edgeThreshold && withinHorizontal;
    const onBottom = Math.abs(y - rect.height) <= edgeThreshold && withinHorizontal;

    return { onLeft, onRight, onTop, onBottom };
  }

  function edgeCursor(state) {
    const { onLeft, onRight, onTop, onBottom } = state;
    if ((onLeft && onTop) || (onRight && onBottom)) return 'nwse-resize';
    if ((onRight && onTop) || (onLeft && onBottom)) return 'nesw-resize';
    if (onLeft || onRight) return 'ew-resize';
    if (onTop || onBottom) return 'ns-resize';
    return '';
  }

  // --- Column Configuration ---
  const initialColumns = [
    { key: '__discard', label: '', width: 40, noSort: true, noFilter: true },
    { key: 'id', label: 'ID', tooltip: 'ID', width: 42, noFilter: true },
    
    { key: 'startTime_s', label: '<i>t </i><sub>start</sub>', tooltip: 'Start Time (s)', width: 60, digits: 4 },
    { key: 'endTime_s', label: '<i>t </i><sub>end</sub>', tooltip: 'End Time (s)', width: 60, digits: 4 },
    { key: 'duration_ms', label: 'Dur', tooltip: 'Duration (ms)', width: 60, digits: 2 },
    
    // Frequency & Time Pairs
    { key: 'lowFreq_kHz', label: 'ƒ<sub>low</sub>', tooltip: 'Low Freq (kHz)', width: 60, digits: 2 },
    { key: 'lowFreq_ms', label: '<i>t </i><sub>low</sub>', tooltip: 'Low Freq Time (ms)', width: 60, digits: 2 },
    
    { key: 'highFreq_kHz', label: 'ƒ<sub>high</sub>', tooltip: 'High Freq (kHz)', width: 60, digits: 2 },
    { key: 'highFreqTime_ms', label: '<i>t </i><sub>high</sub>', tooltip: 'High Freq Time (ms)', width: 60, digits: 2 },
    
    { key: 'peakFreq_kHz', label: 'ƒ<sub>peak</sub>', tooltip: 'Peak Freq (kHz)', width: 60, digits: 2 },
    { key: 'peakFreqTime_ms', label: '<i>t </i><sub>peak</sub>', tooltip: 'Peak Freq Time (ms)', width: 60, digits: 2 },

    { key: 'kneeFreq_kHz', label: 'ƒ<sub>knee</sub>', tooltip: 'Knee Freq (kHz)', width: 60, digits: 2 },
    { key: 'kneeFreq_ms', label: '<i>t </i><sub>knee</sub>', tooltip: 'Knee Freq Time (ms)', width: 60, digits: 2 },
    
    { key: 'heelFreq_kHz', label: 'ƒ<sub>heel</sub>', tooltip: 'Heel Freq (kHz)', width: 60, digits: 2 },
    { key: 'heelFreq_ms', label: '<i>t </i><sub>heel</sub>', tooltip: 'Heel Freq Time (ms)', width: 60, digits: 2 },
    
    { key: 'characteristicFreq_kHz', label: 'ƒ<sub>char</sub>', tooltip: 'Char Freq (kHz)', width: 60, digits: 2 },
    { key: 'characteristicFreq_ms', label: '<i>t </i><sub>char</sub>', tooltip: 'Char Freq Time (ms)', width: 60, digits: 2 },

    { key: 'startFreq_kHz', label: 'ƒ<sub>start</sub>', tooltip: 'Start Freq (kHz)', width: 60, digits: 2 },
    { key: 'endFreq_kHz', label: 'ƒ<sub>end</sub>', tooltip: 'End Freq (kHz)', width: 60, digits: 2 },
    
    { key: 'bandwidth_kHz', label: 'BW', tooltip: 'Bandwidth (kHz)', width: 60, digits: 2 },
    { key: 'peakPower_dB', label: 'dB<sub>peak</sub>', tooltip: 'Peak Power (dB)', width: 70, digits: 1 },
    { key: 'snr_dB', label: 'SNR', tooltip: 'SNR (dB)', width: 60, digits: 1 },
    { key: 'quality', label: 'Quality', tooltip: 'Signal Quality', width: 80 }
  ];

  // State for column visibility and width
  let columns = initialColumns.map(c => ({...c, visible: true}));

  // --- Data Helper: Get Unique Values for Filter List ---
  function getSortedUniqueValues(columnKey) {
    const uniqueSet = new Set();
    allCalls.forEach(call => {
      let val = (columnKey === 'id') ? allCalls.indexOf(call) + 1 : call[columnKey];
      if (val === undefined || val === null || val === '') {
        uniqueSet.add('(Blanks)');
      } else {
        uniqueSet.add(val);
      }
    });
    return Array.from(uniqueSet).sort((a, b) => {
      if (a === '(Blanks)') return 1;
      if (b === '(Blanks)') return -1;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
    });
  }

  function closePopup() {
    // 如果在 Split 模式下關閉，先還原
    if (isSplitMode) {
        toggleSplit(); 
    }
    popup.style.display = 'none';
    if (!isMaximized) {
        localStorage.setItem('callSummaryPopupWidth', popup.style.width);
        localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  }

  function toggleMaximize() {
    if (isSplitMode) toggleSplit(); // 互斥
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

  // --- Split View Logic ---
  function toggleSplit() {
    // 1. 處理互斥狀態
    if (isMaximized) toggleMaximize();

    if (!isSplitMode) {
        // === 進入 Split Mode ===
        
        // A. 記錄當前 Floating 狀態
        preSplitState = {
            width: popup.style.width,
            height: popup.style.height,
            left: popup.style.left,
            top: popup.style.top,
            position: popup.style.position,
            display: popup.style.display // 記錄之前的 display 狀態
        };

        // B. 修改樣式與類別
        popup.classList.add('split-mode');
        // 強制顯示 (覆蓋可能的 display: none)
        popup.style.display = 'flex'; 
        splitResizer.style.display = 'block';
        
        // C. 計算初始寬度 (50% 剩餘空間)
        // 取得 Sidebar 寬度 (如果有的話)
        const sidebarWidth = document.getElementById('sidebar')?.offsetWidth || 0;
        const availableWidth = window.innerWidth - sidebarWidth - 5; // -5 是 resizer 寬度
        const halfWidth = Math.floor(availableWidth / 2);
        
        popup.style.width = `${halfWidth}px`;
        popup.style.height = ''; // 高度由 CSS height: 100% 控制
        
        // D. 更新按鈕圖示 [CHANGED]
        splitBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>'; 
        splitBtn.title = 'Restore Floating';
        
        // E. 隱藏不必要的按鈕
        maxBtn.style.display = 'none';

        isSplitMode = true;

    } else {
        // === 退出 Split Mode (還原) ===
        
        // A. 移除樣式與類別
        popup.classList.remove('split-mode');
        splitResizer.style.display = 'none';
        
        // B. 還原位置與大小
        popup.style.position = 'absolute';
        popup.style.width = preSplitState.width || '1000px';
        popup.style.height = preSplitState.height || '300px';
        popup.style.left = preSplitState.left || '100px';
        popup.style.top = preSplitState.top || '100px';
        
        // 恢復之前的 display 狀態
        popup.style.display = 'block';
        
        // C. 更新按鈕圖示 [CHANGED]
        splitBtn.innerHTML = getIconString('splitView');
        splitBtn.title = 'Split View';

        // D. 恢復按鈕顯示
        maxBtn.style.display = '';

        isSplitMode = false;
    }

    // F. 觸發 Resize 事件以重繪 Spectrogram
    requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
    });
  }

  // --- Split Resizer Logic ---
  let splitStartX = 0;
  let splitStartPopupWidth = 0;

  function onSplitResizeStart(e) {
    if (!isSplitMode) return;
    e.preventDefault();
    isResizingSplit = true;
    splitStartX = e.clientX;
    splitStartPopupWidth = popup.offsetWidth;
    splitResizer.classList.add('active');
    
    document.body.style.cursor = 'col-resize';
    
    document.addEventListener('mousemove', onSplitResizeMove);
    document.addEventListener('mouseup', onSplitResizeEnd);
  }

  function onSplitResizeMove(e) {
    if (!isResizingSplit) return;
    const dx = e.clientX - splitStartX;
    const newWidth = splitStartPopupWidth - dx;
    const sidebarWidth = document.getElementById('sidebar')?.offsetWidth || 0;
    const maxAvailable = window.innerWidth - sidebarWidth - 100;

    if (newWidth > 200 && newWidth < maxAvailable) {
        popup.style.width = `${newWidth}px`;
    }
  }

  function onSplitResizeEnd() {
    isResizingSplit = false;
    splitResizer.classList.remove('active');
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onSplitResizeMove);
    document.removeEventListener('mouseup', onSplitResizeEnd);
    window.dispatchEvent(new Event('resize'));
  }

  // --- Window Dragging ---
  function onWindowDragStart(e) {
    if (e.target.closest('button')) return;
    if (isMaximized || isSplitMode) return;
    isDraggingWindow = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    popupStartX = popup.offsetLeft; popupStartY = popup.offsetTop;
  }
  function onWindowDragMove(e) {
    if (!isDraggingWindow || isMaximized || isSplitMode) return;
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
    let filtered = allCalls.filter((call, idx) => {
      for (const [key, filterVal] of Object.entries(filterState)) {
        if (!filterVal) continue;
        let cellValue;
        if (key === 'id') cellValue = idx + 1;
        else cellValue = call[key];
        
        const compareValue = (cellValue === undefined || cellValue === null || cellValue === '') 
                             ? '(Blanks)' : cellValue;

        if (filterVal instanceof Set) {
            if (!filterVal.has(compareValue)) return false;
        } else if (typeof filterVal === 'string') {
            if (key === '__discard') continue;
            const fLower = filterVal.toLowerCase();
            if (typeof cellValue === 'number') {
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
                 if (!String(cellValue).includes(filterVal)) return false;
              }
            } else {
              if (!String(compareValue).toLowerCase().includes(fLower)) return false;
            }
        }
      }
      return true;
    });

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
    if (key === '__discard') return;
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

  function handleDiscardToggle(originalIndex, isChecked) {
    if (isChecked) discardedIds.add(originalIndex);
    else discardedIds.delete(originalIndex);
    const row = container.querySelector(`tr[data-original-index="${originalIndex}"]`);
    if (row) {
      if (isChecked) row.classList.add('discarded');
      else row.classList.remove('discarded');
    }
  }

  // --- Action Menu (For Discard Column) ---
  function showActionMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const existing = document.getElementById('action-ctx-menu');
    if (existing) existing.remove();
    const colMenu = document.getElementById('col-ctx-menu');
    if (colMenu) colMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'action-ctx-menu';
    menu.className = 'col-ctx-menu'; 
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.minWidth = '160px';

    const header = document.createElement('div');
    header.className = 'col-ctx-header';
    header.innerText = 'Actions';
    menu.appendChild(header);

    const body = document.createElement('div');
    body.className = 'col-ctx-body';

    const options = [
        { 
            label: 'Clear all', 
            icon: 'fa-trash', 
            action: () => {
                if (confirm('Are you sure you want to clear ALL calls?')) {
                    // 通知外部清空
                    if (typeof onClearAll === 'function') {
                        onClearAll();
                    }
                    // 本地清空 (雖然外部更新回來也會清空，但這樣 UI 反應更快)
                    allCalls = [];
                    displayCalls = [];
                    discardedIds.clear();
                    renderTable();
                }
            } 
        },
        { 
            label: 'Clear selected', 
            icon: 'fa-eraser', 
            action: () => {
                if (discardedIds.size === 0) {
                    alert('No rows selected (checked).');
                    return;
                }
                
                if (confirm(`Remove ${discardedIds.size} selected call(s)?`)) {
                    // 將 Set 轉為 Array 傳遞出去
                    const indicesToRemove = Array.from(discardedIds);
                    
                    if (typeof onDeleteCalls === 'function') {
                        onDeleteCalls(indicesToRemove);
                    }
                    
                    // 清空選取狀態
                    discardedIds.clear();
                }
            } 
        },
        { separator: true },
        { label: 'Export .xlsx', icon: 'fa-file-excel', action: () => console.log('Export xlsx clicked') },
        { label: 'Export .csv', icon: 'fa-file-csv', action: () => console.log('Export csv clicked') }
    ];

    options.forEach(opt => {
        if (opt.separator) {
            const sep = document.createElement('div');
            sep.style.borderTop = '1px solid var(--border-color)';
            sep.style.margin = '4px 0';
            body.appendChild(sep);
            return;
        }

        const item = document.createElement('div');
        item.className = 'col-ctx-item';
        item.innerHTML = `<i class="fa-solid ${opt.icon}" style="width:20px; text-align:center; margin-right:8px; color:var(--text-secondary);"></i> ${opt.label}`;
        
        item.onclick = (ev) => {
            ev.stopPropagation();
            opt.action();
            menu.remove();
        };
        body.appendChild(item);
    });

    menu.appendChild(body);
    document.body.appendChild(menu);

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  // --- Context Menu (Column Visibility) ---
  function showContextMenu(e) {
    e.preventDefault();
    const existing = document.getElementById('col-ctx-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'col-ctx-menu';
    menu.className = 'col-ctx-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    // 1. Header (固定在頂部)
    const header = document.createElement('div');
    header.className = 'col-ctx-header';
    header.innerText = 'Field selection';
    menu.appendChild(header);

    // 2. Scrollable Body (包裹選項的容器)
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'col-ctx-body';
    menu.appendChild(scrollContainer);

    columns.forEach((col, idx) => {
      if (col.key === '__discard') return;

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
      lbl.innerHTML = col.label;

      item.appendChild(cb);
      item.appendChild(lbl);
      item.onclick = () => {
        cb.checked = !cb.checked;
        col.visible = cb.checked;
        renderTable();
      };
      
      scrollContainer.appendChild(item);
    });

    document.body.appendChild(menu);
    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  function renderTable() {
    processData();
    container.innerHTML = '';

    if (displayCalls.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">No data found</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'summary-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    columns.forEach((col, idx) => {
      if (!col.visible) return;
      const th = document.createElement('th');
      th.style.width = `${col.width}px`;
      if (col.tooltip) th.title = col.tooltip;

      if (col.key === '__discard') {
          th.classList.add('th-action-col');
      }

      const thContent = document.createElement('div');
      thContent.className = 'th-content';
      
      // [修改] 1. 建立 Label Container
      const labelContainer = document.createElement('div');
      labelContainer.className = 'th-label-container';
      
      // [NEW] 針對 __discard 欄位特殊處理
      if (col.key === '__discard') {
          const menuIcon = document.createElement('i');
          menuIcon.className = 'fas fa-bars';
          menuIcon.style.cursor = 'pointer';
          menuIcon.style.opacity = '0.7';
          
          // Hover effect setup (optional via inline or css)
          menuIcon.onmouseover = () => menuIcon.style.opacity = '1';
          menuIcon.onmouseout = () => menuIcon.style.opacity = '0.7';

          // 點擊觸發 Action Menu
          menuIcon.onclick = (e) => {
              e.stopPropagation();
              showActionMenu(e);
          };
          
          labelContainer.appendChild(menuIcon);
      } else {
          // 一般欄位顯示文字
          const textSpan = document.createElement('span');
          textSpan.className = 'th-text';
          textSpan.innerHTML = col.label;
          labelContainer.appendChild(textSpan);
          
          // 點擊文字觸發排序
          if (!col.noSort) {
            labelContainer.onclick = () => handleSort(col.key);
          }
      }
      
      thContent.appendChild(labelContainer);

      // [修改] 2. Sort Icon (一般欄位才顯示)
      if (sortState.key === col.key && sortState.direction !== 'none') {
        const sortIcon = document.createElement('i');
        sortIcon.className = 'sort-icon fa-solid';
        sortIcon.className += (sortState.direction === 'asc') ? ' fa-arrow-up' : ' fa-arrow-down';
        
        if (!col.noSort) {
            sortIcon.onclick = (e) => {
                e.stopPropagation(); 
                handleSort(col.key);
            };
        }
        thContent.appendChild(sortIcon);
      }

      // [保持不變] Filter Icon
      if (!col.noFilter) {
          const filterIcon = document.createElement('i');
          const isActive = filterState[col.key] !== undefined;
          filterIcon.className = `fa-solid fa-filter filter-icon-btn ${isActive ? 'active' : ''}`;
          filterIcon.title = 'Filter';
          filterIcon.onclick = (e) => {
              e.stopPropagation();
              createFilterMenu(th, col.key);
          };
          thContent.appendChild(filterIcon);
      }
      
      // [NEW] 右鍵選單邏輯：__discard 不顯示 Field selection
      if (col.key === '__discard') {
          thContent.oncontextmenu = (e) => {
              e.preventDefault();
              e.stopPropagation();
              // 可以在這裡決定是否右鍵也能開 Action Menu，目前設為不做任何事(屏蔽)
          };
      } else {
          thContent.oncontextmenu = (e) => showContextMenu(e);
      }

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'resize-handle';
      resizeHandle.onmousedown = (e) => onColumnResizeStart(e, idx);

      th.appendChild(thContent);
      if (col.key !== '__discard') {
          const resizeHandle = document.createElement('div');
          resizeHandle.className = 'resize-handle';
          resizeHandle.onmousedown = (e) => onColumnResizeStart(e, idx);
          th.appendChild(resizeHandle);
      }
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    displayCalls.forEach((call) => {
      const originalIndex = allCalls.indexOf(call);
      const isDiscarded = discardedIds.has(originalIndex);

      const row = document.createElement('tr');
      row.setAttribute('data-original-index', originalIndex);
      if (isDiscarded) row.classList.add('discarded');

      columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        if (col.key === '__discard') {
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
            if (col.digits !== undefined) value = value.toFixed(col.digits);
            else value = value.toString();
          } else if (value === undefined || value === null) {
            value = '-';
          }
          td.textContent = value;
          td.title = value;
        }
        row.appendChild(td);
      });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const prevSelected = container.querySelector('tr.summary-row-selected');
        if (prevSelected) prevSelected.classList.remove('summary-row-selected');
        row.classList.add('summary-row-selected');
        if (typeof onCallSelected === 'function') {
          onCallSelected(originalIndex);
        }
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function updateTable(calls) {
    allCalls = calls || [];
    renderTable();
  }

  function openPopup() {
    popup.style.display = 'block';

    if (!isSplitMode) {
        toggleSplit();
    }

    if (!isSplitMode && !isMaximized) {
        const savedWidth = localStorage.getItem('callSummaryPopupWidth');
        const savedHeight = localStorage.getItem('callSummaryPopupHeight');
        if (savedWidth) popup.style.width = savedWidth;
        if (savedHeight) popup.style.height = savedHeight;
        const rect = popup.getBoundingClientRect();
        if (rect.top < 0 || rect.left < 0) {
            popup.style.top = '100px'; popup.style.left = '100px';
        }
    }
  }

  popup.addEventListener('mousemove', (e) => {
    if (isMaximized || isSplitMode) return;
    if (isDraggingWindow || isResizingWindow) return;
    const state = getEdgeState(e.clientX, e.clientY);
    const cursor = edgeCursor(state);
    popup.style.cursor = cursor || 'default';
  });

  popup.addEventListener('mousedown', (e) => {
    if (isMaximized || isSplitMode) return;
    if (e.target === dragBar || dragBar.contains(e.target)) return;
    const state = getEdgeState(e.clientX, e.clientY);
    if (state.onLeft || state.onRight || state.onTop || state.onBottom) {
      isResizingWindow = true;
      resizeLeft = state.onLeft;
      resizeRight = state.onRight;
      resizeTop = state.onTop;
      resizeBottom = state.onBottom;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = popup.offsetWidth;
      startHeight = popup.offsetHeight;
      startLeft = popup.offsetLeft;
      startTop = popup.offsetTop;
      e.preventDefault();
      e.stopPropagation();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizingWindow) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const minW = 400; 
    const minH = 200;
    let newW = startWidth;
    let newH = startHeight;
    let newL = startLeft;
    let newT = startTop;

    if (resizeRight) newW = Math.max(minW, startWidth + dx);
    if (resizeBottom) newH = Math.max(minH, startHeight + dy);
    if (resizeLeft) {
      const w = Math.max(minW, startWidth - dx);
      if (w !== startWidth) { newW = w; newL = startLeft + dx; }
    }
    if (resizeTop) {
      const h = Math.max(minH, startHeight - dy);
      if (h !== startHeight) { newH = h; newT = startTop + dy; }
    }
    popup.style.width = `${newW}px`;
    popup.style.height = `${newH}px`;
    popup.style.left = `${newL}px`;
    popup.style.top = `${newT}px`;
  }, true);

  window.addEventListener('mouseup', () => {
    if (isResizingWindow) {
      isResizingWindow = false;
      popup.style.cursor = '';
      localStorage.setItem('callSummaryPopupWidth', popup.style.width);
      localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  }, true);

  btn.addEventListener('click', openPopup);
  closeBtn.addEventListener('click', closePopup);
  maxBtn.addEventListener('click', toggleMaximize);

  if (splitBtn) splitBtn.addEventListener('click', toggleSplit);
  if (splitResizer) splitResizer.addEventListener('mousedown', onSplitResizeStart);

  dragBar.addEventListener('mousedown', onWindowDragStart);
  document.addEventListener('mousemove', onWindowDragMove);
  document.addEventListener('mouseup', onWindowDragEnd);

  const observer = new ResizeObserver(() => {
    if (!isMaximized && !isSplitMode && popup.style.display !== 'none') {
      localStorage.setItem('callSummaryPopupWidth', popup.style.width);
      localStorage.setItem('callSummaryPopupHeight', popup.style.height);
    }
  });
  observer.observe(popup);

  function createFilterMenu(targetTh, columnKey) {
    const existing = document.getElementById('gs-filter-popup');
    if (existing) existing.remove();
    const uniqueList = getSortedUniqueValues(columnKey);
    const currentSet = filterState[columnKey];
    const isFilterActive = (currentSet instanceof Set);
    const menu = document.createElement('div');
    menu.id = 'gs-filter-popup';
    menu.className = 'gs-filter-menu';
    menu.innerHTML = `
      <div class="gs-menu-item" id="sort-asc"><i class="fa-solid fa-arrow-down-a-z"></i> Sort A to Z</div>
      <div class="gs-menu-item" id="sort-desc"><i class="fa-solid fa-arrow-down-z-a"></i> Sort Z to A</div>
      <div class="gs-divider"></div>
      <div class="gs-section-header">Filter by values</div>
      <div class="gs-search-container"><input type="text" class="gs-search-input" placeholder="Search..."></div>
      <div class="gs-quick-actions">
        <span class="gs-action-link" id="action-select-all">Select all</span>
        <span class="gs-action-link" id="action-clear">Clear</span>
      </div>
      <div class="gs-value-list" id="gs-value-list-container"></div>
      <div class="gs-divider"></div>
      <div class="gs-footer">
        <button class="gs-btn gs-btn-cancel">Cancel</button>
        <button class="gs-btn gs-btn-ok">OK</button>
      </div>
    `;
    const listContainer = menu.querySelector('#gs-value-list-container');
    uniqueList.forEach((val, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'gs-value-item';
      const isChecked = !isFilterActive || currentSet.has(val);
      const safeValue = encodeURIComponent(String(val));
      itemDiv.innerHTML = `
        <input type="checkbox" id="chk-${idx}" data-val="${safeValue}" ${isChecked ? 'checked' : ''}>
        <label for="chk-${idx}">${val}</label>
      `;
      itemDiv.onclick = (e) => {
        if(e.target.tagName !== 'INPUT') {
          const cb = itemDiv.querySelector('input');
          cb.checked = !cb.checked;
        }
      };
      listContainer.appendChild(itemDiv);
    });
    const rect = targetTh.getBoundingClientRect();
    const leftPos = (rect.left + 280 > window.innerWidth) ? (window.innerWidth - 290) : rect.left;
    menu.style.left = `${leftPos}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    document.body.appendChild(menu);

    menu.querySelector('#sort-asc').onclick = () => {
        sortState.key = columnKey; sortState.direction = 'asc'; renderTable(); menu.remove();
    };
    menu.querySelector('#sort-desc').onclick = () => {
        sortState.key = columnKey; sortState.direction = 'desc'; renderTable(); menu.remove();
    };
    const searchInput = menu.querySelector('.gs-search-input');
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const items = listContainer.querySelectorAll('.gs-value-item');
        items.forEach(item => {
            const text = item.querySelector('label').textContent.toLowerCase();
            if (text.includes(term)) item.style.display = 'flex';
            else item.style.display = 'none';
        });
    });
    searchInput.focus();
    menu.querySelector('#action-select-all').onclick = () => {
        const visibleItems = Array.from(listContainer.querySelectorAll('.gs-value-item')).filter(el => el.style.display !== 'none');
        visibleItems.forEach(el => el.querySelector('input').checked = true);
    };
    menu.querySelector('#action-clear').onclick = () => {
        const visibleItems = Array.from(listContainer.querySelectorAll('.gs-value-item')).filter(el => el.style.display !== 'none');
        visibleItems.forEach(el => el.querySelector('input').checked = false);
    };
    menu.querySelector('.gs-btn-cancel').onclick = () => menu.remove();
    menu.querySelector('.gs-btn-ok').onclick = () => {
        const checkedInputs = listContainer.querySelectorAll('input[type="checkbox"]:checked');
        const allInputs = listContainer.querySelectorAll('input[type="checkbox"]');
        if (checkedInputs.length === allInputs.length) {
            delete filterState[columnKey];
        } else {
            const allowedSet = new Set();
            checkedInputs.forEach(input => {
                const index = parseInt(input.id.split('-')[1]);
                allowedSet.add(uniqueList[index]); 
            });
            filterState[columnKey] = allowedSet;
        }
        const icon = targetTh.querySelector('.filter-icon-btn');
        if (filterState[columnKey]) icon.classList.add('active');
        else icon.classList.remove('active');
        renderTable();
        menu.remove();
    };
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

  return {
    updateTable,
    openPopup,
    closePopup,
    getCurrentCalls: () => displayCalls
  };
}