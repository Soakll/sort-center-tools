// ==UserScript==
// @name         Oculus API Tester
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Teste da API Oculus getPackageDetailData
// @author       emanunec
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ib*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      logistics.amazon.com
// @connect      trans-logistics.amazon.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`
        #oculus-toggle {
            position: fixed; bottom: 70px; right: 20px;
            width: 38px; height: 38px;
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            color: #fff; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; z-index: 999998;
            font-weight: 700; font-size: 10px; border: none;
            box-shadow: 0 4px 20px rgba(124,58,237,0.4);
            transition: all 0.2s;
        }
        #oculus-toggle:hover { transform: scale(1.08); }

        #oculus-panel {
            position: fixed; bottom: 120px; right: 20px;
            width: 560px; max-height: 75vh;
            background: #0d1117;
            border: 1px solid rgba(124,58,237,0.3);
            border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            z-index: 999999;
            display: none;
            flex-direction: column;
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #e6edf3;
            overflow: hidden;
        }

        #oculus-panel .oc-header {
            padding: 12px 16px;
            background: rgba(124,58,237,0.1);
            border-bottom: 1px solid rgba(124,58,237,0.2);
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0;
        }
        #oculus-panel .oc-header h3 {
            margin: 0; font-size: 13px; font-weight: 700;
            color: #a855f7; letter-spacing: 0.5px;
        }

        #oculus-panel .oc-input-row {
            display: flex; gap: 8px; padding: 12px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
        }
        #oculus-input {
            flex: 1; background: #161b22;
            border: 1px solid rgba(124,58,237,0.3);
            border-radius: 8px; color: #e6edf3;
            padding: 8px 12px; font-size: 13px;
            font-family: 'Consolas', monospace;
            outline: none; transition: border-color 0.2s;
            resize: vertical;
            min-height: 40px;
            max-height: 150px;
        }
        #oculus-input:focus { border-color: #a855f7; }
        #oculus-input::placeholder { color: #484f58; }

        #oculus-send {
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            color: #fff; border: none; border-radius: 8px;
            padding: 8px 18px; font-size: 12px; font-weight: 700;
            cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        #oculus-send:hover { box-shadow: 0 0 16px rgba(124,58,237,0.4); }
        #oculus-send:disabled { opacity: 0.5; cursor: not-allowed; }

        .oc-tabs {
            display: flex; gap: 0;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
        }
        .oc-tab {
            padding: 8px 16px; font-size: 11px; font-weight: 600;
            color: #484f58; cursor: pointer;
            border: none; background: transparent;
            border-bottom: 2px solid transparent;
            transition: all 0.15s; letter-spacing: 0.3px;
        }
        .oc-tab:hover { color: #8b949e; }
        .oc-tab.active { color: #a855f7; border-bottom-color: #a855f7; }

        .oc-tab-pane {
            display: none; flex: 1; overflow: auto;
            min-height: 0; max-height: 50vh;
        }
        .oc-tab-pane.active { display: block; }

        #oculus-output {
            padding: 12px 16px;
            font-family: 'Consolas', monospace;
            font-size: 11px; line-height: 1.6;
            background: #0d1117;
            white-space: pre-wrap;
            word-break: break-all;
        }

        #oculus-logs {
            padding: 0;
            font-family: 'Consolas', monospace;
            font-size: 11px;
            background: #0d1117;
        }

        .oc-log-entry {
            padding: 8px 16px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            cursor: pointer;
            transition: background 0.15s;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .oc-log-entry:hover { background: rgba(124,58,237,0.06); }
        .oc-log-entry.selected { background: rgba(124,58,237,0.12); border-left: 3px solid #a855f7; }

        .oc-log-time { color: #484f58; font-size: 10px; min-width: 65px; flex-shrink: 0; }
        .oc-log-tid { color: #79c0ff; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .oc-log-status { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
        .oc-log-status.ok { background: rgba(63,185,80,0.15); color: #3fb950; }
        .oc-log-status.err { background: rgba(248,81,73,0.15); color: #f85149; }
        .oc-log-status.pending { background: rgba(124,58,237,0.15); color: #a855f7; }
        .oc-log-elapsed { color: #484f58; font-size: 10px; min-width: 40px; text-align: right; flex-shrink: 0; }

        .oc-log-empty {
            padding: 24px; text-align: center;
            color: #484f58; font-size: 12px;
            font-family: 'Segoe UI', sans-serif;
        }

        .json-key { color: #79c0ff; }
        .json-string { color: #a5d6ff; }
        .json-number { color: #ffab70; }
        .json-boolean { color: #ff7b72; }
        .json-null { color: #8b949e; }

        #oculus-status {
            padding: 8px 16px;
            font-size: 10px; color: #484f58;
            border-top: 1px solid rgba(255,255,255,0.04);
            display: flex; justify-content: space-between;
            flex-shrink: 0;
        }

        .oc-log-clear {
            background: none; border: 1px solid rgba(248,81,73,0.2);
            color: #f85149; cursor: pointer; font-size: 10px;
            font-weight: 600; padding: 3px 10px; border-radius: 6px;
            transition: all 0.15s; margin-left: auto;
        }
        .oc-log-clear:hover { background: rgba(248,81,73,0.1); }

        .oc-list-container {
            display: flex; flex-direction: column; gap: 12px; margin-top: 8px;
            font-family: 'Segoe UI', Arial, sans-serif;
        }
        .oc-card {
            background: #161b22;
            border: 1px solid rgba(255,255,255,0.08);
            border-left: 3px solid #a855f7;
            border-radius: 8px;
            padding: 12px 16px;
            display: flex; flex-direction: column; gap: 8px;
        }
        .oc-card:hover { border-color: rgba(124,58,237,0.4); }
        .oc-card-header {
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            padding-bottom: 8px; margin-bottom: 4px;
        }
        .oc-card-title {
            font-size: 13px; font-weight: 700; color: #79c0ff;
            font-family: 'Consolas', monospace;
        }
        .oc-card-status {
            font-size: 10px; font-weight: 700; padding: 2px 8px;
            border-radius: 12px; background: rgba(124,58,237,0.15); color: #a855f7;
        }
        .oc-card-body {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 16px;
        }
        .oc-card-desc {
            grid-column: 1 / -1;
            background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 6px;
            font-size: 11px; color: #c9d1d9; border: 1px solid rgba(255,255,255,0.03);
            white-space: normal; line-height: 1.4;
        }
        .oc-info-col { display: flex; flex-direction: column; gap: 2px; }
        .oc-info-label { font-size: 9px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
        .oc-info-value { font-size: 11px; color: #e6edf3; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `);

    const toggle = document.createElement('button');
    toggle.id = 'oculus-toggle';
    toggle.textContent = 'OC';
    toggle.title = 'Oculus API Tester';
    document.body.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'oculus-panel';
    panel.innerHTML = `
        <div class="oc-header">
            <h3>🔬 Oculus API Tester</h3>
            <button style="background:none;border:none;color:#484f58;cursor:pointer;font-size:16px;padding:0 4px;" title="Fechar">✕</button>
        </div>
        <div class="oc-input-row">
            <textarea id="oculus-input" placeholder="TBR... TBR..." spellcheck="false"></textarea>
            <button id="oculus-send">▶ Enviar</button>
        </div>
        <div class="oc-tabs">
            <button class="oc-tab active" data-pane="response">Resposta</button>
            <button class="oc-tab" data-pane="logs">Logs <span id="oc-log-count" style="opacity:0.5;">(0)</span></button>
            <button class="oc-log-clear" title="Limpar logs">🗑 Limpar</button>
        </div>
        <div id="oc-pane-response" class="oc-tab-pane active">
            <div id="oculus-output"><span style="color:#484f58;">Insira um Tracking ID e clique Enviar.</span></div>
        </div>
        <div id="oc-pane-logs" class="oc-tab-pane">
            <div id="oculus-logs"><div class="oc-log-empty">Nenhuma requisição feita ainda.</div></div>
        </div>
        <div id="oculus-status">
            <span id="oculus-status-text">Pronto</span>
            <span id="oculus-timer"></span>
        </div>
    `;
    document.body.appendChild(panel);

    const input = panel.querySelector('#oculus-input');
    const sendBtn = panel.querySelector('#oculus-send');
    const output = panel.querySelector('#oculus-output');
    const statusText = panel.querySelector('#oculus-status-text');
    const timerText = panel.querySelector('#oculus-timer');
    const closeBtn = panel.querySelector('.oc-header button');
    const logsContainer = panel.querySelector('#oculus-logs');
    const logCountBadge = panel.querySelector('#oc-log-count');
    const clearBtn = panel.querySelector('.oc-log-clear');

    const logs = [];

    toggle.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    });
    closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

    function getCsrfToken() {
        let token = '';
        const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
        if (meta) token = meta.getAttribute('content') || '';
        if (!token) {
            const input = document.querySelector('input[name="anti-csrftoken-a2z"]');
            if (input) token = input.value || '';
        }
        if (!token) {
            const match = document.cookie.match(/anti-csrftoken-a2z=([^;]+)/);
            if (match) token = decodeURIComponent(match[1]);
        }
        return token;
    }

    panel.querySelectorAll('.oc-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            panel.querySelectorAll('.oc-tab').forEach(t => t.classList.remove('active'));
            panel.querySelectorAll('.oc-tab-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            panel.querySelector('#oc-pane-' + tab.dataset.pane).classList.add('active');
        });
    });

    function getParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    const TANTEI_QUERY = `query ($queryInput: [SearchTermInput!]!) {
  searchEntities(searchTerms: $queryInput) {
    searchTerm { nodeId nodeTimezone searchId searchIdType resolvedIdType }
    events {
      identifier
      byUser
      lastActionTime
      lastUpdateTime
      properties { key oldValue newValue }
    }
  }
}`;

    clearBtn.addEventListener('click', () => {
        logs.length = 0;
        renderLogs();
        logCountBadge.textContent = '(0)';
    });

    function syntaxHighlight(json) {
        if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                cls = /:$/.test(match) ? 'json-key' : 'json-string';
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    function renderLogs() {
        if (logs.length === 0) {
            logsContainer.innerHTML = '<div class="oc-log-empty">Nenhuma requisição feita ainda.</div>';
            return;
        }
        logsContainer.innerHTML = '';
        logs.slice().reverse().forEach((log, reverseIdx) => {
            const idx = logs.length - 1 - reverseIdx;
            const entry = document.createElement('div');
            entry.className = 'oc-log-entry';
            const statusCls = log.status === null ? 'pending' : (log.status === 200 ? 'ok' : 'err');
            const statusLabel = log.status === null ? '⏳' : ('HTTP ' + log.status);
            const elapsed = log.elapsed !== null ? log.elapsed + 's' : '...';
            entry.innerHTML =
                '<span class="oc-log-time">' + log.time + '</span>' +
                '<span class="oc-log-tid">' + log.trackingId + '</span>' +
                '<span class="oc-log-status ' + statusCls + '">' + statusLabel + '</span>' +
                '<span class="oc-log-elapsed">' + elapsed + '</span>';
            entry.addEventListener('click', () => {
                panel.querySelectorAll('.oc-tab').forEach(t => t.classList.remove('active'));
                panel.querySelectorAll('.oc-tab-pane').forEach(p => p.classList.remove('active'));
                panel.querySelector('[data-pane="response"]').classList.add('active');
                panel.querySelector('#oc-pane-response').classList.add('active');
                panel.querySelectorAll('.oc-log-entry').forEach(e => e.classList.remove('selected'));
                entry.classList.add('selected');
                if (log.response) {
                    try {
                        const parsed = JSON.parse(log.response);
                        if (Array.isArray(parsed)) {
                             output.innerHTML = generateTableFromDataArray(parsed);
                        } else if (parsed && parsed.packageDetail && parsed.packageDetail.packageData) {
                             output.innerHTML = generateTableFromDataArray([parsed.packageDetail.packageData]);
                        } else {
                            output.innerHTML = syntaxHighlight(JSON.stringify(parsed, null, 2));
                        }
                    } catch (e) {
                         output.textContent = log.response;
                    }
                } else if (log.error) {
                    output.innerHTML = '<span style="color:#f85149;">⚠ ' + log.error + '</span>';
                } else {
                    output.innerHTML = '<span style="color:#a855f7;">⏳ Aguardando resposta...</span>';
                }
                statusText.textContent = statusLabel;
                statusText.style.color = statusCls === 'ok' ? '#3fb950' : (statusCls === 'err' ? '#f85149' : '#a855f7');
                timerText.textContent = elapsed;
            });
            logsContainer.appendChild(entry);
        });
    }

    function generateTableFromDataArray(dataArray) {
        if (!dataArray || dataArray.length === 0) return '<div class="oc-log-empty">Nenhum pacote encontrado.</div>';
        
        let html = '<div class="oc-list-container">';
        
        for (const pd of dataArray) {
            let altScannable = '';
            if (pd.alternateScannableIds && pd.alternateScannableIds.length > 0) {
                altScannable = pd.alternateScannableIds.join(', ');
            }
            
            let itemDesc = '-';
            let warehouse = '-';
            
            if (pd.shipInfo) {
                itemDesc = pd.shipInfo.itemDescription || '-';
                warehouse = pd.shipInfo.warehouse || pd.shipInfo.merchantAssignedFacility || '-';
            }
            
            let promisedDate = '-';
            if (pd.shipInfo && pd.shipInfo.promisedDeliveryTime) {
                let d = new Date(pd.shipInfo.promisedDeliveryTime);
                promisedDate = isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR');
            }
            
            let lastUpdated = '-';
            if (pd.lastUpdatedTime) {
                let d = new Date(pd.lastUpdatedTime);
                lastUpdated = isNaN(d.getTime()) ? '-' : d.toLocaleString('pt-BR');
            }
            
            let cubicFeet = '-';
            if (pd.packageDimensions && pd.packageDimensions.packageLength && pd.packageDimensions.packageWidth && pd.packageDimensions.packageHeight) {
                const volCm3 = pd.packageDimensions.packageLength.value * pd.packageDimensions.packageWidth.value * pd.packageDimensions.packageHeight.value;
                cubicFeet = (volCm3 * 0.0000353147).toFixed(4) + ' ft\u00b3';
            }

            html += `
            <div class="oc-card">
                <div class="oc-card-header">
                    <span class="oc-card-title">${pd.trackingId || '-'}</span>
                    <span class="oc-card-status">${pd.packageStatus || '-'}</span>
                </div>
                <div class="oc-card-body">
                    <div class="oc-info-col">
                        <span class="oc-info-label">Scannable ID (Alt)</span>
                        <span class="oc-info-value" title="${altScannable}">${altScannable || '-'}</span>
                    </div>
                    <div class="oc-info-col">
                        <span class="oc-info-label">Warehouse</span>
                        <span class="oc-info-value" title="${warehouse}">${warehouse}</span>
                    </div>
                    <div class="oc-info-col">
                        <span class="oc-info-label">Volume</span>
                        <span class="oc-info-value">${cubicFeet}</span>
                    </div>
                    <div class="oc-info-col" style="grid-column: span 2;">
                        <span class="oc-info-label">Promised Delivery</span>
                        <span class="oc-info-value">${promisedDate}</span>
                    </div>
                    <div class="oc-info-col">
                        <span class="oc-info-label">Last Updated</span>
                        <span class="oc-info-value">${lastUpdated}</span>
                    </div>
                    <div class="oc-card-desc">
                        <span style="color:#8b949e; font-size:9px; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:4px;">Description</span>
                        ${itemDesc}
                    </div>
                </div>
            </div>`;
        }
        
        html += '</div>';
        return html;
    }

    let tanteiCsrfToken = null;

    async function fetchTanteiCsrfToken(nodeId) {
        if (tanteiCsrfToken) return tanteiCsrfToken;
        try {
            const resp = await fetch(location.origin + '/sortcenter/tantei?nodeId=' + nodeId, {
                method: 'GET',
                credentials: 'include'
            });
            const html = await resp.text();
            const div = document.createElement('div');
            div.innerHTML = html;
            const inputs = div.querySelectorAll('input');
            for (let i = 0; i < inputs.length; i++) {
                if (/csrf|token|anti/i.test(inputs[i].name || '') && inputs[i].value) {
                    tanteiCsrfToken = inputs[i].value;
                    return tanteiCsrfToken;
                }
            }
            let m = html.match(/"anti-csrftoken-a2z"\s*[,:]?\s*"([^"]{10,})"/);
            if (!m) m = html.match(/anti.csrftoken.a2z[^"]*"([^"]{10,})"/i);
            if (m) { tanteiCsrfToken = m[1]; return tanteiCsrfToken; }
        } catch (e) { console.error('Failed to fetch Tantei CSRF', e); }
        return '';
    }

    async function sendTanteiRequestAsync(searchId, logEntry) {
        const startTime = performance.now();
        const nodeId = getParam('node') || 'CGH7';

        const csrfToken = await fetchTanteiCsrfToken(nodeId);

        const payload = JSON.stringify({
            query: TANTEI_QUERY,
            variables: {
                queryInput: [{
                    nodeId: nodeId,
                    searchId: searchId,
                    searchIdType: "UNKNOWN"
                }]
            }
        });

        try {
            const resp = await fetch(location.origin + '/sortcenter/tantei/graphql', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'anti-csrftoken-a2z': csrfToken,
                },
                body: payload
            });
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            const responseText = await resp.text();
            logEntry.elapsed = elapsed;
            logEntry.status = resp.status;
            logEntry.response = responseText;
            return { status: resp.status, responseText: responseText, elapsed: elapsed };
        } catch (e) {
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            logEntry.elapsed = elapsed;
            logEntry.status = 0;
            logEntry.error = 'Erro de rede Tantei';
            return { status: 0, error: 'Erro de rede Tantei', elapsed: elapsed };
        }
    }

    function extractTbrFromTantei(responseText) {
        try {
            const json = JSON.parse(responseText);
            const entity = json?.data?.searchEntities?.[0];
            if (!entity) return null;
            const events = entity.events || [];
            for (const ev of events) {
                for (const p of (ev.properties || [])) {
                    if (p.key === 'scannables' && p.newValue) {
                        const match = p.newValue.match(/TBR\d+/);
                        if (match) return match[0];
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    async function sendRequestAsync(trackingIdsChunk, logEntry) {
         return new Promise((resolve) => {
             const startTime = performance.now();
            
             const payload = JSON.stringify({
                 httpMethod: "get",
                 processName: "oculus",
                 requestParams: {
                     nodeId: ["BR_ROOT"],
                     trackingId: trackingIdsChunk,
                 },
                 resourcePath: "/os/getPackageDetailData"
             });
             
             const csrfToken = getCsrfToken();
             
             GM_xmlhttpRequest({
                 method: 'POST',
                 url: location.origin + '/station/proxyapigateway/data',
                 headers: {
                     'Content-Type': 'application/json',
                     'Accept': 'application/json',
                     'X-Requested-With': 'XMLHttpRequest',
                     'anti-csrftoken-a2z': csrfToken,
                 },
                 data: payload,
                 withCredentials: true,
                 onload: function (resp) {
                     const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                     logEntry.elapsed = elapsed;
                     logEntry.status = resp.status;
                     logEntry.response = resp.responseText;
                     resolve({ status: resp.status, responseText: resp.responseText, elapsed: elapsed });
                 },
                 onerror: function () {
                     const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                     logEntry.elapsed = elapsed;
                     logEntry.status = 0;
                     logEntry.error = 'Erro de rede';
                     resolve({ status: 0, error: 'Erro de rede', elapsed: elapsed });
                 }
             });
         });
    }

    async function sendRequest() {
        const rawInput = input.value.trim();
        if (!rawInput) { input.focus(); return; }

        // Split by newlines, spaces, or commas, and remove empty strings
        const trackingIds = rawInput.split(/[\n\s,]+/).map(t => t.trim()).filter(Boolean);
        if (trackingIds.length === 0) return;

        sendBtn.disabled = true;
        sendBtn.textContent = '⏳...';
        statusText.textContent = 'Enviando...';
        statusText.style.color = '#a855f7';
        output.innerHTML = '<span style="color:#a855f7;">⏳ Processando ' + trackingIds.length + ' pacotes...</span>';

        const chunks = [];
        for (let i = 0; i < trackingIds.length; i++) {
            chunks.push([trackingIds[i]]);
        }

        let combinedData = [];
        let finalStatus = 200;
        let totalElapsed = 0;
        
        const masterLogEntry = {
            time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
            trackingId: trackingIds.length > 1 ? `[Lote de ${trackingIds.length}]` : trackingIds[0],
            status: null,
            elapsed: null,
            response: null,
            error: null,
        };
        logs.push(masterLogEntry);
        logCountBadge.textContent = '(' + logs.length + ')';
        renderLogs();

        for (let i = 0; i < chunks.length; i++) {
             let tid = chunks[i][0];
             statusText.textContent = `Buscando ${i+1}/${chunks.length}...`;
             
             const isOculusId = tid.startsWith('TBR') || tid.startsWith('AMZB');

             if (!isOculusId) {
                 statusText.textContent = `Resolvendo ${tid.substring(0,12)}... via Tantei`;
                 const tanteiEntry = {};
                 const tanteiResult = await sendTanteiRequestAsync(tid, tanteiEntry);
                 totalElapsed += parseFloat(tanteiResult.elapsed || 0);
                 if (tanteiResult.status === 200 && tanteiResult.responseText) {
                     const resolvedTbr = extractTbrFromTantei(tanteiResult.responseText);
                     if (resolvedTbr) {
                         tid = resolvedTbr;
                     } else {
                         finalStatus = 404;
                         continue;
                     }
                 } else {
                     finalStatus = tanteiResult.status;
                     continue;
                 }
             }

             const chunkEntry = {};
             const result = await sendRequestAsync([tid], chunkEntry);
             totalElapsed += parseFloat(result.elapsed || 0);

             if (result.status === 200 && result.responseText) {
                 try {
                     const parsed = JSON.parse(result.responseText);
                     if (parsed && parsed.packageDetail && parsed.packageDetail.packageData) {
                         combinedData.push(parsed.packageDetail.packageData);
                     }
                 } catch(e) { console.error("Parse Oculus fail", e); finalStatus = 500; }
             } else { finalStatus = result.status; }
        }
        
        masterLogEntry.elapsed = totalElapsed.toFixed(2);
        masterLogEntry.status = finalStatus;
        
        timerText.textContent = masterLogEntry.elapsed + 's';
        sendBtn.disabled = false;
        sendBtn.textContent = '▶ Enviar';
        
        if (finalStatus === 200) {
            statusText.textContent = 'Concluído';
            statusText.style.color = '#3fb950';
            masterLogEntry.response = JSON.stringify(combinedData);
            output.innerHTML = generateTableFromDataArray(combinedData);
        } else {
            statusText.textContent = finalStatus === 0 ? 'Erro de Rede' : 'Erro HTTP ' + finalStatus;
            statusText.style.color = '#f85149';
            masterLogEntry.error = statusText.textContent;
            output.innerHTML = '<span style="color:#f85149;">⚠ Ocorreram erros durante o processamento. Verifique os logs.</span>';
        }
        renderLogs();
    }

    sendBtn.addEventListener('click', sendRequest);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendRequest();
        }
    });
})();
