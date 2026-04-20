// ==UserScript==
// @name         FCLM Total Inspector
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Extrai e monitora totais de processos do FCLM Portal com interface premium
// @author       emanunec
// @match        https://fclm-portal.amazon.com/ppa/inspect/node?*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const styles = `
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');

        :root {
            --bg-deep:    #070b10;
            --bg-panel:   rgba(9, 14, 22, 0.98);
            --bg-card:    #0c1420;
            --border:     rgba(56, 139, 253, 0.15);
            --border-hi:  rgba(56, 139, 253, 0.4);
            --accent:     #388bfd;
            --accent-2:   #3fb950;
            --danger:     #f85149;
            --text-1:     #ffffff;
            --text-2:     #e6edf3;
            --text-3:     #8b949e;
            --mono:       'JetBrains Mono', monospace;
            --sans:       'Space Grotesk', sans-serif;
        }

        #fclm-inspector-panel {
            position: fixed;
            top: 20px; left: 20px; right: 20px;
            width: auto;
            max-height: calc(100vh - 40px);
            background: var(--bg-panel);
            backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid var(--border);
            border-radius: 12px;
            z-index: 999999;
            color: var(--text-1);
            font-family: var(--sans);
            display: none;
            flex-direction: column;
            box-shadow: 0 0 0 1px rgba(56,139,253,0.05), 0 24px 64px rgba(0,0,0,0.7);
            overflow: hidden;
            animation: fclm-slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes fclm-slide-in {
            from { transform: translateX(30px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        .fclm-header {
            padding: 12px 16px;
            background: rgba(255,255,255,0.02);
            border-bottom: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .fclm-header-title {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .fclm-logo {
            width: 28px; height: 28px;
            background: linear-gradient(135deg, var(--accent), #1f6feb);
            border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 800; color: #fff;
        }

        .fclm-header h3 {
            margin: 0;
            font-size: 14px; font-weight: 700;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: var(--text-1);
        }

        .fclm-content {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            grid-auto-rows: 1fr;
            gap: 16px;
        }
        
        .fclm-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 20px;
            transition: all 0.2s;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 180px;
        }

        .fclm-card:hover { border-color: var(--border-hi); transform: translateY(-2px); }

        .fclm-card::before {
            content: '';
            position: absolute;
            top: 0; left: 0; width: 4px; height: 100%;
            background: var(--accent);
            opacity: 0.6;
        }

        .fclm-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 10px;
        }

        .fclm-stat {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .fclm-stat-label {
            font-size: 10px;
            color: var(--text-3);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .fclm-stat-value {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-1);
            font-family: var(--mono);
        }

        .fclm-stat-value.highlight { color: var(--accent); }
        .fclm-stat-value.positive { color: var(--accent-2); }
        .fclm-stat-value.negative { color: var(--danger); }

        .fclm-footer {
            padding: 16px;
            background: rgba(0,0,0,0.2);
            border-top: 1px solid var(--border);
            display: flex;
            gap: 10px;
        }

        .fclm-btn {
            flex: 1;
            background: var(--accent);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            font-family: var(--sans);
        }

        .fclm-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .fclm-btn-secondary { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-2); }

        #fclm-toggle {
            position: fixed;
            bottom: 24px; right: 24px;
            width: 48px; height: 48px;
            background: linear-gradient(135deg, var(--accent), #1f6feb);
            color: #fff;
            border-radius: 12px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(56,139,253,0.4);
            z-index: 999998;
            font-weight: 700;
            border: none;
            transition: all 0.3s;
        }

        #fclm-toggle:hover { transform: scale(1.1) rotate(5deg); }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: var(--text-3); border-radius: 3px; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    const panel = document.createElement('div');
    panel.id = 'fclm-inspector-panel';
    panel.innerHTML = `
        <div class="fclm-header">
            <div class="fclm-header-title">
                <div class="fclm-logo">FC</div>
                <h3>FCLM Inspector <span id="fclm-node-id" style="color:var(--text-3); font-weight:400; font-size:12px; margin-left:8px;"></span></h3>
            </div>
            <button id="fclm-close" style="background:none; border:none; color:var(--text-3); cursor:pointer; font-size:20px;">×</button>
        </div>
        <div class="fclm-content" id="fclm-results">
            <div style="text-align:center; padding:40px; color:var(--text-3);">Nenhum dado capturado.</div>
        </div>
    `;

    const toggle = document.createElement('button');
    toggle.id = 'fclm-toggle';
    toggle.innerHTML = '📊';

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    let lastData = [];

    function scan() {
        const siteInput = document.getElementById('fcpn-site-input');
        if (siteInput) {
            document.getElementById('fclm-node-id').innerText = `node=${siteInput.value}`;
        }

        const rowsBody = document.querySelectorAll('.result-table tbody tr');
        const rowsFoot = document.querySelectorAll('.result-table tfoot tr');
        let results = [];

        let currentMain = "Core Ops";
        let currentCore = "General";
        let supportAgg = { quantity: 0, hours: 0, has: false };

        rowsBody.forEach(tr => {
            const cells = tr.cells;
            if (cells.length < 9) return;

            const mainText = cells[0].innerText.trim();
            if (mainText && mainText !== "Total" && mainText !== "Process" && !tr.classList.contains('main-process-total')) {
                currentMain = mainText;
            }

            const coreText = cells[1].innerText.trim();
            if (coreText && coreText !== "Total" && !tr.classList.contains('core-process-total')) {
                currentCore = coreText;
            }

            const isCoreTotal = (coreText === "Total" && (tr.classList.contains('core-process-total') || cells[1].classList.contains('core-process-total')));
            const isMainTotal = tr.classList.contains('main-process-total') && mainText.toLowerCase().includes('off task');

            if (isCoreTotal || isMainTotal) {
                const getVal = (idx) => cells[idx]?.innerText?.trim()?.replace(/,/g, '') || '0';
                const label = isMainTotal ? mainText : currentCore;
                const m = isMainTotal ? "Indirect" : currentMain;

                if (m.toLowerCase() === 'support') {
                    supportAgg.has = true;
                    supportAgg.quantity += parseFloat(getVal(5)) || 0;
                    supportAgg.hours += parseFloat(getVal(6)) || 0;
                } else {
                    results.push({
                        main: m,
                        core: label,
                        isWarehouse: false,
                        quantity: getVal(5),
                        hours: getVal(6),
                        qph: getVal(8)
                    });
                }
            }
        });

        if (supportAgg.has) {
            results.push({
                main: "Support",
                core: "Support Total",
                isWarehouse: false,
                quantity: supportAgg.quantity.toString(),
                hours: supportAgg.hours.toString(),
                qph: supportAgg.hours > 0 ? (supportAgg.quantity / supportAgg.hours).toString() : "0"
            });
        }

        rowsFoot.forEach(tr => {
            const cells = tr.cells;
            if (cells.length < 6) return;

            const firstCellText = cells[0].innerText.trim();
            if (firstCellText === "Warehouse Total") {
                const getVal = (idx) => cells[idx]?.innerText?.trim()?.replace(/,/g, '') || '0';
                results.push({
                    main: "Site Wide",
                    core: "Warehouse Total",
                    isWarehouse: true,
                    quantity: getVal(2),
                    hours: getVal(3),
                    qph: getVal(5)
                });
            }
        });

        const warehouseTotal = results.find(r => r.isWarehouse);
        const others = results.filter(r => !r.isWarehouse)
            .sort((a, b) => parseFloat(b.hours) - parseFloat(a.hours));

        lastData = warehouseTotal ? [...others, warehouseTotal] : others;
        render(lastData);
    }

    function render(data) {
        const container = document.getElementById('fclm-results');
        if (data.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-3);">Nenhum dado capturado.</div>`;
            return;
        }

        const warehouse = data.find(d => d.isWarehouse);
        const totalHours = warehouse ? parseFloat(warehouse.hours) : 0;
        const totalQPH = warehouse ? parseFloat(warehouse.qph) : 0;

        container.innerHTML = data.map(entry => {
            const isW = entry.isWarehouse;
            let topSection = '';
            let bottomSection = '';

            if (isW) {
                topSection = `
                    <div style="margin-top: 4px;">
                        <span class="fclm-stat-label">Total Quantity</span>
                        <div class="fclm-stat-value highlight" style="font-size:32px; color:var(--accent-2); margin-top: 4px;">${Number(entry.quantity).toLocaleString()}</div>
                    </div>
                    <div style="height:1px; background:rgba(255,255,255,0.05); margin: 12px 0;"></div>
                `;
                bottomSection = `
                    <div class="fclm-grid" style="grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 0;">
                        <div class="fclm-stat">
                            <span class="fclm-stat-label">Total Hours</span>
                            <span class="fclm-stat-value" style="font-size:22px;">${Number(entry.hours).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                        </div>
                        <div class="fclm-stat" style="text-align: right;">
                            <span class="fclm-stat-label">Site QPH</span>
                            <span class="fclm-stat-value positive" style="font-size:22px;">${Number(entry.qph).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                `;
            } else {
                const contribPct = totalHours > 0 ? (parseFloat(entry.hours) / totalHours) * 100 : 0;
                const qphImpact = (contribPct / 100) * totalQPH;

                topSection = `
                    <div class="fclm-grid" style="grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 12px;">
                        <div class="fclm-stat">
                            <span class="fclm-stat-label">Labor Contrib.</span>
                            <span class="fclm-stat-value highlight" style="font-size:28px;">${contribPct.toFixed(1)}%</span>
                        </div>
                        <div class="fclm-stat" style="text-align: right;">
                            <span class="fclm-stat-label">QPH Impact</span>
                            <span class="fclm-stat-value highlight" style="font-size:28px;">${qphImpact.toFixed(2)}<span style="font-size:12px; margin-left:4px; opacity:0.7;">pts</span></span>
                        </div>
                    </div>
                    <div style="height:1px; background:rgba(255,255,255,0.05); margin-bottom:12px;"></div>
                `;

                bottomSection = `
                    <div class="fclm-grid" style="grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 0;">
                        <div class="fclm-stat">
                            <span class="fclm-stat-label">Hours</span>
                            <span style="font-size:14px; font-weight:600; font-family:var(--mono);">${Number(entry.hours).toFixed(1)}</span>
                        </div>
                        <div class="fclm-stat">
                            <span class="fclm-stat-label">Core QPH</span>
                            <span style="font-size:14px; font-weight:600; font-family:var(--mono); color:var(--text-2);">${Number(entry.qph).toFixed(1)}</span>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="fclm-card" style="${isW ? 'border-color: var(--accent-2); background: rgba(63, 185, 80, 0.03);' : ''}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div style="display:flex; flex-direction:column; gap:0px;">
                            <span style="font-size:9px; color:var(--text-3); font-weight:700; text-transform:uppercase; letter-spacing:0.8px;">${entry.main}</span>
                            <span style="font-size:14px; font-weight:700; color:${isW ? 'var(--accent-2)' : 'var(--accent)'}; text-transform:uppercase;">${entry.core}</span>
                        </div>
                        <span style="font-size:8px; background:${isW ? 'rgba(63, 185, 80, 0.1)' : 'rgba(56, 139, 253, 0.08)'}; padding:1px 5px; border-radius:3px; color:${isW ? 'var(--accent-2)' : 'var(--accent)'}; border:1px solid ${isW ? 'var(--accent-2)' : 'var(--border)'}; letter-spacing:0.5px; font-weight:700;">${isW ? 'SITE TOTAL' : 'TOTAL'}</span>
                    </div>
                    
                    ${topSection}
                    ${bottomSection}
                </div>
            `;
        }).join('');
    }

    let autoScanInterval = null;

    toggle.onclick = () => {
        panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
        if (panel.style.display === 'flex') {
            scan();
            if (!autoScanInterval) {
                autoScanInterval = setInterval(() => {
                    if (panel.style.display === 'flex') scan();
                }, 10000);
            }
        } else {
            if (autoScanInterval) {
                clearInterval(autoScanInterval);
                autoScanInterval = null;
            }
        }
    };

    document.getElementById('fclm-close').onclick = () => {
        panel.style.display = 'none';
        if (autoScanInterval) {
            clearInterval(autoScanInterval);
            autoScanInterval = null;
        }
    };

})();
