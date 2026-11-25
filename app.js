/**
 * FVI Station 01 — Photovoltaic Final Visual Inspection Console
 * Architecture: Vertical Monitor (Portrait Stack Orientation)
 * Simultaneous Dual Outline (Front & Back Outlines Displayed Simultaneously)
 * 24 Columns (1–24) x 6 Rows (A–F) = 144 Half-Cut Silicon Cells per side
 * Interactive Comic Speech-Bubble Defect Tagger per Location
 * Instant Database Persistence, CMMS Authentication & Dual-Screen Broadcast Sync
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

// Auto-detect file:/// protocol
if (typeof window !== "undefined" && window.location.protocol === "file:" && !config.apiBaseUrl) {
  config.apiBaseUrl = "http://localhost:8080";
}

/**
 * Location-Specific Defect Presets
 * Easily editable mapping per location type
 */
const LOCATION_DEFECT_PRESETS = {
  front_cell: {
    label: 'Front Cell Matrix (A1–F24)',
    defaultCategory: 'Cell',
    allowedCategories: ['Cell', 'Glass', 'EVA', 'Soldering components', 'Module Dimension & Appearance', 'Other'],
    presetCodes: ['C7', 'C8', 'C6', 'C10', 'C5', 'C2', 'G2', 'E1']
  },
  front_frame: {
    label: 'Front Outer Frame (FRAME)',
    defaultCategory: 'Frame',
    allowedCategories: ['Frame', 'Module Dimension & Appearance', 'Other'],
    presetCodes: ['F1', 'F2', 'F5', 'F6', 'F7', 'F8', 'D6']
  },
  front_busbar: {
    label: 'Front Center Busbar (BBAR)',
    defaultCategory: 'Soldering components',
    allowedCategories: ['Soldering components', 'Cell', 'EVA', 'Module Dimension & Appearance', 'Other'],
    presetCodes: ['S1', 'S2', 'S3', 'D5', 'C10']
  },
  back_cell: {
    label: 'Back Side Cell / Backsheet Matrix',
    defaultCategory: 'Backsheet',
    allowedCategories: ['Backsheet', 'EVA', 'Module Dimension & Appearance', 'Other'],
    presetCodes: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'E6']
  },
  back_frame: {
    label: 'Back Outer Frame (FRAME)',
    defaultCategory: 'Frame',
    allowedCategories: ['Frame', 'Module Dimension & Appearance', 'Other'],
    presetCodes: ['F1', 'F2', 'F5', 'F6', 'F7', 'F8', 'D6']
  },
  back_jbox: {
    label: 'Junction / Function Box (JBX1/JBX2/JBX3)',
    defaultCategory: 'Junction Box',
    allowedCategories: ['Junction Box', 'Soldering components', 'Other'],
    presetCodes: ['J1', 'J2', 'J3', 'J4', 'J5', 'S3']
  }
};

/**
 * Production Defect Catalog (55 Standard Plant Presets)
 */
const DEFECT_CATALOG = {
  // === GLASS (Front Side) ===
  'G1': { code: 'G1', name: 'Glass Surface Appearance', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'G2': { code: 'G2', name: 'Glass Scratch', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'G3': { code: 'G3', name: 'Glass Bubbles', category: 'Glass', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === FRAME ===
  'F1': { code: 'F1', name: 'Frame Scratches', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F2': { code: 'F2', name: 'Frame Dents & Bumps', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F5': { code: 'F5', name: 'Frame Burrs', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F6': { code: 'F6', name: 'Frame Seam Gap / Misalign', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F7': { code: 'F7', name: 'Frame Sealant Defects', category: 'Frame', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'F8': { code: 'F8', name: 'Ground Mark Defect', category: 'Frame', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },

  // === CELL ===
  'C1': { code: 'C1', name: 'Cell Type Mixing', category: 'Cell', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'C2': { code: 'C2', name: 'Cell Color Difference', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C5': { code: 'C5', name: 'Cell Spots', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C6': { code: 'C6', name: 'Cell Edge & Corner Chip', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C7': { code: 'C7', name: 'Cell Crack Separation', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C8': { code: 'C8', name: 'Cell Scratch', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C9': { code: 'C9', name: 'Water Ripple & Dirt', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C10': { code: 'C10', name: 'Broken Grid / Finger', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'C11': { code: 'C11', name: 'Grid Line Thickness', category: 'Cell', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === EVA ===
  'E1': { code: 'E1', name: 'EVA Voids or Bubbles', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E2': { code: 'E2', name: 'EVA Unmelted Wrinkles', category: 'EVA', side: 'both', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'E3': { code: 'E3', name: 'EVA Discoloration / Dirt', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E4': { code: 'E4', name: 'Missing or Incomplete EVA', category: 'EVA', side: 'both', rawGrades: 'B,R', allowedGrades: ['B', 'X'] },
  'E5': { code: 'E5', name: 'EVA Line Marks, Faults', category: 'EVA', side: 'both', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'E6': { code: 'E6', name: 'Foreign Material', category: 'EVA', side: 'both', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'E7': { code: 'E7', name: 'Overflowing White EVA', category: 'EVA', side: 'both', rawGrades: 'RW', allowedGrades: ['R'] },

  // === BACKSHEET ===
  'B1': { code: 'B1', name: 'Bulging, Delamination', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B2': { code: 'B2', name: 'Drums / Bubbling', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B3': { code: 'B3', name: 'Backsheet Scratch', category: 'Backsheet', side: 'back', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'B4': { code: 'B4', name: 'Backsheet Fold / Crease', category: 'Backsheet', side: 'back', rawGrades: 'A,B', allowedGrades: ['A', 'B'] },
  'B5': { code: 'B5', name: 'Pits, Indentation', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B6': { code: 'B6', name: 'Backsheet Mark / Stain', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B7': { code: 'B7', name: 'Backsheet Crystal Point', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B8': { code: 'B8', name: 'Backsheet Drawing Mark', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'B9': { code: 'B9', name: 'Black Spots', category: 'Backsheet', side: 'back', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },

  // === JUNCTION BOX ===
  'J1': { code: 'J1', name: 'J-Box Body Flaw', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J2': { code: 'J2', name: 'J-Box Installation Tilt', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J3': { code: 'J3', name: 'Wires & Connectors Fault', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J4': { code: 'J4', name: 'Connection Inside J-box', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'J5': { code: 'J5', name: 'Potting Flaw / Leak', category: 'Junction Box', side: 'back', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === SOLDERING COMPONENTS ===
  'S1': { code: 'S1', name: 'Offset Soldering', category: 'Soldering components', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'S2': { code: 'S2', name: 'Solder Scar / Splash', category: 'Soldering components', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'S3': { code: 'S3', name: 'Busbar Soldering Flaw', category: 'Soldering components', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === MODULE DIMENSION & APPEARANCE ===
  'D2': { code: 'D2', name: 'Cell Array Shift', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D3': { code: 'D3', name: 'Cell Chamfer Direction', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R', allowedGrades: ['A', 'X'] },
  'D4': { code: 'D4', name: 'Overall Displacement', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D5': { code: 'D5', name: 'Busbar Lap Flaw', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D6': { code: 'D6', name: 'Module Dimension Out-of-Spec', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D7': { code: 'D7', name: 'Glazed Previous to Light', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D8': { code: 'D8', name: 'Missing Grid Print', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,B,R', allowedGrades: ['A', 'B', 'X'] },
  'D9': { code: 'D9', name: 'Module Barcode Defect', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },
  'D10': { code: 'D10', name: 'Module Nameplate Defect', category: 'Module Dimension & Appearance', side: 'front', rawGrades: 'A,R,RW', allowedGrades: ['A', 'R', 'X'] },

  // === OTHER ===
  'O1': { code: 'O1', name: 'No EL data', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O2': { code: 'O2', name: 'No Power Output', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O3': { code: 'O3', name: 'Low Power Deviation', category: 'Other', side: 'front', rawGrades: 'RW, RT', allowedGrades: ['R', 'X'] },
  'O4': { code: 'O4', name: 'High Power Deviation', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O5': { code: 'O5', name: 'No SunSim Data', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] },
  'O6': { code: 'O6', name: 'No Hi-Pot Data', category: 'Other', side: 'front', rawGrades: 'RT', allowedGrades: ['R', 'X'] }
};

// Application State
const state = {
  stationMode: 'fvi', // 'fvi' | 'postlam' (locked via URL route / server config; no UI toggle)
  moduleId: '', // 16-char photovoltaic module serial number starting with USM
  grade: null, // null | 'A' | 'B' | 'R' | 'X'
  allowedGrades: ['A', 'B', 'R', 'X'],
  defects: new Map(), // key: `${side}:${locCode}` (e.g. 'front:C8', 'front:BBAR', 'back:JBX1')
  activeLocation: null, // { locCode, side, locType, row, col, targetEl }
  selectedDefectCode: null,
  currentOperator: null,
  authToken: null,
  isServerOnline: false,
  isMqttConnected: false,
  activeChannel: 'CH88', // 'CH88' | 'MANUAL'
  isManualScan: false, // true when loaded via manual barcode scan or manual typing
  isSerialVerified: false, // true when manual scan OR physical barcode verified against auto-fetched serial
  verifyModalMode: 'ARRIVAL', // 'ARRIVAL' | 'SUBMIT'
  isSubmittingVerify: false, // guard against double-trigger from scanner Enter + input events
  isRequestInFlight: false, // guard against concurrent POST /api/inspections calls
  recentlyGradedModule: null, // serial of last submitted module
  recentlyGradedAt: 0, // timestamp of last submitted module (ms)
  moduleReadyForImmediateLoad: true, // true when waiting for next module
  mqttQueue: [], // unused (kept for compatibility)
  lastSeenChannelSerial: { CH88: null },
  prefetchedCache: new Map() // serial -> { telemetry, defects }
};

// Coordinate Configuration (Top-Down Rows A..F, Left-to-Right Columns 1..24)
const GRID_ROWS = ['A', 'B', 'C', 'D', 'E', 'F']; // Visual top-to-bottom order (A at top down to F)
const GRID_COLS = Array.from({ length: 24 }, (_, i) => i + 1); // Visual left-to-right order (1 to 24)

// Sound Effects Synthesizer
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
    } catch (e) { }
  }
};

// DOM Cache
const dom = {
  scannerField: document.getElementById('scanner-field'),
  moduleIdInput: document.getElementById('module-id-input'),
  btnCameraScan: document.getElementById('btn-camera-scan'),
  btnFullscreen: document.getElementById('btn-fullscreen'),
  btnFullscreenLabel: document.getElementById('btn-fullscreen-label'),
  cameraScannerModal: document.getElementById('camera-scanner-modal'),
  cameraScanVideo: document.getElementById('camera-scan-video'),
  cameraScanStatus: document.getElementById('camera-scan-status'),
  btnCloseCameraModal: document.getElementById('btn-close-camera-modal'),
  btnCancelCameraScan: document.getElementById('btn-cancel-camera-scan'),
  operatorInput: document.getElementById('operator-input'),
  btnOperatorProfile: document.getElementById('btn-operator-profile'),
  displayOperatorName: document.getElementById('display-operator-name'),
  pillDbStatus: document.getElementById('pill-db-status'),
  pillMqttStatus: document.getElementById('pill-mqtt-status'),
  mqttQueuePill: document.getElementById('mqtt-queue-pill'),
  queueChannelBadge: document.getElementById('queue-channel-badge'),
  queueCountText: document.getElementById('queue-count-text'),
  pillSimTrigger: document.getElementById('pill-sim-trigger'),
  gradeButtons: document.querySelectorAll('.grade-toggle'),
  btnGradeA: document.getElementById('btn-grade-a'),
  btnGradeB: document.getElementById('btn-grade-b'),
  btnGradeR: document.getElementById('btn-grade-r'),
  btnGradeX: document.getElementById('btn-grade-x'),
  btnSaveInspection: document.getElementById('btn-save-inspection'),
  btnViewSql: document.getElementById('btn-view-sql'),
  gradeRestrictionsHint: document.getElementById('grade-restrictions-hint'),

  // Logged Defects Strip
  summaryModuleId: document.getElementById('summary-module-id'),
  summaryGradeBadge: document.getElementById('summary-grade-badge'),
  historyBadgeCount: document.getElementById('history-badge-count'),
  historyTbody: document.getElementById('history-tbody'),
  emptyHistoryState: document.getElementById('empty-history-state'),
  whiteboardNotationPreview: document.getElementById('whiteboard-notation-preview'),
  btnClearHistory: document.getElementById('btn-clear-history'),

  // Front Outline Stage
  axisXFront: document.getElementById('axis-x-front'),
  axisYFront: document.getElementById('axis-y-front'),
  stageFront: document.getElementById('stage-front'),
  cellsGridFront: document.getElementById('cells-grid-front'),
  pinsFront: document.getElementById('pins-front'),

  // Back Outline Stage
  axisXBack: document.getElementById('axis-x-back'),
  axisYBack: document.getElementById('axis-y-back'),
  stageBack: document.getElementById('stage-back'),
  cellsGridBack: document.getElementById('cells-grid-back'),
  pinsBack: document.getElementById('pins-back'),

  // Grading History
  btnViewDatabase: document.getElementById('btn-view-database'),
  btnOpenFullHistory: document.getElementById('btn-open-full-history'),
  gradingHistoryBadge: document.getElementById('grading-history-badge'),
  gradingHistoryTbody: document.getElementById('grading-history-tbody'),
  emptyGradingHistoryState: document.getElementById('empty-grading-history-state'),
  btnRefreshGradingHistory: document.getElementById('btn-refresh-grading-history'),

  // Speech Bubble Popover
  cellComicBubble: document.getElementById('cell-comic-bubble'),
  bubbleArrow: document.getElementById('bubble-arrow'),
  bubbleCellCoord: document.getElementById('bubble-cell-coord'),
  bubbleSideBadge: document.getElementById('bubble-side-badge'),
  bubbleSearchInput: document.getElementById('bubble-search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  quickPresetsChips: document.getElementById('quick-presets-chips'),
  bubbleCategoryTabs: document.getElementById('bubble-category-tabs'),
  bubbleReasonsList: document.getElementById('bubble-reasons-list'),
  bubbleHoverInfo: document.getElementById('bubble-hover-info'),
  hoverInfoTitle: document.getElementById('hover-info-title'),
  hoverInfoSide: document.getElementById('hover-info-side'),
  hoverGradesVal: document.getElementById('hover-grades-val'),
  bubbleNotesInput: document.getElementById('bubble-notes-input'),
  btnBubbleConfirm: document.getElementById('btn-bubble-confirm'),
  btnBubbleDelete: document.getElementById('btn-bubble-delete'),
  btnBubbleClose: document.getElementById('btn-bubble-close'),

  // Hover Tooltip
  hoverTooltip: document.getElementById('hover-tooltip'),

  // CMMS Modals
  loginModal: document.getElementById('login-modal'),
  loginDialogTitle: document.getElementById('login-dialog-title'),
  cmmsLoginFormView: document.getElementById('cmms-login-form-view'),
  cmmsLoggedInView: document.getElementById('cmms-logged-in-view'),
  loggedInUserName: document.getElementById('logged-in-user-name'),
  loggedInUserRole: document.getElementById('logged-in-user-role'),
  loggedInUserDept: document.getElementById('logged-in-user-dept'),
  loginForm: document.getElementById('cmms-login-form'),
  loginUsername: document.getElementById('login-username'),
  loginErrorMsg: document.getElementById('login-error-msg'),
  btnSubmitLogin: document.getElementById('btn-submit-login'),
  btnLogoutCmms: document.getElementById('btn-logout-cmms'),
  btnCloseLoginModal: document.getElementById('btn-close-login-modal'),

  // Simulator Modal
  simulatorModal: document.getElementById('simulator-modal'),
  btnCloseSimModal: document.getElementById('btn-close-sim-modal'),
  simPanelInput: document.getElementById('sim-panel-input'),
  btnTriggerMqttSim: document.getElementById('btn-trigger-mqtt-sim'),
  btnSimPresets: document.querySelectorAll('.btn-sim-preset'),

  // SQL Modal
  sqlModal: document.getElementById('sql-modal'),
  btnCloseSqlModal: document.getElementById('btn-close-sql-modal'),
  sqlCodeDisplay: document.getElementById('sql-code-display'),
  btnCopySql: document.getElementById('btn-copy-sql'),

  // Serial Verification Modal
  serialVerifyModal: document.getElementById('serial-verify-modal'),
  verifyModalSerial: document.getElementById('verify-modal-serial'),
  verifyBarcodeInput: document.getElementById('verify-barcode-input'),
  verifyScanStatus: document.getElementById('verify-scan-status'),
  btnVerifySwitchScanned: document.getElementById('btn-verify-switch-scanned'),
  btnVerifyCancel: document.getElementById('btn-verify-cancel'),
  btnVerifyConfirm: document.getElementById('btn-verify-confirm'),
  btnCloseVerifyModal: document.getElementById('btn-close-verify-modal'),

  // Post-Lam Tablet Embedded EL1 Viewer
  appManifestLink: document.getElementById('app-manifest-link'),
  postlamElCard: document.getElementById('card-postlam-el'),
  postlamElBody: document.getElementById('postlam-el-body'),
  postlamElViewport: document.getElementById('postlam-el-viewport'),
  postlamElImg: document.getElementById('postlam-el-img'),
  postlamElAxisX: document.getElementById('postlam-el-axis-x'),
  postlamElAxisY: document.getElementById('postlam-el-axis-y'),
  postlamElFolderBadge: document.getElementById('postlam-el-folder-badge'),
  postlamElMachineBadge: document.getElementById('postlam-el-machine-badge'),
  postlamElLoading: document.getElementById('postlam-el-loading'),
  postlamElNoImage: document.getElementById('postlam-el-no-image'),
  postlamElNoImageSub: document.getElementById('postlam-el-no-image-sub'),
  btnPostlamRefreshEl: document.getElementById('btn-postlam-refresh-el'),
  btnPostlamToggleEl: document.getElementById('btn-postlam-toggle-el'),
  btnPostlamResetZoom: document.getElementById('btn-postlam-reset-zoom'),

  toastContainer: document.getElementById('toast-container')
};

// Dual-Screen & Station Broadcast Channels
let dualScreenSyncChannel = null;
try {
  dualScreenSyncChannel = new BroadcastChannel('fvi_DualScreen_Sync');
} catch (e) {
  console.warn('[BroadcastChannel] fvi_DualScreen_Sync not supported');
}

let stationSyncChannel = null;
try {
  stationSyncChannel = new BroadcastChannel('fvi_station_sync');
} catch (e) {
  console.warn('[BroadcastChannel] fvi_station_sync not supported');
}

function detectStationMode() {
  const locked = String((typeof window !== 'undefined' && window.__LOCKED_STATION_MODE__) || '').trim().toLowerCase();
  if (locked === 'postlam' || locked === 'post_lam' || locked === 'pl') {
    state.stationMode = 'postlam';
    return state.stationMode;
  }
  const pathLower = (typeof window !== 'undefined' && window.location && window.location.pathname || '').toLowerCase();
  if (pathLower === '/postlam' || pathLower.startsWith('/postlam/')) {
    state.stationMode = 'postlam';
    return state.stationMode;
  }
  const urlParams = new URLSearchParams(window.location.search);
  const qStation = String(urlParams.get('station') || urlParams.get('mode') || '').trim().toLowerCase();
  if (qStation === 'postlam' || qStation === 'post_lam' || qStation === 'pl') {
    state.stationMode = 'postlam';
  } else {
    state.stationMode = 'fvi';
  }
  return state.stationMode;
}

function applyStationModeUI() {
  const isPostLam = state.stationMode === 'postlam';
  document.body.classList.toggle('station-postlam', isPostLam);
  if (dom.appManifestLink) {
    dom.appManifestLink.href = isPostLam ? '/postlam/manifest.json' : '/manifest.json';
  }
  const dbHref = isPostLam ? '/postlam/database.html' : '/database.html';
  if (dom.btnViewDatabase) {
    dom.btnViewDatabase.href = dbHref;
  }
  if (dom.btnOpenFullHistory) {
    dom.btnOpenFullHistory.href = dbHref;
  }
  if (isPostLam) {
    document.title = 'Post-Lam Station — Photovoltaic Post-Lamination Visual Inspection Console';
    const frontSub = document.getElementById('front-card-subtitle');
    if (frontSub) {
      frontSub.textContent = '24\u00d76 Silicon Matrix (144 Cells: A1\u2013F24) \u2022 Center Busbar (BBAR)';
    }
    const backSub = document.getElementById('back-card-subtitle');
    if (backSub) {
      backSub.textContent = '24\u00d76 Grid \u2022 Backsheet';
    }
    const emptySub = document.getElementById('empty-history-subtitle');
    if (emptySub) {
      emptySub.textContent = '\u2014 Click any cell or center busbar on the outlines below to log defects.';
    }
    if (dom.mqttQueuePill) {
      dom.mqttQueuePill.title = 'Locked Station Mode: Post-Lam Visual Inspection';
    }
    buildPostLamElAxes();
    initPostLamElViewer();
    updatePostLamElImage(null);
  }
}

const postLamElZoom = {
  scale: 1,
  originX: 50,
  originY: 50,
  pinchStartDist: 0,
  pinchStartScale: 1,
  panActive: false,
  panLastX: 0,
  panLastY: 0,
  lastTapAt: 0,
  initialized: false
};

function buildPostLamElAxes() {
  if (dom.postlamElAxisX) {
    dom.postlamElAxisX.innerHTML = '';
    const fragX = document.createDocumentFragment();
    for (let c = 1; c <= 12; c++) {
      const cell = document.createElement('div');
      cell.className = 'postlam-el-axis-cell-x';
      cell.dataset.col = c;
      cell.textContent = c;
      fragX.appendChild(cell);
    }
    const spacer = document.createElement('div');
    spacer.className = 'postlam-el-axis-cell-x spacer-x';
    spacer.innerHTML = '&bull;';
    fragX.appendChild(spacer);
    for (let c = 13; c <= 24; c++) {
      const cell = document.createElement('div');
      cell.className = 'postlam-el-axis-cell-x';
      cell.dataset.col = c;
      cell.textContent = c;
      fragX.appendChild(cell);
    }
    dom.postlamElAxisX.appendChild(fragX);
  }

  if (dom.postlamElAxisY) {
    dom.postlamElAxisY.innerHTML = '';
    const fragY = document.createDocumentFragment();
    GRID_ROWS.forEach((row) => {
      const cell = document.createElement('div');
      cell.className = 'postlam-el-axis-cell-y';
      cell.dataset.row = row;
      cell.textContent = row;
      fragY.appendChild(cell);
    });
    dom.postlamElAxisY.appendChild(fragY);
  }
}

function applyPostLamElTransform() {
  if (!dom.postlamElImg) return;
  const s = postLamElZoom.scale > 1 ? postLamElZoom.scale : 1;
  const mirroredOriginX = (100 * s + (1 - s) * postLamElZoom.originX) / (1 + s);
  dom.postlamElImg.style.transformOrigin = `${mirroredOriginX}% ${postLamElZoom.originY}%`;
  dom.postlamElImg.style.transform = `scale(-${s}, ${s})`;
  if (dom.postlamElViewport) {
    dom.postlamElViewport.classList.toggle('is-zoomed', postLamElZoom.scale > 1);
  }
  if (dom.btnPostlamResetZoom) {
    if (postLamElZoom.scale > 1) {
      const label = postLamElZoom.scale.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1');
      dom.btnPostlamResetZoom.textContent = `${label}x Reset`;
      dom.btnPostlamResetZoom.style.display = 'inline-flex';
    } else {
      dom.btnPostlamResetZoom.style.display = 'none';
    }
  }
}

function resetPostLamElZoom() {
  postLamElZoom.scale = 1;
  postLamElZoom.originX = 50;
  postLamElZoom.originY = 50;
  applyPostLamElTransform();
}

function setPostLamOriginFromPoint(clientX, clientY) {
  if (!dom.postlamElViewport) return;
  const rect = dom.postlamElViewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const u = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const v = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const overscan = 18;
  postLamElZoom.originX = -overscan + u * (100 + overscan * 2);
  postLamElZoom.originY = -overscan + v * (100 + overscan * 2);
}

function initPostLamElViewer() {
  if (postLamElZoom.initialized || !dom.postlamElViewport) return;
  postLamElZoom.initialized = true;

  const vp = dom.postlamElViewport;

  vp.addEventListener('mousemove', (e) => {
    setPostLamOriginFromPoint(e.clientX, e.clientY);
    if (postLamElZoom.scale > 1) {
      applyPostLamElTransform();
    }
    const rect = vp.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const col = Math.min(24, Math.max(1, Math.floor(u * 24) + 1));
      const row = GRID_ROWS[Math.min(5, Math.max(0, Math.floor(v * 6)))];
      if (dom.postlamElAxisX) {
        dom.postlamElAxisX.querySelectorAll('.postlam-el-axis-cell-x[data-col]').forEach((c) => {
          c.classList.toggle('highlight', c.dataset.col === String(col));
        });
      }
      if (dom.postlamElAxisY) {
        dom.postlamElAxisY.querySelectorAll('.postlam-el-axis-cell-y[data-row]').forEach((r) => {
          r.classList.toggle('highlight', r.dataset.row === row);
        });
      }
    }
  });

  vp.addEventListener('mouseleave', () => {
    if (dom.postlamElAxisX) {
      dom.postlamElAxisX.querySelectorAll('.highlight').forEach((el) => el.classList.remove('highlight'));
    }
    if (dom.postlamElAxisY) {
      dom.postlamElAxisY.querySelectorAll('.highlight').forEach((el) => el.classList.remove('highlight'));
    }
  });

  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    setPostLamOriginFromPoint(e.clientX, e.clientY);
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    postLamElZoom.scale = Math.round(Math.max(1.0, Math.min(6.0, postLamElZoom.scale + delta)) * 100) / 100;
    applyPostLamElTransform();
  }, { passive: false });

  vp.addEventListener('dblclick', () => resetPostLamElZoom());

  // Touch pinch-to-zoom & single-finger pan for Android Tablets
  const getTouchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  vp.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      postLamElZoom.pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);
      postLamElZoom.pinchStartScale = postLamElZoom.scale;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setPostLamOriginFromPoint(midX, midY);
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - postLamElZoom.lastTapAt < 280) {
        e.preventDefault();
        resetPostLamElZoom();
        postLamElZoom.lastTapAt = 0;
        return;
      }
      postLamElZoom.lastTapAt = now;
      if (postLamElZoom.scale > 1) {
        postLamElZoom.panActive = true;
        postLamElZoom.panLastX = e.touches[0].clientX;
        postLamElZoom.panLastY = e.touches[0].clientY;
      }
    }
  }, { passive: false });

  vp.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && postLamElZoom.pinchStartDist > 0) {
      e.preventDefault();
      const dist = getTouchDist(e.touches[0], e.touches[1]);
      const ratio = dist / postLamElZoom.pinchStartDist;
      postLamElZoom.scale = Math.round(Math.max(1.0, Math.min(6.0, postLamElZoom.pinchStartScale * ratio)) * 100) / 100;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      setPostLamOriginFromPoint(midX, midY);
      applyPostLamElTransform();
    } else if (e.touches.length === 1 && postLamElZoom.panActive && postLamElZoom.scale > 1) {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const dx = e.touches[0].clientX - postLamElZoom.panLastX;
      const dy = e.touches[0].clientY - postLamElZoom.panLastY;
      postLamElZoom.panLastX = e.touches[0].clientX;
      postLamElZoom.panLastY = e.touches[0].clientY;
      if (rect.width > 0 && rect.height > 0) {
        postLamElZoom.originX = Math.max(-18, Math.min(118, postLamElZoom.originX - (dx / rect.width) * 100));
        postLamElZoom.originY = Math.max(-18, Math.min(118, postLamElZoom.originY - (dy / rect.height) * 100));
        applyPostLamElTransform();
      }
    }
  }, { passive: false });

  vp.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) postLamElZoom.pinchStartDist = 0;
    if (e.touches.length === 0) postLamElZoom.panActive = false;
  });

  if (dom.btnPostlamResetZoom) {
    dom.btnPostlamResetZoom.addEventListener('click', resetPostLamElZoom);
  }
  if (dom.btnPostlamRefreshEl) {
    dom.btnPostlamRefreshEl.addEventListener('click', () => {
      updatePostLamElImage(state.moduleId || null, true);
      showToast('Re-fetching EL1 image from camera PCs...', 'info');
    });
  }
  if (dom.btnPostlamToggleEl && dom.postlamElBody) {
    dom.btnPostlamToggleEl.addEventListener('click', () => {
      const hidden = dom.postlamElBody.style.display === 'none';
      dom.postlamElBody.style.display = hidden ? 'flex' : 'none';
      dom.btnPostlamToggleEl.textContent = hidden ? 'Hide Image' : 'Show Image';
    });
  }
}

function renderPostLamElBadges(elData) {
  if (dom.postlamElFolderBadge) {
    const status = String((elData && elData.folder_status) || '').trim().toUpperCase();
    if (status === 'OK') {
      dom.postlamElFolderBadge.textContent = 'OK';
      dom.postlamElFolderBadge.className = 'el-folder-badge ok';
    } else if (status === 'NG') {
      dom.postlamElFolderBadge.textContent = 'NG';
      dom.postlamElFolderBadge.className = 'el-folder-badge ng';
    } else {
      dom.postlamElFolderBadge.textContent = state.moduleId ? 'NO DATA' : '--';
      dom.postlamElFolderBadge.className = 'el-folder-badge';
    }
  }
  if (dom.postlamElMachineBadge) {
    const machine = (elData && elData.el_machine) || 'EL1';
    dom.postlamElMachineBadge.textContent = machine;
  }
}

let activePostLamElBlobUrl = null;
let postLamElFetchSeq = 0;

function showPostLamNoImage(subText) {
  if (activePostLamElBlobUrl) {
    URL.revokeObjectURL(activePostLamElBlobUrl);
    activePostLamElBlobUrl = null;
  }
  if (dom.postlamElLoading) dom.postlamElLoading.style.display = 'none';
  if (dom.postlamElImg) {
    dom.postlamElImg.style.display = 'none';
    dom.postlamElImg.removeAttribute('src');
  }
  if (dom.postlamElNoImageSub) {
    dom.postlamElNoImageSub.textContent = subText || 'No EL1 image found';
  }
  if (dom.postlamElNoImage) {
    dom.postlamElNoImage.style.display = 'flex';
  }
}

function updatePostLamElImage(moduleId, forceBust = false) {
  if (state.stationMode !== 'postlam' || !dom.postlamElImg) return;
  resetPostLamElZoom();

  const mySeq = ++postLamElFetchSeq;
  const cleanMod = String(moduleId || '').trim().toUpperCase();
  if (!cleanMod || cleanMod.length !== 16 || !cleanMod.startsWith('USM')) {
    dom.postlamElImg.onerror = null;
    showPostLamNoImage('Scan module to fetch EL1 image');
    renderPostLamElBadges(null);
    return;
  }

  if (dom.postlamElNoImage) dom.postlamElNoImage.style.display = 'none';
  if (dom.postlamElLoading) dom.postlamElLoading.style.display = 'flex';
  const bustParam = `&_t=${Date.now()}${forceBust ? '&refresh=1' : ''}`;
  const targetUrl = `${config.apiBaseUrl}/api/module/${encodeURIComponent(cleanMod)}/el-image?side=front&station=postlam${bustParam}`;

  fetch(targetUrl)
    .then((res) => {
      if (mySeq !== postLamElFetchSeq) return null;
      if (!res.ok || res.status === 204) {
        showPostLamNoImage(`No EL1 image found for ${cleanMod}`);
        return null;
      }
      return res.blob();
    })
    .then((blob) => {
      if (mySeq !== postLamElFetchSeq || !blob || blob.size === 0) return;
      const nextUrl = URL.createObjectURL(blob);
      if (activePostLamElBlobUrl) {
        URL.revokeObjectURL(activePostLamElBlobUrl);
      }
      activePostLamElBlobUrl = nextUrl;
      dom.postlamElImg.onload = () => {
        if (dom.postlamElNoImage) dom.postlamElNoImage.style.display = 'none';
        if (dom.postlamElLoading) dom.postlamElLoading.style.display = 'none';
        dom.postlamElImg.style.display = 'block';
      };
      dom.postlamElImg.onerror = () => {
        showPostLamNoImage(`No EL1 image found for ${cleanMod}`);
      };
      dom.postlamElImg.src = nextUrl;
    })
    .catch(() => {
      if (mySeq !== postLamElFetchSeq) return;
      showPostLamNoImage(`No EL1 image found for ${cleanMod}`);
    });

  fetch(`${config.apiBaseUrl}/api/telemetry/el1?module_id=${encodeURIComponent(cleanMod)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((elData) => {
      if (state.moduleId === cleanMod && elData) {
        renderPostLamElBadges(elData);
      }
    })
    .catch(() => { });
}

function broadcastModuleChange(modId) {
  const clean = (modId || '').trim().toUpperCase();
  if (clean.length !== 16 || !clean.startsWith('USM')) return;

  const storageKey = state.stationMode === 'postlam' ? 'fvi_active_module_id_postlam' : 'fvi_active_module_id';
  try {
    localStorage.setItem(storageKey, clean);
  } catch (e) { }

  const payload = {
    type: 'MODULE_CHANGED',
    moduleId: clean,
    station: state.stationMode,
    timestamp: Date.now()
  };

  if (dualScreenSyncChannel) {
    try {
      dualScreenSyncChannel.postMessage(payload);
    } catch (e) { }
  }

  if (stationSyncChannel) {
    try {
      stationSyncChannel.postMessage(payload);
    } catch (e) { }
  }

  try {
    fetch(`${config.apiBaseUrl}/api/module/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module_id: clean,
        channel: state.activeChannel || 'MANUAL',
        station: state.stationMode
      })
    }).catch(() => { });
  } catch (e) { }
}

// Memory mapping of grid cells and slots
const stageCellsMap = new Map(); // key: `${side}:${coord}` -> HTMLElement
const stagePinSlotsMap = new Map(); // key: `${side}:${locCode}` -> HTMLElement

/**
 * Initialize Application
 */
function initApp() {
  detectStationMode();
  applyStationModeUI();

  buildStageAxes('front', dom.axisXFront, dom.axisYFront);
  buildStageAxes('back', dom.axisXBack, dom.axisYBack);

  buildStageGrid('front', dom.cellsGridFront, dom.pinsFront);
  buildStageGrid('back', dom.cellsGridBack, dom.pinsBack);

  wireInteractiveRegions();
  loadOperatorSession();
  attachEventListeners();
  checkBackendHealth();
  initConveyorEventStream();

  // Prompt login on initial load if not signed in
  if (!state.currentOperator) {
    setTimeout(() => {
      openLoginModal(true);
    }, 250);
  }

  // Clear defects and reset grade
  state.defects.clear();
  resetGrade();
  recomputeAllowedGrades();
  updateSummaryAndHistory();
  renderDefectPins();

  // Check URL parameters for direct module load
  const urlParams = new URLSearchParams(window.location.search);
  const urlModule = urlParams.get('module') || urlParams.get('serial') || urlParams.get('sn') || urlParams.get('id');
  if (urlModule) {
    const cleanMod = urlModule.trim().toUpperCase().slice(0, 16);
    loadModule(cleanMod, 'URL', false);
    state.moduleReadyForImmediateLoad = false;
  } else {
    // Start clean without fake baseline module
    state.moduleId = '';
    state.activeChannel = 'IDLE';
    state.isManualScan = false;
    state.moduleReadyForImmediateLoad = true;
    if (dom.moduleIdInput) dom.moduleIdInput.value = '';
    if (dom.summaryModuleId) {
      dom.summaryModuleId.textContent = state.stationMode === 'postlam'
        ? 'Scan Barcode for Post-Lam...'
        : 'Scan Barcode or Waiting for MQTT...';
    }
    if (state.currentOperator && dom.moduleIdInput) {
      setTimeout(() => { dom.moduleIdInput.focus(); }, 100);
    }
  }
  updateQueueDisplay();

  // Fetch grading history on startup & poll periodically
  fetchGradingHistory();
  setInterval(() => {
    fetchGradingHistory();
  }, 10000);

  // Register PWA Service Worker (network-first so server/repo updates reach tablets immediately)
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { });
  }
}

/**
 * Build Axis Labels (Columns 1–12, Spacer, Columns 13–24 & Rows A–F Top-Down)
 */
function buildStageAxes(side, axisXEl, axisYEl) {
  if (!axisXEl || !axisYEl) return;
  axisXEl.innerHTML = '';
  axisYEl.innerHTML = '';

  const fragX = document.createDocumentFragment();

  // Left 12 Columns (1..12, left-to-right numbering)
  for (let c = 1; c <= 12; c++) {
    const cellX = document.createElement('div');
    cellX.className = 'axis-cell-x';
    cellX.dataset.col = c;
    cellX.dataset.side = side;
    cellX.textContent = c;
    fragX.appendChild(cellX);
  }

  // Center Spacer (aligns with center gap)
  const spacerX = document.createElement('div');
  spacerX.className = 'axis-cell-x spacer-x';
  spacerX.innerHTML = '&bull;';
  fragX.appendChild(spacerX);

  // Right 12 Columns (13..24, left-to-right numbering)
  for (let c = 13; c <= 24; c++) {
    const cellX = document.createElement('div');
    cellX.className = 'axis-cell-x';
    cellX.dataset.col = c;
    cellX.dataset.side = side;
    cellX.textContent = c;
    fragX.appendChild(cellX);
  }
  axisXEl.appendChild(fragX);

  // Y Axis (Rows A..F top-to-bottom)
  const fragY = document.createDocumentFragment();
  GRID_ROWS.forEach(row => {
    const cellY = document.createElement('div');
    cellY.className = 'axis-cell-y';
    cellY.dataset.row = row;
    cellY.dataset.side = side;
    cellY.textContent = row;
    fragY.appendChild(cellY);
  });
  axisYEl.appendChild(fragY);
}

/**
 * Build 24x6 Coordinate Grid Overlay with DocumentFragments
 */
function buildStageGrid(side, gridEl, pinsLayerEl) {
  if (!gridEl || !pinsLayerEl) return;
  gridEl.innerHTML = '';
  pinsLayerEl.innerHTML = '';

  const fragGrid = document.createDocumentFragment();
  const fragPins = document.createDocumentFragment();

  GRID_ROWS.forEach((row, rowIdx) => {
    GRID_COLS.forEach((col, colIdx) => {
      const coord = `${row}${col}`;
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.coord = coord;
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.dataset.side = side;
      cell.dataset.loc = coord;
      cell.dataset.locType = side === 'front' ? 'front_cell' : 'back_cell';
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', `${side.toUpperCase()} Cell ${coord}`);

      // Grid placement accounting for center gap at column 13
      const gridCol = colIdx < 12 ? colIdx + 1 : colIdx + 2;
      const gridRow = rowIdx + 1;
      cell.style.gridColumn = `${gridCol}`;
      cell.style.gridRow = `${gridRow}`;

      // Slot for pin marker
      const pinSlot = document.createElement('div');
      pinSlot.className = 'defect-pin-slot';
      pinSlot.dataset.side = side;
      pinSlot.dataset.loc = coord;
      cell.appendChild(pinSlot);

      fragGrid.appendChild(cell);

      stageCellsMap.set(`${side}:${coord}`, cell);
      stagePinSlotsMap.set(`${side}:${coord}`, pinSlot);
    });
  });

  gridEl.appendChild(fragGrid);
}

/**
 * Wire interactive regions: Cells, Uniform Outer Frame, Center Busbar, Function Boxes
 */
function wireInteractiveRegions() {
  const isPostLam = state.stationMode === 'postlam';

  // 1. Uniform Frame on both stages (disabled in Post-Lam mode)
  if (!isPostLam) {
    document.querySelectorAll('.uniform-frame-zone').forEach(frameZone => {
      const side = frameZone.dataset.side;
      const loc = frameZone.dataset.loc || 'FRM';
      const pinContainer = frameZone.querySelector('.frame-pin-container');
      if (pinContainer) {
        stagePinSlotsMap.set(`${side}:${loc}`, pinContainer);
        stagePinSlotsMap.set(`${side}:FRAME`, pinContainer);
        stagePinSlotsMap.set(`${side}:FRMT`, pinContainer);
        stagePinSlotsMap.set(`${side}:FRMB`, pinContainer);
        stagePinSlotsMap.set(`${side}:FRML`, pinContainer);
        stagePinSlotsMap.set(`${side}:FRMR`, pinContainer);
      }
      frameZone.addEventListener('click', (e) => {
        e.stopPropagation();
        openComicBubble(loc, side, frameZone.dataset.locType || `${side}_frame`, frameZone);
      });
      frameZone.addEventListener('mouseenter', () => showTooltip(loc, side, `${side.toUpperCase()} Outer Frame (FRAME)`, frameZone));
      frameZone.addEventListener('mouseleave', hideTooltip);
    });
  }

  // 2. Center Busbar (Front Stage)
  const busbar = document.getElementById('front-center-busbar');
  if (busbar) {
    const pinContainer = busbar.querySelector('.frame-pin-container');
    if (pinContainer) {
      stagePinSlotsMap.set('front:BBAR', pinContainer);
    }
    busbar.addEventListener('click', (e) => {
      e.stopPropagation();
      openComicBubble('BBAR', 'front', 'front_busbar', busbar);
    });
    busbar.addEventListener('mouseenter', () => showTooltip('BBAR', 'front', 'Front Center Busbar', busbar));
    busbar.addEventListener('mouseleave', hideTooltip);
  }

  // 3. Three Function / Junction Boxes (Back Stage — disabled in Post-Lam mode)
  if (!isPostLam) {
    document.querySelectorAll('.jbox-zone').forEach(jbox => {
      const side = 'back';
      const loc = jbox.dataset.loc;
      const pinContainer = jbox.querySelector('.frame-pin-container');
      if (pinContainer) {
        stagePinSlotsMap.set(`back:${loc}`, pinContainer);
      }
      jbox.addEventListener('click', (e) => {
        e.stopPropagation();
        openComicBubble(loc, side, 'back_jbox', jbox);
      });
      jbox.addEventListener('mouseenter', () => showTooltip(loc, side, jbox.title, jbox));
      jbox.addEventListener('mouseleave', hideTooltip);
    });
  }

  // 4. Grid Cells on both stages
  document.querySelectorAll('.grid-cell').forEach(cell => {
    const side = cell.dataset.side;
    const loc = cell.dataset.coord;
    const locType = cell.dataset.locType || (side === 'front' ? 'front_cell' : 'back_cell');

    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      openComicBubble(loc, side, locType, cell);
    });
    cell.addEventListener('mouseenter', () => {
      highlightAxes(loc, side);
      showTooltip(loc, side, `Cell ${loc}`, cell);
    });
    cell.addEventListener('mouseleave', () => {
      clearAxesHighlight(side);
      hideTooltip();
    });
  });
}

/**
 * Axis Highlighting
 */
function highlightAxes(coord, side) {
  const row = coord.charAt(0);
  const col = parseInt(coord.slice(1), 10);
  const axisXEl = side === 'front' ? dom.axisXFront : dom.axisXBack;
  const axisYEl = side === 'front' ? dom.axisYFront : dom.axisYBack;

  if (axisXEl) {
    axisXEl.querySelectorAll('.axis-cell-x').forEach(el => {
      el.classList.toggle('highlight', el.dataset.col === String(col));
    });
  }
  if (axisYEl) {
    axisYEl.querySelectorAll('.axis-cell-y').forEach(el => {
      el.classList.toggle('highlight', el.dataset.row === row);
    });
  }
}

function clearAxesHighlight(side) {
  const axisXEl = side === 'front' ? dom.axisXFront : dom.axisXBack;
  const axisYEl = side === 'front' ? dom.axisYFront : dom.axisYBack;
  if (axisXEl) axisXEl.querySelectorAll('.axis-cell-x').forEach(el => el.classList.remove('highlight'));
  if (axisYEl) axisYEl.querySelectorAll('.axis-cell-y').forEach(el => el.classList.remove('highlight'));
}

/**
 * Tooltip Display
 */
function showTooltip(loc, side, title, targetEl) {
  if (!dom.hoverTooltip) return;
  const rect = targetEl.getBoundingClientRect();
  const defKey = `${side}:${loc}`;
  const hasDefect = state.defects.has(defKey);

  dom.hoverTooltip.querySelector('.tooltip-coord').textContent = `${side.toUpperCase()} • ${loc}`;
  const statusEl = dom.hoverTooltip.querySelector('.tooltip-status');
  if (hasDefect) {
    const d = state.defects.get(defKey);
    statusEl.textContent = `[${d.defectCode}] ${d.defectName}`;
  } else {
    statusEl.textContent = title || 'Click to tag defect';
  }

  dom.hoverTooltip.style.display = 'flex';
  dom.hoverTooltip.style.left = `${Math.min(window.innerWidth - 220, Math.max(10, rect.left + rect.width / 2 - 80))}px`;
  dom.hoverTooltip.style.top = `${Math.max(10, rect.top - 32)}px`;
}

function hideTooltip() {
  if (dom.hoverTooltip) dom.hoverTooltip.style.display = 'none';
}

/**
 * Location-Specific Defect Speech Bubble Popover
 */
let currentCategory = 'ALL';
let activeQuickCode = null;

function formatLocationTitle(locCode, side, locType) {
  const sideName = side.toUpperCase();
  if (locType === 'front_frame' || locType === 'back_frame') {
    return `${sideName} OUTER FRAME (${locCode === 'FRM' ? 'FRAME' : locCode})`;
  }
  if (locType === 'front_busbar') {
    return `${sideName} CENTER BUSBAR (${locCode})`;
  }
  if (locType === 'back_jbox') {
    const map = { JBX1: 'TOP J-BOX', JBX2: 'MID J-BOX', JBX3: 'BOT J-BOX' };
    return `${sideName} ${map[locCode] || 'FUNCTION BOX'} (${locCode})`;
  }
  return `${sideName} CELL ${locCode}`;
}

function openComicBubble(locCode, side, locType, targetEl) {
  if (
    state.stationMode === 'postlam' &&
    (['front_frame', 'back_frame', 'back_jbox'].includes(locType) ||
      ['FRM', 'FRAME', 'FRMT', 'FRMB', 'FRML', 'FRMR', 'JBX1', 'JBX2', 'JBX3'].includes(String(locCode || '').toUpperCase()))
  ) {
    return;
  }
  const preset = LOCATION_DEFECT_PRESETS[locType] || LOCATION_DEFECT_PRESETS.front_cell;
  state.activeLocation = { locCode, side, locType, targetEl };

  const defKey = `${side}:${locCode}`;
  const existingDefect = state.defects.get(defKey);

  // Set titles and badges
  dom.bubbleCellCoord.textContent = formatLocationTitle(locCode, side, locType);
  dom.bubbleSideBadge.textContent = `${side.toUpperCase()} SIDE`;
  dom.bubbleSideBadge.className = `bubble-side-badge ${side}`;

  // Reset inputs
  if (dom.bubbleSearchInput) dom.bubbleSearchInput.value = '';
  if (dom.btnClearSearch) dom.btnClearSearch.style.display = 'none';
  if (dom.bubbleNotesInput) dom.bubbleNotesInput.value = existingDefect ? existingDefect.notes || '' : '';

  // Render quick presets
  renderQuickPresets(preset.presetCodes || []);

  // Determine initial category: if defect exists, use its category, else preset defaultCategory
  const initialCategory = existingDefect
    ? existingDefect.category
    : (preset.defaultCategory || 'ALL');

  renderCategoryTabs(preset.allowedCategories, initialCategory);
  currentCategory = initialCategory;

  // Selected code
  state.selectedDefectCode = existingDefect ? existingDefect.defectCode : (preset.presetCodes && preset.presetCodes[0]) || null;
  activeQuickCode = state.selectedDefectCode;

  renderReasonsList();
  updateBubbleActionButtons(!!existingDefect);
  positionBubble(targetEl);
  soundFx.beep(750, 0.04);
}

function renderQuickPresets(presetCodes) {
  if (!dom.quickPresetsChips) return;
  dom.quickPresetsChips.innerHTML = '';

  if (!presetCodes || presetCodes.length === 0) {
    dom.quickPresetsChips.innerHTML = '<span style="color:var(--text-dim);font-size:10px;">None</span>';
    return;
  }

  presetCodes.forEach(code => {
    const def = DEFECT_CATALOG[code];
    if (!def) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-preset-chip ${state.selectedDefectCode === code ? 'active' : ''}`;
    btn.textContent = `${code} ${def.name.slice(0, 14)}`;
    btn.title = `[${code}] ${def.name} (${def.category})`;

    btn.addEventListener('click', () => {
      state.selectedDefectCode = code;
      activeQuickCode = code;
      dom.quickPresetsChips.querySelectorAll('.btn-preset-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Switch category tab to match defect category
      if (def.category && def.category !== currentCategory) {
        currentCategory = def.category;
        dom.bubbleCategoryTabs.querySelectorAll('.bubble-category-tab').forEach(t => {
          t.classList.toggle('active', t.dataset.category === def.category);
        });
      }
      renderReasonsList();
      updateBubbleActionButtons(state.defects.has(`${state.activeLocation.side}:${state.activeLocation.locCode}`));
      soundFx.beep(850, 0.04);
    });

    dom.quickPresetsChips.appendChild(btn);
  });
}

function renderCategoryTabs(allowedCategories, selectedCategory) {
  if (!dom.bubbleCategoryTabs) return;
  dom.bubbleCategoryTabs.innerHTML = '';

  const categories = ['ALL', ...(allowedCategories || [])];

  categories.forEach(cat => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `bubble-category-tab ${cat === selectedCategory ? 'active' : ''}`;
    tab.dataset.category = cat;
    tab.textContent = cat;

    tab.addEventListener('click', () => {
      currentCategory = cat;
      dom.bubbleCategoryTabs.querySelectorAll('.bubble-category-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderReasonsList();
      soundFx.beep(650, 0.03);
    });

    dom.bubbleCategoryTabs.appendChild(tab);
  });
}

function renderReasonsList() {
  if (!dom.bubbleReasonsList) return;
  dom.bubbleReasonsList.innerHTML = '';

  const query = (dom.bubbleSearchInput ? dom.bubbleSearchInput.value : '').trim().toLowerCase();
  const frag = document.createDocumentFragment();

  const entries = Object.values(DEFECT_CATALOG).filter(def => {
    // Post-Lam mode does not use Frame or Junction Box defects
    if (state.stationMode === 'postlam' && (def.category === 'Frame' || def.category === 'Junction Box')) {
      return false;
    }
    // Category match
    if (currentCategory !== 'ALL' && def.category !== currentCategory) return false;
    // Search query match
    if (query) {
      const matchCode = def.code.toLowerCase().includes(query);
      const matchName = def.name.toLowerCase().includes(query);
      const matchCat = def.category.toLowerCase().includes(query);
      if (!matchCode && !matchName && !matchCat) return false;
    }
    return true;
  });

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '12px';
    empty.style.textAlign = 'center';
    empty.style.color = 'var(--text-dim)';
    empty.style.fontSize = '11px';
    empty.textContent = 'No matching defects in this category.';
    dom.bubbleReasonsList.appendChild(empty);
    return;
  }

  entries.forEach(def => {
    const item = document.createElement('div');
    item.className = `bubble-reason-item ${state.selectedDefectCode === def.code ? 'selected' : ''}`;
    item.dataset.code = def.code;

    item.innerHTML = `
      <div class="bubble-reason-left">
        <span class="bubble-reason-code">${def.code}</span>
        <span class="bubble-reason-name">${def.name}</span>
      </div>
      <span class="hover-grades-val" style="font-size:10px;">${def.rawGrades}</span>
    `;

    item.addEventListener('click', () => {
      state.selectedDefectCode = def.code;
      dom.bubbleReasonsList.querySelectorAll('.bubble-reason-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');

      // Update quick chips highlight
      if (dom.quickPresetsChips) {
        dom.quickPresetsChips.querySelectorAll('.btn-preset-chip').forEach(c => {
          c.classList.toggle('active', c.textContent.startsWith(def.code));
        });
      }

      updateBubbleActionButtons(state.defects.has(`${state.activeLocation.side}:${state.activeLocation.locCode}`));
      soundFx.beep(900, 0.04);
    });

    frag.appendChild(item);
  });

  dom.bubbleReasonsList.appendChild(frag);
}

function updateBubbleActionButtons(hasExistingDefect) {
  if (dom.btnBubbleConfirm) {
    dom.btnBubbleConfirm.disabled = !state.selectedDefectCode;
  }
  if (dom.btnBubbleDelete) {
    dom.btnBubbleDelete.style.display = hasExistingDefect ? 'inline-flex' : 'none';
  }
}

function positionBubble(targetEl) {
  const bubble = dom.cellComicBubble;
  if (!bubble || !targetEl) return;

  bubble.style.display = 'flex';
  const rect = targetEl.getBoundingClientRect();
  const bubbleWidth = bubble.offsetWidth || 320;
  const bubbleHeight = bubble.offsetHeight || 380;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.right + 12;
  let top = rect.top + (rect.height / 2) - (bubbleHeight / 2);

  // If overflows right, place to left of target
  if (left + bubbleWidth > viewportWidth - 16) {
    left = rect.left - bubbleWidth - 12;
  }
  // Clamp inside horizontal viewport
  if (left < 16) left = 16;
  if (left + bubbleWidth > viewportWidth - 16) {
    left = viewportWidth - bubbleWidth - 16;
  }

  // Clamp vertical
  if (top < 16) top = 16;
  if (top + bubbleHeight > viewportHeight - 16) {
    top = viewportHeight - bubbleHeight - 16;
  }

  bubble.style.position = 'fixed';
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function closeBubble() {
  if (dom.cellComicBubble) {
    dom.cellComicBubble.style.display = 'none';
  }
  state.activeLocation = null;
  state.selectedDefectCode = null;
}

/**
 * Record & Persist Defect
 */
function recordDefect(locCode, side, defectCode, notes, locType) {
  const catalogEntry = DEFECT_CATALOG[defectCode];
  if (!catalogEntry) return;

  const defKey = `${side}:${locCode}`;
  const defectItem = {
    coord: locCode,
    side: side,
    locationType: locType,
    defectCode: defectCode,
    defectName: catalogEntry.name,
    category: catalogEntry.category,
    rawGrades: catalogEntry.rawGrades,
    allowedGrades: catalogEntry.allowedGrades || ['A', 'B', 'R', 'X'],
    notes: (notes || '').trim(),
    timestamp: new Date().toLocaleTimeString(),
    operatorName: (state.currentOperator && state.currentOperator.name) || 'Inspector'
  };

  state.defects.set(defKey, defectItem);
  state.moduleReadyForImmediateLoad = false;

  updateSummaryAndHistory();
  renderDefectPins();
  recomputeAllowedGrades();

  // Instant DB sync
  persistDefectToDatabase(defectItem);

  showToast(`Logged [${defectCode} - ${catalogEntry.name}] at ${side.toUpperCase()} ${locCode}`, 'success');
  soundFx.beep(950, 0.08);
}

function removeDefect(locCode, side) {
  const defKey = `${side}:${locCode}`;
  if (state.defects.has(defKey)) {
    state.defects.delete(defKey);
    updateSummaryAndHistory();
    renderDefectPins();
    recomputeAllowedGrades();

    // Sync deletion to backend
    deleteDefectFromDatabase(locCode, side);

    showToast(`Removed defect from ${side.toUpperCase()} ${locCode}`, 'info');
    soundFx.beep(350, 0.08);
  }
}

/**
 * Persist Defect to Database (POST /api/defects)
 */
function persistDefectToDatabase(defect) {
  const payload = {
    station: state.stationMode,
    module_id: (state.moduleId || '').slice(0, 16),
    defect_location: defect.coord,
    defect_cell: defect.coord,
    defect_code: defect.defectCode,
    defect_type: defect.defectName.slice(0, 30),
    defect_name: defect.defectName,
    side: defect.side || 'front',
    tester_name: (state.currentOperator && state.currentOperator.name) || 'Inspector',
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

function deleteDefectFromDatabase(locCode, side) {
  fetch(`${config.apiBaseUrl}/api/defects/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      station: state.stationMode,
      module_id: state.moduleId,
      defect_cell: locCode,
      defect_location: locCode,
      side: side
    })
  }).catch(() => { });
}

/**
 * Render Defect Pins on Stages & Frame Bars
 */
function renderDefectPins() {
  // Clear all pin containers and has-defect classes
  stagePinSlotsMap.forEach((slot, key) => {
    slot.innerHTML = '';
  });
  document.querySelectorAll('.has-defect').forEach(el => el.classList.remove('has-defect'));

  state.defects.forEach((defect, defKey) => {
    const slot = stagePinSlotsMap.get(defKey);
    if (slot) {
      const pin = document.createElement('span');
      pin.className = 'defect-marker';
      pin.textContent = defect.defectCode;
      pin.title = `${defect.side.toUpperCase()} ${defect.coord}: [${defect.defectCode}] ${defect.defectName}`;
      slot.appendChild(pin);
    }

    // Add has-defect class to parent interactive target
    const [side, loc] = defKey.split(':');
    const target = document.querySelector(`[data-side="${side}"][data-loc="${loc}"]`) ||
      document.querySelector(`[data-side="${side}"][data-coord="${loc}"]`);
    if (target) {
      target.classList.add('has-defect');
    }
  });
}

/**
 * Update Logged Defects Strip & Summary
 */
function updateSummaryAndHistory() {
  const count = state.defects.size;
  if (dom.historyBadgeCount) dom.historyBadgeCount.textContent = count;
  if (dom.summaryModuleId) dom.summaryModuleId.textContent = state.moduleId || 'Pending Serial';

  if (!dom.historyTbody) return;
  dom.historyTbody.innerHTML = '';

  if (count === 0) {
    if (dom.emptyHistoryState) dom.emptyHistoryState.style.display = 'flex';
    if (dom.whiteboardNotationPreview) dom.whiteboardNotationPreview.textContent = '(None)';
    return;
  }

  if (dom.emptyHistoryState) dom.emptyHistoryState.style.display = 'none';

  const frag = document.createDocumentFragment();
  const notationList = [];

  state.defects.forEach((defect, defKey) => {
    const sideText = (defect.side || 'front').toUpperCase();
    const locDisplay = defect.coord === 'FRM' ? 'FRAME' : defect.coord;
    notationList.push(`${locDisplay} ${defect.defectCode}(${sideText[0]})`);

    const tr = document.createElement('tr');
    tr.className = 'history-row';
    const notesStr = defect.notes ? ` (${defect.notes})` : '';
    tr.title = `${sideText} ${locDisplay}: [${defect.defectCode}] ${defect.defectName}${notesStr} - Click to edit`;

    tr.innerHTML = `
      <td><span class="cell-pill">${locDisplay}</span></td>
      <td><span class="side-pill side-${defect.side}">${sideText}</span></td>
      <td><span class="code-pill" title="${escapeHtml(defect.defectName)}${escapeHtml(notesStr)}">${defect.defectCode}</span></td>
      <td style="text-align: right;">
        <button type="button" class="btn-delete-row" data-delete-key="${defKey}" title="Delete defect">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </td>
    `;

    // Row click: open bubble
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-row')) return;
      const target = document.querySelector(`[data-side="${defect.side}"][data-loc="${defect.coord}"]`) ||
        document.querySelector(`[data-side="${defect.side}"][data-coord="${defect.coord}"]`) ||
        (defect.coord.startsWith('FRM') ? document.querySelector(`.uniform-frame-zone[data-side="${defect.side}"]`) : null);
      if (target) {
        openComicBubble(defect.coord, defect.side, defect.locationType, target);
      }
    });

    frag.appendChild(tr);
  });

  dom.historyTbody.appendChild(frag);
  if (dom.whiteboardNotationPreview) {
    dom.whiteboardNotationPreview.textContent = notationList.join('; ');
  }
}

/**
 * Recompute Allowed Grades — all grades (A, B, R, X) remain selectable regardless of defects
 */
function recomputeAllowedGrades() {
  const allowed = ['A', 'B', 'R', 'X'];
  state.allowedGrades = allowed;

  dom.gradeButtons.forEach(btn => {
    btn.classList.remove('disabled');
    btn.setAttribute('aria-disabled', 'false');
  });
}

/**
 * Grade Selection
 */
function setGrade(gradeLetter) {
  state.grade = gradeLetter;
  state.moduleReadyForImmediateLoad = false;
  dom.gradeButtons.forEach(btn => {
    const isSelected = btn.dataset.grade === gradeLetter;
    btn.classList.toggle('selected', isSelected);
    btn.setAttribute('aria-checked', isSelected);
  });

  if (dom.summaryGradeBadge) {
    const map = { A: 'PRIME', B: 'SECONDARY', R: 'RETEST/REWORK', X: 'REJECT' };
    dom.summaryGradeBadge.textContent = `[${gradeLetter}] ${map[gradeLetter] || ''}`;
    dom.summaryGradeBadge.className = `strip-grade-preview gh-grade-${gradeLetter.toLowerCase()}`;
  }

  soundFx.beep(750, 0.05);
}

function resetGrade() {
  state.grade = null;
  dom.gradeButtons.forEach(b => {
    b.classList.remove('selected');
    b.setAttribute('aria-checked', 'false');
  });
  if (dom.summaryGradeBadge) {
    dom.summaryGradeBadge.textContent = 'Pending Selection';
    dom.summaryGradeBadge.className = 'strip-grade-preview';
  }
}

/**
 * Submit Grade flow: Validates operator, serial, grade, defects criteria,
 * then opens the Serial Verification Popup before sending to database.
 */
function submitGrade() {
  if (!state.currentOperator) {
    showToast('Please sign in as operator before submitting grade', 'error');
    openLoginModal();
    soundFx.beep(300, 0.1);
    return;
  }

  const cleanMod = (state.moduleId || '').trim().toUpperCase();
  if (!cleanMod || cleanMod.length !== 16 || !cleanMod.startsWith('USM')) {
    showToast('Valid 16-character Module Serial required (e.g. USM0112208260078)', 'error');
    if (dom.moduleIdInput) {
      dom.moduleIdInput.focus();
      dom.moduleIdInput.select();
    }
    soundFx.beep(300, 0.1);
    return;
  }

  if (!state.grade) {
    showToast('Please select a grade [A, B, R, or X] before submitting', 'error');
    soundFx.beep(300, 0.1);
    return;
  }

  // If manually scanned or already physically verified, skip verification popup and submit immediately
  if (state.isManualScan || state.isSerialVerified) {
    executeInspectionSubmission();
  } else {
    // Conveyor MQTT / auto-fetched arrival: open verification popup before sending to database
    openSerialVerifyModal('SUBMIT');
  }
}

/**
 * Background Data Pre-Fetching for Conveyor Modules
 */
function prefetchModuleData(serial) {
  if (!serial || !serial.startsWith('USM')) return;
  const cleanMod = serial.trim().toUpperCase().slice(0, 16);
  if (state.prefetchedCache.has(cleanMod)) return;

  const entry = { telemetry: null, defects: null, prefetchedAt: Date.now() };
  state.prefetchedCache.set(cleanMod, entry);
  const stParam = `station=${encodeURIComponent(state.stationMode)}`;

  fetch(`${config.apiBaseUrl}/api/telemetry?module_id=${encodeURIComponent(cleanMod)}&${stParam}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) entry.telemetry = data;
    })
    .catch(() => { });

  fetch(`${config.apiBaseUrl}/api/defects?module_id=${encodeURIComponent(cleanMod)}&${stParam}`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data) entry.defects = data;
    })
    .catch(() => { });
}

/**
 * Update Conveyor Channel Display Pill
 */
function updateQueueDisplay() {
  if (!dom.mqttQueuePill) return;
  const activeChan = state.stationMode === 'postlam' ? 'POST-LAM' : (state.activeChannel || 'CH88');

  if (dom.queueChannelBadge) {
    dom.queueChannelBadge.textContent = activeChan;
    dom.queueChannelBadge.className = `queue-channel-badge chan-${activeChan.toLowerCase()}`;
  }
}

/**
 * Handle Real-Time MQTT Panel Serial Updates (CH88)
 */
function handleIncomingMqttSerial(serial, channel) {
  if (state.stationMode === 'postlam') return;
  if (!serial) return;
  if (channel && channel.toUpperCase() !== 'CH88' && channel.toUpperCase() !== 'MQTT') return;

  const cleanSerial = serial.trim().toUpperCase().slice(0, 16);
  if (cleanSerial.length !== 16 || !cleanSerial.startsWith('USM')) return;

  // Deduplicate against state.lastSeenChannelSerial['CH88']
  if (state.lastSeenChannelSerial['CH88'] === cleanSerial) {
    return;
  }

  // Deduplicate against module that was just graded in the last 15 seconds
  if (state.recentlyGradedModule === cleanSerial && (Date.now() - (state.recentlyGradedAt || 0)) < 15000) {
    return;
  }

  // Do not overwrite an in-progress inspection if the inspector has already logged defects or selected a grade
  if (state.moduleId && (state.defects.size > 0 || state.grade)) {
    return;
  }

  state.lastSeenChannelSerial['CH88'] = cleanSerial;

  // Background pre-fetch database and FTP telemetry & defects
  prefetchModuleData(cleanSerial);

  // Load directly onto the screen
  loadModule(cleanSerial, 'CH88', false);
  showToast(`Conveyor [CH88]: Loaded ${cleanSerial}`, 'info');
}

/**
 * Open Serial Number Verification Modal
 */
function openSerialVerifyModal(mode = 'ARRIVAL') {
  state.verifyModalMode = mode || 'ARRIVAL';
  state.isSubmittingVerify = false;

  if (!dom.serialVerifyModal) {
    if (state.verifyModalMode === 'SUBMIT') {
      executeInspectionSubmission();
    } else {
      state.isSerialVerified = true;
    }
    return;
  }

  if (dom.verifyModalSerial) {
    dom.verifyModalSerial.textContent = state.moduleId || '--';
  }

  // Reset physical barcode scanner verification state
  if (dom.verifyBarcodeInput) {
    dom.verifyBarcodeInput.value = '';
  }
  if (dom.verifyScanStatus) {
    dom.verifyScanStatus.className = 'verify-scan-status';
    dom.verifyScanStatus.textContent = '';
    dom.verifyScanStatus.style.display = 'none';
  }
  if (dom.btnVerifySwitchScanned) {
    dom.btnVerifySwitchScanned.style.display = 'none';
  }

  dom.serialVerifyModal.classList.add('open');

  // Auto-focus physical barcode input for instant scan verification
  setTimeout(() => {
    if (dom.verifyBarcodeInput) {
      dom.verifyBarcodeInput.focus();
    } else if (dom.btnVerifyConfirm) {
      dom.btnVerifyConfirm.focus();
    }
  }, 60);

  soundFx.beep(820, 0.05);
}

/**
 * Confirm Serial Number Verification
 */
function confirmSerialVerification() {
  state.isSerialVerified = true;
  const mode = state.verifyModalMode;
  closeSerialVerifyModal(false);
  if (mode === 'SUBMIT') {
    executeInspectionSubmission();
  } else {
    showToast(`Serial verified: ${state.moduleId}`, 'success');
  }
}

/**
 * Close Serial Number Verification Modal
 */
function closeSerialVerifyModal(refocusScanner = false) {
  if (dom.serialVerifyModal) {
    dom.serialVerifyModal.classList.remove('open');
  }
  if (dom.verifyBarcodeInput) {
    dom.verifyBarcodeInput.value = '';
  }
  if (refocusScanner && dom.moduleIdInput) {
    dom.moduleIdInput.focus();
    dom.moduleIdInput.select();
  }
}

/**
 * Handle Barcode Scanner / Enter Verification in Modal
 */
function handleBarcodeVerification(isEnterKey = false) {
  if (!dom.verifyBarcodeInput) return;
  const scanned = dom.verifyBarcodeInput.value.trim().toUpperCase();
  const expected = (state.moduleId || '').trim().toUpperCase();

  // If input is empty and Enter was pressed, acts as clicking "Yes, Matches"
  if (isEnterKey && !scanned) {
    confirmSerialVerification();
    return;
  }

  if (!scanned) {
    if (dom.verifyScanStatus) {
      dom.verifyScanStatus.className = 'verify-scan-status';
      dom.verifyScanStatus.textContent = '';
      dom.verifyScanStatus.style.display = 'none';
    }
    if (dom.btnVerifySwitchScanned) dom.btnVerifySwitchScanned.style.display = 'none';
    return;
  }

  // Case A: Exact Match
  if (scanned === expected) {
    if (state.isSubmittingVerify) return;
    state.isSubmittingVerify = true;
    state.isSerialVerified = true;
    if (dom.verifyScanStatus) {
      dom.verifyScanStatus.style.display = 'block';
      dom.verifyScanStatus.className = 'verify-scan-status match';
      dom.verifyScanStatus.textContent = '✓ Barcode matched';
    }
    if (dom.btnVerifySwitchScanned) dom.btnVerifySwitchScanned.style.display = 'none';
    soundFx.beep(950, 0.12);
    setTimeout(() => {
      confirmSerialVerification();
    }, 120);
    return;
  }

  // Case B: Mismatch
  if (scanned.length >= 16 || isEnterKey) {
    if (dom.verifyScanStatus) {
      dom.verifyScanStatus.style.display = 'block';
      dom.verifyScanStatus.className = 'verify-scan-status mismatch';
      dom.verifyScanStatus.textContent = `Mismatch: scanned ${scanned}`;
    }
    soundFx.beep(250, 0.18, 'sawtooth');
    dom.verifyBarcodeInput.select();

    if (dom.btnVerifySwitchScanned) {
      dom.btnVerifySwitchScanned.style.display = 'inline-block';
      dom.btnVerifySwitchScanned.textContent = `Use ${scanned}`;
      dom.btnVerifySwitchScanned.onclick = () => {
        const wasSubmit = state.verifyModalMode === 'SUBMIT';
        closeSerialVerifyModal(false);
        loadModule(scanned, 'SCANNER');
        showToast(`Switched active module to scanned serial: ${scanned}`, 'info');
        if (wasSubmit && state.grade) {
          executeInspectionSubmission();
        }
      };
    }
  }
}

/**
 * Execute Actual Inspection Submission (POST /api/inspections)
 */
function executeInspectionSubmission() {
  if (state.isRequestInFlight) {
    return;
  }
  state.isRequestInFlight = true;
  state.isSubmittingVerify = true;
  closeSerialVerifyModal(false);

  if (dom.btnSaveInspection) {
    dom.btnSaveInspection.disabled = true;
  }

  const currentMod = state.moduleId;
  const currentGrade = state.grade;

  const payload = {
    station: state.stationMode,
    module_id: currentMod,
    grade: currentGrade,
    tester_name: (state.currentOperator && state.currentOperator.name) || 'Inspector',
    defect_count: state.defects.size
  };

  fetch(`${config.apiBaseUrl}/api/inspections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': state.authToken ? `Bearer ${state.authToken}` : ''
    },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      state.recentlyGradedModule = currentMod;
      state.recentlyGradedAt = Date.now();
      showToast(`Module ${currentMod} graded as [${currentGrade}] successfully`, 'success');
      soundFx.beep(950, 0.12);

      // Reset for next module
      resetModuleAfterSubmit();
      fetchGradingHistory();
    })
    .catch(() => {
      state.recentlyGradedModule = currentMod;
      state.recentlyGradedAt = Date.now();
      showToast(`Grade submitted locally (offline mode)`, 'info');
      resetModuleAfterSubmit();
      fetchGradingHistory();
    });
}

function resetModuleAfterSubmit() {
  state.defects.clear();
  renderDefectPins();
  resetGrade();
  recomputeAllowedGrades();
  updateSummaryAndHistory();

  // Re-enable inspection submit button
  if (dom.btnSaveInspection) {
    dom.btnSaveInspection.disabled = false;
  }

  // Reset station for next scan or arrival
  state.moduleId = '';
  state.activeChannel = state.stationMode === 'postlam' ? 'POST-LAM' : 'CH88';
  state.isManualScan = false;
  state.isSerialVerified = false;
  state.isSubmittingVerify = false;
  state.isRequestInFlight = false;
  state.moduleReadyForImmediateLoad = true;
  if (dom.moduleIdInput) {
    dom.moduleIdInput.value = '';
    dom.moduleIdInput.focus();
  }
  if (dom.summaryModuleId) {
    dom.summaryModuleId.textContent = state.stationMode === 'postlam'
      ? 'Scan Barcode for Post-Lam...'
      : 'Scan Barcode or Waiting for CH88...';
  }
  updateQueueDisplay();
  updatePostLamElImage(null);
}

/**
 * Load Module Serial & Defects
 */
function loadModule(serial, channel = 'MANUAL', loadHistoryDefects = false) {
  if (!serial) return;
  const cleanMod = serial.trim().toUpperCase().slice(0, 16);
  state.moduleId = cleanMod;
  state.activeChannel = channel || 'MANUAL';
  state.isManualScan = (state.activeChannel === 'MANUAL' || state.activeChannel === 'SCANNER');
  state.isSerialVerified = state.isManualScan;
  state.isSubmittingVerify = false;
  state.isRequestInFlight = false;
  state.moduleReadyForImmediateLoad = false;

  // Always start newly loaded module with 0 defects & reset grade
  state.defects.clear();
  resetGrade();
  recomputeAllowedGrades();
  updateSummaryAndHistory();
  renderDefectPins();

  if (dom.moduleIdInput) {
    dom.moduleIdInput.value = cleanMod;
    if (!state.isManualScan) {
      dom.moduleIdInput.blur();
    }
  }
  if (dom.summaryModuleId) dom.summaryModuleId.textContent = cleanMod;

  updateQueueDisplay();

  // Update embedded EL1 viewer in Post-Lam tablet mode
  updatePostLamElImage(cleanMod);

  // Broadcast to Screen 2
  broadcastModuleChange(cleanMod);

  // Only load previous defects when explicitly requested (e.g. reviewing historical inspection)
  if (loadHistoryDefects === true) {
    const cached = state.prefetchedCache.get(cleanMod);
    if (cached && cached.defects) {
      applyDefectsData(cached.defects);
    } else {
      fetchModuleDefects(cleanMod);
    }
  }

  // Trigger serial verification immediately when auto-populated via MQTT
  if (!state.isManualScan && (state.activeChannel === 'CH88' || state.activeChannel === 'MQTT')) {
    const loginOpen = dom.loginModal && dom.loginModal.classList.contains('open');
    if (!loginOpen) {
      openSerialVerifyModal('ARRIVAL');
    }
  }
}

/**
 * Fetch Module Defects from Server
 */
function fetchModuleDefects(moduleId) {
  if (!moduleId) return;

  fetch(`${config.apiBaseUrl}/api/defects?module_id=${encodeURIComponent(moduleId)}&station=${encodeURIComponent(state.stationMode)}`)
    .then(res => res.json())
    .then(data => {
      const entry = state.prefetchedCache.get(moduleId) || {};
      entry.defects = data;
      state.prefetchedCache.set(moduleId, entry);
      applyDefectsData(data);
    })
    .catch(() => { });
}

function applyDefectsData(data) {
  const defectsList = (data && data.defects) || [];
  state.defects.clear();

  defectsList.forEach(d => {
    const coord = d.defect_location || d.defect_cell || d.cell_coord || '';
    if (!coord) return;
    const side = (d.side || 'front').toLowerCase();
    const code = d.defect_code || 'G1';
    const preset = DEFECT_CATALOG[code] || {
      code: code,
      name: d.defect_type || 'Defect',
      side: side,
      category: 'Visual',
      rawGrades: 'A,B,R',
      allowedGrades: ['A', 'B', 'X']
    };

    let locType = 'front_cell';
    if (coord === 'BBAR') locType = 'front_busbar';
    else if (['JBX1', 'JBX2', 'JBX3'].includes(coord)) locType = 'back_jbox';
    else if (['FRM', 'FRAME', 'FRMT', 'FRMB', 'FRML', 'FRMR'].includes(coord)) locType = `${side}_frame`;
    else if (side === 'back') locType = 'back_cell';

    const defectItem = {
      coord: coord,
      side: side,
      locationType: locType,
      defectCode: preset.code,
      defectName: preset.name,
      category: preset.category || 'Visual',
      rawGrades: preset.rawGrades || 'A,B,R',
      allowedGrades: preset.allowedGrades || ['A', 'B', 'X'],
      notes: d.notes || '',
      timestamp: d.tested_at ? formatTimeShort(d.tested_at) : new Date().toLocaleTimeString(),
      operatorName: d.tester_name || 'Inspector'
    };

    state.defects.set(`${side}:${coord}`, defectItem);
  });

  updateSummaryAndHistory();
  renderDefectPins();
  recomputeAllowedGrades();
}

/**
 * Fetch & Render Grading History (Console quick view; full history is on /database.html)
 */
function fetchGradingHistory() {
  fetch(`${config.apiBaseUrl}/api/inspections?limit=50&station=${encodeURIComponent(state.stationMode)}`)
    .then(res => res.json())
    .then(data => {
      const records = data.records || data.inspection || [];
      renderGradingHistory(records);
    })
    .catch(() => { });
}

function renderGradingHistory(records) {
  if (!dom.gradingHistoryTbody) return;

  const count = (records && records.length) || 0;
  if (dom.gradingHistoryBadge) dom.gradingHistoryBadge.textContent = count;
  dom.gradingHistoryTbody.innerHTML = '';

  if (count === 0) {
    if (dom.emptyGradingHistoryState) dom.emptyGradingHistoryState.style.display = 'flex';
    return;
  }

  if (dom.emptyGradingHistoryState) dom.emptyGradingHistoryState.style.display = 'none';

  const frag = document.createDocumentFragment();

  records.forEach(rec => {
    const tr = document.createElement('tr');
    tr.className = 'grading-history-row';
    const serial = rec.module_id || 'UNKNOWN';
    const timeFormatted = formatTimeShort(rec.tested_at);
    const gradeLetter = String(rec.grade || rec.result_code || '?').toUpperCase();
    const tester = rec.tester_name || 'Inspector';
    const defects = rec.defect_count ? `${rec.defect_count} defect(s)` : 'No defects';

    tr.title = `Module: ${serial}\nGrade: [${gradeLetter}]\nTested: ${rec.tested_at || 'Recently'}\nOperator: ${tester}\nClick to load module & defects`;

    tr.innerHTML = `
      <td class="gh-time">${escapeHtml(timeFormatted)}</td>
      <td><span class="gh-serial">${escapeHtml(serial)}</span></td>
      <td style="text-align: center;">
        <span class="gh-grade-pill gh-grade-${gradeLetter.toLowerCase()}">${escapeHtml(gradeLetter)}</span>
      </td>
      <td class="gh-operator">${escapeHtml(tester)}</td>
      <td class="gh-defects">${escapeHtml(defects)}</td>
    `;

    // Click row: loads that module's serial and defects
    tr.addEventListener('click', () => {
      loadModule(serial, 'HISTORY', true);
      showToast(`Loaded module ${serial} from history`, 'info');
      soundFx.beep(700, 0.05);
    });

    frag.appendChild(tr);
  });

  dom.gradingHistoryTbody.appendChild(frag);
}

/**
 * Event Listeners & Hardware Stream
 */
function attachEventListeners() {
  // Barcode Scanner Input
  if (dom.moduleIdInput) {
    const handleScannerInput = () => {
      const val = dom.moduleIdInput.value.trim().toUpperCase().slice(0, 16);
      if (val.length === 16 && val.startsWith('USM')) {
        if (val !== state.moduleId) {
          loadModule(val, 'MANUAL', false);
          dom.moduleIdInput.blur();
          showToast(`Manually scanned module: ${val}`, 'success');
          soundFx.beep(800, 0.06);
        }
      }
      // When val.length < 16: DO NOT modify state.moduleId, DO NOT call broadcastModuleChange(val),
      // and DO NOT reset the active module! Simply let the user finish typing/scanning until it reaches 16 characters.
    };

    dom.moduleIdInput.addEventListener('input', handleScannerInput);
    dom.moduleIdInput.addEventListener('paste', () => {
      setTimeout(handleScannerInput, 10);
    });

    dom.moduleIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = dom.moduleIdInput.value.trim().toUpperCase().slice(0, 16);
        if (val.length === 16 && val.startsWith('USM')) {
          if (val === state.moduleId && !state.isManualScan) {
            dom.moduleIdInput.blur();
            if (state.grade) {
              submitGrade();
            }
          } else {
            loadModule(val, 'MANUAL', false);
            dom.moduleIdInput.blur();
            showToast(`Manually scanned module: ${val}`, 'success');
            soundFx.beep(800, 0.06);
          }
        } else {
          showToast('Serial number must be 16 characters starting with USM', 'error');
        }
      }
    });
  }

  // Operator Sign In Button
  if (dom.btnOperatorProfile) {
    dom.btnOperatorProfile.addEventListener('click', () => {
      openLoginModal();
    });
  }

  // Segmented Grade Buttons
  dom.gradeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setGrade(btn.dataset.grade);
    });
  });

  // Submit Grade Button
  if (dom.btnSaveInspection) {
    dom.btnSaveInspection.addEventListener('click', () => {
      submitGrade();
    });
  }

  // Clear All Defects Button
  if (dom.btnClearHistory) {
    dom.btnClearHistory.addEventListener('click', () => {
      if (state.defects.size === 0) return;
      state.defects.forEach((d, k) => {
        deleteDefectFromDatabase(d.coord, d.side);
      });
      state.defects.clear();
      renderDefectPins();
      updateSummaryAndHistory();
      recomputeAllowedGrades();
      showToast('Cleared all tagged defects on current module', 'info');
      soundFx.beep(350, 0.08);
    });
  }

  // Table row defect deletion event delegation
  if (dom.historyTbody) {
    dom.historyTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-delete-row');
      if (btn) {
        e.stopPropagation();
        const key = btn.dataset.deleteKey;
        if (key && state.defects.has(key)) {
          const d = state.defects.get(key);
          removeDefect(d.coord, d.side);
        }
      }
    });
  }

  // Refresh Grading History Button
  if (dom.btnRefreshGradingHistory) {
    dom.btnRefreshGradingHistory.addEventListener('click', () => {
      fetchGradingHistory();
      showToast('Refreshed grading history', 'info');
      soundFx.beep(600, 0.04);
    });
  }

  // Fullscreen Toggle Button
  const syncFullscreenButton = () => {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (dom.btnFullscreen) {
      dom.btnFullscreen.setAttribute('aria-pressed', isFs ? 'true' : 'false');
    }
    if (dom.btnFullscreenLabel) {
      dom.btnFullscreenLabel.textContent = isFs ? 'Exit Full' : 'Fullscreen';
    }
  };
  if (dom.btnFullscreen) {
    dom.btnFullscreen.addEventListener('click', async () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      try {
        if (!isFs) {
          const el = document.documentElement;
          if (el.requestFullscreen) await el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } else {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      } catch (e) {
        showToast('Fullscreen not supported by this browser', 'warning');
      }
      syncFullscreenButton();
    });
    document.addEventListener('fullscreenchange', syncFullscreenButton);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButton);
  }

  // Camera Barcode Scanner
  let cameraStream = null;
  let cameraScanTimer = null;

  const closeCameraScanner = () => {
    if (cameraScanTimer) {
      clearTimeout(cameraScanTimer);
      cameraScanTimer = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => {
        try { t.stop(); } catch (e) { }
      });
      cameraStream = null;
    }
    if (dom.cameraScanVideo) {
      dom.cameraScanVideo.srcObject = null;
    }
    if (dom.cameraScannerModal) {
      dom.cameraScannerModal.classList.remove('open');
    }
  };

  const openCameraScanner = async () => {
    if (!dom.cameraScannerModal || !dom.cameraScanVideo) return;
    dom.cameraScannerModal.classList.add('open');
    if (dom.cameraScanStatus) {
      dom.cameraScanStatus.textContent = 'Starting rear camera...';
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (dom.cameraScanStatus) {
        dom.cameraScanStatus.textContent = 'Camera requires HTTPS (use the Cloudflare tunnel URL or localhost).';
      }
      return;
    }

    if (typeof window.BarcodeDetector === 'undefined') {
      if (dom.cameraScanStatus) {
        dom.cameraScanStatus.textContent = 'Camera barcode detection requires Chrome/Edge on Android.';
      }
      return;
    }

    let detector = null;
    try {
      detector = new window.BarcodeDetector({
        formats: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13', 'itf']
      });
    } catch (e) {
      detector = new window.BarcodeDetector();
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      dom.cameraScanVideo.srcObject = cameraStream;
      await dom.cameraScanVideo.play();
      if (dom.cameraScanStatus) {
        dom.cameraScanStatus.textContent = 'Point camera at module barcode (USM...)';
      }

      const scanFrame = async () => {
        if (!cameraStream || !dom.cameraScannerModal.classList.contains('open')) return;
        try {
          if (dom.cameraScanVideo.readyState >= 2) {
            const barcodes = await detector.detect(dom.cameraScanVideo);
            for (const b of barcodes) {
              const raw = String(b.rawValue || '').trim().toUpperCase();
              const match = raw.match(/USM[A-Z0-9]{13}/);
              const candidate = match ? match[0] : (raw.length === 16 && raw.startsWith('USM') ? raw : '');
              if (candidate) {
                closeCameraScanner();
                if (dom.moduleIdInput) dom.moduleIdInput.value = candidate;
                if (candidate !== state.moduleId) {
                  loadModule(candidate, 'MANUAL', false);
                }
                showToast(`Scanned module: ${candidate}`, 'success');
                soundFx.beep(950, 0.08);
                return;
              }
            }
          }
        } catch (e) { }
        cameraScanTimer = setTimeout(scanFrame, 120);
      };
      cameraScanTimer = setTimeout(scanFrame, 150);
    } catch (err) {
      if (dom.cameraScanStatus) {
        const isSec = err && (err.name === 'SecurityError' || err.name === 'NotAllowedError');
        dom.cameraScanStatus.textContent = isSec
          ? 'Camera blocked or requires HTTPS. Allow camera permission or open via HTTPS.'
          : `Camera error: ${(err && err.message) || 'Unavailable'}`;
      }
    }
  };

  if (dom.btnCameraScan) {
    dom.btnCameraScan.addEventListener('click', openCameraScanner);
  }
  if (dom.btnCloseCameraModal) {
    dom.btnCloseCameraModal.addEventListener('click', closeCameraScanner);
  }
  if (dom.btnCancelCameraScan) {
    dom.btnCancelCameraScan.addEventListener('click', closeCameraScanner);
  }
  if (dom.cameraScannerModal) {
    dom.cameraScannerModal.addEventListener('click', (e) => {
      if (e.target === dom.cameraScannerModal) closeCameraScanner();
    });
  }

  // Bubble Close Button
  if (dom.btnBubbleClose) {
    dom.btnBubbleClose.addEventListener('click', closeBubble);
  }

  // Bubble Confirm Button
  if (dom.btnBubbleConfirm) {
    dom.btnBubbleConfirm.addEventListener('click', () => {
      if (state.activeLocation && state.selectedDefectCode) {
        const { locCode, side, locType } = state.activeLocation;
        const notes = dom.bubbleNotesInput ? dom.bubbleNotesInput.value : '';
        recordDefect(locCode, side, state.selectedDefectCode, notes, locType);
        closeBubble();
      }
    });
  }

  // Bubble Delete Button
  if (dom.btnBubbleDelete) {
    dom.btnBubbleDelete.addEventListener('click', () => {
      if (state.activeLocation) {
        const { locCode, side } = state.activeLocation;
        removeDefect(locCode, side);
        closeBubble();
      }
    });
  }

  // Bubble Search Field
  if (dom.bubbleSearchInput) {
    dom.bubbleSearchInput.addEventListener('input', () => {
      const val = dom.bubbleSearchInput.value;
      if (dom.btnClearSearch) dom.btnClearSearch.style.display = val ? 'block' : 'none';
      renderReasonsList();
    });
  }

  if (dom.btnClearSearch) {
    dom.btnClearSearch.addEventListener('click', () => {
      dom.bubbleSearchInput.value = '';
      dom.btnClearSearch.style.display = 'none';
      renderReasonsList();
    });
  }

  // Hardware Simulator Trigger Pill
  if (dom.pillSimTrigger) {
    dom.pillSimTrigger.addEventListener('click', () => {
      if (dom.simulatorModal) dom.simulatorModal.classList.add('open');
    });
  }

  if (dom.btnCloseSimModal) {
    dom.btnCloseSimModal.addEventListener('click', () => {
      if (dom.simulatorModal) dom.simulatorModal.classList.remove('open');
    });
  }

  if (dom.btnTriggerMqttSim) {
    dom.btnTriggerMqttSim.addEventListener('click', () => {
      const p = dom.simPanelInput ? dom.simPanelInput.value.trim().toUpperCase() : '';
      if (p) {
        handleIncomingMqttSerial(p, 'CH88');
        if (dom.simulatorModal) dom.simulatorModal.classList.remove('open');
      }
    });
  }

  document.querySelectorAll('.btn-sim-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.panel;
      if (p) {
        handleIncomingMqttSerial(p, 'CH88');
        if (dom.simulatorModal) dom.simulatorModal.classList.remove('open');
      }
    });
  });

  // CMMS Login Modals
  if (dom.btnCloseLoginModal) {
    dom.btnCloseLoginModal.addEventListener('click', () => {
      if (dom.loginModal) dom.loginModal.classList.remove('open');
      if (state.moduleId && !state.isManualScan && !state.isSerialVerified) {
        openSerialVerifyModal('ARRIVAL');
      } else {
        setTimeout(() => { if (dom.moduleIdInput) dom.moduleIdInput.focus(); }, 80);
      }
    });
  }

  if (dom.loginForm) {
    dom.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = dom.loginUsername ? dom.loginUsername.value.trim() : '';
      if (name) {
        loginCMMS(name);
      }
    });
  }

  if (dom.btnLogoutCmms) {
    dom.btnLogoutCmms.addEventListener('click', logoutCMMS);
  }

  // Serial Verification Modal Actions
  if (dom.btnVerifyConfirm) {
    dom.btnVerifyConfirm.addEventListener('click', () => {
      confirmSerialVerification();
    });
  }

  if (dom.btnVerifyCancel) {
    dom.btnVerifyCancel.addEventListener('click', () => {
      closeSerialVerifyModal(true);
    });
  }

  if (dom.btnCloseVerifyModal) {
    dom.btnCloseVerifyModal.addEventListener('click', () => {
      closeSerialVerifyModal(true);
    });
  }

  // Physical Barcode Scanner verification input listeners
  if (dom.verifyBarcodeInput) {
    dom.verifyBarcodeInput.addEventListener('input', () => {
      handleBarcodeVerification(false);
    });
    dom.verifyBarcodeInput.addEventListener('paste', () => {
      setTimeout(() => handleBarcodeVerification(false), 20);
    });
    dom.verifyBarcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleBarcodeVerification(true);
      }
    });
  }

  // Keyboard Hotkeys
  window.addEventListener('keydown', (e) => {
    // If serial verification modal is open, handle verification keys
    if (dom.serialVerifyModal && dom.serialVerifyModal.classList.contains('open')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSerialVerifyModal(true);
        return;
      }
      if (e.key === 'Enter') {
        if (document.activeElement !== dom.verifyBarcodeInput) {
          e.preventDefault();
          handleBarcodeVerification(true);
          return;
        }
      }
      // If typing printable characters and focus is not inside verify input, redirect focus to verify input
      if (dom.verifyBarcodeInput && document.activeElement !== dom.verifyBarcodeInput && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        dom.verifyBarcodeInput.focus();
      }
      return;
    }

    // Escape closes popover/modals
    if (e.key === 'Escape') {
      closeBubble();
      if (dom.loginModal) dom.loginModal.classList.remove('open');
      if (dom.simulatorModal) dom.simulatorModal.classList.remove('open');
      return;
    }

    // If not focused in any input and 'U' or 'u' is pressed while not in modal/bubble,
    // redirect focus to moduleIdInput for physical barcode scanner key-wedge input
    if ((e.key === 'u' || e.key === 'U') && dom.moduleIdInput && document.activeElement !== dom.moduleIdInput) {
      const verifyModalOpen = dom.serialVerifyModal && dom.serialVerifyModal.classList.contains('open');
      const loginModalOpen = dom.loginModal && dom.loginModal.classList.contains('open');
      const simModalOpen = dom.simulatorModal && dom.simulatorModal.classList.contains('open');
      const bubbleOpen = dom.cellComicBubble && dom.cellComicBubble.style.display !== 'none';
      if (!verifyModalOpen && !loginModalOpen && !simModalOpen && !bubbleOpen) {
        dom.moduleIdInput.focus();
      }
    }

    // Do not trigger hotkeys if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key.toUpperCase();
    if (['A', 'B', 'R', 'X'].includes(key)) {
      setGrade(key);
    } else if (e.key === 'Enter') {
      submitGrade();
    }
  });

  // Global Paste & Rapid Barcode Catcher
  window.addEventListener('paste', (e) => {
    const verifyModalOpen = dom.serialVerifyModal && dom.serialVerifyModal.classList.contains('open');
    const loginModalOpen = dom.loginModal && dom.loginModal.classList.contains('open');
    const simModalOpen = dom.simulatorModal && dom.simulatorModal.classList.contains('open');
    const activeEl = document.activeElement;
    const isNotesFocused = activeEl && (activeEl.id === 'bubble-notes-input' || activeEl.id === 'bubble-search-input');

    if (verifyModalOpen || loginModalOpen || simModalOpen || isNotesFocused) {
      return;
    }

    const pastedText = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const clean = pastedText.trim().toUpperCase().slice(0, 16);
    if (clean.length === 16 && clean.startsWith('USM')) {
      e.preventDefault();
      if (clean === state.moduleId && !state.isManualScan) {
        state.isSerialVerified = true;
        if (dom.moduleIdInput) dom.moduleIdInput.blur();
        showToast(`✓ Verified physical barcode matches active module: ${clean}`, 'success');
        soundFx.beep(950, 0.12);
        return;
      }
      if (dom.moduleIdInput) {
        dom.moduleIdInput.value = clean;
        dom.moduleIdInput.blur();
      }
      loadModule(clean, 'MANUAL', false);
      showToast(`Manually scanned module: ${clean}`, 'success');
      soundFx.beep(800, 0.06);
    }
  });

  // Close bubble if clicked outside
  window.addEventListener('click', (e) => {
    if (dom.cellComicBubble && dom.cellComicBubble.style.display !== 'none') {
      if (!dom.cellComicBubble.contains(e.target) && !e.target.closest('.grid-cell') &&
        !e.target.closest('.uniform-frame-zone') && !e.target.closest('.frame-bar') && !e.target.closest('.center-busbar-zone') &&
        !e.target.closest('.jbox-zone') && !e.target.closest('.history-row')) {
        closeBubble();
      }
    }
  });
}

/**
 * CMMS Authentication Helpers
 */
function openLoginModal(isInitial = false) {
  if (state.currentOperator) {
    if (dom.cmmsLoginFormView) dom.cmmsLoginFormView.style.display = 'none';
    if (dom.cmmsLoggedInView) dom.cmmsLoggedInView.style.display = 'block';
    if (dom.loginDialogTitle) dom.loginDialogTitle.textContent = 'Station Operator Account';
    if (dom.loggedInUserName) dom.loggedInUserName.textContent = state.currentOperator.name;
    if (dom.loggedInUserRole) dom.loggedInUserRole.textContent = state.currentOperator.role || 'Inspector';
    if (dom.loggedInUserDept) dom.loggedInUserDept.textContent = state.currentOperator.department || 'Quality Operations';
  } else {
    if (dom.cmmsLoginFormView) dom.cmmsLoginFormView.style.display = 'block';
    if (dom.cmmsLoggedInView) dom.cmmsLoggedInView.style.display = 'none';
    if (dom.loginDialogTitle) dom.loginDialogTitle.textContent = 'Inspector Login (First Name Last Name)';
    if (dom.loginUsername) dom.loginUsername.value = '';
    setTimeout(() => {
      if (dom.loginUsername) dom.loginUsername.focus();
    }, 120);
  }
  if (dom.loginModal) dom.loginModal.classList.add('open');
}

function loginCMMS(name) {
  state.currentOperator = {
    name: name,
    username: name.toLowerCase().replace(/\s+/g, '.'),
    role: 'Quality Inspector',
    department: state.stationMode === 'postlam' ? 'Post-Lam Visual Inspection' : 'Final Inspection Station 01'
  };
  try {
    localStorage.setItem('fvi_cmms_operator', JSON.stringify(state.currentOperator));
  } catch (e) { }
  updateOperatorDisplay();
  if (dom.loginModal) dom.loginModal.classList.remove('open');
  if (state.moduleId && !state.isManualScan && !state.isSerialVerified) {
    openSerialVerifyModal('ARRIVAL');
  } else {
    setTimeout(() => { if (dom.moduleIdInput) dom.moduleIdInput.focus(); }, 80);
  }
  showToast(`Welcome, ${name}`, 'success');
  soundFx.beep(850, 0.08);
}

function logoutCMMS() {
  state.currentOperator = null;
  state.authToken = null;
  try {
    localStorage.removeItem('fvi_cmms_operator');
    localStorage.removeItem('fvi_cmms_token');
  } catch (e) { }
  updateOperatorDisplay();
  openLoginModal();
  showToast('Signed out of CMMS', 'info');
  soundFx.beep(400, 0.08);
}

function loadOperatorSession() {
  try {
    const saved = localStorage.getItem('fvi_cmms_operator');
    if (saved) {
      state.currentOperator = JSON.parse(saved);
    }
  } catch (e) {
    state.currentOperator = null;
  }
  updateOperatorDisplay();
}

function updateOperatorDisplay() {
  const op = state.currentOperator;
  if (dom.displayOperatorName) {
    dom.displayOperatorName.textContent = op ? op.name : 'Sign In';
  }
  if (dom.operatorInput) {
    dom.operatorInput.value = op ? op.name : '';
  }
  if (dom.btnOperatorProfile) {
    dom.btnOperatorProfile.classList.toggle('needs-login', !op);
  }
}

/**
 * Backend Connectivity & Conveyor SSE
 */
function checkBackendHealth() {
  fetch(`${config.apiBaseUrl}/api/health?station=${encodeURIComponent(state.stationMode)}`)
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
    });
}

function initConveyorEventStream() {
  // Post-Lam inspection sits mid-line and must not be overwritten by downstream FVI CH88 conveyor arrivals
  if (state.stationMode === 'postlam') {
    return;
  }

  const handleEventData = (rawData) => {
    try {
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      if (!data) return;

      // Conveyor channel CH88
      if (data.ch88_serial) {
        handleIncomingMqttSerial(data.ch88_serial, 'CH88');
      }

      // Single panel event (only process if channel is 'CH88')
      const channel = (data.channel || (data.current_panel && data.current_panel.channel) || '').toUpperCase();
      if (channel === 'CH88') {
        const panelId = data.module_id || data.panel_id || (data.current_panel && data.current_panel.panel_id);
        const panelSource = data.source || (data.current_panel && data.current_panel.source) || '';
        if (panelId && panelSource !== 'Initial Baseline') {
          handleIncomingMqttSerial(panelId, 'CH88');
        }
      }
    } catch (e) { }
  };

  if (typeof EventSource !== 'undefined') {
    try {
      const streamUrl = `${config.apiBaseUrl}/api/stream`;
      const sse = new EventSource(streamUrl);

      sse.onmessage = (event) => {
        handleEventData(event.data);
      };

      sse.addEventListener('PANEL_ARRIVED', (event) => {
        handleEventData(event.data);
      });

      sse.onopen = () => {
        state.isMqttConnected = true;
        if (dom.pillMqttStatus) {
          dom.pillMqttStatus.className = 'status-indicator-pill status-live';
        }
      };

      sse.onerror = () => {
        state.isMqttConnected = false;
        if (dom.pillMqttStatus) {
          dom.pillMqttStatus.className = 'status-indicator-pill';
        }
      };
    } catch (e) { }
  }

  // Poll current module and CH88 conveyor status immediately & every 3 seconds
  const pollCurrentConveyor = () => {
    fetch(`${config.apiBaseUrl}/api/module/current`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return;
        if (data.mqtt_connected !== undefined) {
          state.isMqttConnected = !!data.mqtt_connected;
          if (dom.pillMqttStatus) {
            dom.pillMqttStatus.className = state.isMqttConnected
              ? 'status-indicator-pill status-live'
              : 'status-indicator-pill';
          }
        }
        const ch88Mod = data.ch88_serial || (data.channel === 'CH88' ? data.panel_id : null);
        if (ch88Mod) {
          handleIncomingMqttSerial(ch88Mod, 'CH88');
        }
      })
      .catch(() => { });
  };
  pollCurrentConveyor();
  setInterval(pollCurrentConveyor, 3000);
}

/**
 * Utility Helpers
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimeShort(dateStr) {
  if (!dateStr) return '--:--';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }
  } catch (e) { }
  return String(dateStr).slice(11, 19) || String(dateStr).slice(0, 10);
}

function showToast(message, type = 'info') {
  if (!dom.toastContainer) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  dom.toastContainer.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, 2500);
}

// Auto-boot on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
