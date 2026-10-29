/**
 * FVI Station 01 — Secondary Monitor Metrology & Telemetry Display Engine
 * Screen 2 & Integrated Single-Screen Metrology Display
 *
 * Real-time Zero-Latency Synchronization with Screen 1 via BroadcastChannel & SSE
 * Matches exact industrial styling from reference image
 */

(function (window) {
  'use strict';

  // Application State
  const state = {
    moduleId: 'USM0112208260078',
    sunsimData: null,
    hipotData: null,
    isLiveSync: true,
    isAttributesCollapsed: false,
    initialized: false
  };

  // DOM References Cache
  let dom = {};

  function queryDomElements() {
    dom = {
      displayModuleId: document.getElementById('display-module-id'),
      unifiedPmaxBinBadge: document.getElementById('unified-pmax-bin-badge'),
      pillSyncStatus: document.getElementById('pill-sync-status'),
      pillSunsimDb: document.getElementById('pill-sunsim-db'),
      pillHipotDb: document.getElementById('pill-hipot-db'),
      btnToggleFullscreen: document.getElementById('btn-toggle-fullscreen'),

      // Top Pipeline Elements
      pipeCards: [
        { card: document.getElementById('pipe-card-1'), badge: document.getElementById('pipe-badge-1'), date: document.getElementById('pipe-date-1'), time: document.getElementById('pipe-time-1'), grade: document.getElementById('pipe-grade-1') },
        { card: document.getElementById('pipe-card-2'), badge: document.getElementById('pipe-badge-2'), date: document.getElementById('pipe-date-2'), time: document.getElementById('pipe-time-2') },
        { card: document.getElementById('pipe-card-3'), badge: document.getElementById('pipe-badge-3'), date: document.getElementById('pipe-date-3'), time: document.getElementById('pipe-time-3'), grade: document.getElementById('pipe-grade-3') },
        { card: document.getElementById('pipe-card-4'), badge: document.getElementById('pipe-badge-4'), date: document.getElementById('pipe-date-4'), time: document.getElementById('pipe-time-4') },
        { card: document.getElementById('pipe-card-5'), badge: document.getElementById('pipe-badge-5'), date: document.getElementById('pipe-date-5'), time: document.getElementById('pipe-time-5') }
      ],

      // SunSim 9 KPI Elements
      valPmax: document.getElementById('val-pmax'),
      valVoc: document.getElementById('val-voc'),
      valIsc: document.getElementById('val-isc'),
      valFF: document.getElementById('val-ff'),
      valVmp: document.getElementById('val-vmp'),
      valImp: document.getElementById('val-imp'),
      valEff: document.getElementById('val-eff'),
      valTemp: document.getElementById('val-temp'),
      valInspectionTime: document.getElementById('val-inspection-time'),
      valModuleModel: document.getElementById('val-module-model'),
      valBinTag: document.getElementById('val-bin-tag'),

      // Hi-Pot Elements
      valHipotBadge: document.getElementById('val-hipot-badge'),
      badgeDcw: document.getElementById('badge-dcw'),
      valDcw: document.getElementById('val-dcw'),
      badgeIr: document.getElementById('badge-ir'),
      valIr: document.getElementById('val-ir'),
      badgeGb: document.getElementById('badge-gb'),
      valGb: document.getElementById('val-gb'),

      // Attributes Table Elements
      attributesToggleBtn: document.getElementById('attributes-toggle-btn'),
      attributesTableWrap: document.getElementById('attributes-table-wrap'),
      attrChevron: document.getElementById('attr-chevron'),
      attrSn: document.getElementById('attr-sn'),
      attrStatus: document.getElementById('attr-status'),
      attrElGrade: document.getElementById('attr-el-grade'),
      attrRework: document.getElementById('attr-rework'),
      attrTimestamp: document.getElementById('attr-timestamp'),

      // Charts
      chartSvg: document.getElementById('chart-svg'),
      chartTooltip: document.getElementById('chart-tooltip'),
      runChartSvg: document.getElementById('run-chart-svg'),
      binStackedBar: document.getElementById('bin-stacked-bar'),
      binLegendPills: document.getElementById('bin-legend-pills'),
      valTotalTested: document.getElementById('val-total-tested'),

      // Footer
      footerStatusMsg: document.getElementById('footer-status-msg'),
      footerTimestamp: document.getElementById('footer-timestamp')
    };
  }

  // ---------------------------------------------------------------------------
  // Inter-Screen Broadcast Channel (Instant zero-latency sync with Screen 1)
  // ---------------------------------------------------------------------------
  let syncChannel = null;
  try {
    syncChannel = new BroadcastChannel('fvi_station_sync');
    syncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'MODULE_CHANGED' && event.data.moduleId) {
        console.log('[Telemetry Sync] Module changed:', event.data.moduleId);
        loadTelemetryForModule(event.data.moduleId);
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel not supported in this browser:', e);
  }

  // ---------------------------------------------------------------------------
  // Server-Sent Events (SSE) for conveyor arrival events
  // ---------------------------------------------------------------------------
  function initSseConveyorStream() {
    try {
      const eventSource = new EventSource('/api/stream');
      eventSource.addEventListener('PANEL_ARRIVED', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.panel_id) {
            console.log('[Telemetry SSE] Conveyor arrival:', data.panel_id);
            loadTelemetryForModule(data.panel_id);
          }
        } catch (err) {}
      });
    } catch (err) {}
  }

  // ---------------------------------------------------------------------------
  // Fetch and Render Telemetry Data for Module
  // ---------------------------------------------------------------------------
  async function loadTelemetryForModule(moduleId) {
    if (!moduleId) return;
    if (!dom.chartSvg) queryDomElements();
    state.moduleId = moduleId;

    if (dom.displayModuleId) dom.displayModuleId.textContent = moduleId;
    if (dom.attrSn) dom.attrSn.textContent = moduleId;

    try {
      const res = await fetch(`/api/telemetry/all?module_id=${encodeURIComponent(moduleId)}`);
      const data = await res.json();
      
      state.sunsimData = data.sunsim;
      state.hipotData = data.hipot;

      renderPipeline(data.sunsim ? data.sunsim.pipeline : null);
      renderSunSimulator(data.sunsim);
      renderHiPot(data.hipot);
      renderAttributes(data.sunsim ? data.sunsim.attributes : null, moduleId);
      renderRunChart(data.sunsim ? data.sunsim.run_chart : null);
      renderBinSummary(data.sunsim ? data.sunsim.bin_summary : null);

      if (dom.footerTimestamp) {
        dom.footerTimestamp.textContent = `LAST SYNC: ${new Date().toLocaleTimeString()}`;
      }
    } catch (err) {
      console.error('Failed to fetch telemetry:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Render Pipeline (Top 5 Station Cards)
  // ---------------------------------------------------------------------------
  function renderPipeline(pipeline) {
    if (!pipeline || !Array.isArray(pipeline)) return;

    pipeline.forEach((station, idx) => {
      if (idx >= dom.pipeCards.length) return;
      const ref = dom.pipeCards[idx];

      if (ref.badge) {
        ref.badge.textContent = station.badge || 'PASS';
        ref.badge.className = `badge-status ${station.badge_type || 'pass'}`;
      }
      if (ref.date) ref.date.textContent = station.date || '';
      if (ref.time) ref.time.textContent = station.time || '';
      if (ref.grade) ref.grade.textContent = station.grade || 'A';
    });
  }

  // ---------------------------------------------------------------------------
  // Render Sun Simulator (9 KPI Cards & Dual-Axis Curve)
  // ---------------------------------------------------------------------------
  function renderSunSimulator(data) {
    if (!data || !data.parameters) return;
    const p = data.parameters;

    if (dom.valPmax) dom.valPmax.textContent = p.pmax_w.toFixed(1);
    if (dom.valVoc) dom.valVoc.textContent = p.voc_v.toFixed(2);
    if (dom.valIsc) dom.valIsc.textContent = p.isc_a.toFixed(2);
    if (dom.valFF) dom.valFF.textContent = p.fill_factor_pct.toFixed(2);
    if (dom.valVmp) dom.valVmp.textContent = p.vmp_v.toFixed(2);
    if (dom.valImp) dom.valImp.textContent = p.imp_a.toFixed(2);
    if (dom.valEff) dom.valEff.textContent = p.efficiency_pct.toFixed(2);
    if (dom.valTemp) dom.valTemp.textContent = p.cell_temp_c.toFixed(1);
    if (dom.valInspectionTime) dom.valInspectionTime.textContent = p.inspection_time || p.flash_timestamp || '26-08-22 09:38:36';
    if (dom.valModuleModel) dom.valModuleModel.textContent = p.module_model || '144-M10-HC';
    if (dom.valBinTag) dom.valBinTag.textContent = p.power_bin || 'Bin: 540W';

    // Update unified split header badge if present
    if (dom.unifiedPmaxBinBadge) {
      dom.unifiedPmaxBinBadge.textContent = `${p.pmax_w.toFixed(1)}W • ${p.power_bin || 'Bin: 540W'}`;
    }

    // Update DB source pill
    if (dom.pillSunsimDb) {
      if (data.source === 'SQLEXPRESS_LIVE') {
        dom.pillSunsimDb.className = 'status-indicator-pill live';
        dom.pillSunsimDb.innerHTML = '<span class="status-pip"></span><span>SQLEXPRESS LIVE</span>';
      } else {
        dom.pillSunsimDb.className = 'status-indicator-pill fallback';
        dom.pillSunsimDb.innerHTML = '<span class="status-pip"></span><span>SQLEXPRESS</span>';
      }
    }

    // Draw I-V & P-V curve chart matching exact scale in reference image
    renderIvPvCurveSvg(data.iv_curve, data.pv_curve, p);
  }

  // ---------------------------------------------------------------------------
  // Render Hi-Pot Section (DCW, IR, GB 3 Cards)
  // ---------------------------------------------------------------------------
  function renderHiPot(data) {
    if (!data || !data.parameters) return;
    const p = data.parameters;

    if (p.dcw) {
      if (dom.valDcw) dom.valDcw.textContent = p.dcw.value;
      if (dom.badgeDcw) dom.badgeDcw.textContent = p.dcw.status;
    }
    if (p.ir) {
      if (dom.valIr) dom.valIr.textContent = p.ir.value;
      if (dom.badgeIr) dom.badgeIr.textContent = p.ir.status;
    }
    if (p.gb) {
      if (dom.valGb) dom.valGb.textContent = p.gb.value;
      if (dom.badgeGb) dom.badgeGb.textContent = p.gb.status;
    }

    if (dom.valHipotBadge) {
      dom.valHipotBadge.textContent = data.badge || 'HIPOT: PASS';
    }

    // Update DB source pill
    if (dom.pillHipotDb) {
      if (data.source === 'POSTGRES_LIVE') {
        dom.pillHipotDb.className = 'status-indicator-pill live';
        dom.pillHipotDb.innerHTML = '<span class="status-pip"></span><span>HIPOT PG LIVE</span>';
      } else {
        dom.pillHipotDb.className = 'status-indicator-pill fallback';
        dom.pillHipotDb.innerHTML = '<span class="status-pip"></span><span>HIPOT PG</span>';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render Attributes Table
  // ---------------------------------------------------------------------------
  function renderAttributes(attributes, moduleId) {
    if (dom.attrSn) dom.attrSn.textContent = moduleId || 'USM0112208260078';
    if (!attributes || !Array.isArray(attributes)) return;

    attributes.forEach(attr => {
      if (attr.key === 'Serial Number (SN)' && dom.attrSn) dom.attrSn.textContent = attr.value;
      if (attr.key === 'Overall Status' && dom.attrStatus) dom.attrStatus.textContent = attr.value;
      if (attr.key === 'EL Grade Classification' && dom.attrElGrade) dom.attrElGrade.textContent = attr.value;
      if (attr.key === 'Rework Trace Status' && dom.attrRework) dom.attrRework.textContent = attr.value;
      if (attr.key === 'Latest Inspection Timestamp' && dom.attrTimestamp) dom.attrTimestamp.textContent = attr.value;
    });
  }

  // ---------------------------------------------------------------------------
  // Render Dual-Axis I-V & P-V Curve Chart
  // Exact Match: Left Axis Current (0-18A), Right Axis Power (0-700W), Bottom Voltage (0-60V)
  // ---------------------------------------------------------------------------
  function renderIvPvCurveSvg(ivPoints, pvPoints, params) {
    if (!dom.chartSvg || !ivPoints || ivPoints.length === 0) return;

    const w = 760;
    const h = 380;
    const padL = 55;
    const padR = 55;
    const padT = 30;
    const padB = 40;

    const graphW = w - padL - padR; // 650
    const graphH = h - padT - padB; // 310

    const maxV = 60.0;  // X-axis: 0 to 60 V
    const maxI = 18.0;  // Left Y-axis: 0 to 18 A
    const maxP = 700.0; // Right Y-axis: 0 to 700 W

    const scaleX = (v) => padL + (v / maxV) * graphW;
    const scaleY_I = (i) => padT + graphH - (i / maxI) * graphH;
    const scaleY_P = (p) => padT + graphH - (p / maxP) * graphH;

    let svg = '';

    // 1. Gridlines & Axes
    for (let v = 0; v <= 60; v += 10) {
      const x = scaleX(v);
      svg += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + graphH}" stroke="#162236" stroke-width="1" stroke-dasharray="3,3"/>`;
      svg += `<text x="${x}" y="${padT + graphH + 20}" fill="#7c8ba1" font-size="11" font-family="JetBrains Mono" font-weight="600" text-anchor="middle">${v} V</text>`;
    }

    // Bottom Axis Label
    svg += `<text x="${padL + graphW / 2}" y="${h - 6}" fill="#94a3b8" font-size="11" font-family="Inter" font-weight="700" text-anchor="middle">Voltage V (V) ►</text>`;

    // Horizontal Gridlines & Left/Right Ticks
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const curI = (maxI / steps) * s;
      const curP = Math.round((maxP / steps) * s);
      const y = scaleY_I(curI);

      svg += `<line x1="${padL}" y1="${y}" x2="${padL + graphW}" y2="${y}" stroke="#162236" stroke-width="1" stroke-dasharray="3,3"/>`;
      // Left axis tick (Blue)
      svg += `<text x="${padL - 10}" y="${y + 4}" fill="#38bdf8" font-size="11" font-family="JetBrains Mono" font-weight="700" text-anchor="end">${curI.toFixed(1)} A</text>`;
      // Right axis tick (Gold)
      svg += `<text x="${padL + graphW + 10}" y="${y + 4}" fill="#f59e0b" font-size="11" font-family="JetBrains Mono" font-weight="700" text-anchor="start">${curP} W</text>`;
    }

    // Left Axis Header Label
    svg += `<text x="${padL}" y="${padT - 12}" fill="#38bdf8" font-size="11" font-family="Inter" font-weight="700" text-anchor="start">▲ Current I (A)</text>`;
    // Right Axis Header Label
    svg += `<text x="${padL + graphW}" y="${padT - 12}" fill="#f59e0b" font-size="11" font-family="Inter" font-weight="700" text-anchor="end">▲ Power P (W)</text>`;

    // Outer Graph Border
    svg += `<rect x="${padL}" y="${padT}" width="${graphW}" height="${graphH}" fill="none" stroke="#1e2c42" stroke-width="1.2"/>`;

    // 2. Measured P-V Curve (Power vs Voltage, Gold)
    let pvPath = '';
    pvPoints.forEach((pt, idx) => {
      const x = scaleX(pt.v);
      const y = scaleY_P(pt.p);
      pvPath += `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    svg += `<path d="${pvPath}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

    // 3. Measured I-V Curve (Current vs Voltage, Cyan/Blue)
    let ivPath = '';
    ivPoints.forEach((pt, idx) => {
      const x = scaleX(pt.v);
      const y = scaleY_I(pt.i);
      ivPath += `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    svg += `<path d="${ivPath}" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="drop-shadow(0 0 6px rgba(56, 189, 248, 0.45))"/>`;

    // 4. Annotations
    const isc = params.isc_a || 13.56;
    const voc = params.voc_v || 50.35;
    const vmp = params.vmp_v || 42.28;
    const imp = params.imp_a || 12.88;
    const pmax = params.pmax_w || 544.6;

    const iscY = scaleY_I(isc);
    const iscX0 = scaleX(0);
    const iscX1 = scaleX(15);

    // A. Isc Horizontal Dashed Guideline & Callout Badge
    svg += `<line x1="${iscX0}" y1="${iscY}" x2="${iscX1}" y2="${iscY}" stroke="#0284c7" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    svg += `<circle cx="${iscX0}" cy="${iscY}" r="5" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5"/>`;
    
    // Isc Pill Tag
    const iscTagW = 86;
    const iscTagH = 22;
    const iscTagX = scaleX(1.5);
    const iscTagY = iscY - iscTagH / 2;
    svg += `<rect x="${iscTagX}" y="${iscTagY}" width="${iscTagW}" height="${iscTagH}" rx="4" fill="#0c182c" stroke="#0284c7" stroke-width="1.2"/>`;
    svg += `<circle cx="${iscTagX + 8}" cy="${iscTagY + 11}" r="3.5" fill="#38bdf8"/>`;
    svg += `<text x="${iscTagX + 17}" y="${iscTagY + 15}" fill="#38bdf8" font-size="10.5" font-family="JetBrains Mono" font-weight="700">Isc = ${isc.toFixed(2)} A</text>`;

    // B. Voc Callout Badge at (Voc, 0)
    const vocX = scaleX(voc);
    const vocY = scaleY_I(0);
    svg += `<circle cx="${vocX}" cy="${vocY}" r="5" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5"/>`;

    const vocTagW = 90;
    const vocTagH = 22;
    const vocTagX = vocX - vocTagW / 2;
    const vocTagY = vocY - 32;
    svg += `<rect x="${vocTagX}" y="${vocTagY}" width="${vocTagW}" height="${vocTagH}" rx="4" fill="#0c182c" stroke="#0284c7" stroke-width="1.2"/>`;
    svg += `<text x="${vocTagX + vocTagW / 2}" y="${vocTagY + 15}" fill="#38bdf8" font-size="10.5" font-family="JetBrains Mono" font-weight="700" text-anchor="middle">Voc = ${voc.toFixed(2)} V</text>`;

    // C. MPP Vertical Guideline, Dots, and Pmax Callout
    const mppX = scaleX(vmp);
    const mppY_I = scaleY_I(imp);
    const mppY_P = scaleY_P(pmax);
    const mppY_Base = scaleY_I(0);

    svg += `<line x1="${mppX}" y1="${mppY_Base}" x2="${mppX}" y2="${mppY_P - 8}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,4"/>`;
    svg += `<circle cx="${mppX}" cy="${mppY_I}" r="6" fill="#38bdf8" stroke="#ffffff" stroke-width="2"/>`;
    svg += `<circle cx="${mppX}" cy="${mppY_P}" r="6" fill="#f59e0b" stroke="#ffffff" stroke-width="2"/>`;

    const pmaxTagW = 120;
    const pmaxTagH = 34;
    const pmaxTagX = mppX - pmaxTagW / 2;
    const pmaxTagY = mppY_P - pmaxTagH - 8;

    svg += `<rect x="${pmaxTagX}" y="${pmaxTagY}" width="${pmaxTagW}" height="${pmaxTagH}" rx="5" fill="#6d3208" stroke="#d97706" stroke-width="1.4"/>`;
    svg += `<text x="${pmaxTagX + pmaxTagW / 2}" y="${pmaxTagY + 14}" fill="#fbbf24" font-size="11" font-family="Inter" font-weight="800" text-anchor="middle">Pmax = ${pmax.toFixed(1)} W</text>`;
    svg += `<text x="${pmaxTagX + pmaxTagW / 2}" y="${pmaxTagY + 28}" fill="#fde68a" font-size="9.5" font-family="JetBrains Mono" font-weight="600" text-anchor="middle">MPP (${vmp.toFixed(2)}V, ${imp.toFixed(2)}A)</text>`;

    dom.chartSvg.innerHTML = svg;
    attachChartInteractivity(scaleX, scaleY_I, scaleY_P, padL, padT, graphW, graphH, ivPoints, pvPoints);
  }

  // ---------------------------------------------------------------------------
  // Attach Interactive Hover Crosshair on I-V & P-V Chart
  // ---------------------------------------------------------------------------
  function attachChartInteractivity(scaleX, scaleY_I, scaleY_P, padL, padT, graphW, graphH, ivPoints, pvPoints) {
    if (!dom.chartSvg || !dom.chartTooltip) return;

    dom.chartSvg.onmousemove = (e) => {
      const rect = dom.chartSvg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (mouseX < padL || mouseX > padL + graphW || mouseY < padT || mouseY > padT + graphH) {
        dom.chartTooltip.style.display = 'none';
        return;
      }

      const normX = (mouseX - padL) / graphW;
      const targetV = normX * 60.0;

      let closestIdx = 0;
      let minDiff = 999;
      ivPoints.forEach((pt, idx) => {
        const diff = Math.abs(pt.v - targetV);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      });

      const ptI = ivPoints[closestIdx];
      const ptP = pvPoints[closestIdx];
      if (!ptI || !ptP) return;

      dom.chartTooltip.style.display = 'block';
      dom.chartTooltip.style.left = `${Math.min(rect.width - 150, mouseX + 15)}px`;
      dom.chartTooltip.style.top = `${Math.max(10, mouseY - 45)}px`;
      dom.chartTooltip.innerHTML = `
        <div style="font-weight:700; color:#38bdf8;">V: ${ptI.v.toFixed(2)} V</div>
        <div style="color:#7dd3fc;">I: ${ptI.i.toFixed(2)} A</div>
        <div style="color:#f59e0b;">P: ${ptP.p.toFixed(1)} W</div>
      `;
    };

    dom.chartSvg.onmouseleave = () => {
      dom.chartTooltip.style.display = 'none';
    };
  }

  // ---------------------------------------------------------------------------
  // Render Recent Module Pmax Historical Run Chart
  // ---------------------------------------------------------------------------
  function renderRunChart(runChart) {
    if (!dom.runChartSvg || !runChart || !Array.isArray(runChart) || runChart.length === 0) return;

    const w = 460;
    const h = 110;
    const padL = 36;
    const padR = 20;
    const padT = 16;
    const padB = 24;

    const graphW = w - padL - padR;
    const graphH = h - padT - padB;

    const minP = 542.0;
    const maxP = 548.0;

    const scaleX = (idx) => padL + (idx / (runChart.length - 1)) * graphW;
    const scaleY = (p) => padT + graphH - ((p - minP) / (maxP - minP)) * graphH;

    let svg = '';

    const y540 = scaleY(544.0);
    svg += `<line x1="${padL}" y1="${y540}" x2="${padL + graphW}" y2="${y540}" stroke="#065f46" stroke-width="1.2" stroke-dasharray="3,3"/>`;
    svg += `<text x="${padL - 6}" y="${y540 + 3}" fill="#10b981" font-size="9.5" font-family="JetBrains Mono" text-anchor="end">544W</text>`;

    [542, 545, 548].forEach(val => {
      const y = scaleY(val);
      svg += `<line x1="${padL}" y1="${y}" x2="${padL + graphW}" y2="${y}" stroke="#162236" stroke-width="1"/>`;
      svg += `<text x="${padL - 6}" y="${y + 3}" fill="#64748b" font-size="9" font-family="JetBrains Mono" text-anchor="end">${val}W</text>`;
    });

    let path = '';
    runChart.forEach((pt, idx) => {
      const x = scaleX(idx);
      const y = scaleY(pt.pmax);
      path += `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    svg += `<path d="${path}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>`;

    runChart.forEach((pt, idx) => {
      const x = scaleX(idx);
      const y = scaleY(pt.pmax);
      const isCurrent = (idx === runChart.length - 1 || pt.current);

      if (isCurrent) {
        svg += `<circle cx="${x}" cy="${y}" r="6" fill="#10b981" stroke="#ffffff" stroke-width="2"/>`;
        svg += `<text x="${x}" y="${y - 9}" fill="#10b981" font-size="10" font-family="JetBrains Mono" font-weight="800" text-anchor="middle">${pt.pmax.toFixed(1)}W</text>`;
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="#38bdf8"/>`;
      }
    });

    dom.runChartSvg.innerHTML = svg;
  }

  // ---------------------------------------------------------------------------
  // Render Power Bin Summary
  // ---------------------------------------------------------------------------
  function renderBinSummary(summary) {
    if (!summary) return;
    if (dom.valTotalTested) dom.valTotalTested.textContent = `${summary.total_tested || 154} modules`;

    if (dom.binStackedBar && summary.bins) {
      let barHtml = '';
      summary.bins.forEach(bin => {
        barHtml += `<div class="bin-seg" style="width: ${bin.pct}%; background-color: ${bin.color};" title="${bin.name}: ${bin.pct}%"></div>`;
      });
      dom.binStackedBar.innerHTML = barHtml;
    }

    if (dom.binLegendPills && summary.bins) {
      let pillsHtml = '';
      summary.bins.forEach(bin => {
        pillsHtml += `
          <div class="bin-pill">
            <span class="pill-dot" style="background:${bin.color};"></span>
            <span class="pill-name">${bin.name}</span>
            <span class="pill-pct">${bin.pct}% (${bin.count})</span>
          </div>
        `;
      });
      dom.binLegendPills.innerHTML = pillsHtml;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization Routine
  // ---------------------------------------------------------------------------
  function initTelemetry() {
    if (state.initialized) return;
    queryDomElements();

    if (!dom.chartSvg && !document.getElementById('pipeline-container')) {
      return; // Telemetry elements not present in this page
    }

    state.initialized = true;

    // Toggle Fullscreen if button exists
    if (dom.btnToggleFullscreen) {
      dom.btnToggleFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(err => {
            console.warn('Fullscreen request failed:', err);
          });
        } else {
          document.exitFullscreen().catch(err => {
            console.warn('Exit fullscreen failed:', err);
          });
        }
      });
    }

    // Toggle Attributes Collapsible Section
    if (dom.attributesToggleBtn && dom.attributesTableWrap && dom.attrChevron) {
      dom.attributesToggleBtn.addEventListener('click', () => {
        state.isAttributesCollapsed = !state.isAttributesCollapsed;
        if (state.isAttributesCollapsed) {
          dom.attributesTableWrap.style.display = 'none';
          dom.attrChevron.classList.add('collapsed');
        } else {
          dom.attributesTableWrap.style.display = 'block';
          dom.attrChevron.classList.remove('collapsed');
        }
      });
    }

    // Initialize SSE Conveyor Stream
    initSseConveyorStream();

    // Initial Telemetry load
    const urlParams = new URLSearchParams(window.location.search);
    const targetModule = urlParams.get('module_id') || state.moduleId || 'USM0112208260078';
    loadTelemetryForModule(targetModule);
  }

  // Export to window
  window.FVITelemetry = {
    loadTelemetryForModule,
    renderIvPvCurveSvg,
    renderRunChart,
    renderBinSummary,
    init: initTelemetry
  };

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTelemetry);
  } else {
    initTelemetry();
  }

})(typeof window !== 'undefined' ? window : this);
