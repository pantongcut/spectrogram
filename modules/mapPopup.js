import { getCurrentIndex, getFileMetadata, getFileList, getFileIconState } from './fileState.js';
import { showMessageBox } from './messageBox.js';
import { Dropdown } from './dropdown.js';
import MarkerClusteringManager from './markerClusteringManager.js';

let importKmlFileFn = null;
let clusterManager = null;
let surveyPointsDataPending = false; // Track if survey points data needs to be loaded
let surveyPointsLoaded = false; // Track if survey points have been successfully loaded

export function initMapPopup({
  buttonId = 'mapBtn',
  popupId = 'mapPopup',
  mapId = 'map'
} = {}) {
  const btn = document.getElementById(buttonId);
  const popup = document.getElementById(popupId);
  const mapDiv = document.getElementById(mapId);
  const viewer = document.getElementById('viewer-container');
  const controlBar = document.getElementById('control-bar');
  const sidebar = document.getElementById('sidebar');
  const dragBar = popup.querySelector('.popup-drag-bar');
  const closeBtn = popup.querySelector('.popup-close-btn');
  const minBtn = popup.querySelector('.popup-min-btn');
  const maxBtn = popup.querySelector('.popup-max-btn');
  const loadedHabitatsCache = {};

  if (!btn || !popup || !mapDiv) return;
  popup.style.overflow = 'hidden';
  mapDiv.style.outline = 'none';
  popup.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
  });

  mapDiv.style.cursor = 'default';

  const edgeThreshold = 5;

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
    let cursor = '';
    if ((onLeft && onTop) || (onRight && onBottom)) {
      cursor = 'nwse-resize';
    } else if ((onRight && onTop) || (onLeft && onBottom)) {
      cursor = 'nesw-resize';
    } else if (onLeft || onRight) {
      cursor = 'ew-resize';
    } else if (onTop || onBottom) {
      cursor = 'ns-resize';
    }
    return cursor;
  }
  let popupWidth = parseInt(localStorage.getItem('mapPopupWidth'), 10);
  let popupHeight = parseInt(localStorage.getItem('mapPopupHeight'), 10);
  if (isNaN(popupWidth) || popupWidth <= 0) popupWidth = 800;
  if (isNaN(popupHeight) || popupHeight <= 0) popupHeight = 800;
  popup.style.width = `${popupWidth}px`;
  popup.style.height = `${popupHeight}px`;

  let map = null;
  let markers = [];
  let activeLoadingRequests = 0; // 計算目前正在進行的請求數量
  let loadingBarEl = null; // 保存 loading bar DOM 元素的引用
  let polylines = [];

  // 開始讀取時呼叫
  function startLoading() {
    activeLoadingRequests++;
    updateLoadingBarState();
  }

  // 結束讀取時呼叫 (成功或失敗都算)
  function stopLoading() {
    if (activeLoadingRequests > 0) {
      activeLoadingRequests--;
    }
    updateLoadingBarState();
  }

  // 根據請求數量決定是否顯示 Loading Bar
  function updateLoadingBarState() {
    if (!loadingBarEl) return;

    if (activeLoadingRequests > 0) {
      loadingBarEl.style.display = 'block';
    } else {
      activeLoadingRequests = 0;
      loadingBarEl.style.display = 'none';
    }
  }
  let routeBtn = null;
  let routeToggleBtn = null;
  let routeBtnGroup = null;
  let kmlPolylines = [];
  let importBtn = null;
  let clearKmlBtn = null;
  let clearTextBtn = null;
  let drawBtn = null;
  let textBtn = null;
  let professionalBtn = null;
  let exportBtn = null;
  let textMode = false;
  let textMarkers = [];
  let activeTextInput = null;
  let suppressNextTextClick = false;
  let drawControl = null;
  let drawnItems = null;
  let drawControlVisible = false;
  let layersControl = null;
  let hkgridLayer = null;
  // overlays handling (moved to outer scope so togglePopup can access)
  let overlaysPending = []; // { layer, name }
  let overlaysLoaded = false; // whether overlays have been added to layersControl
  let overlaysPromptShown = false; // whether we already showed the password prompt (only show once)
  const HASHED_PASSWORD = '8e81149cfda80214b01f32e8e96ede43ee9c42b797e7af1c5c979429622ce40c';

  function loadOverlays() {
    if (overlaysLoaded) return;
    overlaysPending.forEach(({ layer, name }) => {
      try {
        layersControl.addOverlay(layer, name);
      } catch (e) {
        // ignore
      }
    });
    overlaysPending = [];
    overlaysLoaded = true;
    // hide professional control if present
    try {
      if (professionalBtn?.parentElement) {
        professionalBtn.parentElement.style.display = 'none';
      }
    } catch (e) { }
    // Load survey points data after password is verified
    if (!surveyPointsLoaded && !surveyPointsDataPending) {
      loadSurveyPointsData();
    }
  }

  // Load survey points data from remote source
  function loadSurveyPointsData() {
    if (surveyPointsDataPending || surveyPointsLoaded) return;
    surveyPointsDataPending = true;

    fetch("https://opensheet.elk.sh/1Al_sWwiIU6DtQv6sMFvXb9wBUbBiE-zcYk8vEwV82x8/sheet3")
      .then(r => r.json())
      .then(points => {
        // Initialize clustering manager if not already done
        if (!clusterManager) {
          clusterManager = new MarkerClusteringManager(map, {
            maxVisibleMarkers: 500,
            enableAnimation: true,
            animationDuration: 300,
          });
        }

        // Format data for clustering system
        const formattedPoints = points
          .filter(pt => {
            const lat = parseFloat(pt.Latitude);
            const lon = parseFloat(pt.Longitude);
            return !isNaN(lat) && !isNaN(lon);
          })
          .map((pt, idx) => ({
            id: `survey_${idx}`,
            lat: parseFloat(pt.Latitude),
            lng: parseFloat(pt.Longitude),
            location: pt.Location,
          }));

        // Set survey points in clustering manager
        clusterManager.setSurveyPoints(formattedPoints);

        // Add single Survey point overlay that dynamically shows clusters or markers based on zoom
        try {
          // Create a combined layer group that will be managed dynamically
          const surveyPointLayer = L.layerGroup();

          if (layersControl) {
            layersControl.addOverlay(surveyPointLayer, 'Survey point');
          }

          // Function to update layer visibility based on zoom level
          const updateSurveyPointLayers = () => {
            if (!map.hasLayer(surveyPointLayer)) return; // Only update if overlay is checked

            const clusterLayerGroup = clusterManager.getClusterLayerGroup();
            const markerLayerGroup = clusterManager.getMarkerLayerGroup();

            // 在清除前，保存 pinned markers 資訊
            const pinnedMarkersData = [];
            surveyPointLayer.eachLayer(layer => {
              if (layer._tooltipPinned && layer._pinnedIsPopup) {
                pinnedMarkersData.push({
                  id: layer._surveyPointData?.id,
                  shouldReopen: true
                });
              }
            });

            surveyPointLayer.clearLayers();

            const isClustered = clusterManager.isClustered;

            console.log(`[MapPopup] updateSurveyPointLayers: isClustered=${isClustered}, clusters=${clusterManager.currentClusters?.length || 0}, visibleMarkers=${clusterManager.currentVisibleMarkers?.length || 0}`);

            if (isClustered && clusterLayerGroup) {
              clusterLayerGroup.eachLayer(layer => {
                surveyPointLayer.addLayer(layer);
              });
            } else if (!isClustered && markerLayerGroup) {
              markerLayerGroup.eachLayer(layer => {
                surveyPointLayer.addLayer(layer);
              });
            }

            // Sync pinned markers from clusterManager after layers are updated
            if (clusterManager.getPinnedMarkers) {
              pinnedSurveyMarkers = clusterManager.getPinnedMarkers();
              // 重新打開所有 pinned popups（因為層重新添加時 popup 會被關閉）
              setTimeout(() => {
                pinnedSurveyMarkers.forEach(m => {
                  try {
                    if (m?._tooltipPinned && m._pinnedIsPopup) {
                      m.openPopup();
                    }
                  } catch (e) { }
                });
              }, 20);
            }
          };

          // Listen to map events to update layers dynamically
          map.on('zoomend', updateSurveyPointLayers);
          map.on('moveend', updateSurveyPointLayers);

          // Listen to overlay toggle
          map.on('overlayadd', (e) => {
            if (e.name === 'Survey point') {
              updateSurveyPointLayers();
            }
          });

          // Store reference for later use
          clusterManager.surveyPointLayer = surveyPointLayer;
          clusterManager.updateSurveyPointLayers = updateSurveyPointLayers;
        } catch (e) {
          console.error('[MapPopup] Error adding survey point overlay:', e);
        }

        surveyPointsLoaded = true;
        surveyPointsDataPending = false;
        console.log('[MapPopup] Survey points loaded successfully');
      })
      .catch(err => {
        console.error('[MapPopup] Error loading survey points:', err);
        surveyPointsDataPending = false;
      });
  }

  async function computeSHA256Hex(text) {
    try {
      const enc = new TextEncoder().encode(text);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      return hex;
    } catch (e) {
      return null;
    }
  }

  // Deprecated automatic prompt. We won't auto-prompt when popup opens.
  function promptForPasswordIfNeeded() {
    // intentionally no-op to prevent automatic popup on map open
  }

  // Show professional password prompt on-demand (triggered by the Professional button)
  async function showProfessionalPrompt() {
    try {
      overlaysPromptShown = true;
      const showPasswordPrompt = () => {
        showMessageBox({
          title: 'Professional option',
          message: 'To access more layers, please enter password.',
          confirmText: 'Confirm',
          cancelText: 'Cancel',
          input: true,
          inputType: 'password',
          onConfirm: async (val) => {
            const hex = await computeSHA256Hex(val || '');
            if (hex && hex === HASHED_PASSWORD) {
              loadOverlays();
              // hide professional button if present
              try {
                if (professionalBtn) {
                  const parent = professionalBtn.parentElement;
                  if (parent) parent.style.display = 'none';
                }
              } catch (e) { }
            } else {
              showMessageBox({
                message: 'Wrong password',
                confirmText: 'OK',
                onConfirm: () => {
                  showPasswordPrompt();
                }
              });
            }
          },
          onCancel: () => {
          }
        });
      };
      showPasswordPrompt();
    } catch (e) {
      // ignore
    }
  }
  const coordScaleWrapper = mapDiv.querySelector('.coord-scale-wrapper');
  const coordDisplay = mapDiv.querySelector('#coord-display');
  const noCoordMsg = mapDiv.querySelector('#no-coord-message');
  const copyCoordMsg = mapDiv.querySelector('#copy-coord-message');
  let copyMsgTimer = null;
  let scaleControl = null;
  let isMapDragging = false;
  let isMapZooming = false; // Track if map is zooming
  let layersControlContainer = null;
  let zoomControlContainer = null;
  let routeToggleContainer = null;
  let exportControlContainer = null;
  let textToggleContainer = null;
  const kmlInput = document.createElement('input');
  kmlInput.type = 'file';
  kmlInput.accept = '.kml';
  kmlInput.style.display = 'none';
  popup.appendChild(kmlInput);
  const mapDropOverlay = document.getElementById('map-drop-overlay');
  let dropCounter = 0;

  // =========== NEW: 通用浮動訊息 (Generic Map Floating Message) ===========
  let floatingMsgEl = null;
  let floatingMsgTimer = null;

  function createFloatingMessage() {
    if (!mapDiv) return;
    // 檢查是否已存在
    if (document.getElementById('map-floating-msg-container')) return;

    floatingMsgEl = document.createElement('div');
    floatingMsgEl.id = 'map-floating-msg-container';
    floatingMsgEl.className = 'map-floating-message'; // 使用 CSS 定義的樣式
    
    mapDiv.appendChild(floatingMsgEl);
  }

  // 通用顯示函數：text 為要顯示的文字
  function showFloatingMessage(text) {
    if (!floatingMsgEl) createFloatingMessage();
    
    if (floatingMsgEl) {
      floatingMsgEl.innerText = text; // 設定動態文字
      floatingMsgEl.style.display = 'block';
      
      // 清除舊的 timer
      if (floatingMsgTimer) clearTimeout(floatingMsgTimer);
      
      // 3秒後自動消失
      floatingMsgTimer = setTimeout(() => {
        floatingMsgEl.style.display = 'none';
      }, 3000);
    }
  }
  // =================================================================

  let ctrlPressed = false;
  let markerPointerSuppressed = false; // 當拖動/縮放期間暫時抑制 marker tooltip

  function updateMarkerPointerEvents() {
    // 如果被全域抑制（drag/zoom），則不要改變 pointerEvents
    if (markerPointerSuppressed) return;
    const all = [...markers, ...textMarkers];
    all.forEach(m => {
      const el = m.getElement ? m.getElement() : m._icon;
      if (el) {
        el.style.pointerEvents = ctrlPressed ? 'none' : '';
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !ctrlPressed) {
      ctrlPressed = true;
      updateMarkerPointerEvents();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlPressed) {
      ctrlPressed = false;
      updateMarkerPointerEvents();
    }
  });

  function updateCursor() {
    if (isMapDragging) {
      mapDiv.style.cursor = 'grabbing';
    } else if (textMode) {
      mapDiv.style.cursor = 'text';
    } else {
      mapDiv.style.cursor = 'default';
    }
  }

  function showMapDropOverlay() {
    if (mapDropOverlay) {
      mapDropOverlay.style.display = 'flex';
      mapDropOverlay.style.pointerEvents = 'auto';
    }
    map?.dragging.disable();
  }

  function hideMapDropOverlay() {
    if (mapDropOverlay) {
      mapDropOverlay.style.display = 'none';
      mapDropOverlay.style.pointerEvents = 'none';
    }
    map?.dragging.enable();
  }

  function showNoCoordMessage() {
    if (noCoordMsg) noCoordMsg.style.display = 'flex';
  }

  function hideNoCoordMessage() {
    if (noCoordMsg) noCoordMsg.style.display = 'none';
  }

  function showCopyCoordMessage() {
    if (!copyCoordMsg) return;
    copyCoordMsg.style.display = 'flex';
    clearTimeout(copyMsgTimer);
    copyMsgTimer = setTimeout(() => {
      copyCoordMsg.style.display = 'none';
    }, 3000);
  }

  mapDiv.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    dropCounter++;
    showMapDropOverlay();
  });

  mapDiv.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  mapDiv.addEventListener('dragleave', (e) => {
    if (!e.dataTransfer.types?.includes('Files')) return;
    e.preventDefault();
    dropCounter--;
    if (dropCounter <= 0) hideMapDropOverlay();
  });

  mapDiv.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropCounter = 0;
    hideMapDropOverlay();
    const file = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.kml'));
    if (file) {
      await importKml(file);
    }
  });

  function createMap(lat, lon) {
    map = L.map(mapDiv, { 
      keyboard: false 
    }).setView([lat, lon], 13);
    
    // 確保訊息元素已被建立
    createFloatingMessage();

    // 獲取 Loading Bar 元素的引用並重置狀態
    loadingBarEl = mapDiv.querySelector('.map-loading-bar');
    activeLoadingRequests = 0;
    updateLoadingBarState();
    
    map.on('click', () => {
      try {
        // 如果地圖正在被使用者拖曳，則不要自動重新開啟 pinned tooltip/popup
        if (isMapDragging) return;
        pinnedSurveyMarkers.forEach(m => {
          try {
            if (m?._tooltipPinned) {
              if (m._pinnedIsPopup) m.openPopup(); else m.openTooltip();
            }
          } catch (e) { }
        });
      } catch (e) { }
    });
    // also listen for clicks outside the map (document) to re-open pinned displays
    document.addEventListener('click', () => {
      try {
        // 如果使用者正在拖曳地圖，避免在全域點擊事件中重新開啟 pinned tooltip/popup
        if (isMapDragging) return;
        pinnedSurveyMarkers.forEach(m => {
          try {
            if (m?._tooltipPinned) {
              if (m._pinnedIsPopup) m.openPopup(); else m.openTooltip();
            }
          } catch (e) { }
        });
      } catch (e) { }
    });
    // Protect pinned tooltips/popups: if Leaflet emits close events for pinned layers,
    // immediately re-open them so they remain visible when other markers are clicked.
    if (map && map.on) {
      map.on('tooltipclose', (e) => {
        try {
          // 在使用者拖曳地圖時，不要強制重新開啟 tooltip（以免觸發自動平移）
          if (isMapDragging) return;
          const layer = e.layer || (e.tooltip && e.tooltip._source) || null;
          if (layer && pinnedSurveyMarkers.has(layer) && layer._tooltipPinned && !layer._pinnedIsPopup) {
            setTimeout(() => {
              try { if (layer._tooltipPinned) layer.openTooltip(); } catch (err) { }
            }, 0);
          }
        } catch (err) { }
      });
      map.on('popupclose', (e) => {
        try {
          // 在使用者拖曳或縮放地圖時，不要強制移除或重新開啟 popup
          // 如果 popup 是 pinned，應該保持開啟直到用戶手動取消 pin
          if (isMapDragging || isMapZooming) return;
          const layer = e.layer || (e.popup && e.popup._source) || (e.popup && e.popup._source) || null;
          if (layer && pinnedSurveyMarkers.has(layer) && layer._tooltipPinned && layer._pinnedIsPopup) {
            // 如果是 pinned popup，重新開啟
            setTimeout(() => {
              try { if (layer._tooltipPinned) layer.openPopup(); } catch (err) { }
            }, 0);
          }
        } catch (err) { }
      });
    }
    // 當拖動或縮放時，不要顯示 marker 的 tooltip (全域抑制)
    function setAllMarkersPointerEvents(enabled) {
      try {
        markerPointerSuppressed = enabled ? false : true;
        // top-level markers & text markers
        const all = [...markers, ...textMarkers];
        all.forEach(m => {
          const el = m.getElement ? m.getElement() : m._icon;
          if (el) el.style.pointerEvents = enabled ? '' : 'none';
        });
        // surveyPointLayer (若存在)
        if (typeof surveyPointLayer !== 'undefined' && surveyPointLayer && surveyPointLayer.eachLayer) {
          surveyPointLayer.eachLayer(l => {
            const el = l.getElement ? l.getElement() : l._icon;
            if (el) el.style.pointerEvents = enabled ? '' : 'none';
          });
        }
      } catch (e) { }
    }
    map.createPane('annotationPane');
    map.getPane('annotationPane').style.zIndex = 650;
    zoomControlContainer = map.zoomControl.getContainer();
    map.on('dragstart', () => { isMapDragging = true; setAllMarkersPointerEvents(false); updateCursor(); });
    map.on('dragend', () => { isMapDragging = false; setAllMarkersPointerEvents(true); updateCursor(); });
    // 當使用者開始/結束縮放時也暫時設置標誌以保護 pinned popups
    map.on('zoomstart', () => { isMapZooming = true; setAllMarkersPointerEvents(false); });
    map.on('zoomend', () => { isMapZooming = false; setAllMarkersPointerEvents(true); });
    updateCursor();
    scaleControl = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
    }).addTo(map);
    if (coordScaleWrapper) {
      const scaleEl = scaleControl.getContainer();
      scaleEl.style.position = 'static';
      coordScaleWrapper.appendChild(scaleEl);
    }
    function updateCoords(latlng) {
      if (!coordDisplay) return;
      const { lat, lng } = latlng;
      coordDisplay.textContent = `${lat.toFixed(4)} ${lng.toFixed(4)}`;
    }
    map.on('mousemove', (e) => updateCoords(e.latlng));
    map.on('move', () => updateCoords(map.getCenter()));
    updateCoords(map.getCenter());

    map.on('contextmenu', (e) => {
      const { lat, lng } = e.latlng;
      const text = `${lat.toFixed(6)}\t${lng.toFixed(6)}`;
      navigator.clipboard?.writeText(text).catch(() => { });
      showCopyCoordMessage();
    });

    const osmAttr = { attribution: '&copy; OpenStreetMap contributors' };
    const esriAttr = { attribution: '&copy; Esri' };
    const cartoAttr = { attribution: '&copy; CARTO' };
    const googleAttr = { attribution: '&copy; Google' };
    const imageryAttr = { attribution: '&copy; HKSAR Government' };
    const landsdAttr = { attribution: '&copy; HKSAR Government' };

    const streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { ...osmAttr, crossOrigin: 'anonymous' }
    ).addTo(map);
    const esriSatellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { ...esriAttr, crossOrigin: 'anonymous' }
    );
    const cartoLight = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { ...cartoAttr, crossOrigin: 'anonymous' }
    );
    const cartoDark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { ...cartoAttr, crossOrigin: 'anonymous' }
    );
    const googleStreets = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );
    const googleSatellite = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );
    const googleHybrid = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      { ...googleAttr, crossOrigin: 'anonymous' }
    );

    const hkImageryLayer = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/wgs84/{z}/{x}/{y}.png',
      { ...imageryAttr, minZoom: 0, maxZoom: 19, crossOrigin: 'anonymous' }
    );

    const hkVectorBase = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
      { ...landsdAttr, maxZoom: 20, minZoom: 10, crossOrigin: 'anonymous' }
    );

    const hkVectorLabel = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/en/wgs84/{z}/{x}/{y}.png',
      { attribution: false, maxZoom: 20, minZoom: 0, crossOrigin: 'anonymous' }
    );

    const hkImageryLabel = L.tileLayer(
      'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/en/wgs84/{z}/{x}/{y}.png',
      { attribution: false, maxZoom: 20, minZoom: 0, crossOrigin: 'anonymous' }
    );

    const googleTerrain = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
      {
        attribution: 'Map data ©2025 Google',
        crossOrigin: 'anonymous'
      }
    );

    const hkVectorGroup = L.layerGroup([hkVectorBase, hkVectorLabel]);
    const hkImageryGroup = L.layerGroup([hkImageryLayer, hkImageryLabel]);

    map.on('zoomend', () => {
      const currentZoom = map.getZoom();
      if (currentZoom > 19 && map.hasLayer(hkImageryGroup)) {
        map.setZoom(19);
      }
    });

    const baseLayers = {
      'OpenStreetMap': streets,
      'Esri Satellite': esriSatellite,
      'Carto Light': cartoLight,
      'Carto Dark': cartoDark,
      'Google Streets': googleStreets,
      'Google Satellite': googleSatellite,
      'Google Hybrid': googleHybrid,
      'Google Terrain': googleTerrain,
      'HK Vector': hkVectorGroup,
      'HK Imagery': hkImageryGroup,
    };

    layersControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);
    layersControlContainer = layersControl.getContainer();

    // =========== 修改: Country Park (Dynamic Simplify Factor) ===========
    
    if (L.esri) {

      const toTitleCase = (str) => {
        if (!str) return '';
        return str.toLowerCase().replace(/(?:^|\s|\(|\[)\w/g, (match) => match.toUpperCase());
      };

      // ============================================================
      // 1. Country Park (MapServer/94)
      // ============================================================
      const countryParkCodes = "CODE in ('ACP','CWBCP','KSCP','KTCP','LTCP','LNECP','LNCP','LSCP','LRCP','LFSCP','MOSCP','PSLCP','PCECP','PCCP','PFLCP','RNCP','SKECP','SKWCP','SKWCPW','SOCP','SMCP','TLCP','TMSCP','TTCP','TTCPQB')";

      const cpLayer = L.esri.featureLayer({
        url: 'https://www.map.gov.hk/arcgis2/rest/services/rGeoInfoMap/rgeo_highlight_d00/MapServer/94',
        where: countryParkCodes,
        idField: 'OBJECTID_1',
        style: function () {
          return {
            color: '#388E3C',
            weight: 2,
            fillOpacity: 0.3,
            fillColor: '#388E3C'
          };
        },
        // 初始設定 (預設一個中間值)
        simplifyFactor: 0.5, 
        precision: 5,
      });

      cpLayer.bindPopup(function (layer) {
        const props = layer.feature.properties;
        const nameEng = toTitleCase(props.NAME || ''); // 轉為 Title Case
        const nameCht = props.C_NAME || '';            // 注意這裡有底線 C_NAME
        
        return `<div class="map-popup-table"><strong>${nameEng}</strong><br>${nameCht}</div>`;
      });

      layersControl.addOverlay(cpLayer, "Country Park");

      // ============================================================
      // 2. Special Area (MapServer/93)
      // ============================================================
      const specialAreaCodes = "CP_NO in ('1005','1006','1007','1012','1022','1024','1035','1053','1047','1048','1050')";

      const saLayer = L.esri.featureLayer({
        url: 'https://www.map.gov.hk/arcgis2/rest/services/rGeoInfoMap/rgeo_highlight_d00/MapServer/93',
        where: specialAreaCodes,
        idField: 'OBJECTID', 
        style: function () {
          return {
            color: '#005205ff',
            weight: 2,
            fillOpacity: 0.3,
            fillColor: '#005205ff'
          };
        },
        simplifyFactor: 0.5,
        precision: 5,
      });

      saLayer.bindPopup(function (layer) {
        const props = layer.feature.properties;
        const nameEng = toTitleCase(props.ENAME || '');
        const nameCht = props.CNAME || '';
        
        return `<div class="map-popup-table"><strong>${nameEng}</strong><br>${nameCht}</div>`;
      });

      layersControl.addOverlay(saLayer, "Special Area");
      

      // =========== 監聽 Zoom Level 來改變 simplifyFactor ===========
      map.on('zoomend', () => {
        // 只有當圖層在顯示中才進行計算，節省效能
        if (!map.hasLayer(cpLayer)) return;

        const z = map.getZoom();
        let newFactor = 0.5; // 預設值

        // 自定義邏輯：
        if (z >= 16) {
          newFactor = 0; // Zoom 16+: 關閉簡化，顯示最原始數據 (最精細)
        } else if (z >= 14) {
          newFactor = 0.2; // Zoom 14-15: 低簡化 (精細)
        } else if (z >= 12) {
          newFactor = 0.3; // Zoom 12-13: 中等簡化
        } else {
          newFactor = 0.5; // Zoom < 12: 高度簡化 (效能優先，形狀會比較起角)
        }

        // 只有當數值真的改變時，才執行 refresh (因為 refresh 會閃爍)
        if (cpLayer.options.simplifyFactor !== newFactor) {
          console.log(`[MapPopup] Updating simplifyFactor to ${newFactor} (Zoom: ${z})`);
          cpLayer.options.simplifyFactor = newFactor;
          
          // 強制重繪：這會清空目前的 tile cache 並用新參數重新 fetch
          cpLayer.refresh();
        }
      });
      // =================================================================

    } else {
      console.warn('Esri Leaflet plugin not loaded.');
    }

    // =========== 新增開始: 2.5D Buildings Layer ===========
    if (typeof OSMBuildings !== 'undefined') {
      const OsmBuildingsLayer = L.Layer.extend({
        onAdd: function (map) {
          try {
            const container = map.getContainer();
            const childrenBefore = Array.from(container.children);

            this._osmb = new OSMBuildings(map);
            
            const tileUrl = 'https://a.data.osmbuildings.org/0.2/59fcc2e8/tile/{z}/{x}/{y}.json';
            
            this._osmb.load(tileUrl);
            this._osmb.date(new Date());
            this._osmb.style({ wallColor: 'rgb(200, 190, 180)', roofColor: 'rgb(220, 220, 220)', shadows: true });

            const childrenAfter = Array.from(container.children);
            this._layerElement = childrenAfter.find(el => !childrenBefore.includes(el));

            if (!this._layerElement) {
              const overlayPane = map.getPanes().overlayPane;
              if (overlayPane.children.length > 0) {
                this._layerElement = overlayPane.children[overlayPane.children.length - 1];
              }
            }
            
            console.log('[OSMBuildings] Layer initialized via Proxy.');
          } catch (e) {
            console.error('[OSMBuildings] Initialization failed.', e);
            this._osmb = null;
          }
        },

        onRemove: function (map) {
          if (!this._osmb) return;

          try {
            // 1. 停止數據載入
            if (typeof this._osmb.unload === 'function') {
               this._osmb.unload();
            }
            if (typeof this._osmb.destroy === 'function') {
               this._osmb.destroy();
            }
          } catch(e) { console.warn('[OSMBuildings] Error during cleanup:', e); }

          // 2. 移除我們在 onAdd 時精準捕獲的那個容器元素
          try {
            if (this._layerElement && this._layerElement.parentNode) {
              this._layerElement.parentNode.removeChild(this._layerElement);
            }
          } catch(e) {}

          // 3. 清除版權文字
          document.querySelectorAll('.osmb-attribution').forEach(el => el.remove());

          this._osmb = null;
          this._layerElement = null;
        }
      });

      const buildings3D = new OsmBuildingsLayer();
      layersControl.addOverlay(buildings3D, "2.5D Buildings");
    } else {
      console.warn("OSMBuildings script not loaded via HTML.");
    }
    // =========== 新增結束 ===========

    fetch("https://raw.githubusercontent.com/hkbatradar/SonoRadar/main/hkgrid.geojson")
      .then((r) => r.json())
      .then((hkgriddata) => {
        hkgridLayer = L.geoJSON(hkgriddata, {
          interactive: false,
          style: {
            color: '#3388ff',
            weight: 2,
            fillColor: '#3388ff',
            fillOpacity: 0,
          },
        });
        // postpone adding overlay to control until authorized
        overlaysPending.push({ layer: hkgridLayer, name: '1km Grid' });
        // if popup is already open, prompt now
        promptForPasswordIfNeeded();
      });

    // =========== NEW: Dynamic Habitat Layers (Load on View Change) ===========
    console.log('[Habitat] Initializing Dynamic Habitat Control...');

    const activeHabitats = new Set();
    const habitatGroups = {};

    // 1. 設定清單
    const habitatConfig = [
      { type: 'Agricultural_land', name: 'Agricultural Land', color: '#388E3C' },
      { type: 'Artificial_hard_shoreline', name: 'Artificial Hard Shoreline', color: '#607D8B' },
      { type: 'Artificial_pond', name: 'Artificial Pond', color: '#29B6F6' },
      { type: 'Bare_rock_soil', name: 'Bare Rock/Soil', color: '#795548' },
      { type: 'Grassland', name: 'Grassland', color: '#8BC34A' },
      { type: 'Green_urban_area', name: 'Green Urban Area', color: '#4CAF50' },
      { type: 'Mangrove', name: 'Mangrove', color: '#009688' },
      { type: 'Marsh_reed_bed', name: 'Marsh/Reed Bed', color: '#00BCD4' },
      { type: 'Mixed_barren_land', name: 'Mixed Barren Land', color: '#A1887F' },
      { type: 'Modified_watercourse', name: 'Modified Watercourse', color: '#90CAF9' },
      { type: 'Natural_rocky_shoreline', name: 'Natural Rocky Shoreline', color: '#5D4037' },
      { type: 'Natural_watercourse', name: 'Natural Watercourse', color: '#2196F3' },
      { type: 'Other_urban_area', name: 'Other Urban Area', color: '#9E9E9E' },
      { type: 'Reservoirs', name: 'Reservoirs', color: '#1565C0' },
      { type: 'Rural_plantation', name: 'Rural Plantation', color: '#33691E' },
      { type: 'Seagrass_bed', name: 'Seagrass Bed', color: '#CDDC39' },
      { type: 'Shrubby_grassland', name: 'Shrubby Grassland', color: '#AED581' },
      { type: 'Shrubland', name: 'Shrubland', color: '#558B2F' },
      { type: 'Soft_shore', name: 'Soft Shore', color: '#FFCC80' },
      { type: 'Woodland', name: 'Woodland', color: '#1B5E20' },
      { type: 'Woody_shrubland', name: 'Woody Shrubland', color: '#689F38' }
    ];

    // ==========================================================
    // 2. 建立合併後的 Habitat Control (仿造原生 Layers Control 行為)
    // ==========================================================
    const HabitatControl = L.Control.extend({
      // 改為 topright，這樣它會自動排在原有的 Layers Control 下方
      options: { position: 'topright' },

      onAdd: function(map) {
        // 1. 建立主容器，加上 'leaflet-control-layers' 讓它長得像原生控制項
        // 加上 'leaflet-habitat-control' 用於我們自定義的 CSS
        const container = L.DomUtil.create('div', 'leaflet-control leaflet-bar leaflet-control-layers leaflet-habitat-control');
        
        // 2. 建立 Toggle 按鈕 (顯示 Leaf Icon)
        const toggle = L.DomUtil.create('a', 'leaflet-control-layers-toggle', container);
        toggle.href = '#';
        toggle.title = 'Habitat Layers';
        toggle.innerHTML = '<i class="fa-solid fa-leaf" style="color: #2E7D32; font-size: 18px;"></i>';
        
        // 3. 建立內容面板 (初始隱藏，Hover 時顯示)
        const section = L.DomUtil.create('div', 'leaflet-control-layers-list leaflet-control-habitat-layers-overlays', container);
        
        // --- 內容構建開始 (原本的 UI 邏輯) ---
        // Header
        const header = L.DomUtil.create('div', '', section);
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '8px';
        header.style.borderBottom = '1px solid #eee';
        header.style.paddingBottom = '5px';
        const title = L.DomUtil.create('strong', '', header);
        title.innerText = 'Habitat Layers (AFCD 2021)';

        // Display All Option
        const allRow = L.DomUtil.create('div', '', section);
        allRow.style.marginBottom = '8px';
        allRow.style.paddingBottom = '8px';
        allRow.style.borderBottom = '1px solid #eee';
        allRow.style.display = 'flex';
        allRow.style.alignItems = 'center';

        const allCheckbox = document.createElement('input');
        allCheckbox.type = 'checkbox';
        allCheckbox.id = 'chk_display_all';
        allCheckbox.style.marginRight = '8px';
        allCheckbox.style.cursor = 'pointer';
        const allLabel = document.createElement('label');
        allLabel.htmlFor = 'chk_display_all';
        allLabel.innerText = 'Display All Habitats';
        allLabel.style.fontSize = '12px';
        allLabel.style.fontWeight = 'bold';
        allLabel.style.cursor = 'pointer';
        allRow.appendChild(allCheckbox);
        allRow.appendChild(allLabel);

        // Display All Logic
        allCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            
            // 1. 更新 activeHabitats 狀態
            habitatConfig.forEach((cfg) => {
                const itemChk = document.getElementById(`chk_${cfg.type}`);
                if (itemChk) itemChk.checked = isChecked;
                
                if (isChecked) {
                    activeHabitats.add(cfg.type);
                    if (!habitatGroups[cfg.type]) {
                        habitatGroups[cfg.type] = L.layerGroup().addTo(map);
                    } else if (!map.hasLayer(habitatGroups[cfg.type])) {
                        habitatGroups[cfg.type].addTo(map);
                    }
                } else {
                    activeHabitats.delete(cfg.type);
                    if (habitatGroups[cfg.type]) {
                        habitatGroups[cfg.type].clearLayers();
                        if (map.hasLayer(habitatGroups[cfg.type])) {
                            map.removeLayer(habitatGroups[cfg.type]);
                        }
                    }
                }
            });

            // 2. 發送總請求
            if (isChecked) {
                // [修正] 第二個參數改為 false。
                // false = 顯示 Loading Bar，並立即處理 (非背景預載)
                fetchDataForLayers(Array.from(activeHabitats), false); 
            } else {
                // 如果取消全選，確保 Loading Bar 消失
                // (雖然 fetchDataForLayers 內部有 finally stopLoading，但如果沒進去 fetch，這裡保險起見)
                if (typeof stopLoading === 'function') stopLoading();
            }
        });

        // Habitat Items Loop
        habitatConfig.forEach(cfg => {
          const row = L.DomUtil.create('div', '', section);
          row.style.marginBottom = '4px';
          row.style.display = 'flex';
          row.style.alignItems = 'center';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.id = `chk_${cfg.type}`;
          checkbox.style.marginRight = '8px';
          
          const label = document.createElement('label');
          label.htmlFor = `chk_${cfg.type}`;
          label.innerText = cfg.name;
          label.style.fontSize = '12px';
          label.style.cursor = 'pointer';
          label.style.color = cfg.color;
          label.style.fontWeight = '500';

          checkbox.addEventListener('change', (e) => {
            toggleHabitat(cfg, e.target.checked);
            
            // Sync Display All Checkbox
            const allChk = document.getElementById('chk_display_all');
            if (allChk) {
                if (!e.target.checked) allChk.checked = false;
                else {
                    const allChecked = habitatConfig.every(c => {
                        const box = document.getElementById(`chk_${c.type}`);
                        return box && box.checked;
                    });
                    if (allChecked) allChk.checked = true;
                }
            }
          });

          row.appendChild(checkbox);
          row.appendChild(label);
        });
        // --- 內容構建結束 ---

        // 4. 事件處理：Hover 效果
        // 當滑鼠進入容器 -> 加入 expanded class (Leaflet CSS 會自動隱藏 toggle 並顯示 list)
        L.DomEvent.on(container, 'mouseenter', () => {
             container.classList.add('leaflet-control-layers-expanded');
        });
        
        // 當滑鼠離開容器 -> 移除 expanded class
        L.DomEvent.on(container, 'mouseleave', () => {
             container.classList.remove('leaflet-control-layers-expanded');
        });

        // 防止地圖操作穿透
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousewheel', L.DomEvent.stopPropagation);
        
        // 手機版相容性 (點擊也能展開)
        if (L.Browser.touch) {
            L.DomEvent.on(toggle, 'click', (e) => {
                L.DomEvent.stop(e);
                if (container.classList.contains('leaflet-control-layers-expanded')) {
                    container.classList.remove('leaflet-control-layers-expanded');
                } else {
                    container.classList.add('leaflet-control-layers-expanded');
                }
            });
        }

        return container;
      }
    });

    // 只需要添加這一個 Control
    map.addControl(new HabitatControl());
    
    // 移除舊的 map.addControl(new HabitatToggleBtn()); 的程式碼

    // 3. 狀態切換邏輯
    function toggleHabitat(cfg, isChecked, isPreloading = false) {
      if (isChecked) {
        activeHabitats.add(cfg.type);
        if (!habitatGroups[cfg.type]) {
          habitatGroups[cfg.type] = L.layerGroup().addTo(map);
        } else if (!map.hasLayer(habitatGroups[cfg.type])) {
          habitatGroups[cfg.type].addTo(map);
        }
        // 勾選時：如果是使用者點擊 (isPreloading=false)，顯示 loading；允許使用快取
        fetchDataForLayers([cfg.type], isPreloading, false);
      } else {
        activeHabitats.delete(cfg.type);
        if (habitatGroups[cfg.type]) {
          habitatGroups[cfg.type].clearLayers();
          if (map.hasLayer(habitatGroups[cfg.type])) {
            map.removeLayer(habitatGroups[cfg.type]);
          }
        }
        // [新增] 取消勾選時清除快取，確保下次勾選時能獲取最新數據
        delete loadedHabitatsCache[cfg.type];
      }
    }

    // 4. 核心：根據目前地圖範圍下載數據 (並行請求 + Retry + 快取機制)
    function fetchDataForLayers(types, isPreloading = false, forceRefresh = false) {
      if (!types || types.length === 0) return;
      
      const typeList = Array.isArray(types) ? types : Array.from(types);
      const currentZoom = map.getZoom();
      const currentBounds = map.getBounds();

      // Zoom 保護
      if (currentZoom < 17) {
        typeList.forEach(type => {
            if (habitatGroups[type]) habitatGroups[type].clearLayers();
            delete loadedHabitatsCache[type]; // Zoom out 清除快取
        });
        // 這裡如果是 background fetch 其實不需要 stopLoading，因為根本沒 start
        // 但為了保險起見保留邏輯
        if (!isPreloading) updateLoadingBarState(); // 確保 UI 狀態正確

        if (!window._habitatZoomWarned) {
          showFloatingMessage('Zoom in to Level 17+ to view habitat data');
          window._habitatZoomWarned = true;
        }
        return;
      }
      window._habitatZoomWarned = false;

      // [核心優化] 過濾掉不需要重新請求的圖層
      const typesToFetch = typeList.filter(type => {
          if (forceRefresh) return true;

          const cache = loadedHabitatsCache[type];
          if (!cache) return true;

          // 判斷 1: Zoom 是否變得更細 (Zoom In)
          // 如果 Zoom Out (current < cache)，即使包含在範圍內也可能需要重新請求(雖然通常不會發生因為有<17保護)
          if (currentZoom < cache.zoom) return true;

          // 判斷 2: 範圍是否完全包含
          if (cache.bounds.contains(currentBounds)) {
              return false; // 不需要請求 (快取命中)
          }
          return true; // 需要請求
      });

      // [關鍵修改] 
      // 1. 如果所有圖層都命中快取 (typesToFetch 為空)，直接結束。
      //    因為沒有呼叫 startLoading，所以不會有 Loading Bar 一閃而過的問題。
      if (typesToFetch.length === 0) {
          return;
      }

      // 2. 只有在「真的有東西要抓」且「非預載模式」時，才顯示 Loading Bar
      if (!isPreloading) {
        startLoading();
      }

      // 清空即將重新請求的圖層
      typesToFetch.forEach(type => {
          if (habitatGroups[type]) habitatGroups[type].clearLayers();
      });

      const south = currentBounds.getSouth();
      const west = currentBounds.getWest();
      const north = currentBounds.getNorth();
      const east = currentBounds.getEast();
      const dynamicFilter = `<Filter><Intersects><PropertyName>SHAPE</PropertyName><gml:Envelope srsName='EPSG:4326'><gml:lowerCorner>${south} ${west}</gml:lowerCorner><gml:upperCorner>${north} ${east}</gml:upperCorner></gml:Envelope></Intersects></Filter>`;

      // 內部 Retry 函式
      const fetchWithRetry = async (url, retries = 3) => {
        try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const text = await r.text();
            return JSON.parse(text);
        } catch (err) {
            if (retries > 0) {
                console.warn(`[Habitat] Fetch failed, retrying... (${retries} left)`);
                await new Promise(res => setTimeout(res, 1500));
                return fetchWithRetry(url, retries - 1);
            }
            throw err;
        }
      };

      const promises = typesToFetch.map(type => {
          const url = new URL('https://portal.csdi.gov.hk/server/services/common/afcd_rcd_1639382960762_55768/MapServer/WFSServer');
          url.searchParams.append('service', 'wfs');
          url.searchParams.append('request', 'GetFeature');
          url.searchParams.append('typenames', type);
          url.searchParams.append('outputFormat', 'geojson');
          url.searchParams.append('maxFeatures', '2000');
          url.searchParams.append('srsName', 'EPSG:4326');
          url.searchParams.append('filter', dynamicFilter);

          return fetchWithRetry(url, 3)
            .then(data => {
                if (!data || !data.features || data.features.length === 0) return;

                if (!activeHabitats.has(type)) return;
                
                const cfg = habitatConfig.find(c => c.type === type);
                if (!cfg) return;

                const group = habitatGroups[type];
                if (!group) return;

                // [更新快取]
                loadedHabitatsCache[type] = {
                    bounds: currentBounds,
                    zoom: currentZoom
                };

                let needFlip = false;
                try {
                   let testCoord = null;
                   const geom = data.features[0].geometry;
                   if (geom.type === 'Polygon') testCoord = geom.coordinates[0][0];
                   else if (geom.type === 'MultiPolygon') testCoord = geom.coordinates[0][0][0];
                   if (testCoord && testCoord[0] < 90 && testCoord[1] > 90) {
                      needFlip = true;
                   }
                } catch(e) {}

                const geoLayer = L.geoJSON(data, {
                  coordsToLatLng: function (coords) {
                      return needFlip ? new L.LatLng(coords[0], coords[1]) : new L.LatLng(coords[1], coords[0]);
                  },
                  style: {
                    color: cfg.color,
                    weight: 1,
                    fillColor: cfg.color,
                    fillOpacity: 0.6
                  },
                  onEachFeature: (feature, l) => {
                     l.bindPopup(`<div class="map-popup-table"><strong>${cfg.name}</strong></div>`);
                  }
                });

                group.addLayer(geoLayer);
            })
            .catch(err => {
                console.warn(`[Habitat] Final Error fetching ${type}:`, err);
            });
      });

      Promise.all(promises).finally(() => {
          if (!isPreloading) {
              stopLoading();
          }
          
          if (!isPreloading && typesToFetch.length === 1) {
             const type = typesToFetch[0];
             if (habitatGroups[type] && habitatGroups[type].getLayers().length === 0) {
                 const cfg = habitatConfig.find(c => c.type === type);
                 if (cfg) showFloatingMessage(`No ${cfg.name} found in current view.`);
             }
          }
      });
    }

    // 5. 重新整理所有已勾選的圖層 (地圖移動時)
    function refreshVisibleHabitats() {
      if (activeHabitats.size === 0) return;
      fetchDataForLayers(Array.from(activeHabitats), false, false); 
    }

    // 6. 監聽地圖移動事件 (Drag & Zoom)
    let habitatRefreshTimer = null; 
    // 使用 Debounce 防止在此頻繁觸發
    map.on('moveend', () => {
      if (habitatRefreshTimer) clearTimeout(habitatRefreshTimer);
      // 延遲 500ms，確定使用者停下來才下載
      habitatRefreshTimer = setTimeout(refreshVisibleHabitats, 500);
    });

    // ====================================================================

    drawnItems = new L.FeatureGroup().addTo(map);
    const canvasRenderer = L.canvas({ pane: 'annotationPane' });
    drawControl = new L.Control.Draw({
      position: 'topleft',
      edit: { featureGroup: drawnItems },
      draw: {
        circlemarker: false,
        polyline: {},
        polygon: {},
        rectangle: {},
        circle: {}
      }
    });
    map.on(L.Draw.Event.CREATED, (e) => {
      drawnItems.addLayer(e.layer);
    });

    const RouteToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-route-toggle-control');
        container.style.display = 'flex';

        const toggle = L.DomUtil.create('a', '', container);
        toggle.href = '#';
        toggle.title = 'Route options';
        toggle.innerHTML = '<i class="fa-solid fa-route"></i>';
        routeToggleBtn = toggle;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);

        routeBtnGroup = L.DomUtil.create('div', 'route-button-group', container);

        const createLink = L.DomUtil.create('a', '', routeBtnGroup);
        createLink.href = '#';
        createLink.title = 'Create Route';
        createLink.innerHTML = '<i class="fa-solid fa-eye"></i>';
        routeBtn = createLink;
        L.DomEvent.on(createLink, 'click', L.DomEvent.stop)
          .on(createLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(createLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(createLink, 'click', toggleRoute);

        const importLink = L.DomUtil.create('a', '', routeBtnGroup);
        importLink.href = '#';
        importLink.title = 'Import KML';
        importLink.innerHTML = '<i class="fa-solid fa-file-import"></i>';
        importBtn = importLink;
        L.DomEvent.on(importLink, 'click', L.DomEvent.stop)
          .on(importLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(importLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(importLink, 'click', () => { kmlInput.value = ''; kmlInput.click(); });

        const clearLink = L.DomUtil.create('a', '', routeBtnGroup);
        clearLink.href = '#';
        clearLink.title = 'Clear KML';
        clearLink.innerHTML = '<i class="fa-solid fa-trash"></i>';
        clearKmlBtn = clearLink;
        L.DomEvent.on(clearLink, 'click', L.DomEvent.stop)
          .on(clearLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(clearLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(clearLink, 'click', clearKmlRoute);

        L.DomEvent.on(toggle, 'click', L.DomEvent.stop)
          .on(toggle, 'mousedown', L.DomEvent.stopPropagation)
          .on(toggle, 'dblclick', L.DomEvent.stopPropagation)
          .on(toggle, 'click', () => {
            const visible = routeBtnGroup.classList.contains('visible');
            routeBtnGroup.classList.toggle('visible', !visible);
            toggle.classList.toggle('active', !visible);
          });

        return container;
      }
    });
    const routeControl = new RouteToggleControl();
    map.addControl(routeControl);
    routeToggleContainer = routeControl.getContainer();

    const TextToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-text-toggle-control');
        container.style.display = 'flex';

        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Text';
        link.innerHTML = '<i class="fa-solid fa-font"></i>';
        textBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', toggleTextMode);

        // Clear Text button group (horizontally aligned)
        const textButtonGroup = L.DomUtil.create('div', 'text-button-group', container);

        const clearLink = L.DomUtil.create('a', '', textButtonGroup);
        clearLink.href = '#';
        clearLink.title = 'Clear Text';
        clearLink.innerHTML = '<i class="fa-solid fa-broom"></i>';
        clearTextBtn = clearLink;
        L.DomEvent.on(clearLink, 'click', L.DomEvent.stop)
          .on(clearLink, 'mousedown', L.DomEvent.stopPropagation)
          .on(clearLink, 'dblclick', L.DomEvent.stopPropagation)
          .on(clearLink, 'click', (ev) => {
            try {
              ev.preventDefault();
            } catch (e) { }
            showMessageBox({
              message: 'Confirm to clear all text?',
              confirmText: 'Confirm',
              cancelText: 'Cancel',
              onConfirm: () => {
                try {
                  // remove all text markers from map
                  textMarkers.forEach(m => {
                    try { if (map && m) map.removeLayer(m); } catch (e) { }
                  });
                  textMarkers = [];
                  updateMarkerPointerEvents();
                  // 隱藏 Clear Text button
                  updateTextClearButtonVisibility();
                } catch (e) { }
              }
            });
          });
        return container;
      }
    });
    const textControl = new TextToggleControl();
    map.addControl(textControl);
    textToggleContainer = textControl.getContainer();

    const ExportControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-export-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Export Map';
        link.innerHTML = '<i class="fa-solid fa-file-export"></i>';
        exportBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', exportMap);
        return container;
      }
    });
    const exportControl = new ExportControl();
    map.addControl(exportControl);
    exportControlContainer = exportControl.getContainer();

    const DrawToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-draw-toggle-control');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Draw';
        link.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        drawBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', toggleDrawControl);
        return container;
      }
    });

    // Professional control (placed after Draw control)
    const ProfessionalControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-professional-control');
        container.style.setProperty('margin-top', '1px', 'important');
        const link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Professional';
        link.innerHTML = '<i class="fa-solid fa-user-lock"></i>';
        professionalBtn = link;
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(container, 'mousedown', L.DomEvent.stopPropagation);
        L.DomEvent.on(container, 'dblclick', L.DomEvent.stopPropagation);
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'mousedown', L.DomEvent.stopPropagation)
          .on(link, 'dblclick', L.DomEvent.stopPropagation)
          .on(link, 'click', () => {
            try {
              showProfessionalPrompt();
            } catch (e) { }
          });
        // hide control immediately if overlays already loaded
        if (overlaysLoaded) {
          container.style.display = 'none';
        }
        return container;
      }
    });
    const drawToggle = new DrawToggleControl();
    map.addControl(drawToggle);

    // Add professional control right after draw control
    const professionalToggle = new ProfessionalControl();
    map.addControl(professionalToggle);
  }

  function refreshMarkers() {
    if (!map) return;
    markers.forEach(m => m.remove());
    markers = [];
    const list = getFileList();
    const curIdx = getCurrentIndex();

    const groups = {};
    list.forEach((file, idx) => {
      const meta = getFileMetadata(idx);
      const lat = parseFloat(meta.latitude);
      const lon = parseFloat(meta.longitude);
      if (isNaN(lat) || isNaN(lon)) return;
      const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ file, idx, meta, lat, lon });
    });

    function getTimestamp(meta) {
      if (!meta) return '';
      const d = (meta.date || '').replace(/\D/g, '');
      const t = meta.time || '';
      return `${d}${t}`;
    }

    Object.values(groups).forEach(group => {
      group.sort((a, b) => getTimestamp(a.meta).localeCompare(getTimestamp(b.meta)));
      const first = group[0];
      const { lat, lon } = first;
      const isCurrent = group.some(g => g.idx === curIdx);
      const allTrash = group.every(g => getFileIconState(g.idx).trash);
      let cls = 'map-marker-other';
      if (isCurrent) {
        cls = 'map-marker-current';
      } else if (allTrash) {
        cls = 'map-marker-trash';
      }
      const icon = L.divIcon({
        html: '<i class="fa-solid fa-location-dot"></i>',
        className: cls,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      });
      const fileNames = group.map(g => g.file.name.replace(/\.wav$/i, ''));
      const names = (fileNames.length <= 5)
        ? fileNames.join('<br>')
        : `${fileNames[0]}<br>⋮<br>${fileNames[fileNames.length - 1]}`;
      const zIndexOffset = isCurrent ? 1000 : 0;
      const marker = L.marker([lat, lon], { icon, zIndexOffset });
      marker.on('click', () => {
        document.dispatchEvent(new CustomEvent('map-file-selected', { detail: { index: first.idx } }));
      });
      marker.bindTooltip(names, {
        direction: 'top',
        offset: [-3, -32],
        className: 'map-tooltip'
      });
      marker.addTo(map);
      markers.push(marker);
    });
    updateMarkerPointerEvents();
  }

  function clearRoute() {
    polylines.forEach(l => l.remove());
    polylines = [];
    routeBtn?.classList.remove('active');
    if (routeBtn) {
      routeBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    }
  }

  function clearKmlRoute() {
    kmlPolylines.forEach(l => l.remove());
    kmlPolylines = [];
  }

  async function importKml(file) {
    if (!file) return;
    const text = await file.text();
    const lines = parseKml(text);

    // --- FIX START: Ensure map exists before adding layers ---
    if (!map) {
      let centerLat = 22.28552; // Default HK Lat
      let centerLon = 114.15769; // Default HK Lon

      // Try to use the first point from the KML as the initialization center
      let found = false;
      for (const line of lines) {
        if (line.length > 0) {
          centerLat = line[0][0];
          centerLon = line[0][1];
          found = true;
          break;
        }
      }
      // Initialize the map
      createMap(centerLat, centerLon);
    }
    // --- FIX END ---

    clearKmlRoute();
    const allCoords = [];
    lines.forEach(coords => {
      // Now 'map' is guaranteed to exist, so .addTo(map) won't crash
      const line = L.polyline(coords, {
        color: 'deeppink',
        weight: 2,
        opacity: 0.8,
        renderer: L.canvas()
      }).addTo(map);
      kmlPolylines.push(line);
      allCoords.push(...coords);
    });
    if (allCoords.length > 0) {
      map.fitBounds(allCoords);
      updateMap();
    }
  }

  importKmlFileFn = importKml;

  function parseKml(text) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const lines = [];
    const lineStrings = doc.getElementsByTagName('LineString');
    for (let i = 0; i < lineStrings.length; i++) {
      const coordsEl = lineStrings[i].getElementsByTagName('coordinates')[0];
      if (!coordsEl) continue;
      const coordsText = coordsEl.textContent.trim();
      const coords = coordsText.split(/\s+/).map(pair => {
        const [lon, lat] = pair.split(',').map(Number);
        return (!isNaN(lat) && !isNaN(lon)) ? [lat, lon] : null;
      }).filter(Boolean);
      if (coords.length > 1) lines.push(coords);
    }
    return lines;
  }

  kmlInput.addEventListener('change', async () => {
    const file = kmlInput.files[0];
    if (file) {
      await importKml(file);
    }
  });

  function drawRoute() {
    if (!map) return;
    clearRoute();
    const list = getFileList();
    const points = [];
    list.forEach((_f, idx) => {
      const meta = getFileMetadata(idx);
      const lat = parseFloat(meta.latitude);
      const lon = parseFloat(meta.longitude);
      const d = (meta.date || '').replace(/\D/g, '');
      const t = meta.time || '';
      const ts = `${d}${t}`;
      if (!isNaN(lat) && !isNaN(lon) && ts) {
        points.push({ lat, lon, ts });
      }
    });
    points.sort((a, b) => a.ts.localeCompare(b.ts));

    let current = [];
    let prev = null;
    points.forEach(p => {
      if (prev) {
        const dist = map.distance([prev.lat, prev.lon], [p.lat, p.lon]);
        if (dist >= 1000) {
          if (current.length > 1) {
            polylines.push(L.polyline(current, {
              color: 'black',
              weight: 2,
              opacity: 0.8,
              renderer: L.canvas()
            }).addTo(map));
          }
          current = [];
        }
      }
      current.push([p.lat, p.lon]);
      prev = p;
    });
    if (current.length > 1) {
      polylines.push(L.polyline(current, {
        color: 'black',
        weight: 2,
        opacity: 0.8,
        renderer: L.canvas()
      }).addTo(map));
    }
  }

  function toggleRoute() {
    if (polylines.length > 0) {
      clearRoute();
    } else {
      drawRoute();
      routeBtn?.classList.add('active');
      if (routeBtn) {
        routeBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
      }
    }
  }

  function toggleDrawControl() {
    if (!drawControl) return;
    const willShow = !drawControlVisible;
    if (willShow && textMode) {
      toggleTextMode();
    }
    if (drawControlVisible) {
      map.removeControl(drawControl);
      drawBtn?.classList.remove('active');
      drawControlVisible = false;
    } else {
      drawControl.addTo(map);
      drawBtn?.classList.add('active');
      drawControlVisible = true;
    }
  }

  function exportMap() {
    if (!map || !window.html2canvas) return;
    const container = map.getContainer();

    const controlContainer = container.querySelector('.leaflet-control-container');
    const controls = [];
    if (controlContainer) {
      controls.push(controlContainer);
    }
    if (coordScaleWrapper) {
      controls.push(coordScaleWrapper);
    }
    controls.forEach(el => { el.style.display = 'none'; });

    html2canvas(container, { useCORS: true }).then(canvas => {
      controls.forEach(el => { el.style.display = ''; });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'map.png';
      a.click();
    }).catch(() => {
      controls.forEach(el => { el.style.display = ''; });
    });
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    })[c]);
  }

  function createTextIcon(text, showTooltip = false) {
    const titleAttr = showTooltip
      ? ' title="Left click to edit\nRight click to delete"'
      : '';
    return L.divIcon({
      className: 'map-text-icon',
      html: `<span class="map-text-label"${titleAttr}>${escapeHtml(text)}</span>`,
      iconSize: null, // 可保持 null 讓其自適應
      iconAnchor: [0, 0], // 將 anchor 設為左上角
      popupAnchor: [0, 0]
    });
  }

  function editTextMarker(marker) {
    if (!map || activeTextInput) return;
    const latlng = marker.getLatLng();
    const point = map.latLngToContainerPoint(latlng);
    const input = document.createElement('textarea');
    input.value = marker.text || '';
    input.className = 'map-text-input';
    input.rows = 1;
    input.style.left = `${point.x}px`;
    input.style.top = `${point.y}px`;
    map.getContainer().appendChild(input);
    activeTextInput = input;
    map.dragging.disable();
    input.focus();
    const adjustHeight = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    adjustHeight();
    input.addEventListener('input', adjustHeight);
    const finish = () => {
      if (!activeTextInput) return;
      const val = input.value.trim();
      map.getContainer().removeChild(input);
      activeTextInput = null;
      map.dragging.enable();
      if (val) {
        marker.text = val;
        marker.setIcon(createTextIcon(val, textMode));
      } else {
        map.removeLayer(marker);
        textMarkers = textMarkers.filter(m => m !== marker);
        updateTextClearButtonVisibility();
      }
      updateMarkerPointerEvents();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish();
      }
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('blur', () => {
      suppressNextTextClick = true;
      setTimeout(() => {
        if (document.activeElement !== input) finish();
      });
    });
  }

  function createTextMarker(latlng, text) {
    const marker = L.marker(latlng, {
      icon: createTextIcon(text, textMode),
      draggable: textMode,
      pane: 'annotationPane',
      zIndexOffset: 1000
    });
    marker.text = text;
    marker.on('dblclick', () => { if (textMode) editTextMarker(marker); });
    marker.on('click', (e) => {
      if (textMode && !activeTextInput) {
        e.originalEvent.stopPropagation();
        editTextMarker(marker);
      }
    });
    marker.on('contextmenu', (evt) => {
      // 使用 dropdown.js 顯示一個只有 "Remove" 的選單，按下後再刪除文字標記
      if (!(textMode && !activeTextInput)) return;
      try {
        const orig = evt.originalEvent || evt.srcEvent || {};
        orig.preventDefault?.();
        orig.stopPropagation?.();
      } catch (e) { }

      // 建立一個臨時按鈕，Dropdown 會根據按鈕位置來定位選單
      const btn = document.createElement('button');
      btn.style.position = 'absolute';
      btn.style.left = (evt.originalEvent?.clientX || 0) + 'px';
      btn.style.top = (evt.originalEvent?.clientY || 0) + 'px';
      btn.style.width = '1px';
      btn.style.height = '1px';
      btn.style.padding = '0';
      btn.style.margin = '0';
      btn.style.opacity = '0';
      btn.style.zIndex = '2147483647';
      btn.style.pointerEvents = 'auto';
      document.body.appendChild(btn);

      const items = [{ label: 'Remove', value: 'remove' }];
      
      // 1. Define cleanup FIRST (without calling close recursively)
      const cleanup = () => {
        // REMOVED: if (dropdown && typeof dropdown.close === 'function') dropdown.close(); 
        // Reason: This caused the infinite recursion.
        
        try {
          if (dropdown && dropdown.menu && dropdown.menu.parentNode) dropdown.menu.parentNode.removeChild(dropdown.menu);
        } catch (e) { }
        try { if (btn && btn.parentNode) btn.parentNode.removeChild(btn); } catch (e) { }
      };

      const dropdown = new Dropdown(btn, items, {
        onChange: (val) => {
          try {
            if (val && (val.value === 'remove' || val.label === 'Remove')) {
              map.removeLayer(marker);
              textMarkers = textMarkers.filter(m => m !== marker);
              updateTextClearButtonVisibility();
              updateMarkerPointerEvents();
            }
          } finally {
            // 2. Call close() here to trigger the wrapper (which calls cleanup)
            // If the Dropdown class auto-closes on change, this might be redundant but safe with the fix above.
            if (dropdown && typeof dropdown.close === 'function') {
                dropdown.close(); 
            } else {
                cleanup();
            }
          }
        }
      });

      // 將選項文字顯示為紅色以表危險操作
      try {
        const first = dropdown.menu.querySelector('.dropdown-item');
        if (first) first.style.color = 'red';
      } catch (e) { }

      // 3. The wrapper handles calling the original close AND cleanup
      try {
        const origClose = dropdown.close.bind(dropdown);
        dropdown.close = function () {
          origClose(); // Close logical state
          cleanup();   // Remove DOM elements
        };
      } catch (e) { }

      dropdown.open();
    });
    return marker;
  }

  function updateTextMarkersDraggable() {
    textMarkers.forEach(m => {
      if (textMode) m.dragging.enable();
      else m.dragging.disable();
      const txt = m.text || '';
      m.setIcon(createTextIcon(txt, textMode));
      m.setZIndexOffset(1000);
    });
    updateMarkerPointerEvents();
  }

  function onMapTextClick(e) {
    if (suppressNextTextClick) {
      suppressNextTextClick = false;
      return;
    }
    if (activeTextInput) return;
    const marker = createTextMarker(e.latlng, '');
    marker.addTo(map);
    textMarkers.push(marker);
    updateMarkerPointerEvents();
    updateTextClearButtonVisibility();
    editTextMarker(marker);
  }

  function updateTextClearButtonVisibility() {
    if (!clearTextBtn || !clearTextBtn.parentElement) return;
    const textButtonGroup = clearTextBtn.parentElement;
    if (textMarkers.length > 0) {
      // Show with smooth animation
      textButtonGroup.classList.add('visible');
    } else {
      // Hide with smooth animation
      textButtonGroup.classList.remove('visible');
    }
  }

  function toggleTextMode() {
    const newMode = !textMode;
    if (newMode && drawControlVisible) {
      toggleDrawControl();
    }
    textMode = newMode;
    textBtn?.classList.toggle('active', textMode);
    if (textMode) {
      map.on('click', onMapTextClick);
    } else {
      map.off('click', onMapTextClick);
      if (activeTextInput) {
        activeTextInput.blur();
      }
    }
    updateTextMarkersDraggable();
    updateCursor();
  }

  function fitAllMarkers() {
    if (!map) return;

    map.invalidateSize(true);

    // 收集所有可見的 markers 的座標
    const allCoords = [];

    // 1. 添加主要 markers
    markers.forEach(marker => {
      const latlng = marker.getLatLng();
      allCoords.push([latlng.lat, latlng.lng]);
    });

    // 2. 添加 text markers
    textMarkers.forEach(marker => {
      const latlng = marker.getLatLng();
      allCoords.push([latlng.lat, latlng.lng]);
    });

    // 3. 添加 survey point markers（如果 clustering manager 存在）
    if (clusterManager && clusterManager.currentVisibleMarkers) {
      clusterManager.currentVisibleMarkers.forEach(marker => {
        try {
          const latlng = marker.getLatLng();
          allCoords.push([latlng.lat, latlng.lng]);
        } catch (e) { }
      });
    }

    // --- 新增: 4. 添加 KML Polylines 的座標 ---
    if (typeof kmlPolylines !== 'undefined' && kmlPolylines.length > 0) {
      kmlPolylines.forEach(line => {
        const latlngs = line.getLatLngs();
        // Leaflet Polyline 可能是單層或多層陣列
        latlngs.forEach(latlng => {
            if (latlng.lat && latlng.lng) {
                allCoords.push([latlng.lat, latlng.lng]);
            } else if (Array.isArray(latlng)) { // 處理 MultiPolyline
                latlng.forEach(pt => {
                    if (pt.lat && pt.lng) allCoords.push([pt.lat, pt.lng]);
                });
            }
        });
      });
    }
    // ----------------------------------------

    // 如果有任何座標（Marker 或 KML），自動 fit bounds
    if (allCoords.length > 0) {
      try {
        map.fitBounds(allCoords, { padding: [50, 50], animate: true });
      } catch (e) {
        console.error('[MapPopup] Error fitting bounds:', e);
      }
    } else {
       // 如果完全沒有任何內容，回到預設香港視角
       const HK_CENTER = [22.28552, 114.15769];
       map.setView(HK_CENTER, 13);
    }
  }

  function zoomToCurrentMarker() {
    if (!map) return;

    const idx = getCurrentIndex();
    if (idx < 0) {
      // No file selected, show default view
      const HK_CENTER = [22.28552, 114.15769];
      map.setView(HK_CENTER, DEFAULT_ZOOM);
      return;
    }

    const meta = getFileMetadata(idx);
    const lat = parseFloat(meta.latitude);
    const lon = parseFloat(meta.longitude);

    if (isNaN(lat) || isNaN(lon)) {
      // No coordinates for current file, show default view
      const HK_CENTER = [22.28552, 114.15769];
      map.setView(HK_CENTER, DEFAULT_ZOOM);
      return;
    }

    // Zoom to current marker
    map.setView([lat, lon], 16, { animate: true });
  }

  const DEFAULT_ZOOM = 13;

  // 補上缺失的定位函數
  function showDeviceLocation() {
    if (!map) return;
    // 使用 Leaflet 內建的定位功能
    map.locate({ setView: true, maxZoom: 16 });

    // 定位成功時顯示
    map.once('locationfound', (e) => {
      const radius = e.accuracy / 2;
      L.marker(e.latlng).addTo(map)
        .bindPopup(`You are within ${radius.toFixed(0)} meters from this point`)
        .openPopup();
      L.circle(e.latlng, radius).addTo(map);
    });

    // 定位失敗時 (忽略或顯示錯誤)
    map.once('locationerror', (e) => {
      console.warn("Location access denied or failed:", e.message);
    });
  }

  function updateMap() {
    const idx = getCurrentIndex();
    
    // --- 情境 A: 沒有選中任何檔案 (idx < 0) ---
    if (idx < 0) {
      hideNoCoordMessage();
      const HK_CENTER = [22.28552, 114.15769];

      // 修正 1: 確保地圖已建立 (否則 refreshMarkers 無效)
      if (!map) {
        createMap(HK_CENTER[0], HK_CENTER[1]);
      }
      
      // 修正 2: 地圖建立後再更新 Markers
      refreshMarkers();
      
      // 修正 3: 自動縮放至所有內容 (含 KML)
      fitAllMarkers();

      showDeviceLocation();
      return;
    }

    const meta = getFileMetadata(idx);
    const lat = parseFloat(meta.latitude);
    const lon = parseFloat(meta.longitude);

    // --- 情境 B: 有檔案但沒有座標 (NaN) ---
    if (isNaN(lat) || isNaN(lon)) {
      // 修正 4: 即使沒座標，也要建立地圖以顯示其他內容
      if (!map) {
         const HK_CENTER = [22.28552, 114.15769];
         createMap(HK_CENTER[0], HK_CENTER[1]);
      }

      refreshMarkers();
      showNoCoordMessage();
      
      // 修正 5: 嘗試縮放到 KML 或其他 Marker
      setTimeout(() => {
          fitAllMarkers();
      }, 100);
      return;
    }

    // --- 情境 C: 正常有座標檔案 ---
    hideNoCoordMessage();

    if (!map) {
      createMap(lat, lon);
      refreshMarkers();
      setTimeout(() => {
          fitAllMarkers();
      }, 100); // 延遲 100ms
      return;
    } else {
      // 如果地圖已經存在，則維持原有的行為（聚焦到當前選中的檔案）
      if (popup.style.display !== 'block') {
        map.setView([lat, lon], DEFAULT_ZOOM);
      } else {
        map.setView([lat, lon]);
      }
    }
    
    // 更新標記 (針對 map 已存在的情況)
    refreshMarkers();
  }

  function togglePopup() {
    if (popup.style.display === 'block') {
      if (isMaximized) toggleMaximize();
      if (isMinimized) toggleMinimize();

      popup.classList.add('hidden');

      setTimeout(() => {
        popup.style.display = 'none';
        document.body.classList.remove('map-open');
      }, 300);

      if (textMode) toggleTextMode();

    } else {
      popup.classList.add('hidden');
      popup.style.display = 'block';

      void popup.offsetWidth;

      popup.classList.remove('hidden');

      document.body.classList.add('map-open');
      popup.style.width = `${popupWidth}px`;
      popup.style.height = `${popupHeight}px`;
      if (map) {
        map.invalidateSize();
      }
      updateMap();
      updateCursor();
      promptForPasswordIfNeeded();
    }
  }

  function toggleMaximize() {
    if (!isMaximized) {
      // 如果是從最小化狀態直接最大化，只需要還原顯示元素
      if (isMinimized) {
        if (layersControlContainer) layersControlContainer.style.display = '';
        if (zoomControlContainer) zoomControlContainer.style.display = '';
        if (routeToggleContainer) routeToggleContainer.style.display = '';
        if (exportControlContainer) exportControlContainer.style.display = '';
        if (coordScaleWrapper) coordScaleWrapper.style.display = '';
        if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '1px', 'important');
        isMinimized = false;
      } else {
        // 只有在從浮動狀態切換到最大化時，才儲存當前狀態
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;
        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }
      // 啟用動畫並設置最大化狀態
      popup.classList.add('animating');
      popup.style.left = '0px';
      popup.style.top = '0px';
      popup.style.width = `${window.innerWidth - 2}px`;
      popup.style.height = `${window.innerHeight - 2}px`;
      // 在動畫完成後移除 animating class 並重新計算 map 大小
      setTimeout(() => {
        popup.classList.remove('animating');
        map?.invalidateSize(true);
        // 最大化後自動 fit 所有 markers
        fitAllMarkers();
      }, 400);
      // 狀態：最大化
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-clone"></i>';
      maxBtn.title = 'Restore Down';
      isMaximized = true;
    } else {
      // 啟用動畫並從最大化狀態還原
      popup.classList.add('animating');
      popup.style.width = `${floatingState.width}px`;
      popup.style.height = `${floatingState.height}px`;
      popup.style.left = `${floatingState.left}px`;
      popup.style.top = `${floatingState.top}px`;
      // 在動畫完成後移除 animating class 並重新計算 map 大小
      setTimeout(() => {
        popup.classList.remove('animating');
        map?.invalidateSize(true);
      }, 400);
      // 狀態：一般（非最大化/最小化）
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      isMaximized = false;
    }
  }

  function toggleMinimize() {
    if (!isMinimized) {
      // 如果是從浮動狀態最小化，儲存當前狀態
      if (!isMaximized) {
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;
        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }
      // 啟用動畫並設置最小化狀態
      popup.classList.add('animating');
      popup.style.left = '0px';
      popup.style.top = `${window.innerHeight - 362}px`;
      popup.style.width = '290px';
      popup.style.height = '360px';
      // 在動畫完成後移除 animating class 並重新計算 map 大小
      setTimeout(() => {
        popup.classList.remove('animating');
        map?.invalidateSize(true);
        // 最小化後自動 zoom 到當前 marker
        zoomToCurrentMarker();
      }, 400);
      // 狀態：最小化
      minBtn.innerHTML = '<i class="fa-solid fa-window-maximize"></i>';
      minBtn.title = 'Restore Up';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      if (layersControlContainer) layersControlContainer.style.display = 'none';
      if (zoomControlContainer) zoomControlContainer.style.display = 'none';
      if (routeToggleContainer) routeToggleContainer.style.display = 'none';
      if (exportControlContainer) exportControlContainer.style.display = 'none';
      if (coordScaleWrapper) coordScaleWrapper.style.display = 'none';
      if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '10px', 'important');
      // Hide professional button in minimized state
      if (professionalBtn?.parentElement) {
        professionalBtn.parentElement.style.display = 'none';
      }
      isMinimized = true;
      isMaximized = false; // 確保狀態正確
    } else {
      // 啟用動畫並從最小化狀態還原
      popup.classList.add('animating');
      popup.style.width = `${floatingState.width}px`;
      popup.style.height = `${floatingState.height}px`;
      popup.style.left = `${floatingState.left}px`;
      popup.style.top = `${floatingState.top}px`;
      // 在動畫完成後移除 animating class 並重新計算 map 大小
      setTimeout(() => {
        popup.classList.remove('animating');
        map?.invalidateSize(true);
      }, 400);
      // 狀態：一般（非最大化/最小化）
      minBtn.innerHTML = '<i class="fa-solid fa-window-minimize"></i>';
      minBtn.title = 'Minimize';
      maxBtn.innerHTML = '<i class="fa-regular fa-square"></i>';
      maxBtn.title = 'Maximize';
      if (layersControlContainer) layersControlContainer.style.display = '';
      if (zoomControlContainer) zoomControlContainer.style.display = '';
      if (routeToggleContainer) routeToggleContainer.style.display = '';
      if (exportControlContainer) exportControlContainer.style.display = '';
      if (coordScaleWrapper) coordScaleWrapper.style.display = '';
      if (textToggleContainer) textToggleContainer.style.setProperty('margin-top', '1px', 'important');
      // Show professional button only if overlays are not loaded yet
      if (professionalBtn?.parentElement && !overlaysLoaded) {
        professionalBtn.parentElement.style.display = '';
      }
      isMinimized = false;
    }
  }

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let resizing = false;
  let resizeLeft = false;
  let resizeRight = false;
  let resizeTop = false;
  let resizeBottom = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let startLeft = 0;
  let startTop = 0;
  let isMaximized = false;
  let isMinimized = false;

  // 儲存 Floating window 的最後狀態
  // compute center defaults based on current popup size
  const centerLeftDefault = Math.max(0, Math.floor((window.innerWidth - popupWidth) / 2));
  const centerTopDefault = Math.max(0, Math.floor((window.innerHeight - popupHeight) / 2));
  let floatingState = {
    width: parseInt(localStorage.getItem('mapFloatingWidth'), 10) || popupWidth,
    height: parseInt(localStorage.getItem('mapFloatingHeight'), 10) || popupHeight,
    left: parseInt(localStorage.getItem('mapFloatingLeft'), 10) || centerLeftDefault,
    top: parseInt(localStorage.getItem('mapFloatingTop'), 10) || centerTopDefault
  };

  // ensure popup initially positioned at center (or stored position)
  try {
    popup.style.left = `${floatingState.left}px`;
    popup.style.top = `${floatingState.top}px`;
  } catch (e) {
    // ignore if popup not in DOM or styles cannot be set yet
  }

  function disableUiPointerEvents() {
    if (viewer) {
      viewer.style.pointerEvents = 'none';
      viewer.classList.remove('hide-cursor');
    }
    if (controlBar) controlBar.style.pointerEvents = 'none';
    if (sidebar) sidebar.style.pointerEvents = 'none';
  }

  function enableUiPointerEvents() {
    if (viewer) viewer.style.pointerEvents = '';
    if (controlBar) controlBar.style.pointerEvents = '';
    if (sidebar) sidebar.style.pointerEvents = '';
  }

  if (dragBar) {
    dragBar.addEventListener('mousedown', (e) => {
      if (isMaximized) return;
      dragging = true;
      offsetX = e.clientX - popup.offsetLeft;
      offsetY = e.clientY - popup.offsetTop;
      map?.dragging.disable();
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.preventDefault();
      e.stopPropagation();
    });
  }

  popup.addEventListener('mousemove', (e) => {
    if (isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      return;
    }
    const state = getEdgeState(e.clientX, e.clientY);
    const cursor = edgeCursor(state) || 'default';
    popup.style.cursor = cursor;
    if (cursor !== 'default') {
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.stopPropagation();
    } else {
      mapDiv.style.cursor = '';
      document.body.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
    }
  });

  popup.addEventListener('mousedown', (e) => {
    if (isMaximized) return;
    if (e.target === dragBar || dragBar.contains(e.target)) return;
    const state = getEdgeState(e.clientX, e.clientY);
    if (state.onLeft || state.onRight || state.onTop || state.onBottom) {
      resizing = true;
      popup.classList.add('resizing');
      resizeLeft = state.onLeft;
      resizeRight = state.onRight;
      resizeTop = state.onTop;
      resizeBottom = state.onBottom;
      const cursor = edgeCursor(state) || 'default';
      popup.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      startX = e.clientX;
      startY = e.clientY;
      startWidth = popup.offsetWidth;
      startHeight = popup.offsetHeight;
      startLeft = popup.offsetLeft;
      startTop = popup.offsetTop;
      map?.dragging.disable();
      e.preventDefault();
      e.stopPropagation();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (popup.style.display !== 'block' || isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      return;
    }
    const state = getEdgeState(e.clientX, e.clientY);
    const cursor = edgeCursor(state);
    if (cursor) {
      document.body.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      e.stopPropagation();
    } else {
      document.body.style.cursor = '';
      mapDiv.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    if (popup.style.display !== 'block' || isMaximized) return;
    if (dragging || resizing) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.target === dragBar || dragBar.contains(e.target)) return;
    const state = getEdgeState(e.clientX, e.clientY);
    if (state.onLeft || state.onRight || state.onTop || state.onBottom) {
      resizing = true;
      popup.classList.add('resizing');
      resizeLeft = state.onLeft;
      resizeRight = state.onRight;
      resizeTop = state.onTop;
      resizeBottom = state.onBottom;
      const cursor = edgeCursor(state) || 'default';
      popup.style.cursor = cursor;
      mapDiv.style.cursor = cursor;
      document.body.style.cursor = cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      startX = e.clientX;
      startY = e.clientY;
      startWidth = popup.offsetWidth;
      startHeight = popup.offsetHeight;
      startLeft = popup.offsetLeft;
      startTop = popup.offsetTop;
      map?.dragging.disable();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (isMaximized) return;
    if (dragging) {
      // 限制 popup 不超出視窗範圍
      const popupWidth = popup.offsetWidth;
      const popupHeight = popup.offsetHeight;
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;
      // 限制 left/top 不小於 0
      newLeft = Math.max(0, newLeft);
      newTop = Math.max(0, newTop);
      // 限制 right/bottom 不大於 window 大小
      newLeft = Math.min(window.innerWidth - popupWidth, newLeft);
      newTop = Math.min(window.innerHeight - popupHeight, newTop);
      popup.style.left = `${newLeft}px`;
      popup.style.top = `${newTop}px`;
      e.stopPropagation();
      return;
    }
    if (resizing) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      mapDiv.style.cursor = popup.style.cursor;
      document.body.style.cursor = popup.style.cursor;
      disableUiPointerEvents();
      document.dispatchEvent(new Event('hide-spectrogram-hover'));
      if (resizeRight) {
        popupWidth = Math.max(200, startWidth + dx);
        popup.style.width = `${popupWidth}px`;
      }
      if (resizeBottom) {
        popupHeight = Math.max(200, startHeight + dy);
        popup.style.height = `${popupHeight}px`;
      }
      if (resizeLeft) {
        popupWidth = Math.max(200, startWidth - dx);
        popup.style.width = `${popupWidth}px`;
        popup.style.left = `${startLeft + dx}px`;
      }
      if (resizeTop) {
        popupHeight = Math.max(200, startHeight - dy);
        popup.style.height = `${popupHeight}px`;
        popup.style.top = `${startTop + dy}px`;
      }
      e.stopPropagation();
    }
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (isMaximized) return;
    if (dragging) {
      dragging = false;
      map?.dragging.enable();
      enableUiPointerEvents();
      e.stopPropagation();
    }
    if (resizing) {
      resizing = false;
      popup.classList.remove('resizing');
      map?.dragging.enable();

      // 只在非最小化和非最大化狀態時更新並儲存 Floating window 狀態
      if (!isMinimized && !isMaximized) {
        floatingState.width = popup.offsetWidth;
        floatingState.height = popup.offsetHeight;
        floatingState.left = popup.offsetLeft;
        floatingState.top = popup.offsetTop;

        localStorage.setItem('mapFloatingWidth', floatingState.width);
        localStorage.setItem('mapFloatingHeight', floatingState.height);
        localStorage.setItem('mapFloatingLeft', floatingState.left);
        localStorage.setItem('mapFloatingTop', floatingState.top);
      }

      // 使用平滑動畫移動 basemap
      map?.invalidateSize(true);
      document.body.style.cursor = '';
      popup.style.cursor = '';
      mapDiv.style.cursor = '';
      enableUiPointerEvents();
      updateCursor();
      e.stopPropagation();
    }
  }, true);

  btn.addEventListener('click', togglePopup);
  maxBtn?.addEventListener('click', toggleMaximize);
  minBtn?.addEventListener('click', toggleMinimize);
  if (closeBtn) {
    closeBtn.addEventListener('click', togglePopup);
  }
  window.addEventListener('resize', () => {
    if (isMaximized) {
      popup.style.width = `${window.innerWidth - 2}px`;
      popup.style.height = `${window.innerHeight - 2}px`;
      map?.invalidateSize();
    } else if (isMinimized) {
      popup.style.top = `${window.innerHeight - 362}px`;
    }
  });
  document.addEventListener('file-loaded', updateMap);
  document.addEventListener('file-list-cleared', () => refreshMarkers());
  document.addEventListener('file-list-changed', () => refreshMarkers());
  document.addEventListener('file-icon-toggled', () => refreshMarkers());
}

export async function importKmlFile(file) {
  if (importKmlFileFn && file) {
    await importKmlFileFn(file);
  }
}
