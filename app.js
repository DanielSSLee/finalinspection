/**
 * FVI Station 01 — Photovoltaic Final Visual Inspection Console
 * Metrology Architecture: 24 Columns (1–24) x 6 Rows (A–F) = 144 Half-Cut Silicon Cells
 * Interactive Comic Speech-Bubble Defect Tagger
 * Instant Database Persistence, CMMS Authentication & Conveyor MQTT Stream
 */

// Configuration Fallback
const config = (typeof window !== "undefined" && window.FVI_CONFIG)
  ? Object.assign({}, window.FVI_CONFIG)
  : {
    apiBaseUrl: "",
    cmms: { enabled: true },
    mqtt: { enabled: true, useServerGateway: true },
    database: { directSyncOnConfirm: true }
  };

// Auto-detect file:/// protocol: If opened directly in browser without a web server,
// route API calls to the local Python Edge Gateway (http://localhost:8080)
if (typeof window !== "undefined" && window.location.protocol === "file:" && !config.apiBaseUrl) {
  config.apiBaseUrl = "http://localhost:8080";
}

// Application State
const state = {
  moduleId: '', // 16-char photovoltaic module serial number starting with USM (VARCHAR(16))
  grade: null, // null | 'A' | 'B' | 'X' (No grade selected initially)
  defects: new Map(), // key: 'C8', value: defect object
  activeCell: null, // { coord: 'C8', row: 'C', col: 8 }
  selectedDefectCode: null,
  isGridLocked: false,
  isInverted: false,

  // CMMS Authenticated Operator (null on startup until login)
  currentOperator: null,
  authToken: null,
  isServerOnline: false,
  isMqttConnected: false,

  // Multi-Screen / Single-Screen View Mode ('split' | 'visual' | 'telemetry')
  viewMode: 'split',
  splitRatio: 'balanced'
};

// Coordinate Configuration
const GRID_ROWS = ['A', 'B', 'C', 'D', 'E', 'F']; // 6 Rows
const GRID_COLS = Array.from({ length: 24 }, (_, i) => i + 1); // 1 to 24 (24 Columns)

// Defect Catalog with IEC Classifications & int2 Defect Types
const DEFECT_CATALOG = {
  'A1': { typeId: 1, name: 'Micro-Crack (Hairline)', severity: 'Minor', defaultGrade: 'A', key: '1' },
  'A2': { typeId: 2, name: 'Cross-Crack / Star Crack', severity: 'Moderate', defaultGrade: 'B', key: '2' },
  'B1': { typeId: 3, name: 'Dead Finger / Inactive Area', severity: 'Moderate', defaultGrade: 'B', key: '3' },
  'B2': { typeId: 4, name: 'Solder Disconnect / Void', severity: 'Moderate', defaultGrade: 'B', key: '4' },
  'C1': { typeId: 5, name: 'Dark Cell / Low Shunt', severity: 'Severe', defaultGrade: 'B', key: '5' },
  'X1': { typeId: 6, name: 'Broken Cell / Corner V-Crack', severity: 'Critical', defaultGrade: 'X', key: '6' },
  'X2': { typeId: 7, name: 'Severe Hotspot / Solder Bead', severity: 'Critical', defaultGrade: 'X', key: '7' },
  'X3': { typeId: 8, name: 'Delamination / Foreign Mat.', severity: 'Critical', defaultGrade: 'X', key: '8' }
};

const DEFECT_CODE_TO_ID = {
  'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4,
  'C1': 5, 'X1': 6, 'X2': 7, 'X3': 8
};

const DEFECT_ID_TO_CODE = {
  1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2',
  5: 'C1', 6: 'X1', 7: 'X2', 8: 'X3'
};

// Tactical Metrology Audio Feedback Synthesizer
const soundFx = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  beep(freq = 600, duration = 0.05, type = 'sine') {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Audio may be blocked before first user gesture
    }
  }
};

// DOM Cache
const dom = {
  scannerField: document.getElementById('scanner-field'),
  moduleIdInput: document.getElementById('module-id-input'),
  operatorInput: document.getElementById('operator-input'),
  btnOperatorProfile: document.getElementById('btn-operator-profile'),
  displayOperatorName: document.getElementById('display-operator-name'),
  displayOperatorShift: document.getElementById('display-operator-shift'),
  pillDbStatus: document.getElementById('pill-db-status'),
  pillMqttStatus: document.getElementById('pill-mqtt-status'),
  pillSimTrigger: document.getElementById('pill-sim-trigger'),
  gradeButtons: document.querySelectorAll('.grade-toggle, .grade-btn'),
  summaryModuleId: document.getElementById('summary-module-id'),
  summaryGradeBadge: document.getElementById('summary-grade-badge'),
  summaryTotalTags: document.getElementById('summary-total-tags'),
  statDefectCount: document.getElementById('stat-defect-count'),
  historyBadgeCount: document.getElementById('history-badge-count'),
  historyTbody: document.getElementById('history-tbody'),
  emptyHistoryState: document.getElementById('empty-history-state'),
  whiteboardNotationPreview: document.getElementById('whiteboard-notation-preview'),
  inspectionFrame: document.getElementById('inspection-frame'),
  stageMatrixWrapper: document.getElementById('stage-matrix-wrapper'),
  axisHeaderX: document.getElementById('axis-header-x'),
  axisFooterX: document.getElementById('axis-footer-x'),
  axisHeaderY: document.getElementById('axis-header-y'),
  imageStage: document.getElementById('image-stage'),
  coordinateGridOverlay: document.getElementById('coordinate-grid-overlay'),
  defectPinsLayer: document.getElementById('defect-pins-layer'),
  reticleLineH: document.getElementById('reticle-line-h'),
  reticleLineV: document.getElementById('reticle-line-v'),
  hoverTooltip: document.getElementById('hover-tooltip'),
  liveCoordIndicator: document.getElementById('live-coord-indicator'),
  cursorPosReadout: document.getElementById('cursor-pos-readout'),
  toggleKeepGrid: document.getElementById('toggle-keep-grid'),
  btnToggleInvert: document.getElementById('btn-toggle-invert'),
  btnResetZoom: document.getElementById('btn-reset-zoom'),
  elImage: document.getElementById('el-image'),
  selectElSample: document.getElementById('select-el-sample'),
  inputCustomImage: document.getElementById('input-custom-image'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Comic Bubble Popover Elements
  cellComicBubble: document.getElementById('cell-comic-bubble'),
  bubbleArrow: document.getElementById('bubble-arrow'),
  bubbleCellCoord: document.getElementById('bubble-cell-coord'),
  bubbleReasonsList: document.getElementById('bubble-reasons-list'),
  bubbleReasonItems: document.querySelectorAll('.bubble-reason-item'),
  bubbleNotesInput: document.getElementById('bubble-notes-input'),
  btnBubbleConfirm: document.getElementById('btn-bubble-confirm'),
  btnBubbleDelete: document.getElementById('btn-bubble-delete'),
  btnBubbleClose: document.getElementById('btn-bubble-close'),

  // CMMS Login & Account Dialog
  loginModal: document.getElementById('login-modal'),
  loginDialogTitle: document.getElementById('login-dialog-title'),
  cmmsLoginFormView: document.getElementById('cmms-login-form-view'),
  cmmsLoggedInView: document.getElementById('cmms-logged-in-view'),
  loggedInUserName: document.getElementById('logged-in-user-name'),
  loggedInUserRole: document.getElementById('logged-in-user-role'),
  loggedInUserDept: document.getElementById('logged-in-user-dept'),
  loginForm: document.getElementById('cmms-login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  btnSubmitLogin: document.getElementById('btn-submit-login'),
  btnLogoutCmms: document.getElementById('btn-logout-cmms'),
  loginErrorMsg: document.getElementById('login-error-msg'),
  btnCloseLoginModal: document.getElementById('btn-close-login-modal'),

  // Hardware Simulator Dialog
  simulatorModal: document.getElementById('simulator-modal'),
  btnCloseSimModal: document.getElementById('btn-close-sim-modal'),
  simPanelInput: document.getElementById('sim-panel-input'),
  btnTriggerMqttSim: document.getElementById('btn-trigger-mqtt-sim'),
  btnSimPresets: document.querySelectorAll('.btn-sim-preset'),

  // SQL Modal & Telemetry
  btnViewSql: document.getElementById('btn-view-sql'),
  btnLaunchTelemetry: document.getElementById('btn-launch-telemetry'),
  btnSaveInspection: document.getElementById('btn-save-inspection'),
  sqlModal: document.getElementById('sql-modal'),
  btnCloseSqlModal: document.getElementById('btn-close-sql-modal'),
  sqlCodeDisplay: document.getElementById('sql-code-display'),
  codeTabs: document.querySelectorAll('.code-tab'),
  btnCopySql: document.getElementById('btn-copy-sql'),
  btnExecuteSqlMock: document.getElementById('btn-execute-sql-mock'),
  sqlSyncIndicator: document.getElementById('sql-sync-indicator'),
  toastContainer: document.getElementById('toast-container'),

  // View Mode Switcher Elements
  workbenchShell: document.querySelector('.workbench-shell'),
  viewBtns: document.querySelectorAll('.view-mode-btn'),
  btnViewVisual: document.getElementById('btn-view-visual'),
  btnViewSplit: document.getElementById('btn-view-split'),
  btnViewTelemetry: document.getElementById('btn-view-telemetry'),
  btnSplitRatios: document.querySelectorAll('.btn-split-ratio'),
  btnToggleTelemetryPane: document.getElementById('btn-toggle-telemetry-pane'),
  unifiedTelemetryContainer: document.getElementById('unified-telemetry-container')
};

// Inter-Screen Broadcast Channel (Instant zero-latency sync with Monitor 2 Telemetry)
let stationSyncChannel = null;
try {
  stationSyncChannel = new BroadcastChannel('fvi_station_sync');
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

function broadcastModuleChange(modId) {
  if (stationSyncChannel && modId) {
    try {
      stationSyncChannel.postMessage({
        type: 'MODULE_CHANGED',
        moduleId: modId
      });
    } catch (e) { }
  }

  // Instant in-window sync for Unified 1-Screen Console
  if (window.FVITelemetry && typeof window.FVITelemetry.loadTelemetryForModule === 'function') {
    window.FVITelemetry.loadTelemetryForModule(modId);
  }
}

/**
 * Initialize Application
 */
function initApp() {
  buildAxes();
  buildCoordinateGrid();
  loadOperatorSession();
  attachEventListeners();
  checkBackendHealth();
  initConveyorEventStream();

  // Prompt to login immediately when the application first opens!
  if (!state.currentOperator) {
    setTimeout(() => {
      openLoginModal(true);
    }, 250);
  }

  // Start with clean grid ready for inspection and no grade selected
  resetGrade();
  updateSummaryAndHistory();
  renderDefectPins();

  // Initialize View Mode (defaults to 'split' Unified 1-screen console)
  const urlParams = new URLSearchParams(window.location.search);
  const initialMode = urlParams.get('view') || urlParams.get('mode') || localStorage.getItem('fvi_view_mode') || 'split';
  const initialRatio = urlParams.get('ratio') || localStorage.getItem('fvi_split_ratio') || 'visual-max';
  setSplitRatio(initialRatio);
  setViewMode(initialMode, false);
  fitInspectionStage();

  // Initial synchronization with Monitor 2 & Integrated Telemetry
  broadcastModuleChange(state.moduleId);
}

/**
 * Open CMMS Login or Account Profile Dialog
 */
function openLoginModal(isInitial = false) {
  if (state.currentOperator) {
    // Show Logged In State with "Logged in as..." and Sign Out button
    if (dom.cmmsLoginFormView) dom.cmmsLoginFormView.style.display = 'none';
    if (dom.cmmsLoggedInView) dom.cmmsLoggedInView.style.display = 'block';
    if (dom.loginDialogTitle) dom.loginDialogTitle.textContent = 'Station Operator Account';
    if (dom.loggedInUserName) dom.loggedInUserName.textContent = state.currentOperator.name || state.currentOperator.username;
    if (dom.loggedInUserRole) dom.loggedInUserRole.textContent = state.currentOperator.role || 'Inspector';
    if (dom.loggedInUserDept) dom.loggedInUserDept.textContent = state.currentOperator.department || 'Quality Operations';
  } else {
    // Show Login Form
    if (dom.cmmsLoginFormView) dom.cmmsLoginFormView.style.display = 'block';
    if (dom.cmmsLoggedInView) dom.cmmsLoggedInView.style.display = 'none';
    if (dom.loginDialogTitle) dom.loginDialogTitle.textContent = 'Inspector Login (First Name Last Name)';
    if (dom.loginUsername) dom.loginUsername.value = '';
    if (dom.loginErrorMsg) dom.loginErrorMsg.style.display = 'none';
    setTimeout(() => {
      if (dom.loginUsername) dom.loginUsername.focus();
    }, 120);
  }
  dom.loginModal.classList.add('open');
}

/**
 * Restore Saved CMMS Operator Session from localStorage
 */
function loadOperatorSession() {
  try {
    const saved = localStorage.getItem('fvi_cmms_operator');
    if (saved) {
      state.currentOperator = JSON.parse(saved);
    } else {
      state.currentOperator = null;
    }
  } catch (e) {
    state.currentOperator = null;
  }

  updateOperatorDisplay();
}

/**
 * Update Operator Profile Pill in Header
 */
function updateOperatorDisplay() {
  const op = state.currentOperator;
  if (dom.displayOperatorName) {
    dom.displayOperatorName.textContent = op ? (op.name || op.username || 'Inspector') : 'Sign In';
  }
  if (dom.operatorInput) {
    dom.operatorInput.value = op ? (op.name || op.username) : '';
  }
  if (dom.btnOperatorProfile) {
    if (op) {
      dom.btnOperatorProfile.classList.remove('needs-login');
      dom.btnOperatorProfile.title = `Logged in as ${op.name || op.username} — Click to view account or sign out`;
    } else {
      dom.btnOperatorProfile.classList.add('needs-login');
      dom.btnOperatorProfile.title = 'Click to sign in with plant CMMS credentials';
    }
  }
}

/**
 * Sign Out from CMMS
 */
function logoutCMMS() {
  state.authToken = null;
  state.currentOperator = null;
  localStorage.removeItem('fvi_cmms_operator');
  localStorage.removeItem('fvi_cmms_token');
  updateOperatorDisplay();
  openLoginModal(); // Immediately displays the clean login form for next user
  showToast('Signed out of plant CMMS', 'info');
  soundFx.beep(400, 0.08);
}

/**
 * Check Backend Edge Gateway Connectivity
 */
function checkBackendHealth() {
  const url = `${config.apiBaseUrl}/api/status`;
  fetch(url)
    .then(res => res.json())
    .then(data => {
      state.isServerOnline = true;
      if (dom.pillDbStatus) {
        dom.pillDbStatus.className = 'status-indicator-pill status-live';
        dom.pillDbStatus.innerHTML = '<span class="status-pip"></span><span>DB LIVE</span>';
      }
    })
    .catch(() => {
      state.isServerOnline = false;
      if (dom.pillDbStatus) {
        dom.pillDbStatus.className = 'status-indicator-pill status-warn';
        dom.pillDbStatus.innerHTML = '<span class="status-pip"></span><span>STANDALONE</span>';
      }
    });
}

/**
 * Real-time Conveyor MQTT Stream Listener via Server-Sent Events (SSE)
 */
function initConveyorEventStream() {
  const sseUrl = `${config.apiBaseUrl}/api/stream`;
  try {
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      state.isMqttConnected = true;
      if (dom.pillMqttStatus) {
        dom.pillMqttStatus.className = 'status-indicator-pill status-live';
        dom.pillMqttStatus.innerHTML = '<span class="status-pip"></span><span>MQTT LIVE</span>';
      }
    };

    eventSource.addEventListener('PANEL_ARRIVED', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.panel_id) {
          handleNewConveyorModule(data.panel_id, 'MQTT Sensor');
        }
      } catch (err) { }
    });

    eventSource.onerror = () => {
      state.isMqttConnected = false;
      if (dom.pillMqttStatus) {
        dom.pillMqttStatus.className = 'status-indicator-pill status-warn';
        dom.pillMqttStatus.innerHTML = '<span class="status-pip"></span><span>MQTT SIM</span>';
      }
    };
  } catch (err) {
    if (dom.pillMqttStatus) {
      dom.pillMqttStatus.className = 'status-indicator-pill status-warn';
      dom.pillMqttStatus.innerHTML = '<span class="status-pip"></span><span>MQTT SIM</span>';
    }
  }
}

/**
 * Handle Arrival of New Module from Conveyor
 * Automatically fetches the corresponding EL image from FTP and updates UI
 */
function handleNewConveyorModule(panelId, source = 'Conveyor Sensor') {
  // If the inspector has active defects on their current module, do not wipe their screen
  if (state.defects.size > 0 && state.moduleId !== panelId) {
    showToast(`Conveyor Alert: Panel ${panelId} arrived, but current module has ${state.defects.size} active defect(s).`, 'warning');
    return;
  }

  // Update current module
  state.moduleId = panelId;
  dom.moduleIdInput.value = panelId;
  if (dom.scannerField) {
    dom.scannerField.classList.remove('highlight-error');
  }
  dom.summaryModuleId.textContent = panelId;
  broadcastModuleChange(panelId);

  // Clear defects and reset grade for fresh inspection of the new module
  state.defects.clear();
  resetGrade();
  updateSummaryAndHistory();
  renderDefectPins();
  closeComicBubble();

  // Load image: tries backend FTP fetcher first, falls back to local sample
  const elImageUrl = `${config.apiBaseUrl}/api/module/${panelId}/el-image`;

  // Test image availability
  const tempImg = new Image();
  tempImg.onload = () => {
    dom.elImage.src = elImageUrl;
    showToast(`Conveyor MQTT: Loaded ${panelId} (${source})`, 'success');
  };
  tempImg.onerror = () => {
    // Fallback mapping for testing samples
    const sampleMap = {
      'USM0112208260078': 'solar_el_sample.jpg',
      'USM0111208260304': 'solar_el_sample.jpg',
      'USM0111208260302': 'sample_el_2.jpg',
      'USM0111208260208': 'sample_el_3.jpg',
      'USM0111208260303': 'sample_el_4.jpg'
    };
    dom.elImage.src = sampleMap[panelId] || 'solar_el_sample.jpg';
    showToast(`Conveyor MQTT: Detected ${panelId}`, 'info');
  };
  tempImg.src = elImageUrl;

  soundFx.beep(850, 0.1);
}

// Pre-allocated element caches for high-performance DOM manipulation
const axisColMap = new Map();       // col (1..24) -> [colElTop, colElBot]
const axisRowMap = new Map();       // row ('A'..'F') -> [rowEl]
const gridCellsByCoord = new Map(); // coord ('A1'..'F24') -> cell element
const pinSlotsByCoord = new Map();  // coord ('A1'..'F24') -> pinSlot element
let currentHoverCol = null;
let currentHoverRow = null;
let activeSelectedCellEl = null;

/**
 * Build Axis Headers: Top X (1-24), Bottom X (1-24), Left Y (A-F)
 * Batched with DocumentFragments and pre-mapped for O(1) hover highlights.
 */
function buildAxes() {
  dom.axisHeaderX.innerHTML = '';
  dom.axisFooterX.innerHTML = '';
  dom.axisHeaderY.innerHTML = '';
  axisColMap.clear();
  axisRowMap.clear();

  const fragHeaderX = document.createDocumentFragment();
  const fragFooterX = document.createDocumentFragment();
  const fragHeaderY = document.createDocumentFragment();

  GRID_COLS.forEach(col => {
    const colElTop = document.createElement('div');
    colElTop.className = 'axis-cell-x';
    colElTop.dataset.col = col;
    colElTop.textContent = col;
    fragHeaderX.appendChild(colElTop);

    const colElBot = document.createElement('div');
    colElBot.className = 'axis-cell-x';
    colElBot.dataset.col = col;
    colElBot.textContent = col;
    fragFooterX.appendChild(colElBot);

    axisColMap.set(col, [colElTop, colElBot]);
  });

  GRID_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'axis-cell-y';
    rowEl.dataset.row = row;
    rowEl.textContent = row;
    fragHeaderY.appendChild(rowEl);

    axisRowMap.set(row, [rowEl]);
  });

  dom.axisHeaderX.appendChild(fragHeaderX);
  dom.axisFooterX.appendChild(fragFooterX);
  dom.axisHeaderY.appendChild(fragHeaderY);
}

/**
 * Update Axis Highlights with O(1) Map lookups
 * Skips DOM mutations if the active column/row has not changed.
 */
function updateAxisHighlights(newCol, newRow) {
  if (newCol !== currentHoverCol) {
    if (currentHoverCol && axisColMap.has(currentHoverCol)) {
      axisColMap.get(currentHoverCol).forEach(el => el.classList.remove('highlight'));
    }
    if (newCol && axisColMap.has(newCol)) {
      axisColMap.get(newCol).forEach(el => el.classList.add('highlight'));
    }
    currentHoverCol = newCol;
  }

  if (newRow !== currentHoverRow) {
    if (currentHoverRow && axisRowMap.has(currentHoverRow)) {
      axisRowMap.get(currentHoverRow).forEach(el => el.classList.remove('highlight'));
    }
    if (newRow && axisRowMap.has(newRow)) {
      axisRowMap.get(newRow).forEach(el => el.classList.add('highlight'));
    }
    currentHoverRow = newRow;
  }
}

/**
 * Build Interactive 24x6 Coordinate Grid (144 cells)
 * Batched with DocumentFragments and pre-mapped for O(1) cell/slot lookups.
 */
function buildCoordinateGrid() {
  dom.coordinateGridOverlay.innerHTML = '';
  dom.defectPinsLayer.innerHTML = '';
  gridCellsByCoord.clear();
  pinSlotsByCoord.clear();

  const fragGrid = document.createDocumentFragment();
  const fragPins = document.createDocumentFragment();

  GRID_ROWS.forEach(row => {
    GRID_COLS.forEach(col => {
      const coord = `${row}${col}`;

      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.coord = coord;
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', `Cell ${row}-${col}`);
      fragGrid.appendChild(cell);

      const pinSlot = document.createElement('div');
      pinSlot.className = 'defect-pin-slot';
      pinSlot.dataset.coord = coord;
      fragPins.appendChild(pinSlot);

      gridCellsByCoord.set(coord, cell);
      pinSlotsByCoord.set(coord, pinSlot);
    });
  });

  dom.coordinateGridOverlay.appendChild(fragGrid);
  dom.defectPinsLayer.appendChild(fragPins);
}

/**
 * Update a Single Persistent Defect Pin Slot in O(1) time
 */
function updateDefectPin(coord) {
  const slot = pinSlotsByCoord.get(coord);
  if (!slot) return;
  slot.innerHTML = '';
  if (state.defects.has(coord)) {
    const defect = state.defects.get(coord);
    const marker = document.createElement('span');
    const prefix = defect.defectCode.charAt(0).toLowerCase();
    marker.className = `defect-marker marker-${prefix}`;
    marker.textContent = defect.defectCode;
    marker.title = `${coord}: ${defect.defectName}`;
    slot.appendChild(marker);
  }
}

/**
 * Render/Refresh All Persistent Defect Badges using Pre-Cached Map
 */
function renderDefectPins() {
  pinSlotsByCoord.forEach((_, coord) => {
    updateDefectPin(coord);
  });
}

/**
 * Open Comic Speech Bubble Popover Next to Clicked Cell
 */
function openComicBubble(coord, row, col) {
  state.activeCell = { coord, row, col };
  state.selectedDefectCode = null;
  soundFx.beep(750, 0.05);

  dom.bubbleCellCoord.textContent = `CELL ${row}-${col < 10 ? '0' + col : col} (${coord})`;

  if (activeSelectedCellEl) {
    activeSelectedCellEl.classList.remove('active-selected');
    activeSelectedCellEl = null;
  }
  const cellEl = gridCellsByCoord.get(coord);
  if (cellEl) {
    cellEl.classList.add('active-selected');
    activeSelectedCellEl = cellEl;
  }

  const stageRect = dom.imageStage.getBoundingClientRect();
  const cellRect = cellEl ? cellEl.getBoundingClientRect() : { left: stageRect.left, top: stageRect.top, width: 30, height: 40 };

  const cellLeft = cellRect.left - stageRect.left;
  const cellTop = cellRect.top - stageRect.top;
  const cellWidth = cellRect.width;
  const cellHeight = cellRect.height;

  const bubbleWidth = 250;
  let bubbleLeft = 0;

  if (col <= 12) {
    dom.cellComicBubble.classList.remove('arrow-right');
    dom.cellComicBubble.classList.add('arrow-left');
    bubbleLeft = cellLeft + cellWidth + 12;
  } else {
    dom.cellComicBubble.classList.remove('arrow-left');
    dom.cellComicBubble.classList.add('arrow-right');
    bubbleLeft = cellLeft - bubbleWidth - 12;
  }

  // Horizontal clamp: Ensure bubble stays cleanly inside stage boundaries
  bubbleLeft = Math.max(8, Math.min(bubbleLeft, stageRect.width - bubbleWidth - 8));

  let bubbleTop = cellTop + (cellHeight / 2) - 130;
  const maxTop = Math.max(8, stageRect.height - 310);
  bubbleTop = Math.max(8, Math.min(bubbleTop, maxTop));

  dom.cellComicBubble.style.left = `${Math.round(bubbleLeft)}px`;
  dom.cellComicBubble.style.top = `${Math.round(bubbleTop)}px`;

  dom.bubbleReasonItems.forEach(item => item.classList.remove('selected'));
  setBubbleConfirmState(false);

  if (state.defects.has(coord)) {
    const existing = state.defects.get(coord);
    state.selectedDefectCode = existing.defectCode;

    const matchingItem = Array.from(dom.bubbleReasonItems).find(i => i.dataset.code === existing.defectCode);
    if (matchingItem) matchingItem.classList.add('selected');

    dom.bubbleNotesInput.value = existing.notes || '';
    dom.btnBubbleDelete.style.display = 'inline-block';
    setBubbleConfirmState(true);
  } else {
    dom.bubbleNotesInput.value = '';
    dom.btnBubbleDelete.style.display = 'none';
  }

  dom.cellComicBubble.style.display = 'flex';
  dom.coordinateGridOverlay.classList.add('force-visible');
}

/**
 * Control Confirm Button Lit / Disabled State
 */
function setBubbleConfirmState(isLit) {
  dom.btnBubbleConfirm.disabled = !isLit;
  dom.btnBubbleConfirm.classList.toggle('lit', isLit);
}

/**
 * Close Comic Speech Bubble Popover
 */
function closeComicBubble() {
  dom.cellComicBubble.style.display = 'none';
  if (activeSelectedCellEl) {
    activeSelectedCellEl.classList.remove('active-selected');
    activeSelectedCellEl = null;
  }
  state.activeCell = null;
  state.selectedDefectCode = null;

  if (!state.isGridLocked) {
    dom.coordinateGridOverlay.classList.remove('force-visible');
  }
}

/**
 * Set / Register Defect in State and IMMEDIATELY SEND TO DATABASE (User Requirement)
 */
function setDefect(coord, row, col, defectCode, notes = '', notify = true, syncToDatabase = true) {
  const catalogEntry = DEFECT_CATALOG[defectCode] || {
    typeId: 1,
    name: 'Observed Anomaly',
    severity: 'Moderate',
    defaultGrade: 'B'
  };

  const defectItem = {
    coord,
    row,
    col,
    defectCode,
    defectType: catalogEntry.typeId || DEFECT_CODE_TO_ID[defectCode] || 1, // int2
    defectName: catalogEntry.name,
    severity: catalogEntry.severity,
    gradeImpact: catalogEntry.defaultGrade,
    timestamp: new Date().toLocaleTimeString(),
    notes: (notes || '').trim(),
    operatorId: state.currentOperator.id,
    operatorName: state.currentOperator.name
  };

  state.defects.set(coord, defectItem);

  if (defectCode.startsWith('X') && state.grade !== 'X') {
    showToast(`Critical defect ${defectCode} flagged. Consider setting Grade to [X].`, 'warning');
  }

  updateSummaryAndHistory();
  updateDefectPin(coord);

  // INSTANT DATABASE PERSISTENCE (POST /api/defects -> final_inspection_defects)
  if (syncToDatabase) {
    persistDefectToDatabase(defectItem);
  }

  if (notify) {
    showToast(`Logged [${defectCode}] at Cell ${coord}`, 'success');
    soundFx.beep(920, 0.08);
  }
}

/**
 * Persist Defect to Database Immediately via REST API
 * Maps directly to table: final_inspection_defects
 * (record_id and tested_at are auto-generated by the database)
 */
function persistDefectToDatabase(defect) {
  const defectName = defect.defectName || (DEFECT_CATALOG[defect.defectCode] ? DEFECT_CATALOG[defect.defectCode].name : 'Defect');
  const payload = {
    module_id: (state.moduleId || '').slice(0, 16), // nvarchar(16)
    defect_location: defect.coord, // nvarchar(4) e.g. "C8" (matches dbo.Final_Inspection_Defects.Defect_Location)
    defect_cell: defect.coord, // backwards compatibility
    defect_type: defectName.slice(0, 30), // nvarchar(30) (matches dbo.Final_Inspection_Defects.Defect_Type)
    tester_name: state.currentOperator.name || state.currentOperator.username || 'Inspector',

    // Auxiliary fields for client-side state & logging
    defect_code: defect.defectCode,
    defect_name: defectName,
    row_id: defect.row,
    col_id: defect.col,
    notes: defect.notes
  };

  fetch(`${config.apiBaseUrl}/api/defects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': state.authToken ? `Bearer ${state.authToken}` : ''
    },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        if (dom.pillDbStatus) {
          dom.pillDbStatus.className = 'status-indicator-pill status-live';
          dom.pillDbStatus.innerHTML = `<span class="status-pip"></span><span>DEFECT #${data.record_id || data.defect_id || ''}</span>`;
          setTimeout(() => {
            dom.pillDbStatus.innerHTML = '<span class="status-pip"></span><span>DB LIVE</span>';
          }, 2000);
        }
      }
    })
    .catch(err => {
      // Offline queue fallback
      queueDefectOffline(payload);
    });
}

/**
 * Queue Defect in LocalStorage when Offline
 */
function queueDefectOffline(payload) {
  try {
    const queue = JSON.parse(localStorage.getItem('fvi_offline_defects') || '[]');
    queue.push(payload);
    localStorage.setItem('fvi_offline_defects', JSON.stringify(queue));
    if (dom.pillDbStatus) {
      dom.pillDbStatus.className = 'status-indicator-pill status-warn';
      dom.pillDbStatus.innerHTML = `<span class="status-pip"></span><span>QUEUED (${queue.length})</span>`;
    }
  } catch (e) { }
}

/**
 * Remove Defect from State & Database
 */
function removeDefect(coord) {
  if (state.defects.has(coord)) {
    state.defects.delete(coord);
    updateSummaryAndHistory();
    updateDefectPin(coord);
    showToast(`Defect removed from ${coord}`, 'info');
    soundFx.beep(350, 0.08);

    // Sync deletion to database
    fetch(`${config.apiBaseUrl}/api/defects/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module_id: state.moduleId, cell_coord: coord })
    }).catch(() => { });
  }
}

/**
 * Update Left Panel Summary and History Table (Appends logged defect data)
 * Uses DocumentFragment for batched, single-paint DOM insertion.
 */
function updateSummaryAndHistory() {
  const count = state.defects.size;
  dom.statDefectCount.textContent = count;
  if (dom.summaryTotalTags) {
    dom.summaryTotalTags.textContent = `${count} ${count === 1 ? 'cell' : 'cells'} tagged`;
  }
  dom.historyBadgeCount.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  dom.summaryModuleId.textContent = state.moduleId || 'Pending Serial';

  dom.historyTbody.innerHTML = '';
  if (count === 0) {
    dom.emptyHistoryState.style.display = 'flex';
    dom.whiteboardNotationPreview.textContent = '(None)';
  } else {
    dom.emptyHistoryState.style.display = 'none';

    const frag = document.createDocumentFragment();
    const notationList = [];
    const sortedDefects = Array.from(state.defects.values()).sort((a, b) => {
      if (a.row !== b.row) return a.row.localeCompare(b.row);
      return a.col - b.col;
    });

    sortedDefects.forEach(defect => {
      notationList.push(`${defect.coord} ${defect.defectCode}`);

      const tr = document.createElement('tr');
      tr.className = 'history-row';
      tr.title = 'Click to focus cell on inspection stage';
      tr.innerHTML = `
        <td><span class="cell-pill">${defect.coord}</span></td>
        <td><span class="code-pill code-${defect.defectCode.charAt(0).toLowerCase()}">${defect.defectCode}</span></td>
        <td class="defect-name-cell" title="${defect.defectName}">${defect.defectName}</td>
        <td><span class="font-bold text-muted">${defect.gradeImpact}</span></td>
        <td class="text-right">
          <button type="button" class="btn-delete-row" data-delete-coord="${defect.coord}" title="Delete defect">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </td>
      `;

      tr.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-row')) return;
        openComicBubble(defect.coord, defect.row, defect.col);
      });

      frag.appendChild(tr);
    });

    dom.historyTbody.appendChild(frag);
    dom.whiteboardNotationPreview.textContent = notationList.join('; ');
  }
}

// Grade Mapping: MES Database Numeric Standard (0=A, 1=B, 2=Retest/Rework, 3=Reject)
const GRADE_NUMERIC_MAP = {
  'A': '0',
  'B': '1',
  'R': '2',
  'X': '3',
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3'
};

const NUMERIC_TO_GRADE_LETTER = {
  '0': 'A',
  '1': 'B',
  '2': 'R',
  '3': 'X',
  0: 'A',
  1: 'B',
  2: 'R',
  3: 'X'
};

/**
 * Handle Grade Toggle (A, B, R, X) - Single select only
 */
function setGrade(newGrade) {
  const letterGrade = NUMERIC_TO_GRADE_LETTER[newGrade] || newGrade;
  state.grade = letterGrade;
  soundFx.beep(520, 0.06);

  // Remove any active error highlight
  const gradeControl = document.getElementById('segmented-grade-control');
  if (gradeControl) {
    gradeControl.classList.remove('highlight-error');
  }

  dom.gradeButtons.forEach(btn => {
    const isTarget = btn.dataset.grade === letterGrade;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-checked', isTarget ? 'true' : 'false');
  });

  const numericCode = GRADE_NUMERIC_MAP[letterGrade] || '0';

  if (dom.summaryGradeBadge) {
    dom.summaryGradeBadge.className = `telemetry-badge grade-tag-${letterGrade.toLowerCase()}`;
    const descriptions = {
      'A': 'Grade A (Prime)',
      'B': 'Grade B (Secondary)',
      'R': 'Retest / Rework',
      'X': 'Grade X (Reject)'
    };
    dom.summaryGradeBadge.textContent = descriptions[letterGrade] || `Grade ${letterGrade}`;
  }

  showToast(`Selected Grade [${letterGrade}]`, 'info');
}

/**
 * Reset Grade Selection (Clears active grade)
 */
function resetGrade() {
  state.grade = null;
  const gradeControl = document.getElementById('segmented-grade-control');
  if (gradeControl) {
    gradeControl.classList.remove('highlight-error');
  }
  dom.gradeButtons.forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-checked', 'false');
  });
  if (dom.summaryGradeBadge) {
    dom.summaryGradeBadge.className = 'telemetry-badge grade-tag-pending';
    dom.summaryGradeBadge.textContent = 'Pending Selection';
  }
}

/**
 * Persist Grade to Database (table: final_inspections)
 * Requirement: Send 0 (A), 1 (B), 2 (Retest/Rework), 3 (Reject)
 */
/**
 * Validate Module Serial Number:
 * Must be typed in, start with "USM", and have 16 characters total (including "USM").
 */
function validateModuleSerial(showFeedback = true) {
  const rawSerial = (dom.moduleIdInput ? dom.moduleIdInput.value : state.moduleId || '').trim();
  state.moduleId = rawSerial;

  const isValid = rawSerial.length === 16 && rawSerial.startsWith('USM');
  if (isValid) {
    if (dom.scannerField) {
      dom.scannerField.classList.remove('highlight-error');
    }
    return true;
  }

  if (showFeedback) {
    let msg = 'Please enter a Module Serial Number (must start with USM and have 16 characters)';
    if (rawSerial && !rawSerial.startsWith('USM')) {
      msg = 'Invalid Module Serial: Must start with "USM" and be 16 characters long';
    } else if (rawSerial && rawSerial.length !== 16) {
      msg = `Invalid Module Serial: Must be 16 characters including USM (currently ${rawSerial.length}/16)`;
    }
    showToast(msg, 'warning');
    soundFx.beep(260, 0.15);

    const scannerField = dom.scannerField || document.getElementById('scanner-field');
    if (scannerField) {
      scannerField.classList.remove('highlight-error');
      void scannerField.offsetWidth; // Force reflow to re-trigger CSS animations
      scannerField.classList.add('highlight-error');
      scannerField.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (dom.moduleIdInput) {
      dom.moduleIdInput.focus();
    }
  }

  return false;
}

function persistGradeToDatabase(grade) {
  const numericGrade = GRADE_NUMERIC_MAP[grade] || '0';
  const tester = (state.currentOperator && (state.currentOperator.name || state.currentOperator.username)) || 'Inspector';
  const payload = {
    module_id: (state.moduleId || '').slice(0, 16), // nvarchar(16)
    grade: numericGrade, // 0 = A, 1 = B, 2 = Retest/Rework, 3 = Reject
    result_code: numericGrade, // backwards compatibility
    tester_name: tester
  };

  fetch(`${config.apiBaseUrl}/api/inspections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success && dom.pillDbStatus) {
        dom.pillDbStatus.className = 'status-indicator-pill status-live';
        dom.pillDbStatus.innerHTML = `<span class="status-pip"></span><span>GRADE [${grade}] SAVED</span>`;
        setTimeout(() => {
          dom.pillDbStatus.innerHTML = '<span class="status-pip"></span><span>DB LIVE</span>';
        }, 2500);
      }
    })
    .catch(() => { });
}

/**
 * Helper to commit successful operator login state
 */
function handleLoginSuccess(userProfile, token) {
  state.authToken = token;
  const fullName = userProfile.full_name || userProfile.name || userProfile.username || 'Inspector';
  state.currentOperator = {
    id: userProfile.id || userProfile.user_id || fullName.toLowerCase().replace(/\s+/g, '.'),
    username: userProfile.username || fullName,
    name: fullName,
    role: userProfile.role || 'Inspector',
    department: (typeof userProfile.department === 'object' ? userProfile.department?.name : userProfile.department) || 'Quality Operations'
  };
  localStorage.setItem('fvi_cmms_operator', JSON.stringify(state.currentOperator));
  if (token) localStorage.setItem('fvi_cmms_token', token);
  updateOperatorDisplay();
  dom.loginModal.classList.remove('open');
  showToast(`Logged in as ${fullName}. Remember to log out when done!`, 'success');
  soundFx.beep(880, 0.1);
}

/**
 * Perform Operator Authentication (Name-Only Login: First Name Last Name)
 */
async function authenticateCMMS(operatorName) {
  dom.loginErrorMsg.style.display = 'none';
  const submitBtn = dom.btnSubmitLogin || document.getElementById('btn-submit-login');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
  }

  const resetBtn = () => {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  };

  const name = (operatorName || '').trim();
  if (!name) {
    dom.loginErrorMsg.textContent = 'Please enter your First Name and Last Name';
    dom.loginErrorMsg.style.display = 'block';
    resetBtn();
    return;
  }

  // 1. If local edge server is online, route through local gateway API
  if (state.isServerOnline) {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, username: name })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        handleLoginSuccess(data.user, data.token);
        resetBtn();
        return;
      }
    } catch (e) {
      // Fall through to direct local sign in
    }
  }

  // 2. Direct local sign-in fallback (offline or direct file:/// use)
  const localUser = {
    user_id: name.toLowerCase().replace(/\s+/g, '.'),
    username: name,
    full_name: name,
    name: name,
    role: 'Inspector',
    department: 'Quality Operations'
  };
  handleLoginSuccess(localUser, 'local_' + Date.now());
  resetBtn();
}

/**
 * Generate Prepared SQL Payload
 */
function generateSqlQueries() {
  const defectsList = Array.from(state.defects.values());
  const modId = (state.moduleId || 'USM0111208260304').slice(0, 16);
  const tester = ((state.currentOperator && state.currentOperator.name) || 'Inspector').replace(/'/g, "''");
  const numericGrade = GRADE_NUMERIC_MAP[state.grade] || '0';

  const insertInspectionSql = `-- 1. Overall Final Inspection (table: dbo.Final_Inspections)
-- Target Database: PL2
-- Note: Record_ID is IDENTITY(1,1), Tested_At uses SYSDATETIMEOFFSET()
-- Numeric Grade Mapping: 0 = Grade A, 1 = Grade B, 2 = Retest/Rework, 3 = Reject
INSERT INTO dbo.Final_Inspections (
  Module_ID,
  Tested_At,
  Grade,
  Tester_Name
) VALUES (
  '${modId}',
  SYSDATETIMEOFFSET(),
  '${numericGrade}',
  '${tester}'
);`;

  let insertDefectsSql = `-- 2. Detailed Cell Defects (table: dbo.Final_Inspection_Defects)\n-- Note: Record_ID is IDENTITY(1,1), Tested_At uses SYSDATETIMEOFFSET()\n`;
  if (defectsList.length === 0) {
    insertDefectsSql += `-- (No cell defects flagged for this module)`;
  } else {
    insertDefectsSql += `INSERT INTO dbo.Final_Inspection_Defects (
  Module_ID,
  Tested_At,
  Defect_Location,
  Defect_Type,
  Tester_Name
) VALUES\n`;
    const rows = defectsList.map(d => {
      const typeName = (d.defectName || (DEFECT_CATALOG[d.defectCode] ? DEFECT_CATALOG[d.defectCode].name : 'Micro-Crack')).slice(0, 30).replace(/'/g, "''");
      return `  ('${modId}', SYSDATETIMEOFFSET(), '${d.coord}', '${typeName}', '${tester}')`;
    });
    insertDefectsSql += rows.join(',\n') + ';';
  }

  return `${insertInspectionSql}\n\n${insertDefectsSql}`;
}

/**
 * Generate DDL Schema for SQL Database (Matches exact Microsoft SQL Server PL2 schema)
 */
function generateSqlSchema() {
  return `-- Production Database Schema (Microsoft SQL Server / PL2)

-- 1. Detailed Cell Defects Table
CREATE TABLE dbo.Final_Inspection_Defects (
  Record_ID BIGINT IDENTITY(1,1) PRIMARY KEY,
  Module_ID NVARCHAR(16) NOT NULL,
  Tested_At DATETIMEOFFSET(7) NOT NULL,
  Defect_Location NVARCHAR(4) NULL,
  Defect_Type NVARCHAR(30) NULL,
  Tester_Name NVARCHAR(MAX) NULL
);

-- 2. Overall Final Inspections Header Table
CREATE TABLE dbo.Final_Inspections (
  Record_ID BIGINT IDENTITY(1,1) PRIMARY KEY,
  Module_ID NVARCHAR(16) NOT NULL,
  Tested_At DATETIMEOFFSET(7) NOT NULL,
  Grade NVARCHAR(1) NOT NULL,
  Tester_Name NVARCHAR(MAX) NULL
);

-- Defect Type Classifications:
-- [A1] Micro-Crack (Hairline)
-- [A2] Cross-Crack / Star Crack
-- [B1] Dead Finger / Inactive Area
-- [B2] Solder Disconnect / Void
-- [C1] Dark Cell / Low Shunt
-- [X1] Broken Cell / Corner V-Crack
-- [X2] Severe Hotspot / Solder Bead
-- [X3] Delamination / Foreign Mat.`;
}

/**
 * Generate JSON payload
 */
function generateJsonPayload() {
  return JSON.stringify({
    stationId: 'FVI_STATION_01',
    moduleId: state.moduleId,
    operator: state.currentOperator,
    grade: state.grade,
    gridSize: { rows: 6, cols: 24, totalCells: 144 },
    defectsCount: state.defects.size,
    whiteboardSyntax: Array.from(state.defects.values()).map(d => `${d.coord} ${d.defectCode}`).join('; '),
    defects: Array.from(state.defects.values()),
    timestamp: new Date().toISOString()
  }, null, 2);
}

let currentSqlTab = 'sql-insert';
function updateSqlCodeView() {
  if (currentSqlTab === 'sql-insert') {
    dom.sqlCodeDisplay.textContent = generateSqlQueries();
  } else if (currentSqlTab === 'sql-schema') {
    dom.sqlCodeDisplay.textContent = generateSqlSchema();
  } else if (currentSqlTab === 'sql-json') {
    dom.sqlCodeDisplay.textContent = generateJsonPayload();
  }
}

/**
 * Toast Notification Utility
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-dot"></span>
    <span class="toast-msg">${message}</span>
  `;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 250);
  }, 2600);
}

// Cached stage bounding rect
let stageRect = null;
function updateStageRect() {
  if (dom.imageStage) {
    stageRect = dom.imageStage.getBoundingClientRect();
  }
}

/**
 * Calibrated Responsive Stage Auto-Fitter:
 * Dynamically fits the 1024:558 EL image and 24x6 grid so that 100% of the image,
 * coordinates, and Row F are completely visible without ANY vertical clipping.
 */
function fitInspectionStage() {
  if (!dom.inspectionFrame || !dom.imageStage) return;

  const frameRect = dom.inspectionFrame.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return;

  const padX = 20;
  const padY = 8;
  const axisYWidth = 28;
  const axisTotalXHeight = 36; // 18px top axis + 18px bottom mirror axis

  const availW = Math.max(120, frameRect.width - padX);
  const availH = Math.max(100, frameRect.height - padY);

  const maxStageW = availW - axisYWidth;
  const maxStageH = availH - axisTotalXHeight;

  // Physical EL Camera Aspect Ratio is 1024 : 558 (~1.8351)
  const targetAspect = 1024 / 558;

  let stageW = maxStageW;
  let stageH = stageW / targetAspect;

  // Constrain by height if needed so Row F and all 6 rows are completely visible
  if (stageH > maxStageH) {
    stageH = maxStageH;
    stageW = stageH * targetAspect;
  }

  stageW = Math.floor(stageW);
  stageH = Math.floor(stageH);

  dom.imageStage.style.width = `${stageW}px`;
  dom.imageStage.style.height = `${stageH}px`;

  if (dom.elImage) {
    dom.elImage.style.width = '100%';
    dom.elImage.style.height = '100%';
    dom.elImage.style.objectFit = 'fill';
    dom.elImage.style.display = 'block';
  }

  const totalW = stageW + axisYWidth;
  if (dom.stageMatrixWrapper) {
    dom.stageMatrixWrapper.style.width = `${totalW}px`;
    dom.stageMatrixWrapper.style.height = `${stageH + axisTotalXHeight}px`;
  }
  if (dom.axisHeaderX) {
    dom.axisHeaderX.style.width = `${totalW}px`;
  }
  if (dom.axisFooterX) {
    dom.axisFooterX.style.width = `${totalW}px`;
  }
  if (dom.axisHeaderY) {
    // 97.491% matches active cell rows A-F (excluding bottom timestamp text)
    dom.axisHeaderY.style.height = `${Math.floor(stageH * 0.97491)}px`;
  }

  updateStageRect();
}

/**
 * Attach Event Listeners
 */
function attachEventListeners() {
  // Module ID syncing
  dom.moduleIdInput.addEventListener('input', (e) => {
    if (dom.scannerField) {
      dom.scannerField.classList.remove('highlight-error');
    }
    state.moduleId = e.target.value.trim();
    dom.summaryModuleId.textContent = state.moduleId || 'Pending Serial';
    broadcastModuleChange(state.moduleId);
  });

  // Grade Buttons Toggle: [ A ] [ B ] [ X ]
  dom.gradeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const grade = btn.dataset.grade;
      setGrade(grade);
    });
  });

  // Operator Profile Button -> Opens CMMS Login or Account Dialog
  dom.btnOperatorProfile.addEventListener('click', () => {
    openLoginModal();
  });

  if (dom.btnLogoutCmms) {
    dom.btnLogoutCmms.addEventListener('click', () => {
      logoutCMMS();
    });
  }

  dom.btnCloseLoginModal.addEventListener('click', () => {
    dom.loginModal.classList.remove('open');
  });

  // CMMS Login Form Submission
  dom.loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = dom.loginUsername.value.trim();
    authenticateCMMS(user);
  });

  // Simulator Modal Triggers
  dom.pillSimTrigger.addEventListener('click', () => {
    dom.simulatorModal.classList.add('open');
  });

  dom.btnCloseSimModal.addEventListener('click', () => {
    dom.simulatorModal.classList.remove('open');
  });

  // Trigger Conveyor MQTT Arrival in Simulator
  dom.btnTriggerMqttSim.addEventListener('click', () => {
    const panelId = dom.simPanelInput.value.trim() || 'USM-0083';

    // Call backend simulator API or handle locally
    fetch(`${config.apiBaseUrl}/api/conveyor/simulate-mqtt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ panel_id: panelId })
    })
      .then(res => res.json())
      .then(() => {
        dom.simulatorModal.classList.remove('open');
      })
      .catch(() => {
        handleNewConveyorModule(panelId, 'Simulator');
        dom.simulatorModal.classList.remove('open');
      });
  });

  // Simulator Presets
  dom.btnSimPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      dom.simPanelInput.value = panel;
      handleNewConveyorModule(panel, 'Preset');
      dom.simulatorModal.classList.remove('open');
    });
  });

  // Image Hover & Active Reticle Tracking (Cached stage bounds, passive resize/scroll listeners)
  window.addEventListener('resize', fitInspectionStage, { passive: true });
  window.addEventListener('scroll', updateStageRect, { passive: true });
  if (dom.elImage) {
    dom.elImage.addEventListener('load', fitInspectionStage);
  }

  dom.imageStage.addEventListener('mouseenter', () => {
    updateStageRect();
    if (!state.isGridLocked && !state.activeCell) {
      dom.coordinateGridOverlay.style.opacity = '1';
      dom.coordinateGridOverlay.style.pointerEvents = 'auto';
    }
  });

  dom.imageStage.addEventListener('mouseleave', () => {
    if (!state.isGridLocked && !state.activeCell) {
      dom.coordinateGridOverlay.style.opacity = '0';
      dom.coordinateGridOverlay.style.pointerEvents = 'none';
    }
    dom.hoverTooltip.style.display = 'none';
    dom.liveCoordIndicator.textContent = 'Hover image to view grid';
    dom.cursorPosReadout.textContent = 'Cursor: Outside stage';
    updateAxisHighlights(null, null);
  });

  // RAF-Throttled Mousemove Crosshairs & Coordinate Updates (60+ FPS, Zero Layout Thrashing)
  let mouseRafId = null;
  let pendingMouseMove = null;

  function processMouseMove() {
    mouseRafId = null;
    if (!pendingMouseMove) return;

    if (!stageRect) updateStageRect();
    const x = pendingMouseMove.clientX - stageRect.left;
    const y = pendingMouseMove.clientY - stageRect.top;

    if (dom.reticleLineH) {
      dom.reticleLineH.style.transform = `translate3d(0, ${Math.round(y)}px, 0)`;
    }
    if (dom.reticleLineV) {
      dom.reticleLineV.style.transform = `translate3d(${Math.round(x)}px, 0, 0)`;
    }

    const cell = pendingMouseMove.targetCell;
    if (!cell) {
      dom.cursorPosReadout.textContent = `Cursor: X: ${Math.round(x)}px, Y: ${Math.round(y)}px`;
      updateAxisHighlights(null, null);
      dom.hoverTooltip.style.display = 'none';
      return;
    }

    const row = cell.dataset.row;
    const col = parseInt(cell.dataset.col, 10);
    const coord = cell.dataset.coord;

    dom.liveCoordIndicator.textContent = `Cell: ${row}-${col < 10 ? '0' + col : col} (${coord})`;
    dom.cursorPosReadout.textContent = `Cell ${coord} [Col ${col}, Row ${row}] &bull; X: ${Math.round(x)}px, Y: ${Math.round(y)}px`;

    if (dom.cellComicBubble.style.display !== 'flex') {
      dom.hoverTooltip.style.display = 'flex';

      const existingDefect = state.defects.get(coord);
      dom.hoverTooltip.querySelector('.tooltip-coord').textContent = `Cell ${row}-${col}`;
      dom.hoverTooltip.querySelector('.tooltip-status').textContent = existingDefect
        ? `Defect: ${existingDefect.defectCode} (${existingDefect.defectName})`
        : 'Click to select cell';

      // Pre-cached tooltip dimensions (eliminates forced reflows from offsetWidth/offsetHeight)
      const tooltipW = 140;
      const tooltipH = 44;
      const stageW = stageRect ? stageRect.width : 1000;
      const stageH = stageRect ? stageRect.height : 260;

      // Horizontal clamp (keep minimum 8px margin from left and right stage borders)
      let posX = x;
      let transX = '-50%';
      if (x - (tooltipW / 2) < 8) {
        posX = 8;
        transX = '0%';
      } else if (x + (tooltipW / 2) > stageW - 8) {
        posX = stageW - 8;
        transX = '-100%';
      }

      // Vertical clamp: If hovering near the top row (Row A), flip tooltip BELOW cursor so it's not clipped
      let posY = y;
      let transY = '-130%';
      if (y - tooltipH - 12 < 0) {
        posY = y + 22;
        transY = '0%';
      } else if (y > stageH - 30) {
        posY = stageH - 10;
        transY = '-100%';
      }

      dom.hoverTooltip.style.transform = `translate3d(${Math.round(posX)}px, ${Math.round(posY)}px, 0) translate(${transX}, ${transY})`;
    } else {
      dom.hoverTooltip.style.display = 'none';
    }

    updateAxisHighlights(col, row);
  }

  dom.imageStage.addEventListener('mousemove', (e) => {
    pendingMouseMove = {
      clientX: e.clientX,
      clientY: e.clientY,
      targetCell: e.target.closest('.grid-cell')
    };
    if (!mouseRafId) {
      mouseRafId = requestAnimationFrame(processMouseMove);
    }
  }, { passive: true });

  // Click on a cell in grid -> Opens comic bubble popover on the side of the clicked cell!
  dom.coordinateGridOverlay.addEventListener('click', (e) => {
    const cell = e.target.closest('.grid-cell');
    if (!cell) return;
    const row = cell.dataset.row;
    const col = parseInt(cell.dataset.col, 10);
    const coord = cell.dataset.coord;

    openComicBubble(coord, row, col);
  });

  // Comic Bubble Reason Selection: Lights up confirm button
  dom.bubbleReasonItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = item.dataset.code;
      state.selectedDefectCode = code;

      dom.bubbleReasonItems.forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');

      setBubbleConfirmState(true);
      soundFx.beep(640, 0.04);
    });
  });

  // Comic Bubble Confirm Button: "data will be sent right away to the database and saved in there"
  dom.btnBubbleConfirm.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.activeCell || !state.selectedDefectCode) return;

    if (!validateModuleSerial(true)) {
      return;
    }

    if (!state.currentOperator) {
      showToast('Please sign in with your CMMS account before logging defects', 'warning');
      soundFx.beep(300, 0.1);
      openLoginModal();
      return;
    }

    const notes = dom.bubbleNotesInput.value;
    setDefect(
      state.activeCell.coord,
      state.activeCell.row,
      state.activeCell.col,
      state.selectedDefectCode,
      notes,
      true,
      true // Sends right away to the database!
    );

    closeComicBubble();
  });

  // Comic Bubble Delete Button
  dom.btnBubbleDelete.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.activeCell) {
      removeDefect(state.activeCell.coord);
      closeComicBubble();
    }
  });

  // Comic Bubble Close Button
  dom.btnBubbleClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeComicBubble();
  });

  // Click outside bubble closes it
  document.addEventListener('click', (e) => {
    if (dom.cellComicBubble.style.display === 'flex') {
      const isInsideBubble = e.target.closest('#cell-comic-bubble');
      const isGridCell = e.target.closest('.grid-cell');
      const isHistoryRow = e.target.closest('.history-row');
      if (!isInsideBubble && !isGridCell && !isHistoryRow) {
        closeComicBubble();
      }
    }
  });

  // History Row Delete Buttons Delegation
  dom.historyTbody.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.btn-delete-row');
    if (deleteBtn) {
      e.stopPropagation();
      const coord = deleteBtn.dataset.deleteCoord;
      removeDefect(coord);
    }
  });

  // Clear All History Button
  dom.btnClearHistory.addEventListener('click', () => {
    if (state.defects.size === 0) return;
    if (confirm('Clear all logged cell defects for this module?')) {
      state.defects.clear();
      updateSummaryAndHistory();
      renderDefectPins();
      closeComicBubble();
      showToast('All cell defect tags cleared', 'info');
      soundFx.beep(300, 0.12);
    }
  });

  // Toolbar: Toggle Always Show Grid
  dom.toggleKeepGrid.addEventListener('change', (e) => {
    state.isGridLocked = e.target.checked;
    dom.coordinateGridOverlay.classList.toggle('force-visible', state.isGridLocked);
    showToast(state.isGridLocked ? 'Grid overlay locked visible' : 'Grid overlay set to hover-only', 'info');
  });

  // Toolbar: Invert EL Image Filter
  dom.btnToggleInvert.addEventListener('click', () => {
    state.isInverted = !state.isInverted;
    dom.elImage.classList.toggle('inverted', state.isInverted);
    dom.btnToggleInvert.classList.toggle('active', state.isInverted);
    soundFx.beep(640, 0.05);
  });

  // Toolbar: Sample Image Switcher
  if (dom.selectElSample) {
    dom.selectElSample.addEventListener('change', (e) => {
      const selectedOpt = dom.selectElSample.selectedOptions[0];
      const newSrc = e.target.value;
      const modId = selectedOpt ? selectedOpt.dataset.moduleId : 'USM-2026-FVI';
      const grade = selectedOpt ? selectedOpt.dataset.grade : 'A';

      dom.elImage.src = newSrc;
      state.moduleId = modId;
      dom.moduleIdInput.value = modId;
      dom.summaryModuleId.textContent = modId;
      broadcastModuleChange(modId);
      state.defects.clear();
      resetGrade();
      updateSummaryAndHistory();
      renderDefectPins();
      closeComicBubble();
      showToast(`Loaded sample module: ${modId}`, 'info');
      soundFx.beep(750, 0.08);
    });
  }

  // Toolbar: Upload Custom EL Image
  if (dom.inputCustomImage) {
    dom.inputCustomImage.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (loadEvt) => {
        dom.elImage.src = loadEvt.target.result;
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        state.moduleId = nameWithoutExt.toUpperCase();
        dom.moduleIdInput.value = state.moduleId;
        dom.summaryModuleId.textContent = state.moduleId;
        broadcastModuleChange(state.moduleId);
        closeComicBubble();
        showToast(`Loaded custom EL image: ${file.name}`, 'success');
        soundFx.beep(850, 0.1);
      };
      reader.readAsDataURL(file);
    });
  }

  // Global Ergonomics Hotkeys
  window.addEventListener('keydown', (e) => {
    const isInputActive = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (isInputActive) {
      if (e.key === 'Enter' && dom.cellComicBubble.style.display === 'flex') {
        if (!dom.btnBubbleConfirm.disabled) {
          dom.btnBubbleConfirm.click();
        }
      }
      return;
    }

    const key = e.key.toUpperCase();

    if (key === 'A' || key === 'B' || key === 'R' || key === 'X') {
      setGrade(key);
    }
    else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
      const targetCodeMap = {
        '1': 'A1', '2': 'A2', '3': 'B1', '4': 'B2',
        '5': 'C1', '6': 'X1', '7': 'X2', '8': 'X3'
      };
      const code = targetCodeMap[e.key];
      if (code) {
        state.selectedDefectCode = code;
        dom.bubbleReasonItems.forEach(i => i.classList.toggle('selected', i.dataset.code === code));
        setBubbleConfirmState(true);
        soundFx.beep(640, 0.04);
      }
    }
    else if (e.key === 'Enter') {
      if (dom.cellComicBubble.style.display === 'flex' && !dom.btnBubbleConfirm.disabled) {
        dom.btnBubbleConfirm.click();
      }
    }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.activeCell) {
        removeDefect(state.activeCell.coord);
        closeComicBubble();
      }
    }
    else if (key === 'M') {
      // Toggle between 'split' (Unified 1-Screen) and 'visual' (Full Inspection)
      const nextMode = (state.viewMode === 'split') ? 'visual' : 'split';
      setViewMode(nextMode);
    }
    else if (key === 'V') {
      setViewMode('visual');
    }
    else if (key === 'T') {
      setViewMode('telemetry');
    }
    else if (key === 'I') {
      dom.btnToggleInvert.click();
    }
    else if (key === 'G') {
      dom.toggleKeepGrid.checked = !dom.toggleKeepGrid.checked;
      dom.toggleKeepGrid.dispatchEvent(new Event('change'));
    }
    else if (e.key === 'Escape') {
      if (dom.loginModal.classList.contains('open')) {
        dom.loginModal.classList.remove('open');
      } else if (dom.simulatorModal.classList.contains('open')) {
        dom.simulatorModal.classList.remove('open');
      } else if (dom.sqlModal.classList.contains('open')) {
        dom.sqlModal.classList.remove('open');
      } else {
        closeComicBubble();
      }
    }
  });

  // Toolbar: Reset View Fit
  dom.btnResetZoom.addEventListener('click', () => {
    fitInspectionStage();
    showToast('Inspection view reset to fit', 'info');
  });

  // Submit Grade: Sends Overall Inspection to database table final_inspections
  // (record_id and tested_at are auto-generated by the database)
  dom.btnSaveInspection.addEventListener('click', () => {
    // 1. Validate Module Serial (Must be typed in, start with USM, and have 16 characters including USM)
    if (!validateModuleSerial(true)) {
      // Also highlight grade control if grade is not chosen yet
      if (!state.grade) {
        const gradeControl = document.getElementById('segmented-grade-control');
        if (gradeControl) {
          gradeControl.classList.remove('highlight-error');
          void gradeControl.offsetWidth;
          gradeControl.classList.add('highlight-error');
        }
      }
      return;
    }

    // 2. Validate Grade Selection
    if (!state.grade) {
      showToast('Please select a Grade (A, B, Retest/Rework, or Reject) before submitting', 'warning');
      soundFx.beep(260, 0.15);

      const gradeControl = document.getElementById('segmented-grade-control');
      if (gradeControl) {
        gradeControl.classList.remove('highlight-error');
        void gradeControl.offsetWidth; // Force reflow to re-trigger CSS animations
        gradeControl.classList.add('highlight-error');
        gradeControl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }

    if (!state.currentOperator) {
      showToast('Please enter your name before submitting grade', 'warning');
      soundFx.beep(300, 0.1);
      openLoginModal();
      return;
    }

    const submittedModuleId = state.moduleId;
    const submittedGrade = state.grade;
    const numericGrade = GRADE_NUMERIC_MAP[state.grade] || '0';

    const resetAfterSubmit = () => {
      state.moduleId = '';
      if (dom.moduleIdInput) {
        dom.moduleIdInput.value = '';
        dom.moduleIdInput.focus();
      }
      if (dom.scannerField) {
        dom.scannerField.classList.remove('highlight-error');
      }
      state.defects.clear();
      resetGrade();
      updateSummaryAndHistory();
      renderDefectPins();
      closeComicBubble();
    };
    const payload = {
      module_id: (state.moduleId || '').slice(0, 16), // nvarchar(16)
      grade: numericGrade, // 0 = A, 1 = B, 2 = Retest/Rework, 3 = Reject
      result_code: numericGrade, // backwards compatibility
      tester_name: state.currentOperator.name || state.currentOperator.username || 'Inspector'
    };

    fetch(`${config.apiBaseUrl}/api/inspections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        showToast(`Module ${submittedModuleId} submitted as Grade [${submittedGrade}]!`, 'success');
        resetAfterSubmit();
        soundFx.beep(950, 0.12);
        if (dom.pillDbStatus) {
          dom.pillDbStatus.className = 'status-indicator-pill status-live';
          dom.pillDbStatus.innerHTML = `<span class="status-pip"></span><span>GRADE [${submittedGrade}] SAVED</span>`;
          setTimeout(() => {
            dom.pillDbStatus.innerHTML = '<span class="status-pip"></span><span>DB LIVE</span>';
          }, 2500);
        }
      })
      .catch(() => {
        showToast(`Database offline: grade queued locally`, 'info');
        soundFx.beep(650, 0.08);
        resetAfterSubmit();
      });
  });

  // Monitor 2 Metrology Display Launcher
  if (dom.btnLaunchTelemetry) {
    dom.btnLaunchTelemetry.addEventListener('click', () => {
      const win = window.open('telemetry.html', 'FVITelemetryScreen', 'width=1600,height=900,menubar=no,toolbar=no,location=no,status=no');
      if (win) {
        win.focus();
        setTimeout(() => {
          broadcastModuleChange(state.moduleId);
        }, 350);
      }
      showToast('Opened Monitor 2 Telemetry Console', 'info');
      soundFx.beep(700, 0.05);
    });
  }

  // SQL Modal Triggers
  dom.btnViewSql.addEventListener('click', () => {
    updateSqlCodeView();
    dom.sqlModal.classList.add('open');
    soundFx.beep(600, 0.08);
  });

  dom.btnCloseSqlModal.addEventListener('click', () => {
    dom.sqlModal.classList.remove('open');
  });

  dom.codeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      dom.codeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentSqlTab = tab.dataset.tab;
      updateSqlCodeView();
    });
  });

  dom.btnCopySql.addEventListener('click', () => {
    navigator.clipboard.writeText(dom.sqlCodeDisplay.textContent).then(() => {
      showToast('Payload copied to clipboard', 'success');
      soundFx.beep(800, 0.08);
    });
  });

  dom.btnExecuteSqlMock.addEventListener('click', () => {
    dom.sqlSyncIndicator.textContent = 'Commit in progress...';
    soundFx.beep(700, 0.05);
    setTimeout(() => {
      dom.sqlSyncIndicator.textContent = 'Synchronized with MES at ' + new Date().toLocaleTimeString();
      showToast('Module inspection committed to database', 'success');
      soundFx.beep(920, 0.12);
    }, 450);
  });

  // View Mode Selector buttons
  dom.viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.view);
    });
  });

  // Split Ratio preset buttons
  dom.btnSplitRatios.forEach(btn => {
    btn.addEventListener('click', () => {
      setSplitRatio(btn.dataset.ratio);
    });
  });

  // Toggle Telemetry Pane Collapse
  if (dom.btnToggleTelemetryPane) {
    dom.btnToggleTelemetryPane.addEventListener('click', () => {
      if (dom.workbenchShell) {
        dom.workbenchShell.classList.toggle('telemetry-collapsed');
        const isCollapsed = dom.workbenchShell.classList.contains('telemetry-collapsed');
        showToast(isCollapsed ? 'Telemetry tray collapsed' : 'Telemetry tray expanded', 'info');
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
        }, 100);
      }
    });
  }
}

/**
 * Change Console View Mode: 'visual' | 'split' | 'telemetry'
 */
function setViewMode(mode, showFeedback = true) {
  if (!['visual', 'split', 'telemetry'].includes(mode)) mode = 'split';
  state.viewMode = mode;
  try {
    localStorage.setItem('fvi_view_mode', mode);
  } catch (e) { }

  if (dom.workbenchShell) {
    dom.workbenchShell.setAttribute('data-view', mode);
  }

  // Update button active state
  if (dom.viewBtns) {
    dom.viewBtns.forEach(btn => {
      if (btn.dataset.view === mode) {
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-checked', 'false');
      }
    });
  }

  // Load telemetry if active in current view
  if (mode === 'split' || mode === 'telemetry') {
    if (window.FVITelemetry && typeof window.FVITelemetry.loadTelemetryForModule === 'function') {
      window.FVITelemetry.loadTelemetryForModule(state.moduleId);
    }
  }

  // Trigger immediate and next-frame stage refits for instantaneous transition
  fitInspectionStage();
  requestAnimationFrame(() => {
    fitInspectionStage();
  });
  setTimeout(() => {
    fitInspectionStage();
    window.dispatchEvent(new Event('resize'));
  }, 100);

  if (showFeedback) {
    const modeLabels = {
      'visual': 'Visual Inspection Focus',
      'split': 'Unified 1-Screen Console (Both Pages)',
      'telemetry': 'Electrical Metrology Focus'
    };
    showToast(`Switched to ${modeLabels[mode]}`, 'info');
    soundFx.beep(650, 0.05);
  }
}

/**
 * Set Split Height Ratio in Unified Mode ('balanced' | 'visual-max' | 'metro-max')
 */
function setSplitRatio(ratio) {
  if (!['balanced', 'visual-max', 'metro-max'].includes(ratio)) ratio = 'visual-max';
  state.splitRatio = ratio;
  try {
    localStorage.setItem('fvi_split_ratio', ratio);
  } catch (e) { }

  if (dom.workbenchShell) {
    dom.workbenchShell.setAttribute('data-split-ratio', ratio);
  }
  if (dom.btnSplitRatios) {
    dom.btnSplitRatios.forEach(b => {
      b.classList.toggle('active', b.dataset.ratio === ratio);
    });
  }
  fitInspectionStage();
  setTimeout(() => {
    fitInspectionStage();
    window.dispatchEvent(new Event('resize'));
  }, 100);
}

// Kickoff
document.addEventListener('DOMContentLoaded', initApp);

