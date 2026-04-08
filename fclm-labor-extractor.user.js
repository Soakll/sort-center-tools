// ==UserScript==
// @name         FCLM Labor Hours Extractor (Progress Bar & URL Fix Final)
// @namespace    http://tampermonkey.net/
// @version      0.19
// @description  Extract labor hours with nested subdivisions via parallel background chunking and simple progress bar
// @author       emanunec
// @match        https://fclm-portal.amazon.com/ppa/inspect/node*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`
        #fclm-extractor-btn {
            position: fixed; bottom: 30px; right: 30px; z-index: 10000;
            padding: 14px 28px; background: linear-gradient(135deg, #8b5cf6 0%, #c084fc 100%);
            color: #fff; border: none; border-radius: 50px; cursor: pointer;
            font-family: 'Amazon Ember', 'Inter', sans-serif; font-weight: 800; font-size: 14px;
            box-shadow: 0 8px 25px rgba(139, 92, 246, 0.4); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            display: flex; align-items: center; gap: 10px; border: 1px solid rgba(255,255,255,0.2);
        }
        #fclm-extractor-btn:hover { transform: scale(1.05) translateY(-5px); box-shadow: 0 12px 30px rgba(139, 92, 246, 0.5); }

        #fclm-panel-overlay {
            position: fixed; inset: 0; background: rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(4px); z-index: 10002;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; pointer-events: none; transition: opacity 0.4s;
        }
        #fclm-panel-overlay.active { opacity: 1; pointer-events: auto; }

        #fclm-results-panel {
            position: fixed;
            background: rgba(26, 26, 46, 0.75);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            color: #f0f0f5; width: 1400px; height: 85vh;
            border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            font-family: 'Amazon Ember', 'Inter', -apple-system, system-ui, sans-serif;
            transform: scale(0.9); transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            resize: both; min-width: 900px; min-height: 500px;
            top: 50%; left: 50%; transform: scale(0.9) translate(-50%, -50%);
            transform-origin: center;
        }
        #fclm-panel-overlay.active #fclm-results-panel { transform: scale(1) translate(-50%, -50%); }

        .fclm-header {
            padding: 15px 28px; background: rgba(255, 255, 255, 0.03);
            display: flex; justify-content: space-between; align-items: center;
            cursor: move; user-select: none; border-bottom: 1px solid rgba(255,255,255,0.05);
        }

        .fclm-controls-bar {
            padding: 10px 28px; background: rgba(255, 255, 255, 0.02);
            display: flex; flex-wrap: wrap; gap: 15px; align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .fclm-input {
            background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255,255,255,0.1);
            color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 13px; outline: none;
            transition: all 0.2s;
        }
        .fclm-input:focus { border-color: rgba(139, 92, 246, 0.5); background: rgba(255,255,255,0.12); }
        .fclm-input option { background: #1a1a2e; color: #fff; }
        .fclm-label { color: rgba(167, 139, 250, 0.8); font-weight: 700; font-size: 11px; letter-spacing: 0.5px; }

        #fclm-run-search-btn {
             padding: 10px 20px; background: rgba(139, 92, 246, 0.6); color: #fff;
            border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-weight: 800;
            cursor: pointer; transition: all 0.3s;
            min-width: 150px; text-align: center; backdrop-filter: blur(10px);
        }
        #fclm-run-search-btn:hover { background: rgba(139, 92, 246, 0.8); transform: translateY(-1px); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3); }
        #fclm-run-search-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .fclm-content { padding: 25px 28px; flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }

        .fclm-footer {
            padding: 15px 28px; display: flex; justify-content: flex-end; gap: 12px;
            background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.05);
        }

        .btn-panel {
            padding: 10px 22px; border-radius: 8px; font-weight: 700; cursor: pointer;
            transition: all 0.2s; border: 1px solid rgba(255,255,255,0.08);
        }
        .btn-copy { background: rgba(139, 92, 246, 0.6); color: #fff; }
        .btn-copy:hover { background: rgba(139, 92, 246, 0.8); transform: translateY(-1px); }
        .btn-close { background: rgba(255, 255, 255, 0.05); color: #ccc; }
        .btn-close:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

        .fclm-summary-stats {
            display: flex; flex-direction: column; align-items: center; padding: 6px 18px;
            background: rgba(139, 92, 246, 0.08); border-radius: 12px;
            border: 1px solid rgba(139, 92, 246, 0.15);
            min-width: 160px; justify-content: center; backdrop-filter: blur(10px);
        }

        /* Loading Area */
        .fclm-loading-container { background: rgba(255,255,255,0.03); padding: 30px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); width: 80%; margin: 0 auto; }
        .progress-bar-bg { width: 100%; height: 12px; background: rgba(255,255,255,0.1); border-radius: 10px; overflow: hidden; margin-top: 15px; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%); width: 0%; transition: width 0.3s; }

        /* Chart Styles */
        .chart-row { margin-bottom: 28px; transition: transform 0.2s; }
        .chart-row:hover { transform: translateX(5px); }
        .main-group { margin-bottom: 10px; }
        .main-info { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px; }
        .main-info b { font-size: 15px; color: #a78bfa; letter-spacing: 0.5px; }
        .main-info .total-stats { font-size: 12px; font-family: 'Roboto Mono', monospace; color: #c084fc; opacity: 0.9; }
        .chart-bar-bg { width: 100%; height: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 10px; overflow: hidden; }
        .chart-bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed 0%, #a855f7 100%); width: 0; transition: width 1.2s cubic-bezier(0.22, 1, 0.36, 1); border-radius: 10px; }
        .sub-division { margin-top: 12px; padding-left: 24px; border-left: 2px solid rgba(139,92,246,0.15); display: flex; flex-direction: column; gap: 6px; }
        .sub-row { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; padding: 4px 8px; border-radius: 4px; transition: background 0.2s; }
        .sub-row:hover { background: rgba(255,255,255,0.03); color: #fff; }
        .sub-name { font-weight: 600; width: 350px; }
        .sub-val { font-family: 'Roboto Mono', monospace; color: #a78bfa; }

        .fclm-footer { padding: 20px 28px; background: #16213e; display: flex; gap: 14px; justify-content: flex-end; border-top: 1px solid rgba(255,255,255,0.05); }
        .panel-btn { padding: 12px 28px; border-radius: 8px; cursor: pointer; border: none; font-weight: 800; font-size: 14px; transition: all 0.2s; }
        .btn-copy { background: #8b5cf6; color: #fff; }
        .btn-copy:hover { background: #7c3aed; }
        .btn-close { background: rgba(255,255,255,0.05); color: #94a3b8; border: 1px solid rgba(255,255,255,0.1); }
        .btn-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

        .fclm-summary-stats {
            display: flex; flex-direction: column; align-items: center; padding: 4px 15px;
            background: rgba(139, 92, 246, 0.1); border-radius: 8px;
            border: 1px solid rgba(139, 92, 246, 0.2);
            min-width: 160px; justify-content: center;
        }
        .fclm-summary-grid { display: flex; gap: 25px; width: 100%; justify-content: center; }
        .fclm-summary-item { display: flex; flex-direction: column; align-items: center; }
        .fclm-summary-label { font-size: 9px; color: #a78bfa; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; }
        .fclm-summary-value { color: #fff; font-family: 'Roboto Mono', monospace; font-weight: 800; font-size: 14px; }
        /* Loading Area Skeleton */
        .fclm-skeleton-container { display: flex; flex-direction: column; gap: 35px; width: 100%; }

        @keyframes fclm-shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        .fclm-skeleton {
            position: relative; overflow: hidden;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
        }
        .fclm-skeleton::after {
            content: ""; position: absolute; inset: 0;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
            animation: fclm-shimmer 1.8s infinite cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes fclm-reveal {
            from { clip-path: inset(0 100% 0 0); opacity: 0; transform: translateX(-10px); }
            to { clip-path: inset(0 0 0 0); opacity: 1; transform: translateX(0); }
        }
        .fclm-animate-entry {
            animation: fclm-reveal 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
    `);

    function generateSkeletons() {
        let html = '<div class="fclm-skeleton-container">';
        for (let i = 0; i < 4; i++) {
            html += `
                <div style="display:flex; flex-direction:column; gap:12px;">
                    <div class="fclm-skeleton" style="width:250px; height:24px;"></div>
                    <div class="fclm-skeleton" style="width:100%; height:12px; border-radius:10px;"></div>
                    <div style="display:flex; gap:15px; margin-left:20px;">
                        <div class="fclm-skeleton" style="width:120px; height:14px;"></div>
                        <div class="fclm-skeleton" style="width:100px; height:14px; margin-left:auto;"></div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    let globalResults = [];
    let lastInductStats = { pallets: 0, pacotes: 0 };
    let lastUpdateTime = "";
    let refreshTimer = null;
    let countdownTimer = null;
    let secondsLeft = 0;

    function formatHHMM(decimalHours) {
        const totalMinutes = Math.round(decimalHours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        return `${h}h${String(m).padStart(2, '0')}m`;
    }

    function generateTimeOptions() {
        let opts = '';
        for (let h = 0; h < 24; h++) {
            for (let m of [0, 15, 30, 45]) {
                const hh = String(h).padStart(2, '0');
                const mm = String(m).padStart(2, '0');
                opts += `<option value="${hh}:${mm}">${hh}h${mm}</option>`;
            }
        }
        return opts;
    }

    function parseDateTime(dateStr, timeStr) {
        const [h, m] = timeStr.split(':');
        let d = new Date(dateStr + 'T00:00:00');
        d.setHours(parseInt(h), parseInt(m), 0, 0);
        return d;
    }

    function getChunks(startDate, endDate) {
        let chunks = [];
        let current = new Date(startDate);
        while (current < endDate) {
            let next = new Date(current);
            next.setHours(next.getHours() + 24);
            if (next > endDate) next = new Date(endDate);
            chunks.push({ start: new Date(current), end: new Date(next) });
            current = next;
        }
        return chunks;
    }

    function buildFclmUrl(startDt, endDt) {
        let url = new URL('https://fclm-portal.amazon.com/ppa/inspect/node');
        const nodeInput = document.getElementById('fclm-node-input');
        if (nodeInput) {
            const val = nodeInput.value.toUpperCase();
            url.searchParams.set('warehouseId', val);
            url.searchParams.set('warehouseid', val); // case-sensitivity safety
            url.searchParams.set('node', val);
            url.searchParams.set('nodeType', 'SC');
        }

        // Formata para o padrão FCLM (YYYY/MM/DD) com o horário local real
        const formatFCLMDate = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}/${mm}/${dd}`;
        };

        // Usa os parâmetros EXATOS da sua URL
        url.searchParams.set('spanType', 'Intraday');
        url.searchParams.set('maxIntradayDays', '1');

        url.searchParams.set('startDateIntraday', formatFCLMDate(startDt));
        url.searchParams.set('startHourIntraday', startDt.getHours());
        url.searchParams.set('startMinuteIntraday', startDt.getMinutes());

        url.searchParams.set('endDateIntraday', formatFCLMDate(endDt));
        url.searchParams.set('endHourIntraday', endDt.getHours());
        url.searchParams.set('endMinuteIntraday', endDt.getMinutes());

        return url.href;
    }

    function extractDataToMap(doc, resultsMap, inductStats) {
        const table = Array.from(doc.querySelectorAll('table')).find(t => t.innerText.includes('Labor Process') && t.innerText.includes('Units'));
        if (!table) return;

        const headers = Array.from(table.querySelectorAll('tr')).find(tr => tr.innerText.includes('Labor Process') && tr.innerText.includes('Units'));
        if (!headers) return;

        const hCells = Array.from(headers.querySelectorAll('th, td'));

        const getXBounds = (txt) => {
            const cell = hCells.find(h => h.innerText.trim() === txt);
            if (!cell) return null;
            const rect = cell.getBoundingClientRect();
            return { center: (rect.left + rect.right) / 2, left: rect.left, right: rect.right };
        };

        const colLp = getXBounds('Labor Process');
        const colAttr = getXBounds('Attributes');
        const colUnits = getXBounds('Units');
        const colQty = getXBounds('Quantity');
        const colHrs = getXBounds('Hours');

        if (!colLp || !colHrs) return;

        let curLP = "";

        table.querySelectorAll('tr').forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 2) return;

            const lpCell = cells.find(c => {
                const rect = c.getBoundingClientRect();
                return rect.left < colLp.center && rect.right > colLp.center;
            });
            if (lpCell) {
                const txt = lpCell.innerText.trim();
                if (txt && !txt.toLowerCase().includes('total')) curLP = txt;
            }

            if (!curLP || row.innerText.toLowerCase().includes('total') || row.classList.contains('total')) return;

            const getValByX = (bounds) => {
                if (!bounds) return 0;
                const cell = cells.find(c => {
                    const rect = c.getBoundingClientRect();
                    return rect.left < bounds.center && rect.right > bounds.center;
                });
                return parseFloat(cell?.innerText.replace(/,/g, '')) || 0;
            };

            const uVal = getValByX(colUnits);
            const qVal = getValByX(colQty);
            const hVal = getValByX(colHrs);

            if (hVal > 0 || uVal > 0 || qVal > 0) {
                let entry = resultsMap.get(curLP);
                if (!entry) {
                    entry = { name: curLP, totalHours: 0, totalUnits: 0, totalQty: 0, subGroups: [] };
                    resultsMap.set(curLP, entry);
                }

                let attrsRaw = [];
                cells.forEach(c => {
                    const rect = c.getBoundingClientRect();
                    const cCenter = (rect.left + rect.right) / 2;
                    if (colAttr && cCenter >= colAttr.left && cCenter <= colAttr.right) {
                        const t = c.innerText.trim();
                        if (t && t !== "-") attrsRaw.push(t);
                    }
                });

                const ignoreWords = ['pallet', 'shuttle', 'bag', 'package', 'container'];
                let allWords = attrsRaw.flatMap(a => a.split(/[\s\-]+/));
                let filteredWords = allWords.filter(w => {
                    const wl = w.toLowerCase();
                    return wl && !ignoreWords.includes(wl) && wl !== "-";
                });
                const subName = [...new Set(filteredWords)].join(' ') || "Geral";

                if (curLP.trim() === "Induct") {
                    const hasTargetAttr = attrsRaw.some(a => {
                        const al = a.toLowerCase();
                        return al.includes("pallet") || al.includes("shuttle");
                    });
                    const isUpcount = attrsRaw.some(a => /IB_UPCONT|IB_UPCOUNT/i.test(a));
                    if (hasTargetAttr && isUpcount) {
                        inductStats.pallets += uVal;
                        inductStats.pacotes += qVal;
                    }
                }

                entry.totalHours += hVal; entry.totalUnits += uVal; entry.totalQty += qVal;

                let sub = entry.subGroups.find(s => s.name === subName);
                if (!sub) {
                    sub = { name: subName, hours: 0, units: 0, quantity: 0 };
                    entry.subGroups.push(sub);
                }
                sub.hours += hVal; sub.units += uVal; sub.quantity += qVal;
            }
        });
    }

    async function runSearch() {
        const dtFrom = document.getElementById('fclm-dt-from').value;
        const tmFrom = document.getElementById('fclm-tm-from').value;
        const dtTo = document.getElementById('fclm-dt-to').value;
        const tmTo = document.getElementById('fclm-tm-to').value;
        const btnSearch = document.getElementById('fclm-run-search-btn');
        const chartBody = document.getElementById('fclm-chart-body');
        const summaryContainer = document.getElementById('fclm-induct-summary');

        if (!dtFrom || !dtTo) return alert('Selecione as datas.');

        const startDate = parseDateTime(dtFrom, tmFrom);
        const endDate = parseDateTime(dtTo, tmTo);

        if (startDate >= endDate) return alert('Data Final deve ser maior que a Inicial.');

        // UI Reset
        btnSearch.disabled = true;
        btnSearch.innerText = '⏳ Processando...';
        chartBody.innerHTML = `
            <div class="fclm-loading-container" style="margin-bottom: 25px;">
                <div style="text-align:center; font-weight:800; color:#a78bfa; margin-bottom:10px; font-size: 14px; letter-spacing: 0.5px;">EXTRAÇÃO EM CURSO</div>
                <div class="progress-bar-bg"><div class="progress-bar-fill" id="fclm-progress-fill"></div></div>
                <div id="fclm-progress-text" style="text-align:center; font-size:11px; font-family:'Roboto Mono', monospace; color:rgba(255,255,255,0.6); margin-top:10px; font-weight:700;">0% (0/0)</div>
            </div>
            ${generateSkeletons()}
        `;
        if (summaryContainer) summaryContainer.innerHTML = '';

        // State Reset
        let mainResultsMap = new Map();
        globalResults = [];
        lastInductStats = { pallets: 0, pacotes: 0 };

        const chunks = getChunks(startDate, endDate);
        const totalChunks = chunks.length;

        try {
            for (let i = 0; i < totalChunks; i++) {
                const chunk = chunks[i];
                const url = buildFclmUrl(chunk.start, chunk.end);
                
                // Update Progress UI
                const progressPct = Math.round((i / totalChunks) * 100);
                const fillEl = document.getElementById('fclm-progress-fill');
                const textEl = document.getElementById('fclm-progress-text');
                if (fillEl) fillEl.style.width = progressPct + '%';
                if (textEl) textEl.innerText = `${progressPct}% (${i + 1}/${totalChunks})`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout per chunk

                let iframe = document.createElement('iframe');
                try {
                    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const html = await res.text();

                    iframe.style.position = 'fixed';
                    iframe.style.top = '-10000px';
                    iframe.style.width = '1920px';
                    iframe.style.height = '1080px';
                    iframe.style.visibility = 'hidden';
                    document.body.appendChild(iframe);

                    iframe.contentDocument.open();
                    iframe.contentDocument.write(html);
                    iframe.contentDocument.close();

                    // Wait for layout/rendering
                    await new Promise(r => setTimeout(r, 1200)); 
                    
                    extractDataToMap(iframe.contentDocument, mainResultsMap, lastInductStats);
                } catch (chunkErr) {
                    console.error(`Erro no chunk ${i+1}:`, chunkErr);
                } finally {
                    clearTimeout(timeoutId);
                    if (iframe && iframe.parentNode) {
                        document.body.removeChild(iframe);
                    }
                }
            }

            // Final Progress Update
            const finalFill = document.getElementById('fclm-progress-fill');
            const finalText = document.getElementById('fclm-progress-text');
            if (finalFill) finalFill.style.width = '100%';
            if (finalText) finalText.innerText = '100% - Concluído';

            globalResults = Array.from(mainResultsMap.values()).filter(r => r.totalHours > 0);
            lastUpdateTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            
            renderResults(globalResults);

            if (summaryContainer && globalResults.length > 0) {
                summaryContainer.innerHTML = `
                    <div style="font-size: 8px; color: #a78bfa; font-weight: 800; text-transform: uppercase;">Crossdocking</div>
                    <div class="fclm-summary-grid">
                        <div class="fclm-summary-item">
                            <span class="fclm-summary-label">Pallets</span>
                            <span class="fclm-summary-value">${lastInductStats.pallets.toLocaleString()}</span>
                        </div>
                        <div class="fclm-summary-item">
                            <span class="fclm-summary-label">Pacotes</span>
                            <span class="fclm-summary-value">${lastInductStats.pacotes.toLocaleString()}</span>
                        </div>
                    </div>
                    <div style="font-size: 9px; color: rgba(255,255,255,0.4); margin-top: 2px;">Atualizado: ${lastUpdateTime}</div>
                `;
            }

        } catch (err) {
            console.error("Erro fatal na busca:", err);
            chartBody.innerHTML = `<div style="text-align:center; padding: 40px; color:#ef4444; font-weight:bold;">
                Erro crítico durante a extração: ${err.message}<br>
                Tente atualizar a página.
            </div>`;
        } finally {
            btnSearch.disabled = false;
            btnSearch.innerText = '▶ Buscar';
        }
    }

    function renderResults(results) {
        const container = document.getElementById('fclm-chart-body');
        if (!container) return;
        if (results.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color:#94a3b8;">Nenhum dado retornado neste período.</div>';
            return;
        }

        results.sort((a, b) => b.totalHours - a.totalHours);
        const maxH = Math.max(...results.map(r => r.totalHours));

        container.innerHTML = results.map(r => {
            const uph = r.totalHours > 0 ? (r.totalUnits / r.totalHours).toFixed(1) : "0";
            return `
            <div class="chart-row fclm-animate-entry">
                <div class="main-group">
                    <div class="main-info">
                        <b>${r.name}</b>
                        <span class="total-stats">${formatHHMM(r.totalHours)} - ${r.totalUnits.toLocaleString()}(un) - ${uph} UPH</span>
                    </div>
                    <div class="chart-bar-bg"><div class="chart-bar-fill" style="width:0%" data-w="${(r.totalHours / maxH) * 100}%"></div></div>
                </div>
                <div class="sub-division">
                    ${r.subGroups.sort((a, b) => b.hours - a.hours).map(s => {
                const subUph = s.hours > 0 ? (s.units / s.hours).toFixed(1) : "0";
                return `
                        <div class="sub-row">
                            <span class="sub-name">${s.name}</span>
                            <span class="sub-val">${formatHHMM(s.hours)} | ${s.units.toLocaleString()} un | ${subUph} UPH</span>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `}).join('');

        setTimeout(() => document.querySelectorAll('.chart-bar-fill').forEach(b => b.style.width = b.dataset.w), 100);
    }

    function copyToClipboard() {
        if (!globalResults.length) return alert('Nenhum dado para copiar.');
        let txt = "Labor Process\tChild Process/Package\tUnits\tUPH\tHours (HHMM)\n";
        globalResults.forEach(r => {
            const uph = r.totalHours > 0 ? (r.totalUnits / r.totalHours).toFixed(1).replace('.', ',') : "0";
            txt += `${r.name}\tTOTAL\t${r.totalUnits}\t${uph}\t${formatHHMM(r.totalHours)}\n`;
            r.subGroups.forEach(s => {
                const subUph = s.hours > 0 ? (s.units / s.hours).toFixed(1).replace('.', ',') : "0";
                txt += `${r.name}\t${s.name}\t${s.units}\t${subUph}\t${formatHHMM(s.hours)}\n`;
            });
        });
        GM_setClipboard(txt);
        alert('Dados detalhados copiados!');
    }

    function openPanel() {
        let overlay = document.getElementById('fclm-panel-overlay');
        if (!overlay) {
            const today = new Date();
            const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            const params = new URL(window.location.href).searchParams;
            const urlNode = params.get('warehouseId') || params.get('node') || 'CGH7';

            overlay = document.createElement('div');
            overlay.id = 'fclm-panel-overlay';
            overlay.innerHTML = `
                <div id="fclm-results-panel">
                    <div class="fclm-header">
                        <div style="font-size:18px; font-weight:800; color:#FF9900">Análise de Horas FCLM v0.19</div>
                        <button style="background:none; border:none; color:#9090b0; font-size:24px; cursor:pointer" id="fclm-close-x">&times;</button>
                    </div>

                    <div class="fclm-controls-bar">
                        <span class="fclm-label">NODE:</span>
                        <input type="text" id="fclm-node-input" class="fclm-input" value="${urlNode}" style="width: 70px; text-transform: uppercase; font-weight: 800; text-align: center;">

                        <span class="fclm-label" style="margin-left:5px;">INÍCIO:</span>
                        <input type="date" id="fclm-dt-from" class="fclm-input" value="${todayStr}">
                        <select id="fclm-tm-from" class="fclm-input">${generateTimeOptions()}</select>

                        <span class="fclm-label" style="margin-left:15px;">FIM:</span>
                        <input type="date" id="fclm-dt-to" class="fclm-input" value="${todayStr}">
                        <select id="fclm-tm-to" class="fclm-input">${generateTimeOptions()}</select>

                        <div id="fclm-induct-summary" class="fclm-summary-stats"></div>

                        <div style="display: flex; align-items: center; gap: 5px; margin-left: 15px; padding-left: 15px; border-left: 1px solid rgba(255,255,255,0.1);">
                            <input type="checkbox" id="fclm-auto-refresh-check" style="cursor:pointer">
                            <span class="fclm-label" style="font-size: 11px;">Auto (min):</span>
                            <select id="fclm-auto-refresh-interval" class="fclm-input" style="padding: 2px 5px; font-size: 11px;">
                                <option value="5">5</option>
                                <option value="10">10</option>
                                <option value="15">15</option>
                            </select>
                            <span id="fclm-refresh-countdown" style="font-family: 'Roboto Mono', monospace; font-size: 10px; color: #a78bfa; min-width: 45px; text-align: right;"></span>
                        </div>

                        <button id="fclm-run-search-btn">▶ Buscar</button>
                    </div>

                    <div class="fclm-content"><div id="fclm-chart-body"><div style="text-align:center; padding: 40px; color:#94a3b8;">Defina as datas acima e clique em Buscar para puxar os dados.</div></div></div>

                    <div class="fclm-footer">
                        <button class="panel-btn btn-close" id="panel-btn-close">Fechar</button>
                        <button class="panel-btn btn-copy" id="panel-btn-copy">📋 Copiar Excel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            document.getElementById('fclm-tm-from').value = "06:00";
            document.getElementById('fclm-tm-to').value = "18:00";

            const updateUI = () => {
                const el = document.getElementById('fclm-refresh-countdown');
                if (!el) return;
                if (secondsLeft <= 0) { el.innerText = ''; return; }
                const m = Math.floor(secondsLeft / 60);
                const s = secondsLeft % 60;
                el.innerText = `${m}:${String(s).padStart(2, '0')}`;
                secondsLeft--;
            };

            const handleAutoRefresh = () => {
                if (refreshTimer) clearTimeout(refreshTimer);
                if (countdownTimer) clearInterval(countdownTimer);
                document.getElementById('fclm-refresh-countdown').innerText = '';

                if (document.getElementById('fclm-auto-refresh-check').checked) {
                    const minutes = parseInt(document.getElementById('fclm-auto-refresh-interval').value);
                    secondsLeft = minutes * 60;

                    countdownTimer = setInterval(updateUI, 1000);
                    refreshTimer = setTimeout(() => {
                        if (document.getElementById('fclm-auto-refresh-check').checked) {
                            runSearch().then(() => handleAutoRefresh());
                        }
                    }, minutes * 60000);
                }
            };

            document.getElementById('fclm-auto-refresh-check').onchange = handleAutoRefresh;
            document.getElementById('fclm-auto-refresh-interval').onchange = handleAutoRefresh;

            const cleanup = () => {
                overlay.classList.remove('active');
                if (refreshTimer) clearTimeout(refreshTimer);
                if (countdownTimer) clearInterval(countdownTimer);
            };

            document.getElementById('fclm-close-x').onclick = cleanup;
            document.getElementById('panel-btn-close').onclick = cleanup;
            document.getElementById('fclm-run-search-btn').onclick = () => { runSearch(); handleAutoRefresh(); };
            document.getElementById('panel-btn-copy').onclick = copyToClipboard;

            if (globalResults.length > 0) {
                renderResults(globalResults);
                const summaryContainer = document.getElementById('fclm-induct-summary');
                if (summaryContainer) {
                    summaryContainer.innerHTML = `
                        <div style="font-size: 8px; color: #a78bfa; font-weight: 800; text-transform: uppercase;">Crossdocking</div>
                        <div class="fclm-summary-grid">
                            <div class="fclm-summary-item">
                                <span class="fclm-summary-label">Pallets</span>
                                <span class="fclm-summary-value">${lastInductStats.pallets.toLocaleString()}</span>
                            </div>
                            <div class="fclm-summary-item">
                                <span class="fclm-summary-label">Pacotes</span>
                                <span class="fclm-summary-value">${lastInductStats.pacotes.toLocaleString()}</span>
                            </div>
                        </div>
                        <div style="font-size: 9px; color: rgba(255,255,255,0.4); margin-top: 2px;">Atualizado: ${lastUpdateTime}</div>
                    `;
                }
            }

            // Drag Functionality
            const header = overlay.querySelector('.fclm-header');
            const panel = document.getElementById('fclm-results-panel');
            let isDragging = false;
            let offset = { x: 0, y: 0 };

            header.onmousedown = (e) => {
                if (e.target.id === 'fclm-close-x') return;
                isDragging = true;
                panel.style.transition = 'none';

                const rect = panel.getBoundingClientRect();
                panel.style.transform = 'none'; // Clear the translate(-50%)
                panel.style.left = rect.left + 'px';
                panel.style.top = rect.top + 'px';
                offset.x = e.clientX - rect.left;
                offset.y = e.clientY - rect.top;
            };

            document.onmousemove = (e) => {
                if (!isDragging) return;
                panel.style.left = (e.clientX - offset.x) + 'px';
                panel.style.top = (e.clientY - offset.y) + 'px';
            };

            document.onmouseup = () => {
                isDragging = false;
                panel.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            };
        }
        overlay.classList.add('active');
    }

    const btn = document.createElement('button');
    btn.id = 'fclm-extractor-btn';
    btn.innerHTML = '📊 Analisar Labor Detalhado';
    btn.onclick = openPanel;
    document.body.appendChild(btn);

})();