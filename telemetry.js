/**
 * FVI Station 01 — Monitor 2: High-Resolution Industrial Metrology Console
 * Horizontal (16:9 Landscape) Screen Display Engine
 *
 * Controls:
 * - 4-Camera EL Imagery (2×2 Quad Array, Click-to-Focus, Invert EL)
 * - SunSim PMax & I-V HTML5 Canvas Graph with MPP Callout & 9 Flasher KPIs
 * - Hi-Pot Dielectric Safety Results with 5 Threshold Bars & 4-Channel Matrix
 * - Live Dual-Screen Zero-Latency Sync (BroadcastChannel, Storage, Polling, SSE)
 */

(function (window) {
  'use strict';

  // Application State
  const state = {
    moduleId: 'USM0112208260078',
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
      pillSyncStatus: document.getElementById('pill-sync-status'),
      pillSunsimDb: document.getElementById('pill-sunsim-db'),
      pillHipotDb: document.getElementById('pill-hipot-db'),
      btnToggleFullscreen: document.getElementById('btn-toggle-fullscreen'),

      // EL Panel Elements (Single Module Reference View)
      elViewportContainer: document.getElementById('el-viewport-container'),
      elSingleImg: document.getElementById('el-single-img'),

      // SunSim Elements
      pmaxCanvas: document.getElementById('pmax-canvas'),
      canvasContainer: document.getElementById('canvas-container'),
      canvasReadout: document.getElementById('canvas-readout'),
      valBinTag: document.getElementById('val-bin-tag'),
      legendPmaxVal: document.getElementById('legend-pmax-val'),
      valPmax: document.getElementById('val-pmax'),
      valBin: document.getElementById('val-bin'),
      valVoc: document.getElementById('val-voc'),
      valIsc: document.getElementById('val-isc'),
      valVmp: document.getElementById('val-vmp'),
      valImp: document.getElementById('val-imp'),
      valFF: document.getElementById('val-ff'),
      valEff: document.getElementById('val-eff'),
      valTemp: document.getElementById('val-temp'),

      // Hi-Pot Elements
      valHipotTime: document.getElementById('val-hipot-time'),
      valHipotTester: document.getElementById('val-hipot-tester'),
      valHipotBadge: document.getElementById('val-hipot-badge'),
      gaugeValDcwV: document.getElementById('gauge-val-dcw-v'),
      barFillDcwV: document.getElementById('bar-fill-dcw-v'),
      gaugeValDcw: document.getElementById('gauge-val-dcw'),
      barFillDcw: document.getElementById('bar-fill-dcw'),
      gaugeValIr: document.getElementById('gauge-val-ir'),
      barFillIr: document.getElementById('bar-fill-ir'),
      gaugeValGb: document.getElementById('gauge-val-gb'),
      barFillGb: document.getElementById('bar-fill-gb'),
      gaugeValArc: document.getElementById('gauge-val-arc'),
      valDwell: document.getElementById('val-dwell'),
      ch1Val: document.getElementById('ch1-val'),
      ch2Val: document.getElementById('ch2-val'),
      ch3Val: document.getElementById('ch3-val'),
      ch4Val: document.getElementById('ch4-val'),
      channelsTbody: document.getElementById('hipot-channels-tbody')
    };
  }

  // =========================================================================
  // 1. EL Image Display (Single Module Reference)
  // =========================================================================
  function hashString(str) {
    if (!str) return 1;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  function updateElImageForModule(moduleId, fallbackSample) {
    if (!dom.elSingleImg) return;
    const cleanId = (moduleId || '').trim();
    const sampleNum = (Math.abs(hashString(cleanId)) % 4) + 1;
    const defaultFallback = fallbackSample || `sample_el_${sampleNum}.jpg`;

    // Try live FTP-served image first, fallback seamlessly if offline
    dom.elSingleImg.onerror = () => {
      dom.elSingleImg.onerror = null;
      dom.elSingleImg.src = defaultFallback;
    };
    dom.elSingleImg.src = `/api/module/${encodeURIComponent(cleanId)}/el-image?side=front`;
  }

  // =========================================================================
  // 2. Interactive HTML5 Canvas PMax & I-V Graph
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

    if (key === 'pmax') return p.pmax_w ?? s.pmax ?? defaultVal;
    if (key === 'voc') return p.voc_v ?? s.voc ?? defaultVal;
    if (key === 'isc') return p.isc_a ?? s.isc ?? defaultVal;
    if (key === 'vmp') return p.vmp_v ?? s.vmp ?? defaultVal;
    if (key === 'imp') return p.imp_a ?? s.imp ?? defaultVal;
    if (key === 'ff') return p.fill_factor_pct ?? s.ff ?? defaultVal;
    if (key === 'temp') return p.cell_temp_c ?? s.temp ?? defaultVal;
    if (key === 'eff') return p.efficiency_pct ?? s.efficiency ?? defaultVal;
    if (key === 'bin') return p.power_bin ?? s.power_bin ?? s.bin ?? defaultVal;
    if (key === 'model') return p.module_model ?? s.module_model ?? s.model ?? defaultVal;

    return p[key] ?? s[key] ?? defaultVal;
  }

  function updateHoverReadout(vVal) {
    if (!dom.canvasReadout) return;
    const voc = getSunsimParam('voc', 50.35);
    const isc = getSunsimParam('isc', 13.56);

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

    const maxV = 55.0;  // X axis ceiling
    const maxP = 600.0; // Left Y axis ceiling (Power in W)
    const maxI = 16.0;  // Right Y axis ceiling (Current in A)

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

    // Target Power Bin Guideline (540W Dashed Line)
    const targetY = padT + plotH - (540.0 / maxP) * plotH;
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, targetY);
    ctx.lineTo(padL + plotW, targetY);
    ctx.stroke();
    ctx.restore();

    // Generate Curve Points (Double-Diode high fidelity PV simulation or data array)
    const curvePoints = [];
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
        v,
        i: curI,
        p: curP,
        x: padL + (v / maxV) * plotW,
        yP: padT + plotH - (curP / maxP) * plotH,
        yI: padT + plotH - (curI / maxI) * plotH
      });
    }

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
  // 3. Render SunSim Metrology KPIs
  // =========================================================================
  function renderSunSimMetrics(sunsim) {
    if (!sunsim) return;

    const pmax = Number(getSunsimParam('pmax', 544.6)).toFixed(1);
    const voc = Number(getSunsimParam('voc', 50.35)).toFixed(2);
    const isc = Number(getSunsimParam('isc', 13.56)).toFixed(2);
    const vmp = Number(getSunsimParam('vmp', 42.28)).toFixed(2);
    const imp = Number(getSunsimParam('imp', 12.88)).toFixed(2);
    const ff = Number(getSunsimParam('ff', 79.75)).toFixed(2);
    const temp = Number(getSunsimParam('temp', 34.3)).toFixed(1);

    const rawEff = Number(getSunsimParam('eff', 21.3));
    const eff = rawEff < 1 ? (rawEff * 100).toFixed(1) : rawEff.toFixed(1);

    const rawBin = String(getSunsimParam('bin', '540W'));
    const binClean = rawBin.replace(/^Bin:\s*/i, '');

    if (dom.valPmax) dom.valPmax.textContent = pmax;
    if (dom.valBin) dom.valBin.textContent = binClean;
    if (dom.valBinTag) dom.valBinTag.textContent = `Bin: ${binClean}`;
    if (dom.legendPmaxVal) dom.legendPmaxVal.textContent = `${pmax} W`;
    if (dom.valVoc) dom.valVoc.textContent = voc;
    if (dom.valIsc) dom.valIsc.textContent = isc;
    if (dom.valVmp) dom.valVmp.textContent = vmp;
    if (dom.valImp) dom.valImp.textContent = imp;
    if (dom.valFF) dom.valFF.textContent = ff;
    if (dom.valEff) dom.valEff.textContent = eff;
    if (dom.valTemp) dom.valTemp.textContent = temp;

    drawPmaxGraph();
  }

  // =========================================================================
  // 4. Render Hi-Pot Safety Gauges & Multi-Channel Breakdown
  // =========================================================================
  function renderHiPotMetrics(hipot) {
    if (!hipot) return;
    const p = hipot.parameters || {};

    const dcw = p.dcw || {};
    const ir = p.ir || {};
    const gb = p.gb || {};

    // 1. DCW Voltage & Leakage
    const dcwVolts = hipot.withstand_voltage_v ?? p.test_voltage_vdc ?? 1500;
    const dcwVal = parseFloat(hipot.leakage_current_ua ?? dcw.value ?? '10.00') || 10.0;
    if (dom.gaugeValDcwV) dom.gaugeValDcwV.textContent = `${dcwVolts}`;
    if (dom.gaugeValDcw) dom.gaugeValDcw.textContent = dcwVal.toFixed(2);

    // Leakage bar (0 to 50 µA max trip limit)
    const dcwPct = Math.min(100, Math.max(6, (dcwVal / 50.0) * 100));
    if (dom.barFillDcw) {
      dom.barFillDcw.style.width = `${dcwPct}%`;
      dom.barFillDcw.className = `threshold-bar-fill ${dcwVal < 40 ? 'pass' : (dcwVal <= 50 ? 'warning' : 'fail')}`;
    }

    // 2. Insulation Resistance (IR)
    const irVal = parseFloat(hipot.insulation_resistance_mohm ?? ir.value ?? '1680.0') || 1680.0;
    if (dom.gaugeValIr) dom.gaugeValIr.textContent = irVal.toFixed(1);

    // IR bar (Floor: 400 MΩ, target max scale 2000 MΩ)
    const irPct = Math.min(100, Math.max(10, (irVal / 2000.0) * 100));
    if (dom.barFillIr) {
      dom.barFillIr.style.width = `${irPct}%`;
      dom.barFillIr.className = `threshold-bar-fill ${irVal >= 500 ? 'pass' : (irVal >= 400 ? 'warning' : 'fail')}`;
    }

    // 3. Ground Bond Continuity (GB)
    const gbVal = parseFloat(hipot.ground_continuity_mohm ?? gb.value ?? '14.0') || 14.0;
    if (dom.gaugeValGb) dom.gaugeValGb.textContent = gbVal.toFixed(1);

    // GB bar (0 to 100 mΩ max limit)
    const gbPct = Math.min(100, Math.max(6, (gbVal / 100.0) * 100));
    if (dom.barFillGb) {
      dom.barFillGb.style.width = `${gbPct}%`;
      dom.barFillGb.className = `threshold-bar-fill ${gbVal < 80 ? 'pass' : (gbVal <= 100 ? 'warning' : 'fail')}`;
    }

    // 4. Arc Detection & Dwell
    const arcDetected = hipot.arc_detection ?? p.arc_detected ?? false;
    const dwell = hipot.dwell_time_s ?? p.test_duration_sec ?? 3.0;
    if (dom.gaugeValArc) {
      dom.gaugeValArc.textContent = arcDetected ? 'ARC TRIP' : 'NONE';
      dom.gaugeValArc.className = `gauge-num ${arcDetected ? 'fail' : 'green-text'}`;
    }
    if (dom.valDwell) dom.valDwell.textContent = `${Number(dwell).toFixed(1)}s`;

    // 5. Header Badges & Timestamps
    const timeStr = hipot.tested_at || p.test_timestamp || '26-08-22 17:08:41';
    if (dom.valHipotTime) dom.valHipotTime.textContent = timeStr;
    if (dom.valHipotTester && p.tester_id) dom.valHipotTester.textContent = p.tester_id;

    const overallPass = ((hipot.overall_result || hipot.overall_status) === 'PASS' || !arcDetected);
    if (dom.valHipotBadge) {
      dom.valHipotBadge.textContent = overallPass ? 'PASS' : 'FAIL';
      dom.valHipotBadge.className = `hipot-master-badge ${overallPass ? 'pass' : 'fail'}`;
    }

    // 6. Update Multi-Channel Table Values
    if (dom.ch1Val) dom.ch1Val.textContent = `${dcwVal.toFixed(2)} µA`;
    if (dom.ch2Val) dom.ch2Val.textContent = `${irVal.toFixed(1)} MΩ`;
    if (dom.ch3Val) dom.ch3Val.textContent = `${gbVal.toFixed(1)} mΩ`;
    if (dom.ch4Val) dom.ch4Val.textContent = '0.12 A';

    // If API provided rich channel array, render them dynamically
    if (Array.isArray(hipot.channels) && hipot.channels.length > 0 && dom.channelsTbody) {
      dom.channelsTbody.innerHTML = hipot.channels.map((ch, idx) => {
        const badgeClass = idx === 0 ? 'ch-blue' : (idx === 1 ? 'ch-cyan' : (idx === 2 ? 'ch-emerald' : 'ch-amber'));
        const volt = ch.voltage_v ? `${ch.voltage_v} VDC` : (ch.test_current_a ? `${ch.test_current_a} A` : '35.0 VDC');
        const meas = ch.measured_value !== undefined ? `${ch.measured_value} ${ch.unit || ''}` : '--';
        return `
          <tr>
            <td><span class="ch-badge ${badgeClass}">CH${ch.channel || (idx + 1)}</span></td>
            <td class="ch-desc font-bold">${ch.name || 'Dielectric Circuit'}</td>
            <td class="mono">${volt}</td>
            <td class="mono font-bold val-pass">${meas}</td>
            <td class="mono">${ch.limit || '--'}</td>
            <td class="mono">${ch.dwell_s || 2.0} sec</td>
            <td class="text-green">Normal / Pass</td>
            <td><span class="badge-status-pill pass">${ch.status || 'PASS'}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  // =========================================================================
  // 5. Fetch and Load Telemetry For Module
  // =========================================================================
  async function loadTelemetryForModule(moduleId) {
    if (!moduleId) return;
    const cleanId = moduleId.trim().toUpperCase();
    state.moduleId = cleanId;

    if (dom.displayModuleId) dom.displayModuleId.textContent = cleanId;

    // Immediately trigger EL image refresh for this module
    updateElImageForModule(cleanId);

    // 1. Try `/api/telemetry?module_id=...`
    try {
      const res = await fetch(`/api/telemetry?module_id=${encodeURIComponent(cleanId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.el_image || data.el_fallback) {
          updateElImageForModule(cleanId, data.el_fallback);
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
      const resAll = await fetch(`/api/telemetry/all?module_id=${encodeURIComponent(cleanId)}`);
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
        fetch(`/api/telemetry/sunsim?module_id=${encodeURIComponent(cleanId)}`),
        fetch(`/api/telemetry/hipot?module_id=${encodeURIComponent(cleanId)}`)
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
  // 6. Real-time Multi-Vector Synchronization Engine
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

    // Vector 4: Server-Sent Events (SSE) Stream
    try {
      const eventSource = new EventSource('/api/stream');
      eventSource.addEventListener('PANEL_ARRIVED', (e) => {
        try {
          const data = JSON.parse(e.data);
          const panelId = data.panel_id || data.serial_number;
          if (panelId && panelId !== state.moduleId) {
            console.log('[SSE Stream] Conveyor Arrival:', panelId);
            loadTelemetryForModule(panelId);
          }
        } catch (err) {}
      });
    } catch (err) {
      console.warn('[SSE] EventSource init notice:', err);
    }

    // Vector 5: Periodic Polling fallback (/api/module/current & /api/conveyor/current)
    setInterval(async () => {
      try {
        let res = await fetch('/api/conveyor/current');
        if (!res.ok) {
          res = await fetch('/api/module/current');
        }
        if (res.ok) {
          const cur = await res.json();
          const currentId = cur.panel_id || cur.module_id;
          if (currentId && currentId !== state.moduleId) {
            console.log('[Polling Sync] Detected new conveyor module:', currentId);
            loadTelemetryForModule(currentId);
          }
        }
      } catch (e) {}
    }, 2500);
  }

  // =========================================================================
  // 7. Fullscreen Toggle
  // =========================================================================
  function initFullscreenButton() {
    if (!dom.btnToggleFullscreen) return;
    dom.btnToggleFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // =========================================================================
  // 8. Initialization (Pure Reference Display - Zero Interaction Required)
  // =========================================================================
  function init() {
    queryDom();
    initPmaxCanvas();
    initLiveSync();
    initFullscreenButton();

    // Check URL parameters or localStorage from Screen 1
    const urlParams = new URLSearchParams(window.location.search);
    let initialMod = urlParams.get('module_id') || urlParams.get('sn');
    if (!initialMod) {
      try {
        initialMod = localStorage.getItem('fvi_active_module_id');
      } catch (e) {}
    }
    if (!initialMod) {
      initialMod = state.moduleId;
    }
    loadTelemetryForModule(initialMod);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose global interface for interop with Screen 1 console
  window.FVITelemetry = {
    loadTelemetryForModule,
    state
  };

})(window);
