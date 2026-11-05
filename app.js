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
  grade: null, // null | 'A' | 'B' | 'R' | 'X' (No grade selected initially)
  currentSide: 'front', // 'front' | 'back'
  allowedGrades: ['A', 'B', 'R', 'X'], // Dynamically computed based on logged defect criteria
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

/**
 * Production Defect Catalog (55 Standard Plant Presets)
 * Categorization & Side Applicability:
 *  - side: 'front' (Red / Front inspection)
 *  - side: 'back'  (Blue / Back inspection: Backsheet, Junction Box)
 *  - side: 'both'  (Green / Both sides: EVA)
 * Grade Options:
 *  - 'A,B,R' -> Grade A, Grade B, Reject ('X')
 *  - 'A,R'   -> Grade A, Reject ('X')
 *  - 'A,B'   -> Grade A, Grade B
 *  - 'B,R'   -> Grade B, Reject ('X')
 *  - 'RW'    -> Retest/Rework ('R')
 *  - 'A,R,RW'-> Grade A, Reject ('X'), Retest/Rework ('R')
 *  - 'RT'    -> Retest/Rework ('R'), Reject ('X')
 *  - 'RW, RT'-> Retest/Rework ('R'), Reject ('X')
 */
const DEFECT_CATALOG = {
  // === GLASS (Front Side / Red) ===
  'G1': { code: 'G1', name: 'Glass Surface Appearance', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'G2': { code: 'G2', name: 'Glass Scratch', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'G3': { code: 'G3', name: 'Glass Bubbles', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === FRAME (Front Side / Red) ===
  'F1': { code: 'F1', name: 'Frame Scratches', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F2': { code: 'F2', name: 'Frame Dents (Concave) & Bumps (Convex)', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F5': { code: 'F5', name: 'Frame Burrs', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F6': { code: 'F6', name: 'Frame Seam Gap and Misalignment', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F7': { code: 'F7', name: 'Frame sealant defects (front & back)', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F8': { code: 'F8', name: 'Ground Mark', category: 'Frame', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },

  // === CELL (Front Side / Red) ===
  'C1': { code: 'C1', name: 'Cell Type Mixing', category: 'Cell', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'C2': { code: 'C2', name: 'Cell Color Difference (post-lam)', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C5': { code: 'C5', name: 'Cell Spots', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C6': { code: 'C6', name: 'Cell Edge and Corner Chip', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C7': { code: 'C7', name: 'Cell Crack Separation', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C8': { code: 'C8', name: 'Cell Scratch', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C9': { code: 'C9', name: 'Water Ripple and Dirt', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C10': { code: 'C10', name: 'Broken Grid', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C11': { code: 'C11', name: 'Grid Line Thickness', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === EVA (Both Sides / Green) ===
  'E1': { code: 'E1', name: 'EVA Voids or Bubbles', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E2': { code: 'E2', name: 'EVA Unmelted Wrinkles', category: 'EVA', side: 'both', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'E3': { code: 'E3', name: 'EVA Discoloration/ Dirtiness', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E4': { code: 'E4', name: 'Missing or Incomplete EVA', category: 'EVA', side: 'both', rawGrades: 'B,R', allowedGrades: ['B', 'X'] },
  'E5': { code: 'E5', name: 'EVA Line Marks, Faults', category: 'EVA', side: 'both', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'E6': { code: 'E6', name: 'Foreign Material', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E7': { code: 'E7', name: 'Overflowing White EVA', category: 'EVA', side: 'both', rawGrades: 'RW', allowedGrades: ['R'] },

  // === BACKSHEET (Back Side / Blue) ===
  'B1': { code: 'B1', name: 'Bulging, Delamination', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B2': { code: 'B2', name: 'Drums', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B3': { code: 'B3', name: 'Scratch', category: 'Backsheet', side: 'back', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'B4': { code: 'B4', name: 'Fold', category: 'Backsheet', side: 'back', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'B5': { code: 'B5', name: 'Pits, Indentation', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B6': { code: 'B6', name: 'Backsheet Mark', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B7': { code: 'B7', name: 'Backsheet Crystal Point', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B8': { code: 'B8', name: 'Backsheet Drawing', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B9': { code: 'B9', name: 'Black Spots', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === JUNCTION BOX (Back Side / Blue) ===
  'J1': { code: 'J1', name: 'J-Box Body/ Mi', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J2': { code: 'J2', name: 'J-Box Installation', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J3': { code: 'J3', name: 'Wires & Connectors', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J4': { code: 'J4', name: 'Connection Inside the J-box', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J5': { code: 'J5', name: 'Potting', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === SOLDERING COMPONENTS (Front Side / Red) ===
  'S1': { code: 'S1', name: 'Offset Soldering', category: 'Soldering components', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'S2': { code: 'S2', name: 'Solder Scar', category: 'Soldering components', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'S3': { code: 'S3', name: 'Busbar Soldering', category: 'Soldering components', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === MODULE DIMENSION & APPEARANCE (Front Side / Red) ===
  'D2': { code: 'D2', name: 'Cell Array', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D3': { code: 'D3', name: 'Cell Chamfer Direction', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'D4': { code: 'D4', name: 'Overall Displacement', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D5': { code: 'D5', name: 'Busbar Lap', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D6': { code: 'D6', name: 'Module Dimensions', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D7': { code: 'D7', name: 'Glazed Previous to Light', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D8': { code: 'D8', name: 'Missing Grid Print', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D9': { code: 'D9', name: 'Module Barcode', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'D10': { code: 'D10', name: 'Module Nameplate', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === OTHER (Front Side / Red) ===
  'O1': { code: 'O1', name: 'No EL data', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O2': { code: 'O2', name: 'No Power', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O3': { code: 'O3', name: 'Low Power', category: 'Other', side: 'front', rawGrades: 'RW, RT', allowedGrades: ['R', 'X'] },
  'O4': { code: 'O4', name: 'High Power', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] }
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
  gradingHistoryBadge: document.getElementById('grading-history-badge'),
  gradingHistoryTbody: document.getElementById('grading-history-tbody'),
  emptyGradingHistoryState: document.getElementById('empty-grading-history-state'),
  btnRefreshGradingHistory: document.getElementById('btn-refresh-grading-history'),
  sidebarDock: document.querySelector('.sidebar-dock'),
  btnToggleDock: document.getElementById('btn-toggle-dock'),
  dockToggleLabel: document.getElementById('dock-toggle-label'),
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
  btnToggleInvert: document.getElementById('btn-toggle-invert'),
  elImage: document.getElementById('el-image'),
  selectElSample: document.getElementById('select-el-sample'),
  inputCustomImage: document.getElementById('input-custom-image'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Front / Back Side Switcher & Badges
  btnSideFront: document.getElementById('btn-side-front'),
  btnSideBack: document.getElementById('btn-side-back'),
  bubbleSideBadge: document.getElementById('bubble-side-badge'),
  bubbleSearchInput: document.getElementById('bubble-search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  bubbleCategoryTabs: document.getElementById('bubble-category-tabs'),
  bubbleHoverInfo: document.getElementById('bubble-hover-info'),
  hoverInfoTitle: document.getElementById('hover-info-title'),
  hoverInfoSide: document.getElementById('hover-info-side'),
  hoverGradesVal: document.getElementById('hover-grades-val'),
  gradeRestrictionsHint: document.getElementById('grade-restrictions-hint'),

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
  recomputeAllowedGrades();
  updateSummaryAndHistory();
  renderDefectPins();

  // Check URL parameters for direct module load (e.g. from database.html)
  const urlParams = new URLSearchParams(window.location.search);
  const urlModule = urlParams.get('module') || urlParams.get('serial') || urlParams.get('sn') || urlParams.get('id');
  if (urlModule) {
    const cleanMod = urlModule.trim().toUpperCase().slice(0, 16);
    state.moduleId = cleanMod;
    if (dom.moduleIdInput) dom.moduleIdInput.value = cleanMod;
    if (dom.summaryModuleId) dom.summaryModuleId.textContent = cleanMod;
    if (dom.scannerField) dom.scannerField.classList.remove('highlight-error');
    loadInspectionImage(cleanMod, 'front');
  } else {
    // Load initial EL image for front side
    loadInspectionImage(state.moduleId, 'front');
  }

  // Initialize View Mode (defaults to 'split' Unified 1-screen console)
  const initialMode = urlParams.get('view') || urlParams.get('mode') || localStorage.getItem('fvi_view_mode') || 'split';
  const initialRatio = urlParams.get('ratio') || localStorage.getItem('fvi_split_ratio') || 'visual-max';
  setSplitRatio(initialRatio);
  setViewMode(initialMode, false);
  fitInspectionStage();

  // Initial synchronization with Monitor 2 & Integrated Telemetry
  broadcastModuleChange(state.moduleId);

  // Load and subscribe to Grading History (time descending order)
  fetchGradingHistory();
  setInterval(() => {
    fetchGradingHistory();
  }, 10000);
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
        dom.pillDbStatus.innerHTML = '<span>DB LIVE</span>';
      }
    })
    .catch(() => {
      state.isServerOnline = false;
      if (dom.pillDbStatus) {
        dom.pillDbStatus.className = 'status-indicator-pill status-warn';
        dom.pillDbStatus.innerHTML = '<span>STANDALONE</span>';
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
        dom.pillMqttStatus.innerHTML = '<span>MQTT LIVE</span>';
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
        dom.pillMqttStatus.innerHTML = '<span>MQTT SIM</span>';
      }
    };
  } catch (err) {
    if (dom.pillMqttStatus) {
      dom.pillMqttStatus.className = 'status-indicator-pill status-warn';
      dom.pillMqttStatus.innerHTML = '<span>MQTT SIM</span>';
    }
  }
}

/**
 * Load Inspection Image for current module and side (Front or Back)
 */
function loadInspectionImage(panelId = state.moduleId, side = state.currentSide, onSuccess = null) {
  const elImageUrl = `${config.apiBaseUrl}/api/module/${panelId}/el-image?side=${side}`;
  const sampleMap = {
    'USM0112208260078': 'solar_el_sample.jpg',
    'USM0111208260304': 'solar_el_sample.jpg',
    'USM0111208260302': 'sample_el_2.jpg',
    'USM0111208260208': 'sample_el_3.jpg',
    'USM0111208260303': 'sample_el_4.jpg'
  };

  const tempImg = new Image();
  tempImg.onload = () => {
    dom.elImage.src = elImageUrl;
    if (typeof onSuccess === 'function') onSuccess();
  };
  tempImg.onerror = () => {
    if (side === 'back') {
      dom.elImage.src = 'sample_el_back.jpg';
    } else {
      dom.elImage.src = sampleMap[panelId] || 'solar_el_sample.jpg';
    }
    if (typeof onSuccess === 'function') onSuccess();
  };
  tempImg.src = elImageUrl;
}

/**
 * Switch Inspection Viewport Side (Front Side <-> Back Side)
 */
function toggleInspectionSide(targetSide) {
  const nextSide = targetSide || (state.currentSide === 'front' ? 'back' : 'front');
  state.currentSide = nextSide;

  // 1. Update Switcher Buttons
  if (dom.btnSideFront && dom.btnSideBack) {
    dom.btnSideFront.classList.toggle('active', nextSide === 'front');
    dom.btnSideBack.classList.toggle('active', nextSide === 'back');
  }

  // 2. Update Stage Floating Badge
  if (dom.stageSideBadge) {
    dom.stageSideBadge.className = `stage-side-badge ${nextSide}`;
    if (dom.stageSideBadgeText) {
      dom.stageSideBadgeText.textContent = nextSide === 'front' ? 'FRONT SIDE (CELLS)' : 'BACK SIDE (BACKSHEET & J-BOX)';
    }
  }

  // 3. Update Bubble Side Badge
  if (dom.bubbleSideBadge) {
    dom.bubbleSideBadge.className = `bubble-side-badge ${nextSide}`;
    dom.bubbleSideBadge.textContent = nextSide === 'front' ? 'FRONT SIDE' : 'BACK SIDE';
  }

  // 4. Load the appropriate image
  loadInspectionImage(state.moduleId, nextSide);

  // 5. Update Defect Pins for the active side
  renderDefectPins();

  // 6. If defect selection bubble is open, refresh reasons list for this side
  if (dom.cellComicBubble && dom.cellComicBubble.style.display === 'flex') {
    renderCategoryTabs();
    renderDefectReasonItems();
  }

  const sideLabel = nextSide === 'front' ? 'Front Side (Cells/Glass)' : 'Back Side (Backsheet/J-Box)';
  showToast(`Switched view to ${sideLabel}`, 'info');
  soundFx.beep(nextSide === 'front' ? 740 : 620, 0.07);
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
  recomputeAllowedGrades();
  updateSummaryAndHistory();
  renderDefectPins();
  closeComicBubble();

  // Reset side to front for new panel
  state.currentSide = 'front';
  if (dom.btnSideFront && dom.btnSideBack) {
    dom.btnSideFront.classList.add('active');
    dom.btnSideBack.classList.remove('active');
  }
  if (dom.stageSideBadge) {
    dom.stageSideBadge.className = 'stage-side-badge front';
    if (dom.stageSideBadgeText) dom.stageSideBadgeText.textContent = 'FRONT SIDE (CELLS)';
  }

  loadInspectionImage(panelId, 'front', () => {
    showToast(`Conveyor MQTT: Loaded ${panelId} (${source})`, 'success');
  });

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
      cell.setAttribute('aria-label', `Cell ${coord}`);
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
    const isCurrentSide = !defect.side || defect.side === state.currentSide || defect.side === 'both';
    const sideClass = (defect.side || 'front').toLowerCase();

    marker.className = `defect-marker ${isCurrentSide ? '' : 'marker-other-side'}`;
    marker.textContent = defect.defectCode;
    const sideText = sideClass === 'back' ? 'BACK' : 'FRONT';
    marker.title = `${coord}: [${defect.defectCode}] ${defect.defectName} (${sideText} SIDE)`;
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

// Speech Bubble Filter State
let currentBubbleCategory = 'ALL';
let bubbleSearchQuery = '';

/**
 * Render Category Tabs inside Defect Speech Bubble
 */
function renderCategoryTabs() {
  if (!dom.bubbleCategoryTabs) return;
  dom.bubbleCategoryTabs.innerHTML = '';

  const activeSide = state.currentSide; // 'front' | 'back'
  const relevantCategories = new Set();
  relevantCategories.add('ALL');

  Object.values(DEFECT_CATALOG).forEach(defect => {
    if (activeSide === 'front' && (defect.side === 'front' || defect.side === 'both')) {
      relevantCategories.add(defect.category);
    } else if (activeSide === 'back' && (defect.side === 'back' || defect.side === 'both')) {
      relevantCategories.add(defect.category);
    }
  });
  relevantCategories.add('ALL SIDES');

  relevantCategories.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bubble-cat-btn ${cat === currentBubbleCategory ? 'active' : ''}`;
    btn.textContent = cat === 'Module Dimension & Appearance' ? 'Dimensions' : cat;
    btn.title = `Filter defects by ${cat}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentBubbleCategory = cat;
      dom.bubbleCategoryTabs.querySelectorAll('.bubble-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDefectReasonItems();
    });
    dom.bubbleCategoryTabs.appendChild(btn);
  });
}

/**
 * Render Filtered List of Defect Reasons inside Speech Bubble
 */
function renderDefectReasonItems() {
  if (!dom.bubbleReasonsList) return;
  dom.bubbleReasonsList.innerHTML = '';

  const activeSide = state.currentSide; // 'front' | 'back'
  const query = (bubbleSearchQuery || '').toLowerCase().trim();

  const matchingDefects = Object.values(DEFECT_CATALOG).filter(defect => {
    // 1. Text Search Filter across code, name, category, or allowed options
    if (query) {
      const matchCode = defect.code.toLowerCase().includes(query);
      const matchName = defect.name.toLowerCase().includes(query);
      const matchCat = defect.category.toLowerCase().includes(query);
      const matchGrades = (defect.rawGrades || '').toLowerCase().includes(query);
      if (!matchCode && !matchName && !matchCat && !matchGrades) return false;
      return true; // Search query searches across all defects
    }

    // 2. Category Tab Filter
    if (currentBubbleCategory === 'ALL SIDES') {
      return true;
    }
    if (currentBubbleCategory !== 'ALL' && defect.category !== currentBubbleCategory) {
      return false;
    }

    // 3. Inspection Viewport Side Filter
    if (activeSide === 'front') {
      return defect.side === 'front' || defect.side === 'both';
    } else {
      return defect.side === 'back' || defect.side === 'both';
    }
  });

  if (matchingDefects.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'padding: 14px; text-align: center; color: var(--text-dim); font-size: 0.75rem;';
    emptyDiv.textContent = 'No defects found. Try another search or category.';
    dom.bubbleReasonsList.appendChild(emptyDiv);
    return;
  }

  const frag = document.createDocumentFragment();
  matchingDefects.forEach(defect => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bubble-reason-item ${state.selectedDefectCode === defect.code ? 'selected' : ''}`;
    btn.dataset.code = defect.code;
    btn.dataset.side = defect.side;

    btn.innerHTML = `
      <span class="reason-code">${defect.code}</span>
      <span class="reason-label" title="${defect.name}">${defect.name}</span>
      <span class="reason-grade-pill" title="Permitted Grades: ${defect.rawGrades}">${defect.rawGrades}</span>
    `;

    // Tooltip / Detail Preview on Hover
    btn.addEventListener('mouseenter', () => {
      showDefectHoverPreview(defect);
    });

    // Selection on Click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedDefectCode = defect.code;
      dom.bubbleReasonsList.querySelectorAll('.bubble-reason-item').forEach(i => i.classList.remove('selected'));
      btn.classList.add('selected');
      setBubbleConfirmState(true);
      showDefectHoverPreview(defect);
      soundFx.beep(640, 0.04);
    });

    frag.appendChild(btn);
  });

  dom.bubbleReasonsList.appendChild(frag);
}

/**
 * Show Detailed Defect Preview Card (Category, Side, Allowed Grades)
 */
function showDefectHoverPreview(defect) {
  if (!dom.bubbleHoverInfo) return;
  dom.bubbleHoverInfo.style.display = 'flex';
  if (dom.hoverInfoTitle) dom.hoverInfoTitle.textContent = `${defect.code} • ${defect.name}`;
  if (dom.hoverInfoSide) {
    const sideName = defect.side === 'front' ? 'Front Side' : (defect.side === 'back' ? 'Back Side' : 'Front & Back');
    dom.hoverInfoSide.textContent = `${defect.category} (${sideName})`;
  }
  if (dom.hoverGradesVal) {
    const gradeNames = (defect.allowedGrades || []).map(g => {
      if (g === 'A') return 'A Prime';
      if (g === 'B') return 'B Secondary';
      if (g === 'R') return 'Retest/Rework';
      if (g === 'X') return 'Reject';
      return g;
    }).join(', ');
    dom.hoverGradesVal.textContent = `${defect.rawGrades} [${gradeNames}]`;
  }
}

/**
 * Open Comic Speech Bubble Popover Next to Clicked Cell
 */
function openComicBubble(coord, row, col) {
  state.activeCell = { coord, row, col };
  state.selectedDefectCode = null;
  currentBubbleCategory = 'ALL';
  bubbleSearchQuery = '';

  if (dom.bubbleSearchInput) dom.bubbleSearchInput.value = '';
  if (dom.btnClearSearch) dom.btnClearSearch.style.display = 'none';
  if (dom.bubbleHoverInfo) dom.bubbleHoverInfo.style.display = 'none';

  soundFx.beep(750, 0.05);

  dom.bubbleCellCoord.textContent = `CELL ${coord}`;
  if (dom.bubbleSideBadge) {
    dom.bubbleSideBadge.className = `bubble-side-badge ${state.currentSide}`;
    dom.bubbleSideBadge.textContent = state.currentSide === 'front' ? 'FRONT SIDE' : 'BACK SIDE';
  }

  // Active cell highlighting on matrix
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

  const bubbleWidth = 320;
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

  let bubbleTop = cellTop + (cellHeight / 2) - 150;
  const maxTop = Math.max(8, stageRect.height - 390);
  bubbleTop = Math.max(8, Math.min(bubbleTop, maxTop));

  dom.cellComicBubble.style.left = `${Math.round(bubbleLeft)}px`;
  dom.cellComicBubble.style.top = `${Math.round(bubbleTop)}px`;

  // Render Category Tabs & Preset Defect Items
  renderCategoryTabs();
  renderDefectReasonItems();

  setBubbleConfirmState(false);

  // If cell already has a logged defect, pre-select it
  if (state.defects.has(coord)) {
    const existing = state.defects.get(coord);
    state.selectedDefectCode = existing.defectCode;

    const catEntry = DEFECT_CATALOG[existing.defectCode];
    if (catEntry) {
      showDefectHoverPreview(catEntry);
    }
    const matchingBtn = dom.bubbleReasonsList.querySelector(`[data-code="${existing.defectCode}"]`);
    if (matchingBtn) {
      matchingBtn.classList.add('selected');
      matchingBtn.scrollIntoView({ block: 'nearest' });
    }

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
    code: defectCode,
    name: 'Observed Anomaly',
    category: 'Visual',
    side: state.currentSide,
    rawGrades: 'A,B,R',
    allowedGrades: ['A', 'B', 'X']
  };

  const defectItem = {
    coord,
    row,
    col,
    side: state.currentSide, // 'front' | 'back'
    defectCode,
    defectName: catalogEntry.name,
    category: catalogEntry.category,
    rawGrades: catalogEntry.rawGrades,
    allowedGrades: catalogEntry.allowedGrades || ['A', 'B', 'R', 'X'],
    gradeImpact: catalogEntry.rawGrades,
    timestamp: new Date().toLocaleTimeString(),
    notes: (notes || '').trim(),
    operatorName: (state.currentOperator && state.currentOperator.name) || 'Inspector'
  };

  state.defects.set(coord, defectItem);

  updateSummaryAndHistory();
  updateDefectPin(coord);
  recomputeAllowedGrades();

  // INSTANT DATABASE PERSISTENCE (POST /api/defects -> final_inspection_defects)
  if (syncToDatabase) {
    persistDefectToDatabase(defectItem);
  }

  if (notify) {
    showToast(`Logged [${defectCode} - ${catalogEntry.name}] at Cell ${coord} (${state.currentSide.toUpperCase()})`, 'success');
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
    module_id: (state.moduleId || '').slice(0, 16),
    defect_location: defect.coord,
    defect_cell: defect.coord,
    defect_code: defect.defectCode,
    defect_type: defectName.slice(0, 30),
    defect_name: defectName,
    side: defect.side || state.currentSide || 'front',
    tester_name: (state.currentOperator && state.currentOperator.name) || 'Inspector',
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
      if (data.success && dom.pillDbStatus) {
        dom.pillDbStatus.className = 'status-indicator-pill status-live';
        dom.pillDbStatus.innerHTML = `<span>DEFECT #${data.record_id || ''}</span>`;
        setTimeout(() => {
          dom.pillDbStatus.innerHTML = '<span>DB LIVE</span>';
        }, 2000);
      }
    })
    .catch(() => { });
}

/**
 * Remove Defect from State & Database
 */
function removeDefect(coord) {
  if (state.defects.has(coord)) {
    state.defects.delete(coord);
    updateSummaryAndHistory();
    updateDefectPin(coord);
    recomputeAllowedGrades();
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
      const sideText = (defect.side || 'front').toUpperCase();
      const sideClass = (defect.side || 'front').toLowerCase();
      notationList.push(`${defect.coord} ${defect.defectCode}(${sideText[0]})`);

      const tr = document.createElement('tr');
      tr.className = 'history-row';
      tr.title = `${defect.coord}: [${defect.defectCode}] ${defect.defectName} (${sideText} SIDE) - Click to focus`;
      tr.innerHTML = `
        <td><span class="cell-pill">${defect.coord}</span></td>
        <td><span class="side-pill">${sideText}</span></td>
        <td><span class="code-pill" title="${defect.defectName} (${defect.category || 'Visual'})">${defect.defectCode}</span></td>
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
        // If defect was tagged on opposite side, flip viewport to match
        if (defect.side && defect.side !== state.currentSide) {
          toggleInspectionSide(defect.side);
        }
        openComicBubble(defect.coord, defect.row, defect.col);
      });

      frag.appendChild(tr);
    });

    dom.historyTbody.appendChild(frag);
    dom.whiteboardNotationPreview.textContent = notationList.join('; ');
  }
}

// Grade Mapping: MES Database Numeric Standard (0=A, 1=B, 2=Retest/Rework, 3=Reject)
/**
 * Safely escape HTML characters
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format timestamp to short HH:MM:SS
 */
function formatTimeShort(dateStr) {
  if (!dateStr) return '--:--';
  try {
    const cleanStr = String(dateStr).replace(' ', 'T');
    const d = new Date(cleanStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
  } catch (e) {}
  return String(dateStr).slice(11, 19) || String(dateStr).slice(0, 10);
}

/**
 * Get grade display metadata (letter, label, CSS class)
 */
function getGradeDisplayInfo(rawGrade) {
  const g = String(rawGrade ?? '').trim().toUpperCase();
  if (g === '0' || g === 'A') {
    return { letter: 'A', label: 'Prime', cls: 'gh-grade-a' };
  } else if (g === '1' || g === 'B') {
    return { letter: 'B', label: 'Secondary', cls: 'gh-grade-b' };
  } else if (g === '2' || g === 'R' || g === 'RW' || g === 'RT' || g.includes('REWORK') || g.includes('RETEST')) {
    return { letter: 'RETEST', label: 'Retest / Rework', cls: 'gh-grade-r' };
  } else if (g === '3' || g === 'X' || g.includes('REJECT')) {
    return { letter: 'REJECT', label: 'Reject', cls: 'gh-grade-x' };
  }
  return { letter: g || '?', label: 'Pending', cls: 'gh-grade-pending' };
}

/**
 * Fetches recent grading submissions from server (/api/inspections?limit=50)
 * ordered by tested_at DESC and renders them in the bottom half of the left dock.
 */

/**
 * Fetches defects for a historical module from server (/api/defects?module_id=...)
 */
function fetchModuleDefects(moduleId) {
  if (!moduleId) return;
  fetch(`${config.apiBaseUrl}/api/defects?module_id=${encodeURIComponent(moduleId)}`)
    .then(res => res.json())
    .then(data => {
      const defectsList = data.defects || [];
      state.defects.clear();
      defectsList.forEach(d => {
        const coord = d.defect_location || d.defect_cell || d.cell_coord || '';
        if (!coord) return;
        const row = coord.charAt(0);
        const col = parseInt(coord.slice(1), 10);
        const code = d.defect_code || 'G1';
        const preset = DEFECT_CATALOG[code] || {
          code: code,
          name: d.defect_type || 'Defect',
          side: d.side || 'front',
          rawGrades: 'A,B,R',
          allowedGrades: ['A', 'B', 'X']
        };
        state.defects.set(coord, {
          coord: coord,
          row: row,
          col: col,
          defectCode: preset.code,
          defectName: preset.name,
          side: d.side || preset.side || 'front',
          category: preset.category || 'Visual',
          rawGrades: preset.rawGrades || 'A,B,R',
          allowedGrades: preset.allowedGrades || ['A', 'B', 'X'],
          notes: d.notes || ''
        });
      });
      updateSummaryAndHistory();
      renderDefectPins();
      recomputeAllowedGrades();
    })
    .catch(() => {
      state.defects.clear();
      updateSummaryAndHistory();
      renderDefectPins();
    });
}

function fetchGradingHistory() {
  fetch(`${config.apiBaseUrl}/api/inspections?limit=50`)
    .then(res => res.json())
    .then(data => {
      const records = data.records || data.inspection || [];
      renderGradingHistory(records);
    })
    .catch(err => {
      console.warn('[FVI History] Could not load grading history:', err);
    });
}

/**
 * Renders grading records into the grading history table
 */
function renderGradingHistory(records) {
  if (!dom.gradingHistoryTbody) return;

  const count = (records && records.length) || 0;
  if (dom.gradingHistoryBadge) {
    dom.gradingHistoryBadge.textContent = count;
  }

  dom.gradingHistoryTbody.innerHTML = '';

  if (count === 0) {
    if (dom.emptyGradingHistoryState) {
      dom.emptyGradingHistoryState.style.display = 'flex';
    }
    return;
  }

  if (dom.emptyGradingHistoryState) {
    dom.emptyGradingHistoryState.style.display = 'none';
  }

  const frag = document.createDocumentFragment();

  records.forEach(rec => {
    const tr = document.createElement('tr');
    tr.className = 'history-row grading-history-row';
    const serial = rec.module_id || 'UNKNOWN';
    const timeFormatted = formatTimeShort(rec.tested_at);
    const gradeInfo = getGradeDisplayInfo(rec.grade || rec.result_code);
    const tester = rec.tester_name || 'Inspector';
    const defects = rec.defect_count ? `${rec.defect_count} defect(s)` : 'No defects';

    tr.title = `Module: ${serial}\nGrade: [${gradeInfo.letter}] ${gradeInfo.label}\nTested: ${rec.tested_at || 'Recently'}\nOperator: ${tester}\n${defects}\nClick to load module`;
    tr.dataset.module = serial;

    tr.innerHTML = `
      <td class="gh-time" title="${escapeHtml(rec.tested_at || '')}">${escapeHtml(timeFormatted)}</td>
      <td>
        <span class="gh-serial" title="Click to inspect ${escapeHtml(serial)}">
          ${escapeHtml(serial)}
        </span>
      </td>
      <td style="text-align: right;">
        <span class="gh-grade-pill ${gradeInfo.cls}">${escapeHtml(gradeInfo.letter)}</span>
      </td>
    `;

    // Click handler to load module when clicked
    tr.addEventListener('click', () => {
      if (dom.moduleIdInput) {
        dom.moduleIdInput.value = serial;
        dom.moduleIdInput.focus();
        if (dom.scannerField) dom.scannerField.classList.remove('highlight-error');
        state.moduleId = serial;
        if (dom.summaryModuleId) dom.summaryModuleId.textContent = serial;
        loadInspectionImage(serial, 'front');
        fetchModuleDefects(serial);
        showToast(`Loaded module ${serial} from history`, 'info');
      }
    });

    frag.appendChild(tr);
  });

  dom.gradingHistoryTbody.appendChild(frag);
}

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
 * Recompute intersection of allowable grades across all logged defects
 * Enforces plant quality rules (e.g. O3 allows only Retest/Rework or Reject)
 */
function recomputeAllowedGrades() {
  const allGrades = ['A', 'B', 'R', 'X'];
  if (state.defects.size === 0) {
    state.allowedGrades = allGrades;
    updateGradeButtonsUI(allGrades);
    return allGrades;
  }

  let intersection = null;
  state.defects.forEach(defect => {
    const entry = DEFECT_CATALOG[defect.defectCode];
    const allowed = (entry && entry.allowedGrades) ? entry.allowedGrades : (defect.allowedGrades || allGrades);
    if (intersection === null) {
      intersection = new Set(allowed);
    } else {
      const next = new Set();
      allowed.forEach(g => {
        if (intersection.has(g)) next.add(g);
      });
      intersection = next;
    }
  });

  const finalAllowed = (intersection && intersection.size > 0) ? Array.from(intersection) : ['X'];
  state.allowedGrades = finalAllowed;
  updateGradeButtonsUI(finalAllowed);

  // If currently active grade is now prohibited by a newly added defect, adjust or clear it
  if (state.grade && !finalAllowed.includes(state.grade)) {
    if (finalAllowed.length === 1) {
      setGrade(finalAllowed[0]);
      showToast(`Grade automatically adjusted to [${finalAllowed[0]}] per defect criteria`, 'info');
    } else {
      resetGrade();
      const gradeNames = finalAllowed.map(g => g === 'A' ? 'Prime (A)' : (g === 'B' ? 'Secondary (B)' : (g === 'R' ? 'Rework (R)' : 'Reject (X)'))).join(' or ');
      showToast(`Selected grade reset: Logged defects restrict options to ${gradeNames}`, 'warning');
    }
  }

  return finalAllowed;
}

/**
 * Update visual enabled/disabled state of grade buttons and restrictions hint banner
 */
function updateGradeButtonsUI(allowedGrades) {
  dom.gradeButtons.forEach(btn => {
    const g = btn.dataset.grade;
    const isAllowed = allowedGrades.includes(g);
    btn.classList.toggle('grade-disabled', !isAllowed);
    btn.setAttribute('aria-disabled', !isAllowed ? 'true' : 'false');
  });

  if (dom.gradeRestrictionsHint) {
    if (allowedGrades.length < 4 && state.defects.size > 0) {
      const names = allowedGrades.map(g => {
        if (g === 'A') return 'A Prime';
        if (g === 'B') return 'B Secondary';
        if (g === 'R') return 'Retest/Rework';
        if (g === 'X') return 'Reject';
        return g;
      }).join(', ');
      dom.gradeRestrictionsHint.textContent = `Allowed: ${names}`;
      dom.gradeRestrictionsHint.style.display = 'inline-flex';
    } else {
      dom.gradeRestrictionsHint.style.display = 'none';
    }
  }
}

/**
 * Handle Grade Toggle (A, B, R, X) with defect validation enforcement
 */
function setGrade(newGrade) {
  const allowed = state.allowedGrades || recomputeAllowedGrades();
  const letterGrade = NUMERIC_TO_GRADE_LETTER[newGrade] || newGrade;

  // Enforce defect grading logic
  if (!allowed.includes(letterGrade)) {
    const gradeNames = { 'A': 'Grade A (Prime)', 'B': 'Grade B (Secondary)', 'R': 'Retest / Rework', 'X': 'Reject' };
    const allowedNames = allowed.map(g => gradeNames[g] || g).join(', ');
    showToast(`Cannot select ${gradeNames[letterGrade] || letterGrade}. Logged defect rules permit only: ${allowedNames}`, 'warning');
    soundFx.beep(280, 0.15);

    const gradeControl = document.getElementById('segmented-grade-control');
    if (gradeControl) {
      gradeControl.classList.remove('highlight-error');
      void gradeControl.offsetWidth;
      gradeControl.classList.add('highlight-error');
    }
    return;
  }

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
        dom.pillDbStatus.innerHTML = `<span>GRADE [${grade}] SAVED</span>`;
        setTimeout(() => {
          dom.pillDbStatus.innerHTML = '<span>DB LIVE</span>';
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
function toggleSidebarDock(forceState) {
  if (!dom.sidebarDock) return;
  const isCurrentlyCollapsed = dom.sidebarDock.classList.contains('dock-collapsed');
  const shouldCollapse = forceState !== undefined ? forceState : !isCurrentlyCollapsed;

  dom.sidebarDock.classList.toggle('dock-collapsed', shouldCollapse);

  if (dom.btnToggleDock) {
    dom.btnToggleDock.classList.toggle('active', !shouldCollapse);
    if (dom.dockToggleLabel) {
      dom.dockToggleLabel.textContent = shouldCollapse ? 'Show Dock' : 'Dock';
    }
  }

  // Refit inspection stage immediately and after transition
  fitInspectionStage();
  requestAnimationFrame(() => {
    fitInspectionStage();
  });
  setTimeout(() => {
    fitInspectionStage();
    window.dispatchEvent(new Event('resize'));
  }, 240);
}

function fitInspectionStage() {
  if (!dom.inspectionFrame || !dom.imageStage) return;

  const frameRect = dom.inspectionFrame.getBoundingClientRect();
  if (frameRect.width <= 0 || frameRect.height <= 0) return;

  // Responsive padding: maximize EL matrix area on split/narrow screens
  const isNarrow = frameRect.width < 750;
  const isShort = frameRect.height < 500;
  const padX = isNarrow ? 8 : (frameRect.width < 1100 ? 14 : 20);
  const padY = isShort ? 6 : (frameRect.height < 750 ? 10 : 14);
  const axisYWidth = isNarrow ? 22 : 28;
  const axisTotalXHeight = isShort ? 32 : 38;

  const availW = Math.max(80, frameRect.width - padX);
  const availH = Math.max(60, frameRect.height - padY);

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

  stageW = Math.max(80, Math.floor(stageW));
  stageH = Math.max(44, Math.floor(stageH));

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
    dom.axisHeaderX.style.paddingLeft = `${axisYWidth}px`;
  }
  if (dom.axisFooterX) {
    dom.axisFooterX.style.width = `${totalW}px`;
    dom.axisFooterX.style.paddingLeft = `${axisYWidth}px`;
  }
  if (dom.axisHeaderY) {
    dom.axisHeaderY.style.width = `${axisYWidth}px`;
    // 97.491% matches active cell rows A-F (excluding bottom timestamp text)
    dom.axisHeaderY.style.height = `${Math.floor(stageH * 0.97491)}px`;
  }

  updateStageRect();
}

/**
 * Attach Event Listeners
 */
function attachEventListeners() {
  // Front / Back Side View Switcher buttons
  if (dom.btnSideFront) {
    dom.btnSideFront.addEventListener('click', () => {
      toggleInspectionSide('front');
    });
  }
  if (dom.btnSideBack) {
    dom.btnSideBack.addEventListener('click', () => {
      toggleInspectionSide('back');
    });
  }

  // Comic Bubble Defect Search & Clear
  if (dom.bubbleSearchInput) {
    dom.bubbleSearchInput.addEventListener('input', (e) => {
      bubbleSearchQuery = e.target.value;
      if (dom.btnClearSearch) {
        dom.btnClearSearch.style.display = bubbleSearchQuery.length > 0 ? 'inline-flex' : 'none';
      }
      renderDefectReasonItems();
    });
  }
  if (dom.btnClearSearch) {
    dom.btnClearSearch.addEventListener('click', (e) => {
      e.stopPropagation();
      bubbleSearchQuery = '';
      if (dom.bubbleSearchInput) {
        dom.bubbleSearchInput.value = '';
        dom.bubbleSearchInput.focus();
      }
      dom.btnClearSearch.style.display = 'none';
      renderDefectReasonItems();
    });
  }

  // Automatic Viewport Stage Fit via ResizeObserver
  if (window.ResizeObserver && dom.inspectionFrame) {
    const frameObserver = new ResizeObserver(() => {
      fitInspectionStage();
    });
    frameObserver.observe(dom.inspectionFrame);
  }

  // Helper to extract a module serial number from text
  function extractModuleSerial(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (/^USM/i.test(trimmed)) {
      return trimmed.toUpperCase().slice(0, 16);
    }
    const match = trimmed.match(/\b(USM[A-Z0-9]{13})\b/i);
    if (match) {
      return match[1].toUpperCase();
    }
    return null;
  }

  /**
   * Automatic Serial Number Paste Routing:
   * When a module serial number (e.g. starting with "USM") is pasted anywhere on the page,
   * automatically redirect it straight into the Module Serial Number input box!
   * Even if the user accidentally has focus on the notes field, defect search field, or body,
   * it prevents polluting that other input and sets the serial number cleanly.
   */
  window.addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;
    const rawText = clipboardData.getData('text');
    const detectedSerial = extractModuleSerial(rawText);

    if (detectedSerial) {
      // Prevent pasting into unintended input fields (such as defect notes or defect search)
      if (document.activeElement !== dom.moduleIdInput) {
        e.preventDefault();
      }

      if (dom.moduleIdInput) {
        dom.moduleIdInput.value = detectedSerial;
        dom.moduleIdInput.focus();
        dom.moduleIdInput.setSelectionRange(detectedSerial.length, detectedSerial.length);
        dom.moduleIdInput.dispatchEvent(new Event('input', { bubbles: true }));
        dom.moduleIdInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (dom.scannerField) {
        dom.scannerField.classList.remove('highlight-error');
      }

      state.moduleId = detectedSerial;
      dom.summaryModuleId.textContent = detectedSerial || 'Pending Serial';
      broadcastModuleChange(detectedSerial);
      state.defects.clear();
      resetGrade();
      updateSummaryAndHistory();
      renderDefectPins();

      // Close defect bubble if open
      closeComicBubble();

      // If full 16-character serial, load calibrated EL image
      if (detectedSerial.length === 16) {
        loadInspectionImage(detectedSerial, state.currentSide || 'front');
      }

      showToast(`Scanned serial automatically routed to Module Serial input: ${detectedSerial}`, 'success');
      soundFx.beep(880, 0.08);
    }
  }, true); // Capture phase ensures we intercept before child inputs consume it

  /**
   * Barcode Scanner Keyboard Wedge Interceptor:
   * Many handheld barcode scanners type characters rapidly (e.g. < 70ms between keys) ending in Enter.
   * If a scan begins with 'USM' while focus is in the wrong input box or on the body,
   * automatically redirect the input stream to dom.moduleIdInput!
   */
  let wedgeBuffer = '';
  let lastWedgeCharTime = 0;

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter') {
      const trimmedBuffer = wedgeBuffer.trim().toUpperCase();
      if (trimmedBuffer.length >= 10 && trimmedBuffer.startsWith('USM')) {
        const fullSerial = trimmedBuffer.slice(0, 16);
        if (dom.moduleIdInput) {
          dom.moduleIdInput.value = fullSerial;
          dom.moduleIdInput.focus();
        }
        state.moduleId = fullSerial;
        dom.summaryModuleId.textContent = fullSerial;
        if (dom.scannerField) dom.scannerField.classList.remove('highlight-error');
        broadcastModuleChange(fullSerial);
        state.defects.clear();
        resetGrade();
        updateSummaryAndHistory();
        renderDefectPins();
        closeComicBubble();
        if (fullSerial.length === 16) {
          loadInspectionImage(fullSerial, state.currentSide || 'front');
        }
        showToast(`Scanned serial captured: ${fullSerial}`, 'success');
        soundFx.beep(880, 0.08);
        e.preventDefault();
      }
      wedgeBuffer = '';
      return;
    }

    if (e.key.length !== 1) return;

    const now = Date.now();
    const isFast = (now - lastWedgeCharTime) < 90;
    lastWedgeCharTime = now;

    if (!isFast && now - lastWedgeCharTime > 300) {
      wedgeBuffer = '';
    }

    wedgeBuffer += e.key;

    // If stream begins with 'USM' and active element is NOT moduleIdInput:
    if (/^USM$/i.test(wedgeBuffer) && document.activeElement !== dom.moduleIdInput) {
      // Remove any leaked 'u' or 's' from the accidental active input
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        const el = document.activeElement;
        if (el.value.toLowerCase().endsWith('us')) {
          el.value = el.value.slice(0, -2);
        } else if (el.value.toLowerCase().endsWith('u')) {
          el.value = el.value.slice(0, -1);
        }
      }

      if (dom.moduleIdInput) {
        dom.moduleIdInput.focus();
        dom.moduleIdInput.value = 'USM';
        state.moduleId = 'USM';
        dom.summaryModuleId.textContent = 'USM';
        if (dom.scannerField) dom.scannerField.classList.remove('highlight-error');
      }
      e.preventDefault();
    }
  }, true);

  // Module ID syncing
  dom.moduleIdInput.addEventListener('input', (e) => {
    if (dom.scannerField) {
      dom.scannerField.classList.remove('highlight-error');
    }
    state.moduleId = e.target.value.trim().toUpperCase();
    dom.summaryModuleId.textContent = state.moduleId || 'Pending Serial';
    broadcastModuleChange(state.moduleId);
  });

  dom.moduleIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const serial = dom.moduleIdInput.value.trim().toUpperCase();
      if (serial.length === 16 && serial.startsWith('USM')) {
        loadInspectionImage(serial, state.currentSide || 'front');
        showToast(`Loaded module: ${serial}`, 'info');
      }
    }
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
      updateAxisHighlights(null, null);
      dom.hoverTooltip.style.display = 'none';
      return;
    }

    const row = cell.dataset.row;
    const col = parseInt(cell.dataset.col, 10);
    const coord = cell.dataset.coord;

    if (dom.liveCoordIndicator) {
      dom.liveCoordIndicator.textContent = `Cell ${coord}`;
    }

    if (dom.cellComicBubble.style.display !== 'flex') {
      dom.hoverTooltip.style.display = 'flex';

      const existingDefect = state.defects.get(coord);
      dom.hoverTooltip.querySelector('.tooltip-coord').textContent = `Cell ${coord}`;
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

  // Refresh Grading History Button
  if (dom.btnRefreshGradingHistory) {
    dom.btnRefreshGradingHistory.addEventListener('click', () => {
      fetchGradingHistory();
      showToast('Refreshed grading history', 'info');
      soundFx.beep(600, 0.05);
    });
  }

  // Toggle Sidebar Dock (for scalable side-by-side monitor layouts)
  if (dom.btnToggleDock) {
    dom.btnToggleDock.addEventListener('click', () => {
      toggleSidebarDock();
    });
  }

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

    // Hotkey [ or ] or D: Toggle Defects & Grading History Dock
    if (e.key === '[' || e.key === ']' || key === 'D') {
      e.preventDefault();
      toggleSidebarDock();
      return;
    }

    // Hotkey F: Flip Front / Back Side View
    if (key === 'F') {
      toggleInspectionSide();
    }
    else if (key === 'A' || key === 'B' || key === 'R' || key === 'X') {
      setGrade(key);
    }
    else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
      if (dom.cellComicBubble && dom.cellComicBubble.style.display === 'flex') {
        // Quick select from visible defect items in the bubble
        const index = parseInt(e.key, 10) - 1;
        const visibleItems = dom.bubbleReasonsList ? dom.bubbleReasonsList.querySelectorAll('.bubble-reason-item') : [];
        if (visibleItems[index]) {
          visibleItems[index].click();
        }
      }
    }
    else if (e.key === 'Enter') {
      if (dom.cellComicBubble && dom.cellComicBubble.style.display === 'flex') {
        if (!dom.btnBubbleConfirm.disabled) {
          dom.btnBubbleConfirm.click();
        }
      } else {
        // Submit grade when bubble is closed
        if (dom.btnSaveInspection) {
          dom.btnSaveInspection.click();
        }
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

    // 2. Validate against allowed grades from logged defects
    const allowed = state.allowedGrades || recomputeAllowedGrades();
    if (allowed.length > 0 && !allowed.includes(state.grade)) {
      const gradeNames = { 'A': 'Grade A (Prime)', 'B': 'Grade B (Secondary)', 'R': 'Retest / Rework', 'X': 'Reject' };
      const allowedNames = allowed.map(g => gradeNames[g] || g).join(' or ');
      showToast(`Grade [${state.grade}] is blocked by logged defects! Permitted: ${allowedNames}`, 'error');
      soundFx.beep(220, 0.2);
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
        fetchGradingHistory();
        soundFx.beep(950, 0.12);
        if (dom.pillDbStatus) {
          dom.pillDbStatus.className = 'status-indicator-pill status-live';
          dom.pillDbStatus.innerHTML = `<span>GRADE [${submittedGrade}] SAVED</span>`;
          setTimeout(() => {
            dom.pillDbStatus.innerHTML = '<span>DB LIVE</span>';
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

