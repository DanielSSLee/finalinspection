/**
 * FVI Station 01 — Monitor 2: High-Resolution Industrial Metrology Console
 * Horizontal (16:9 Landscape) Screen Display Engine
 *
 * Controls:
 * - Single-Module EL Imagery Reference Display with Dynamic FTP & Sample Fallback
 * - SunSim PMax & I-V HTML5 Canvas Graph with MPP Callout & 6 Database KPIs (dbo.IV_Flasher)
 * - Hi-Pot Electrical Safety Results with Pure Database Columns (dbo.Hipot)
 * - Live Dual-Screen Zero-Latency Sync (BroadcastChannel, Storage, Polling)
 */

(function (window) {
  'use strict';

  // Application State
  const state = {
    moduleId: '',
    sunsimData: null,
    hipotData: null,
    hoverV: null,
    canvasMetrics: null
  };

  // Cached DOM Elements
  let dom = {};

  function queryDom() {
    dom = {
      displayModuleId: document.getElementById('display-module-id'),

      // EL Single View Element
      elSingleImg: document.getElementById('el-single-img'),
      elPanelActions: document.getElementById('el-panel-actions'),

      // SunSim Elements (dbo.IV_Flasher)
      pmaxCanvas: document.getElementById('pmax-canvas'),
      canvasContainer: document.getElementById('canvas-container'),
      canvasReadout: document.getElementById('canvas-readout'),
      valSunsimTime: document.getElementById('val-sunsim-time'),
      legendPmaxVal: document.getElementById('legend-pmax-val'),
      valPmax: document.getElementById('val-pmax'),
      valVmp: document.getElementById('val-vmp'),
      valImp: document.getElementById('val-imp'),
      valVoc: document.getElementById('val-voc'),
      valIsc: document.getElementById('val-isc'),
      valFF: document.getElementById('val-ff'),

      // Hi-Pot Elements (dbo.Hipot)
      valHipotStatus: document.getElementById('val-hipot-status'),
      valHipotModule: document.getElementById('val-hipot-module'),
      valHipotTime: document.getElementById('val-hipot-time'),
      valHipotFile: document.getElementById('val-hipot-file')
    };
  }

  // =========================================================================
  // 1. Single Module EL Image Reference Display
  // =========================================================================
  function updateSingleElImage(moduleId, elUrl, fallbackUrl) {
    if (!dom.elSingleImg) return;

    // Deterministic hash from moduleId for stable sample fallback
    let hash = 0;
    const str = String(moduleId || 'USM0112208260078');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const sampleIdx = Math.abs(hash % 4) + 1;
    const defaultFallback = `sample_el_${sampleIdx}.jpg`;
    const finalFallback = fallbackUrl || defaultFallback;

    // Attach graceful fallback handler
    dom.elSingleImg.onerror = function () {
      this.onerror = null;
      this.src = finalFallback;
    };

    const targetSrc = elUrl || (`/api/module/${encodeURIComponent(moduleId)}/el-image?side=front`);
    dom.elSingleImg.src = targetSrc;
  }

  // =========================================================================
  // 2. Interactive HTML5 Canvas PMax & I-V Graph (dbo.IV_Flasher)
  // =========================================================================
  function initPmaxCanvas() {
    if (!dom.pmaxCanvas || !dom.canvasContainer) return;

    // Handle mouse movement for crosshairs & hover readout
    dom.pmaxCanvas.addEventListener('mousemove', (e) => {
      const rect = dom.pmaxCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const metrics = state.canvasMetrics;
      if (!metrics) return;

      const { padL, plotW, maxV } = metrics;
      if (mouseX >= padL && mouseX <= padL + plotW) {
        const normX = (mouseX - padL) / plotW;
        state.hoverV = normX * maxV;
        drawPmaxGraph();
        updateHoverReadout(state.hoverV);
      } else {
        state.hoverV = null;
        drawPmaxGraph();
        hideHoverReadout();
      }
    });

    dom.pmaxCanvas.addEventListener('mouseleave', () => {
      state.hoverV = null;
      drawPmaxGraph();
      hideHoverReadout();
    });

    // Auto-resize using ResizeObserver
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        drawPmaxGraph();
      });
      ro.observe(dom.canvasContainer);
    } else {
      window.addEventListener('resize', () => drawPmaxGraph());
    }
  }

  function getSunsimParam(key, defaultVal) {
    if (!state.sunsimData) return defaultVal;
    const s = state.sunsimData;
    const p = s.parameters || {};

    if (key === 'pmax') return s.pmpp ?? s.Pmpp ?? p.pmax_w ?? s.pmax ?? p.pmax ?? s.Pmax ?? p.Pmax ?? s.PMAX ?? defaultVal;
    if (key === 'voc') return s.voc ?? s.Voc ?? p.voc_v ?? p.voc ?? s.VOC ?? defaultVal;
    if (key === 'isc') return s.isc ?? s.Isc ?? p.isc_a ?? p.isc ?? s.ISC ?? defaultVal;
    if (key === 'vmp') return s.vmpp ?? s.Vmpp ?? p.vmp_v ?? s.vmp ?? p.vmp ?? s.Vmp ?? defaultVal;
    if (key === 'imp') return s.impp ?? s.Impp ?? p.imp_a ?? s.imp ?? p.imp ?? s.Imp ?? defaultVal;
    if (key === 'ff') return s.fill_factor ?? s.Fill_Factor ?? p.fill_factor_pct ?? s.ff ?? p.ff ?? s.FF ?? defaultVal;
    if (key === 'tested_at') return s.tested_at ?? s.Tested_At ?? p.flash_timestamp ?? p.inspection_time ?? defaultVal;

    return p[key] ?? s[key] ?? defaultVal;
  }

  function updateHoverReadout(vVal) {
    if (!dom.canvasReadout) return;
    const voc = Number(getSunsimParam('voc', 50.35));
    const isc = Number(getSunsimParam('isc', 13.56));

    // Calculate curve current & power at this voltage
    const vNorm = Math.min(1.0, Math.max(0.0, vVal / voc));
    const curI = vVal < voc ? Math.max(0, isc * (1.0 - Math.pow(vNorm, 9.6))) : 0;
    const curP = vVal * curI;

    dom.canvasReadout.innerHTML = `<b>${vVal.toFixed(2)} V</b> &nbsp;|&nbsp; <span style="color:#38bdf8;">${curP.toFixed(1)} W</span> &nbsp;|&nbsp; <span style="color:#f59e0b;">${curI.toFixed(2)} A</span>`;
    dom.canvasReadout.classList.remove('hidden');
  }

  function hideHoverReadout() {
    if (dom.canvasReadout) dom.canvasReadout.classList.add('hidden');
  }

  function drawPmaxGraph() {
    const canvas = dom.pmaxCanvas;
    if (!canvas || !dom.canvasContainer) return;

    const rect = dom.canvasContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Margins
    const padL = 44;
    const padR = 40;
    const padT = 18;
    const padB = 26;
    const plotW = Math.max(10, w - padL - padR);
    const plotH = Math.max(10, h - padT - padB);

    // Retrieve parameters
    const pmax = Number(getSunsimParam('pmax', 544.6));
    const vmp = Number(getSunsimParam('vmp', 42.28));
    const imp = Number(getSunsimParam('imp', 12.88));
    const voc = Number(getSunsimParam('voc', 50.35));
    const isc = Number(getSunsimParam('isc', 13.56));

    const maxV = Math.max(55.0, voc * 1.05);  // X axis ceiling
    const maxP = Math.max(600.0, pmax * 1.1); // Left Y axis ceiling (Power in W)
    const maxI = Math.max(16.0, isc * 1.15);  // Right Y axis ceiling (Current in A)

    state.canvasMetrics = { padL, padR, padT, padB, plotW, plotH, maxV, maxP, maxI };

    // Clear background
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    // Grid lines (horizontal & vertical)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // 5 horizontal grid lines
    for (let i = 0; i <= 5; i++) {
      const gy = padT + (plotH * i) / 5;
      ctx.moveTo(padL, gy);
      ctx.lineTo(padL + plotW, gy);
    }
    // 6 vertical grid lines
    for (let i = 0; i <= 5; i++) {
      const gx = padL + (plotW * i) / 5;
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + plotH);
    }
    ctx.stroke();

    // Axis Labels
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';

    // Left Y Axis: Power (W)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const gy = padT + plotH - (plotH * i) / 5;
      const val = Math.round((maxP * i) / 5);
      ctx.fillText(`${val}W`, padL - 6, gy);
    }

    // Right Y Axis: Current (A)
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f59e0b';
    for (let i = 0; i <= 4; i++) {
      const gy = padT + plotH - (plotH * i) / 4;
      const val = Math.round((maxI * i) / 4);
      ctx.fillText(`${val}A`, padL + plotW + 6, gy);
    }

    // X Axis: Voltage (V)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#64748b';
    for (let i = 0; i <= 5; i++) {
      const gx = padL + (plotW * i) / 5;
      const val = Math.round((maxV * i) / 5);
      ctx.fillText(`${val}V`, gx, padT + plotH + 6);
    }

    // Curve Points (use API points if available, otherwise calculate double-diode curve)
    const curvePoints = [];
    const rawCurve = (state.sunsimData && (state.sunsimData.pmax_curve || state.sunsimData.iv_curve)) || null;

    if (Array.isArray(rawCurve) && rawCurve.length > 5) {
      for (const pt of rawCurve) {
        const v = Number(pt.v || 0);
        const i = Number(pt.i || 0);
        const p = Number(pt.p !== undefined ? pt.p : v * i);
        curvePoints.push({
          v, i, p,
          x: padL + (v / maxV) * plotW,
          yP: padT + plotH - (p / maxP) * plotH,
          yI: padT + plotH - (i / maxI) * plotH
        });
      }
    } else {
      const pts = 80;
      for (let i = 0; i <= pts; i++) {
        const v = (maxV * i) / pts;
        let curI = 0;
        if (v < voc) {
          const vNorm = v / voc;
          curI = Math.max(0, isc * (1.0 - Math.pow(vNorm, 9.6)));
        }
        const curP = v * curI;
        curvePoints.push({
          v, i: curI, p: curP,
          x: padL + (v / maxV) * plotW,
          yP: padT + plotH - (curP / maxP) * plotH,
          yI: padT + plotH - (curI / maxI) * plotH
        });
      }
    }

    if (curvePoints.length > 1) {
      // 1. Draw P-V Curve (Power vs Voltage) with subtle glow & fill
      const gradP = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      gradP.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
      gradP.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

      ctx.beginPath();
      ctx.moveTo(curvePoints[0].x, padT + plotH);
      for (let pt of curvePoints) {
        ctx.lineTo(pt.x, pt.yP);
      }
      ctx.lineTo(curvePoints[curvePoints.length - 1].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = gradP;
      ctx.fill();

      ctx.save();
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(curvePoints[0].x, curvePoints[0].yP);
      for (let i = 1; i < curvePoints.length; i++) {
        ctx.lineTo(curvePoints[i].x, curvePoints[i].yP);
      }
      ctx.stroke();
      ctx.restore();

      // 2. Draw I-V Curve (Current vs Voltage)
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(curvePoints[0].x, curvePoints[0].yI);
      for (let i = 1; i < curvePoints.length; i++) {
        ctx.lineTo(curvePoints[i].x, curvePoints[i].yI);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 3. Highlight Maximum Power Point (MPP): Crosshairs, Point & Callout
    const mppX = padL + (vmp / maxV) * plotW;
    const mppY_P = padT + plotH - (pmax / maxP) * plotH;
    const mppY_I = padT + plotH - (imp / maxI) * plotH;

    // Crosshairs
    ctx.save();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.7)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;

    // Vertical line down to X-axis
    ctx.beginPath();
    ctx.moveTo(mppX, padT);
    ctx.lineTo(mppX, padT + plotH);
    ctx.stroke();

    // Horizontal line across to Left Y-axis (Power)
    ctx.beginPath();
    ctx.moveTo(padL, mppY_P);
    ctx.lineTo(mppX, mppY_P);
    ctx.stroke();
    ctx.restore();

    // Current point on I-V curve
    ctx.beginPath();
    ctx.arc(mppX, mppY_I, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();

    // MPP Point Marker on P-V curve (Glowing Ring + Center)
    ctx.save();
    ctx.shadowColor = '#10b981';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(mppX, mppY_P, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // MPP Callout Badge
    const badgeText = `Pmax: ${pmax.toFixed(1)}W @ ${vmp.toFixed(2)}V`;
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    const textW = ctx.measureText(badgeText).width;
    const bPadX = 6;
    const bH = 18;
    const bX = Math.min(padL + plotW - textW - bPadX * 2 - 4, Math.max(padL + 4, mppX - textW / 2 - bPadX));
    const bY = Math.max(padT + 4, mppY_P - 26);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bX, bY, textW + bPadX * 2, bH, 3) : ctx.rect(bX, bY, textW + bPadX * 2, bH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#34d399';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, bX + bPadX, bY + bH / 2);

    // 4. If Hovered, draw vertical tracking line & crosshair dot
    if (state.hoverV !== null && state.hoverV >= 0 && state.hoverV <= maxV) {
      const hX = padL + (state.hoverV / maxV) * plotW;
      const vNorm = Math.min(1.0, Math.max(0.0, state.hoverV / voc));
      const curI = state.hoverV < voc ? Math.max(0, isc * (1.0 - Math.pow(vNorm, 9.6))) : 0;
      const curP = state.hoverV * curI;
      const hY_P = padT + plotH - (curP / maxP) * plotH;

      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hX, padT);
      ctx.lineTo(hX, padT + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(hX, hY_P, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  // =========================================================================
  // 3. Render SunSim Metrology KPIs (6 Database Columns from dbo.IV_Flasher)
  // =========================================================================
  function renderSunSimMetrics(sunsim) {
    if (!sunsim) return;

    const pmax = Number(getSunsimParam('pmax', 544.6)).toFixed(1);
    const voc = Number(getSunsimParam('voc', 50.35)).toFixed(2);
    const isc = Number(getSunsimParam('isc', 13.56)).toFixed(2);
    const vmp = Number(getSunsimParam('vmp', 42.28)).toFixed(2);
    const imp = Number(getSunsimParam('imp', 12.88)).toFixed(2);
    const ff = Number(getSunsimParam('ff', 79.75)).toFixed(2);
    const testedAt = String(getSunsimParam('tested_at', '--'));

    if (dom.valPmax) dom.valPmax.textContent = pmax;
    if (dom.legendPmaxVal) dom.legendPmaxVal.textContent = `${pmax} W`;
    if (dom.valVoc) dom.valVoc.textContent = voc;
    if (dom.valIsc) dom.valIsc.textContent = isc;
    if (dom.valVmp) dom.valVmp.textContent = vmp;
    if (dom.valImp) dom.valImp.textContent = imp;
    if (dom.valFF) dom.valFF.textContent = ff;
    if (dom.valSunsimTime) dom.valSunsimTime.textContent = testedAt;

    drawPmaxGraph();
  }

  // =========================================================================
  // 4. Render Hi-Pot Safety Results (Real Columns from dbo.Hipot)
  // =========================================================================
  function renderHiPotMetrics(hipot) {
    if (!hipot) return;

    // 1. Module ID
    const modId = hipot.module_id || hipot.Module_ID || state.moduleId || '--';
    if (dom.valHipotModule) {
      dom.valHipotModule.textContent = modId;
    }

    // 2. Tested At
    const timeStr = hipot.tested_at || hipot.Tested_At || hipot.test_timestamp || '--';
    if (dom.valHipotTime) {
      dom.valHipotTime.textContent = timeStr;
    }

    // 3. Passed / Result (bit: 1/True = PASS, 0/False = FAIL)
    let passed = true;
    if (hipot.passed !== undefined) {
      passed = Boolean(hipot.passed === 1 || hipot.passed === true || hipot.passed === '1' || String(hipot.passed).toLowerCase() === 'true');
    } else if (hipot.Passed !== undefined) {
      passed = Boolean(hipot.Passed === 1 || hipot.Passed === true || hipot.Passed === '1' || String(hipot.Passed).toLowerCase() === 'true');
    } else if (hipot.overall_status !== undefined) {
      passed = String(hipot.overall_status).toUpperCase() === 'PASS';
    } else if (hipot.overall_result !== undefined) {
      passed = String(hipot.overall_result).toUpperCase() === 'PASS';
    } else if (hipot.status !== undefined) {
      passed = String(hipot.status).toUpperCase() === 'PASS';
    }

    if (dom.valHipotStatus) {
      dom.valHipotStatus.textContent = passed ? 'PASS' : 'FAIL';
      dom.valHipotStatus.className = `hipot-status-badge ${passed ? 'pass' : 'fail'}`;
    }

    // 4. Result File
    const resultFile = hipot.result_file || hipot.Result_File || hipot.file || '--';
    if (dom.valHipotFile) {
      dom.valHipotFile.textContent = resultFile;
      dom.valHipotFile.title = resultFile;
    }
  }

  // =========================================================================
  // 5. Fetch and Load Telemetry For Module
  // =========================================================================
  async function loadTelemetryForModule(moduleId) {
    if (!moduleId) {
      state.moduleId = '';
      if (dom.displayModuleId) dom.displayModuleId.textContent = 'Waiting for Module...';
      if (dom.valHipotModule) dom.valHipotModule.textContent = '--';
      return;
    }
    state.moduleId = moduleId;

    if (dom.displayModuleId) dom.displayModuleId.textContent = moduleId;
    if (dom.valHipotModule) dom.valHipotModule.textContent = moduleId;

    // Immediately trigger EL image update
    updateSingleElImage(moduleId);

    // 1. Try `/api/telemetry?module_id=...`
    try {
      const res = await fetch(`/api/telemetry?module_id=${encodeURIComponent(moduleId)}`);
      if (res.ok) {
        const data = await res.json();
        const elUrl = data.el_image || (Array.isArray(data.el_images) ? data.el_images[0] : null);
        if (elUrl) {
          updateSingleElImage(moduleId, elUrl);
        }
        const sunsim = data.sun_simulator || data.sunsim;
        if (sunsim) {
          state.sunsimData = sunsim;
          renderSunSimMetrics(sunsim);
        }
        const hipot = data.hipot;
        if (hipot) {
          state.hipotData = hipot;
          renderHiPotMetrics(hipot);
        }
        return;
      }
    } catch (e) {
      console.warn('[Telemetry] /api/telemetry fetch notice:', e);
    }

    // 2. Try `/api/telemetry/all?module_id=...`
    try {
      const resAll = await fetch(`/api/telemetry/all?module_id=${encodeURIComponent(moduleId)}`);
      if (resAll.ok) {
        const data = await resAll.json();
        const sunsim = data.sunsim || data.sun_simulator;
        const hipot = data.hipot;
        if (sunsim) {
          state.sunsimData = sunsim;
          renderSunSimMetrics(sunsim);
        }
        if (hipot) {
          state.hipotData = hipot;
          renderHiPotMetrics(hipot);
        }
        return;
      }
    } catch (e) {
      console.warn('[Telemetry] /api/telemetry/all fetch notice:', e);
    }

    // 3. Fallback: Fetch SunSim and Hi-Pot endpoints in parallel
    try {
      const [sunsimRes, hipotRes] = await Promise.all([
        fetch(`/api/telemetry/sunsim?module_id=${encodeURIComponent(moduleId)}`),
        fetch(`/api/telemetry/hipot?module_id=${encodeURIComponent(moduleId)}`)
      ]);

      if (sunsimRes.ok) {
        const sunsim = await sunsimRes.json();
        state.sunsimData = sunsim;
        renderSunSimMetrics(sunsim);
      }
      if (hipotRes.ok) {
        const hipot = await hipotRes.json();
        state.hipotData = hipot;
        renderHiPotMetrics(hipot);
      }
    } catch (err) {
      console.error('[Telemetry] Fallback telemetry fetch error:', err);
    }
  }

  // =========================================================================
  // 6. Real-time Multi-Vector Synchronization Engine (Locked to Screen 1 Active Module)
  // =========================================================================
  function initLiveSync() {
    // Vector 1: BroadcastChannel 'fvi_DualScreen_Sync'
    try {
      const dualScreenChannel = new BroadcastChannel('fvi_DualScreen_Sync');
      dualScreenChannel.onmessage = (event) => {
        if (!event.data) return;
        const modId = event.data.moduleId || event.data.panel_id || event.data.serialNumber;
        if (modId && modId !== state.moduleId) {
          console.log('[DualScreen Sync] Module received via fvi_DualScreen_Sync:', modId);
          loadTelemetryForModule(modId);
        }
      };
    } catch (e) {
      console.warn('[Sync] BroadcastChannel fvi_DualScreen_Sync unsupported:', e);
    }

    // Vector 2: BroadcastChannel 'fvi_station_sync' (Screen 1 app.js channel)
    try {
      const stationChannel = new BroadcastChannel('fvi_station_sync');
      stationChannel.onmessage = (event) => {
        if (!event.data) return;
        const modId = event.data.moduleId || event.data.panel_id;
        if (modId && modId !== state.moduleId) {
          console.log('[Station Sync] Module received via fvi_station_sync:', modId);
          loadTelemetryForModule(modId);
        }
      };
    } catch (e) {
      console.warn('[Sync] BroadcastChannel fvi_station_sync unsupported:', e);
    }

    // Vector 3: LocalStorage 'storage' event listener
    window.addEventListener('storage', (event) => {
      if (event.key === 'fvi_active_module_id' || event.key === 'fvi_module_id' || event.key === 'fvi_cmms_module') {
        const newMod = event.newValue;
        if (newMod && newMod !== state.moduleId) {
          console.log('[Storage Sync] Module changed via localStorage:', newMod);
          loadTelemetryForModule(newMod);
        }
      }
    });

    // Vector 4: Reliable LocalStorage & Active Module Polling (Guarantees zero flicker)
    setInterval(async () => {
      try {
        const localActive = localStorage.getItem('fvi_active_module_id');
        if (localActive && localActive.startsWith('USM') && localActive !== state.moduleId) {
          loadTelemetryForModule(localActive);
          return;
        }
        // Only if localStorage has no active module (e.g. separate browser window/device), check /api/module/active
        if (!localActive) {
          const res = await fetch('/api/module/active');
          if (res.ok) {
            const data = await res.json();
            const activeId = data.module_id || data.panel_id;
            if (activeId && activeId !== state.moduleId) {
              loadTelemetryForModule(activeId);
            }
          }
        }
      } catch (e) {}
    }, 1000);
  }

  // =========================================================================
  // 7. Initialization
  // =========================================================================
  async function init() {
    queryDom();
    initPmaxCanvas();
    initLiveSync();

    // Check localStorage first
    const savedActive = localStorage.getItem('fvi_active_module_id');
    if (savedActive && savedActive.startsWith('USM')) {
      loadTelemetryForModule(savedActive);
      return;
    }

    // Check URL parameters for ?module_id=...
    const urlParams = new URLSearchParams(window.location.search);
    const paramMod = urlParams.get('module_id') || urlParams.get('sn');
    if (paramMod) {
      loadTelemetryForModule(paramMod);
      return;
    }

    // Otherwise fetch from /api/module/active
    try {
      const res = await fetch('/api/module/active');
      if (res.ok) {
        const data = await res.json();
        const activeId = data.module_id || data.panel_id;
        if (activeId) {
          loadTelemetryForModule(activeId);
          return;
        }
      }
    } catch (e) {}

    // Fallback to default
    loadTelemetryForModule(state.moduleId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose global interface for interop with Screen 1 console
  window.FVITelemetry = {
    loadTelemetryForModule,
    updateSingleElImage,
    state
  };

})(window);
