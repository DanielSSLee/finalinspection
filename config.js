/**
 * FVI Station 01 — Photovoltaic Final Visual Inspection Console
 * Plant Integration & Frontend Interface Configuration
 *
 * NOTE: Backend credentials (Database passwords, FTP credentials, MQTT broker)
 * are stored securely in the server environment (.env) and are never exposed
 * to client-side browser scripts.
 */

const FVI_CONFIG = {
  // Edge Gateway Backend API base URL (empty string "" means relative to this host)
  // When running server.py locally, this connects to http://localhost:8080 or port 5000
  apiBaseUrl: "",

  // 1. Company CMMS Authentication Settings
  cmms: {
    enabled: true,
    systemName: "US Modules CMMS Gateway",
    loginEndpoint: "/api/auth/login",
    sessionEndpoint: "/api/auth/session",
    logoutEndpoint: "/api/auth/logout",
    // Offline / Demo fallback operators if CMMS server is unreachable
    fallbackOperators: [
      { id: "OP-8492", username: "vance.k", name: "Vance Kowalski", role: "QC Lead", shift: "Shift A" },
      { id: "OP-3310", username: "sarah.m", name: "Sarah Miller", role: "Inspector", shift: "Shift A" },
      { id: "OP-5521", username: "carlos.r", name: "Carlos Reyes", role: "Inspector", shift: "Shift B" },
      { id: "OP-9901", username: "admin", name: "Plant Administrator", role: "Quality Engineer", shift: "All Shifts" }
    ]
  },

  // 2. Conveyor MQTT Sensor Stream
  mqtt: {
    enabled: true,
    // When useServerGateway: true, server.py subscribes directly to MQTT and streams to UI via SSE (/api/stream)
    useServerGateway: true,
    brokerWsUrl: "ws://localhost:9001",
    panelTopic: "factory/conveyor/fvi/station1/panel",
    statusTopic: "factory/conveyor/fvi/station1/status",
    reconnectIntervalMs: 5000
  },

  // 3. EL Testing PC Image Acquisition
  // Managed by server.py (/api/module/{panel_id}/el-image) using credentials in .env
  elCamera: {
    filenameFormat: "{panel_id}.jpg", // e.g. "USM-2026-FVI-8492.jpg"
    fetchTimeoutMs: 8000
  },

  // 4. Production Database Configuration (Microsoft SQL Server / PL2)
  // Persistence is handled by server.py (/api/defects and /api/inspections) using credentials in .env
  database: {
    directSyncOnConfirm: true, // Immediately POST defect to DB when 'Confirm' clicked
    database: "PL2",
    defectsEndpoint: "/api/defects",
    inspectionsEndpoint: "/api/inspections",
    offlineQueueStorageKey: "fvi_offline_defect_queue",
    tables: {
      defects: "dbo.Final_Inspection_Defects", // Columns: Record_ID, Module_ID, Tested_At, Defect_Location, Defect_Type, Tester_Name
      inspections: "dbo.Final_Inspections"    // Columns: Record_ID, Module_ID, Tested_At, Grade, Tester_Name
    }
  }
};

// Freeze configuration in browser
if (typeof window !== "undefined") {
  window.FVI_CONFIG = Object.freeze(FVI_CONFIG);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = FVI_CONFIG;
}
