// ==UserScript==
// @name         TL Productivity Panel
// @namespace    http://tampermonkey.net/
// @version      3.1.1
// @description  Painel de produtividade por associado — auto-atualização configurável
// @author       emanunec
// @match        https://trans-logistics.amazon.com/sortcenter/*
// @match        https://trans-logistics-eu.amazon.com/sortcenter/*
// @match        https://trans-logistics-fe.amazon.com/sortcenter/*
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ib*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    if (location.pathname.includes('/yms/')) return;

    var BASE = document.URL.includes('-fe.') ? 'https://trans-logistics-fe.amazon.com/'
             : document.URL.includes('-eu.') ? 'https://trans-logistics-eu.amazon.com/'
             : 'https://trans-logistics.amazon.com/';

    // ── Detecta node ──────────────────────────────────────────────────────────
    function detectCurrentNode() {
        var fns = [
            function() { var el = document.querySelector('#nodeId'); return el ? el.value || el.textContent.trim() : null; },
            function() { var el = document.querySelector('select[name="nodeId"] option:checked'); return el ? el.value.trim() : null; },
            function() { var m = document.body.innerHTML.match(/\bNode[:\s]+([A-Z]{2,4}\d[A-Z0-9]{0,4})\b/); return m ? m[1] : null; },
            function() { var m = location.href.match(/[?&]node=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
            function() { var m = document.cookie.match(/currentNode=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
        ];
        for (var i = 0; i < fns.length; i++) {
            try { var v = fns[i](); if (v && /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(v)) return v.toUpperCase(); } catch(_) {}
        }
        return 'CGH7';
    }

    var CURRENT_NODE  = GM_getValue('tl_node', detectCurrentNode());
    var antiCsrfToken = '';

    // ── Auto-refresh state ────────────────────────────────────────────────────
    var AUTO_INTERVALS = [
        { label: '1 min',  ms: 1  * 60 * 1000 },
        { label: '2 min',  ms: 2  * 60 * 1000 },
        { label: '5 min',  ms: 5  * 60 * 1000 },
        { label: '10 min', ms: 10 * 60 * 1000 },
        { label: '15 min', ms: 15 * 60 * 1000 },
        { label: '30 min', ms: 30 * 60 * 1000 },
        { label: '1 hora', ms: 60 * 60 * 1000 },
    ];
    var autoRefreshOn       = GM_getValue('tl_auto_on', false);
    var autoRefreshInterval = GM_getValue('tl_auto_ms', 5 * 60 * 1000);
    var autoRefreshTimer    = null;
    var countdownTimer      = null;
    var nextRefreshAt       = 0;

    // ── Blur errors ───────────────────────────────────────────────────────────
    var blurErrors = GM_getValue('tl_blur_errors', false);

    // ── Meta pkgs/h ───────────────────────────────────────────────────────────
    // Tiers baseados na meta:
    //   🔵 Azul  : ≥ 110% da meta
    //   🟢 Verde : ≥ 100% da meta
    //   🟡 Amarelo: ≥  80% da meta
    //   🔴 Vermelho: <  80% da meta
    var goalPph = GM_getValue('tl_goal_pph', 300);

    // ── CSRF token ────────────────────────────────────────────────────────────
    function fetchAntiCsrfToken(callback) {
        if (antiCsrfToken) { callback(antiCsrfToken); return; }
        GM_xmlhttpRequest({
            method: 'GET', url: BASE + 'sortcenter/vista',
            onload: function(response) {
                try {
                    var div = document.createElement('div');
                    div.innerHTML = response.responseText;
                    var inputs = div.querySelectorAll('input');
                    for (var i = 0; i < inputs.length; i++) {
                        if (/csrf|token|anti/i.test(inputs[i].name || '') && inputs[i].value) {
                            antiCsrfToken = inputs[i].value; break;
                        }
                    }
                    if (!antiCsrfToken) {
                        var m = response.responseText.match(/"anti-csrftoken-a2z"\s*[,:]?\s*"([^"]{10,})"/);
                        if (!m) m = response.responseText.match(/anti.csrftoken.a2z[^"]*"([^"]{10,})"/i);
                        if (m) antiCsrfToken = m[1];
                    }
                } catch(e) { console.warn('[TL Prod] token error:', e); }
                callback(antiCsrfToken);
            },
            onerror: function() { callback(''); }
        });
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    GM_addStyle([
        // FAB
        '#tl-prod-fab{position:fixed;bottom:72px;right:24px;z-index:99999;width:44px;height:44px;border-radius:50%;background:#fff;color:#1a56db;font-size:20px;border:2px solid #e5e7eb;cursor:pointer;box-shadow:0 2px 12px rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center;transition:box-shadow .2s,transform .2s;padding:0}',
        '#tl-prod-fab:hover{box-shadow:0 4px 20px rgba(0,0,0,.22);transform:scale(1.07)}',

        // Overlay
        '#tl-prod-overlay{position:fixed;inset:0;background:rgba(17,24,39,.35);z-index:99998;display:none;backdrop-filter:blur(2px);opacity:0;transition:opacity .22s ease}',
        '#tl-prod-overlay.open{display:block;opacity:1}',

        // Popup
        '#tl-prod-popup{position:fixed;top:10%;left:50%;transform:translate(-50%,0);z-index:99999;width:640px;max-width:96vw;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;font-family:"Amazon Ember",Helvetica,Arial,sans-serif;font-size:13px;min-height:320px;max-height:88vh;border:1px solid #e5e7eb;transition:width .25s cubic-bezier(.4,0,.2,1),left .25s cubic-bezier(.4,0,.2,1),top .15s ease}',

        // Resize handles
        '.tl-rh{position:absolute;z-index:100000}',
        '.tl-rh-n{top:-4px;left:8px;right:8px;height:8px;cursor:n-resize}',
        '.tl-rh-s{bottom:-4px;left:8px;right:8px;height:8px;cursor:s-resize}',
        '.tl-rh-w{left:-4px;top:8px;bottom:8px;width:8px;cursor:w-resize}',
        '.tl-rh-e{right:-4px;top:8px;bottom:8px;width:8px;cursor:e-resize}',
        '.tl-rh-nw{top:-4px;left:-4px;width:16px;height:16px;cursor:nw-resize}',
        '.tl-rh-ne{top:-4px;right:-4px;width:16px;height:16px;cursor:ne-resize}',
        '.tl-rh-sw{bottom:-4px;left:-4px;width:16px;height:16px;cursor:sw-resize}',
        '.tl-rh-se{bottom:-4px;right:-4px;width:16px;height:16px;cursor:se-resize}',

        // Header — clean, like the modal in the image
        '#tl-prod-header{background:#fff;color:#111827;padding:14px 16px 0;flex-shrink:0;cursor:grab;user-select:none;border-bottom:1px solid #e5e7eb}',
        '#tl-prod-header:active{cursor:grabbing}',
        '#tl-prod-header-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
        '#tl-prod-icon{font-size:18px;line-height:1}',
        '#tl-prod-title{flex:1;font-weight:700;font-size:14px;color:#111827;letter-spacing:-.01em}',
        '#tl-prod-node-badge{font-size:11px;font-weight:600;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:2px 7px}',
        '#tl-prod-status{font-size:11px;color:#6b7280}',
        '#tl-prod-close{background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px;border-radius:4px;transition:background .15s}',
        '#tl-prod-close:hover{background:#f3f4f6;color:#111827}',
        '#tl-node-input{font-size:12px;font-weight:700;padding:3px 7px;border:1.5px solid #d1d5db;border-radius:6px;color:#374151;background:#f3f4f6;width:68px;text-align:center;text-transform:uppercase;cursor:text}',
        '#tl-node-input:focus{outline:none;border-color:#1a56db;background:#fff}',

        // Tabs — período
        '#tl-prod-tabs{display:flex;gap:0;border-bottom:0;margin:0 -1px}',
        '.tl-tab{font-size:12px;font-weight:600;padding:7px 14px;border:none;background:none;cursor:pointer;color:#6b7280;border-bottom:2px solid transparent;transition:color .18s ease,border-color .18s ease;display:flex;align-items:center;gap:5px;white-space:nowrap}',
        '.tl-tab:hover{color:#1a56db}',
        '.tl-tab.active{color:#1a56db;border-bottom:2px solid #1a56db}',
        '.tl-tab-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}',

        // Custom range
        '#tl-custom-row{display:flex;align-items:center;gap:6px;padding:8px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;flex-shrink:0}',
        '#tl-custom-row.hidden{display:none}',
        '#tl-time-start,#tl-time-end{font-size:12px;padding:4px 7px;border:1.5px solid #d1d5db;border-radius:6px;color:#374151;background:#fff;width:90px;-webkit-date-and-time-value:{hour-cycle:h23}}',
        '#tl-date-pick{font-size:12px;padding:4px 7px;border:1.5px solid #d1d5db;border-radius:6px;color:#374151;background:#fff;width:120px}',
        '#tl-date-pick:focus,#tl-time-start:focus,#tl-time-end:focus{outline:none;border-color:#1a56db}',
        '.tl-arrow{color:#9ca3af;font-size:13px}',
        '#tl-apply-btn{font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;border:none;background:#1a56db;color:#fff;cursor:pointer;margin-left:4px}',
        '#tl-apply-btn:hover{background:#1e40af}',

        // Auto-refresh bar
        '#tl-auto-bar{display:flex;align-items:center;gap:8px;padding:7px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb;flex-shrink:0}',
        '#tl-auto-label{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}',
        '#tl-auto-toggle{position:relative;width:34px;height:19px;border:none;background:none;padding:0;cursor:pointer;flex-shrink:0}',
        '#tl-auto-toggle .track{position:absolute;inset:0;border-radius:10px;background:#d1d5db;transition:background .25s cubic-bezier(.4,0,.2,1)}',
        '#tl-auto-toggle.on .track{background:#1a56db}',
        '#tl-auto-toggle .thumb{position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .25s cubic-bezier(.4,0,.2,1)}',
        '#tl-auto-toggle.on .thumb{left:18px}',
        '#tl-auto-select{font-size:11px;padding:3px 6px;border:1.5px solid #d1d5db;border-radius:6px;color:#374151;background:#fff;cursor:pointer}',
        '#tl-auto-select:focus{outline:none;border-color:#1a56db}',
        '#tl-auto-countdown{font-size:11px;font-family:monospace;color:#1a56db;font-weight:700;min-width:48px}',
        '#tl-refresh-btn{margin-left:auto;background:none;border:1.5px solid #d1d5db;color:#374151;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;font-weight:600;transition:border-color .15s,color .15s}',
        '#tl-refresh-btn:hover{border-color:#1a56db;color:#1a56db}',

        // Meta bar
        '#tl-goal-bar{display:flex;align-items:center;gap:8px;padding:7px 16px;background:#fff;border-bottom:1px solid #e5e7eb;flex-shrink:0}',
        '#tl-goal-label{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}',
        '#tl-goal-input{width:72px;font-size:12px;font-weight:700;padding:3px 7px;border:1.5px solid #d1d5db;border-radius:6px;color:#374151;text-align:center;-moz-appearance:textfield}',
        '#tl-goal-input::-webkit-outer-spin-button,#tl-goal-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
        '#tl-goal-input:focus{outline:none;border-color:#1a56db}',
        '#tl-goal-unit{font-size:11px;color:#6b7280;flex-shrink:0}',
        '#tl-goal-save{font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;border:none;background:#1a56db;color:#fff;cursor:pointer}',
        '#tl-goal-save:hover{background:#1e40af}',
        '#tl-goal-legend{margin-left:8px;display:flex;gap:10px;align-items:center}',
        '.tl-goal-chip{font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;white-space:nowrap}',

        // Body
        '#tl-prod-body{overflow-y:auto;flex:1;min-height:0}',
        '#tl-prod-body table{width:100%;border-collapse:collapse}',

        // Thead — estilo da imagem: sticky, limpo
        '#tl-prod-body thead th{position:sticky;top:0;background:#f9fafb;padding:8px 14px;text-align:left;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid #e5e7eb;cursor:pointer;user-select:none;white-space:nowrap}',
        '#tl-prod-body thead th:hover{color:#1a56db}',
        '#tl-prod-body thead th.sort-asc::after{content:" ▴"}',
        '#tl-prod-body thead th.sort-desc::after{content:" ▾"}',

        // Tbody — cada row tem cor suave, como na imagem
        '#tl-prod-body tbody tr{border-bottom:1px solid #f3f4f6;transition:background .15s ease}',
        '#tl-prod-body tbody tr:hover td{background:rgba(219,234,254,.5)!important}',
        '#tl-prod-body tbody td{padding:9px 14px;font-size:13px;color:#111827}',
        '#tl-prod-body tbody td.td-label{font-weight:600;color:#374151}',
        '#tl-prod-body tbody td.td-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}',
        '#tl-prod-body tbody td.td-err{text-align:right;font-weight:700;color:#dc2626}',
        '#tl-prod-body tbody td.td-na{color:#9ca3af;font-style:italic;text-align:right}',
        '#tl-prod-body tbody td.td-pph{text-align:right;font-weight:700}',

        // Row color tiers — espelhando as cores suaves da imagem
        'tr.tier-top td{background:#dbeafe}',        // azul — top performers
        'tr.tier-good td{background:#d1fae5}',       // verde
        'tr.tier-mid td{background:#fef3c7}',        // amarelo
        'tr.tier-low td{background:#fee2e2}',        // vermelho suave
        'tr.tier-none td{background:#f9fafb}',       // neutro

        '#tl-prod-footer{padding:8px 16px;font-size:11px;color:#6b7280;border-top:1px solid #e5e7eb;background:#f9fafb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',

        // Chain panels
        '.tl-chain-panel{position:fixed;z-index:100000;width:420px;max-width:96vw;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;font-family:"Amazon Ember",Helvetica,Arial,sans-serif;font-size:13px;border:1px solid #e5e7eb;transition:width .25s cubic-bezier(.4,0,.2,1),left .25s cubic-bezier(.4,0,.2,1),top .15s ease,max-height .2s ease;animation:tl-panel-in .2s cubic-bezier(.4,0,.2,1)}',
        '@keyframes tl-panel-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}',
        '.tl-cp-header{background:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #e5e7eb;flex-shrink:0}',
        '.tl-cp-title{flex:1;font-weight:700;font-size:13px;color:#111827}',
        '.tl-cp-close{background:none;border:none;color:#6b7280;font-size:16px;cursor:pointer;padding:2px 4px;border-radius:4px;line-height:1}',
        '.tl-cp-close:hover{background:#f3f4f6;color:#111827}',
        '.tl-cp-body{overflow-y:auto;flex:1;min-height:0}',
        '.tl-cp-body tbody tr{border-bottom:1px solid #f3f4f6;transition:background .1s}',
        '.tl-cp-body tbody tr:hover td{background:rgba(219,234,254,.45)!important}',

        // States
        '.tl-prod-loading{padding:32px;text-align:center;color:#9ca3af;font-size:13px}',
        '.tl-prod-error{padding:16px 20px;color:#dc2626;font-size:12px;line-height:1.8}',
        '.tl-prod-error a{color:#1a56db;font-weight:700}',
        // Blur errors
        'body.tl-blur-errors .tl-err-col{filter:blur(5px);color:#9ca3af!important;transition:filter .2s ease,color .2s ease;cursor:default;user-select:none}',
        'body.tl-blur-errors .tl-err-col:hover{filter:none;color:inherit!important}',
        // Blur toggle button
        '#tl-blur-toggle{background:none;border:1.5px solid #d1d5db;color:#6b7280;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;gap:3px;transition:border-color .15s,color .15s,background .15s}',
        '#tl-blur-toggle:hover{border-color:#1a56db;color:#1a56db}',
        '#tl-blur-toggle.on{background:#fef3c7;border-color:#f59e0b;color:#92400e}',
        '@keyframes tl-popup-in{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}',
    ].join(''));

    // ── FAB ───────────────────────────────────────────────────────────────────
    var fab = document.createElement('button');
    fab.id   = 'tl-prod-fab';
    fab.type = 'button';
    fab.title = 'Produtividade';
    fab.textContent = '👥';
    document.body.appendChild(fab);

    // ── Overlay ───────────────────────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.id = 'tl-prod-overlay';
    document.body.appendChild(overlay);

    // ── Popup ─────────────────────────────────────────────────────────────────
    var popup = document.createElement('div');
    popup.id = 'tl-prod-popup';

    // Resize handles
    ['n','s','w','e','nw','ne','sw','se'].forEach(function(dir) {
        var h = document.createElement('div');
        h.className = 'tl-rh tl-rh-' + dir;
        h.addEventListener('mousedown', function(e) {
            e.preventDefault(); e.stopPropagation();
            var r = popup.getBoundingClientRect();
            popup.style.transform = 'none';
            popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px';
            popup.style.width = r.width + 'px'; popup.style.maxHeight = r.height + 'px';
            var sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top, sw = r.width, sh = r.height;
            function onMove(ev) {
                var dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (dir.includes('e')) popup.style.width     = Math.max(400, sw + dx) + 'px';
                if (dir.includes('s')) popup.style.maxHeight = Math.max(220, sh + dy) + 'px';
                if (dir.includes('w')) { var w = Math.max(400, sw - dx); popup.style.width = w + 'px'; popup.style.left = (sl + sw - w) + 'px'; }
                if (dir.includes('n')) { var hh = Math.max(220, sh - dy); popup.style.maxHeight = hh + 'px'; popup.style.top = (st + sh - hh) + 'px'; }
            }
            function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        popup.appendChild(h);
    });

    // ── Header ────────────────────────────────────────────────────────────────
    var header = document.createElement('div');
    header.id = 'tl-prod-header';

    // Tabs de período
    var PRESETS = [
        { label: 'Custom',ms: 0,                   dot: '#94a3b8' },
        { label: '30min', ms: 30 * 60 * 1000,      dot: '#60a5fa' },
        { label: '1h',    ms: 60 * 60 * 1000,      dot: '#34d399' },
        { label: '2h',    ms: 2 * 60 * 60 * 1000,  dot: '#a78bfa' },
        { label: '4h',    ms: 4 * 60 * 60 * 1000,  dot: '#f59e0b' },
        { label: '8h',    ms: 8 * 60 * 60 * 1000,  dot: '#f87171' },
        { label: '12h',   ms: 12 * 60 * 60 * 1000, dot: '#fb923c' },
    ];

    var selectedPreset = 0;
    var customMode     = true;

    var tabsHTML = PRESETS.map(function(p) {
        var active = p.ms === selectedPreset && !customMode ? ' active' : '';
        return '<button type="button" class="tl-tab' + active + '" data-ms="' + p.ms + '">' +
            '<span class="tl-tab-dot" style="background:' + p.dot + '"></span>' + p.label + '</button>';
    }).join('');

    header.innerHTML =
        '<div id="tl-prod-header-row">' +
            '<span id="tl-prod-icon">👥</span>' +
            '<span id="tl-prod-title">Produtividade</span>' +
            '<input type="text" id="tl-node-input" value="' + CURRENT_NODE + '" maxlength="10" title="Node ID">' +
            '<span id="tl-prod-status"></span>' +
            '<button id="tl-prod-close" type="button" title="Fechar">✕</button>' +
        '</div>' +
        '<div id="tl-prod-tabs">' + tabsHTML + '</div>';

    popup.appendChild(header);

    // Drag — ignora cliques no input do node também
    var dragX = 0, dragY = 0, dragging = false;
    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('button') || e.target.closest('.tl-tab') || e.target.closest('input')) return;
        dragging = true;
        var r = popup.getBoundingClientRect();
        popup.style.transform = 'none';
        popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px';
        dragX = e.clientX - r.left; dragY = e.clientY - r.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        popup.style.left = (e.clientX - dragX) + 'px';
        popup.style.top  = (e.clientY - dragY) + 'px';
        if (chainPanels.length) applyAllWidths();
    });
    document.addEventListener('mouseup', function() { dragging = false; });

    // ── Custom range row ──────────────────────────────────────────────────────
    // 6 dias anteriores ao dia de hoje
    function getDateLimits() {
        var today = new Date();
        var min   = new Date(today); min.setDate(today.getDate() - 6);
        var fmt   = function(d) { return d.toISOString().slice(0, 10); };
        return { min: fmt(min), max: fmt(today), today: fmt(today) };
    }

    var dl = getDateLimits();

    var customRow = document.createElement('div');
    customRow.id = 'tl-custom-row';
    customRow.className = '';
    customRow.setAttribute('lang', 'pt-BR');
    customRow.innerHTML =
        '<span style="font-size:11px;font-weight:600;color:#6b7280;">Data</span>' +
        '<input type="date" id="tl-date-pick" value="' + dl.today + '" min="' + dl.min + '" max="' + dl.max + '">' +
        '<span class="tl-arrow">|</span>' +
        '<span style="font-size:11px;font-weight:600;color:#6b7280;">De</span>' +
        '<input type="time" id="tl-time-start" value="06:00" lang="pt-BR">' +
        '<span class="tl-arrow">→</span>' +
        '<input type="time" id="tl-time-end" value="18:00" lang="pt-BR">' +
        '<button type="button" id="tl-apply-btn">▶ Aplicar</button>';
    popup.appendChild(customRow);

    // ── Auto-refresh bar ──────────────────────────────────────────────────────
    var autoBar = document.createElement('div');
    autoBar.id = 'tl-auto-bar';

    var selectOpts = AUTO_INTERVALS.map(function(iv) {
        var sel = iv.ms === autoRefreshInterval ? ' selected' : '';
        return '<option value="' + iv.ms + '"' + sel + '>' + iv.label + '</option>';
    }).join('');

    autoBar.innerHTML =
        '<span id="tl-auto-label">Auto</span>' +
        '<button type="button" id="tl-auto-toggle" class="' + (autoRefreshOn ? 'on' : '') + '" title="Ligar/desligar atualização automática">' +
            '<span class="track"></span><span class="thumb"></span>' +
        '</button>' +
        '<select id="tl-auto-select">' + selectOpts + '</select>' +
        '<span id="tl-auto-countdown"></span>' +
        '<button type="button" id="tl-blur-toggle" class="' + (blurErrors ? 'on' : '') + '" title="Ocultar erros — passe o mouse para revelar">👁 Erros</button>' +
        '<button type="button" id="tl-refresh-btn">↺ Atualizar</button>';
    popup.appendChild(autoBar);

    // ── Meta bar ──────────────────────────────────────────────────────────────
    var goalBar = document.createElement('div');
    goalBar.id = 'tl-goal-bar';
    goalBar.innerHTML =
        '<span id="tl-goal-label">Meta Pkgs/h</span>' +
        '<input type="number" id="tl-goal-input" min="1" max="9999" value="' + goalPph + '">' +
        '<span id="tl-goal-unit">pkgs/h</span>' +
        '<button type="button" id="tl-goal-save">Salvar</button>' +
        '<div id="tl-goal-legend">' +
            '<span class="tl-goal-chip" style="background:#dbeafe;color:#1d4ed8">≥95% Azul</span>' +
            '<span class="tl-goal-chip" style="background:#d1fae5;color:#065f46">≥80% Verde</span>' +
            '<span class="tl-goal-chip" style="background:#fef3c7;color:#92400e">≥50% Amarelo</span>' +
            '<span class="tl-goal-chip" style="background:#fee2e2;color:#991b1b">&lt;50% Vermelho</span>' +
        '</div>';
    popup.appendChild(goalBar);
    var body = document.createElement('div');
    body.id = 'tl-prod-body';
    body.innerHTML = '<div class="tl-prod-loading">Selecione um período e clique em ↺ Atualizar.</div>';
    popup.appendChild(body);

    // ── Footer ────────────────────────────────────────────────────────────────
    var footer = document.createElement('div');
    footer.id = 'tl-prod-footer';
    footer.innerHTML = '<span id="tl-prod-range"></span><span id="tl-prod-total"></span>';
    popup.appendChild(footer);

    document.body.appendChild(popup);

    // ── State ─────────────────────────────────────────────────────────────────
    var popupOpen = false;
    var sortCol   = 'successfulScans';
    var sortAsc   = false;
    var lastData  = [];

    // ── Helpers ───────────────────────────────────────────────────────────────
    function getTimeRange() {
        if (!customMode) {
            var now = Date.now();
            return { start: now - selectedPreset, end: now };
        }
        var startInput = document.getElementById('tl-time-start');
        var endInput   = document.getElementById('tl-time-end');
        var datePick   = document.getElementById('tl-date-pick');
        var d = datePick && datePick.value ? datePick.value : new Date().toISOString().slice(0, 10);
        var startMs = new Date(d + 'T' + (startInput ? startInput.value : '06:00') + ':00').getTime();
        var endMs   = new Date(d + 'T' + (endInput   ? endInput.value   : '18:00') + ':00').getTime();
        // Se fim <= início, assume que cruza meia-noite (adiciona 1 dia ao fim)
        if (endMs <= startMs) endMs += 86400000;
        return { start: startMs, end: endMs };
    }

    // ── Auto-refresh logic ────────────────────────────────────────────────────
    function stopAutoRefresh() {
        clearInterval(autoRefreshTimer);
        clearInterval(countdownTimer);
        autoRefreshTimer = null;
        countdownTimer   = null;
        var cd = document.getElementById('tl-auto-countdown');
        if (cd) cd.textContent = '';
    }

    function startAutoRefresh() {
        stopAutoRefresh();
        nextRefreshAt = Date.now() + autoRefreshInterval;

        autoRefreshTimer = setInterval(function() {
            nextRefreshAt = Date.now() + autoRefreshInterval;
            fetchProductivity();
        }, autoRefreshInterval);

        countdownTimer = setInterval(function() {
            var cd = document.getElementById('tl-auto-countdown');
            if (!cd) return;
            var secs = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
            var m = String(Math.floor(secs / 60)).padStart(2, '0');
            var s = String(secs % 60).padStart(2, '0');
            cd.textContent = m + ':' + s;
        }, 1000);
    }

    function applyAutoRefresh() {
        var toggle = document.getElementById('tl-auto-toggle');
        if (autoRefreshOn) {
            if (toggle) toggle.classList.add('on');
            startAutoRefresh();
        } else {
            if (toggle) toggle.classList.remove('on');
            stopAutoRefresh();
        }
    }

    // ── Blur errors logic ─────────────────────────────────────────────────────
    function applyBlurErrors() {
        if (blurErrors) document.body.classList.add('tl-blur-errors');
        else document.body.classList.remove('tl-blur-errors');
        var btn = document.getElementById('tl-blur-toggle');
        if (btn) btn.classList.toggle('on', blurErrors);
    }

    // ── Skeleton ──────────────────────────────────────────────────────────────
    GM_addStyle([
        '@keyframes tl-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}',
        '.tl-sk{background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:800px 100%;animation:tl-shimmer 1.4s infinite linear;border-radius:4px}',
    ].join(''));

    function showSkeleton() {
        var bodyEl = document.getElementById('tl-prod-body');
        if (!bodyEl) return;
        var tiers = ['#dbeafe','#d1fae5','#d1fae5','#fef3c7','#fef3c7','#fef3c7','#fee2e2','#fee2e2','#fee2e2','#fee2e2'];
        var nameLens = [140,120,160,110,150,130,145,125,135,115];
        var html = '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
            '<th style="background:#f9fafb;padding:8px 6px;width:28px;border-bottom:1px solid #e5e7eb"></th>' +
            '<th style="background:#f9fafb;padding:8px 14px;border-bottom:1px solid #e5e7eb"><div class="tl-sk" style="width:70px;height:10px"></div></th>' +
            '<th style="background:#f9fafb;padding:8px 14px;text-align:right;border-bottom:1px solid #e5e7eb"><div class="tl-sk" style="width:48px;height:10px;margin-left:auto"></div></th>' +
            '<th style="background:#f9fafb;padding:8px 14px;text-align:right;border-bottom:1px solid #e5e7eb"><div class="tl-sk" style="width:36px;height:10px;margin-left:auto"></div></th>' +
            '<th style="background:#f9fafb;padding:8px 14px;text-align:right;border-bottom:1px solid #e5e7eb"><div class="tl-sk" style="width:30px;height:10px;margin-left:auto"></div></th>' +
            '</tr></thead><tbody>';
        for (var i = 0; i < 10; i++) {
            var bg = tiers[i] || '#f9fafb';
            var nw = nameLens[i] || 120;
            html += '<tr style="border-bottom:1px solid #f3f4f6;background:' + bg + '">' +
                '<td style="padding:9px 6px;text-align:center;font-size:11px;color:#9ca3af;width:28px">' + (i+1) + '</td>' +
                '<td style="padding:9px 14px"><div class="tl-sk" style="width:' + nw + 'px;height:13px"></div></td>' +
                '<td style="padding:9px 14px;text-align:right"><div class="tl-sk" style="width:38px;height:13px;margin-left:auto"></div></td>' +
                '<td style="padding:9px 14px;text-align:right"><div class="tl-sk" style="width:30px;height:13px;margin-left:auto"></div></td>' +
                '<td style="padding:9px 14px;text-align:right"><div class="tl-sk" style="width:22px;height:13px;margin-left:auto"></div></td>' +
            '</tr>';
        }
        html += '</tbody></table>';
        bodyEl.innerHTML = html;
    }

    // ── Fetch ─────────────────────────────────────────────────────────────────
    function fetchProductivity() {
        var nodeInp = document.getElementById('tl-node-input');
        if (nodeInp && nodeInp.value.trim()) CURRENT_NODE = nodeInp.value.trim().toUpperCase();

        showSkeleton();
        var statusEl = document.getElementById('tl-prod-status');
        var bodyEl   = document.getElementById('tl-prod-body');
        if (statusEl) statusEl.textContent = '⏳ buscando...';

        var range = getTimeRange();

        fetchAntiCsrfToken(function(token) {
            var payload = {
                nodeId: CURRENT_NODE, nodeType: 'SC',
                entity: 'getQualityMetricDetails',
                metricType: 'PRODUCTIVITY_REPORT',
                containerTypes: ['PACKAGE'],
                startTime: range.start, endTime: range.end,
                metricsData: {
                    nodeId: CURRENT_NODE, pageType: 'OUTBOUND',
                    refreshType: '', device: 'DESKTOP',
                    nodeType: 'SC', userAction: 'FAILED_MOVES_SUBMIT_CLICK'
                }
            };

            GM_xmlhttpRequest({
                method: 'POST',
                url: BASE + 'sortcenter/vista/controller/getQualityMetricDetails',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'anti-csrftoken-a2z': token,
                },
                data: 'jsonObj=' + encodeURIComponent(JSON.stringify(payload)),
                withCredentials: true,
                onload: function(response) {
                    var finalUrl = response.finalUrl || '';
                    if (finalUrl.includes('midway-auth') || finalUrl.includes('/SSO/')) {
                        antiCsrfToken = '';
                        if (statusEl) statusEl.textContent = '⚠ sessão expirada';
                        if (bodyEl) bodyEl.innerHTML = '<div class="tl-prod-error">🔐 <b>Sessão expirada.</b><br><a href="' + location.href + '">Recarregue a página</a> e tente novamente.</div>';
                        return;
                    }
                    if (response.status === 403 || response.status === 401) {
                        antiCsrfToken = '';
                        if (statusEl) statusEl.textContent = '⚠ ' + response.status;
                        if (bodyEl) bodyEl.innerHTML = '<div class="tl-prod-error">⛔ <b>Erro ' + response.status + '</b><br><a href="' + location.href + '">Recarregue a página</a>.</div>';
                        return;
                    }
                    try {
                        var json = typeof response.responseText === 'object'
                            ? response.responseText
                            : JSON.parse(response.responseText);
                        lastData = (json && json.ret &&
                            json.ret.getQualityMetricDetailsOutput &&
                            json.ret.getQualityMetricDetailsOutput.qualityMetrics) || [];
                        var fmt = function(ms) { return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
                        var rangeEl = document.getElementById('tl-prod-range');
                        if (rangeEl) rangeEl.textContent = fmt(range.start) + ' → ' + fmt(range.end);
                        if (statusEl) statusEl.textContent = '';
                        renderTable();
                    } catch(e) {
                        if (statusEl) statusEl.textContent = '⚠ erro';
                        if (bodyEl) bodyEl.innerHTML = '<div class="tl-prod-error">❌ ' + e.message + '</div>';
                    }
                },
                onerror: function() {
                    if (statusEl) statusEl.textContent = '⚠ erro';
                    if (bodyEl) bodyEl.innerHTML = '<div class="tl-prod-error">❌ Falha de rede.</div>';
                }
            });
        });
    }

    // ── Render ────────────────────────────────────────────────────────────────
    var LOWER_WORDS = { de:1, da:1, do:1, das:1, dos:1, e:1, em:1 };
    function normalizeName(raw) {
        if (!raw || raw === '—') return raw;
        return raw
            .split(',').reverse()
            .map(function(s) { return s.trim(); })
            .join(' ')
            .toLowerCase()
            .replace(/\S+/g, function(word, offset) {
                if (offset > 0 && LOWER_WORDS[word]) return word;
                return word.charAt(0).toUpperCase() + word.slice(1);
            });
    }

    function tierClass(pph) {
        if (!pph || !goalPph) return 'tier-none';
        var ratio = pph / goalPph;
        if (ratio >= 0.95) return 'tier-top';
        if (ratio >= 0.80) return 'tier-good';
        if (ratio >= 0.50) return 'tier-mid';
        return 'tier-low';
    }

    function renderTable() {
        var bodyEl = document.getElementById('tl-prod-body');
        if (!bodyEl) return;
        if (!lastData.length) {
            bodyEl.innerHTML = '<div class="tl-prod-loading">Sem dados para o período selecionado.</div>';
            return;
        }

        var pphOf = function(r) { return r.workInSeconds > 0 ? r.successfulScans / (r.workInSeconds / 3600) : 0; };

        var filtered = lastData.filter(function(r) { return (r.successfulScans || 0) > 0; });

        if (!filtered.length) {
            bodyEl.innerHTML = '<div class="tl-prod-loading">Nenhum resultado para "' + searchTerm + '".</div>';
            return;
        }

        var sorted = filtered.slice().sort(function(a, b) {
            if (sortCol === 'userName') {
                var va = a.userName || '', vb = b.userName || '';
                return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
            }
            if (sortCol === 'pkgsPerHour') return sortAsc ? pphOf(a) - pphOf(b) : pphOf(b) - pphOf(a);
            var va = Number(a[sortCol]) || 0, vb = Number(b[sortCol]) || 0;
            return sortAsc ? va - vb : vb - va;
        });

        lastSorted = sorted; // keep in sync for chain panels

        var maxPph = sorted.reduce(function(m, r) { return Math.max(m, pphOf(r)); }, 0); // kept for reference only

        var totalPkgs = filtered.reduce(function(s, r) { return s + (r.successfulScans || 0); }, 0);
        var totalEl = document.getElementById('tl-prod-total');
        if (totalEl) totalEl.textContent = filtered.length + ' associados · ' + totalPkgs.toLocaleString('pt-BR') + ' pkgs';

        var cols = [
            { key: null,              label: '#' },
            { key: 'userName',        label: 'Associado' },
            { key: 'successfulScans', label: 'Pacotes' },
            { key: 'pkgsPerHour',     label: 'Pkgs/h' },
            { key: 'failedScans',     label: 'Erros' },
        ];

        var html = '<table><thead><tr>';
        cols.forEach(function(c) {
            if (!c.key) { html += '<th style="width:28px;text-align:center">#</th>'; return; }
            var cls = sortCol === c.key ? (sortAsc ? 'sort-asc' : 'sort-desc') : '';
            html += '<th class="' + cls + '" data-col="' + c.key + '">' + c.label + '</th>';
        });
        html += '</tr></thead><tbody>';

        sorted.forEach(function(r, i) {
            var name = normalizeName(r.userName || r.userLogin || '—');
            var pkgs = r.successfulScans || 0;
            var errs = r.failedScans    || 0;
            var workH = (r.workInSeconds || 0) / 3600;
            var pph   = workH > 0 ? Math.round(pkgs / workH) : null;
            var tier  = pph !== null ? tierClass(pph) : 'tier-none';

            var pphCell = pph !== null
                ? '<td class="td-pph">' + pph.toLocaleString('pt-BR') + '</td>'
                : '<td class="td-na">—</td>';
            var errCell = errs > 0
                ? '<td class="td-err tl-err-col">' + errs + '</td>'
                : '<td class="td-num tl-err-col" style="color:#9ca3af">0</td>';

            html += '<tr class="' + tier + '" data-idx="' + i + '">' +
                '<td style="color:#9ca3af;text-align:center;font-size:11px;width:28px">' + (i + 1) + '</td>' +
                '<td class="td-label">' + name + '</td>' +
                '<td class="td-num">' + pkgs.toLocaleString('pt-BR') + '</td>' +
                pphCell + errCell + '</tr>';
        });

        html += '</tbody></table>';
        bodyEl.innerHTML = html;

        bodyEl.querySelectorAll('thead th').forEach(function(th) {
            th.addEventListener('click', function() {
                var col = th.dataset.col;
                if (sortCol === col) sortAsc = !sortAsc;
                else { sortCol = col; sortAsc = col === 'userName'; }
                renderTable();
            });
        });

        debounceSync();
    }

    // ── Chain panels (continuação reativa) ───────────────────────────────────
    var lastSorted  = [];
    var chainPanels = [];   // array de { el, bodyEl, open }
    var syncTimer   = null;

    function debounceSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncChain, 80);
    }

    // Retorna o índice do primeiro row oculto abaixo da área visível de um scrollBody
    function getFirstHiddenIdx(scrollBodyEl) {
        if (!scrollBodyEl) return -1;
        if (scrollBodyEl._fakeStart !== undefined) return scrollBodyEl._fakeStart;
        var rect = scrollBodyEl.getBoundingClientRect();
        var rows = scrollBodyEl.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i].getBoundingClientRect();
            if (r.top >= rect.bottom - 2) {
                return parseInt(rows[i].getAttribute('data-idx') || String(i));
            }
        }
        return -1; // sem overflow
    }

    // Constrói HTML de uma row a partir dos dados brutos
    function buildChainRow(r, absIdx) {
        var name  = normalizeName(r.userName || r.userLogin || '—');
        var pkgs  = r.successfulScans || 0;
        var errs  = r.failedScans    || 0;
        var workH = (r.workInSeconds || 0) / 3600;
        var pph   = workH > 0 ? Math.round(pkgs / workH) : null;
        var tier  = pph !== null ? tierClass(pph) : 'tier-none';
        var pphCell = pph !== null
            ? '<td style="text-align:right;font-weight:700;padding:8px 10px">' + pph.toLocaleString('pt-BR') + '</td>'
            : '<td style="text-align:right;color:#9ca3af;padding:8px 10px">—</td>';
        var errCell = errs > 0
            ? '<td class="tl-chain-err tl-err-col" style="text-align:right;font-weight:700;color:#dc2626;padding:8px 10px">' + errs + '</td>'
            : '<td class="tl-err-col" style="text-align:right;color:#9ca3af;padding:8px 10px">0</td>';
        return '<tr class="' + tier + '" data-idx="' + absIdx + '">' +
            '<td style="color:#9ca3af;text-align:center;width:28px;padding:8px 4px;font-size:11px">' + (absIdx + 1) + '</td>' +
            '<td style="font-weight:600;color:#374151;padding:8px 10px">' + name + '</td>' +
            '<td style="text-align:right;font-weight:600;padding:8px 10px">' + pkgs.toLocaleString('pt-BR') + '</td>' +
            pphCell + errCell + '</tr>';
    }

    function renderChainBody(cp, startIdx) {
        if (startIdx < 0 || startIdx >= lastSorted.length) {
            cp.bodyEl.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:12px">Nenhum associado oculto no painel anterior.</div>';
            cp.el.querySelector('.tl-cp-title').textContent = '👥 Continuação';
            return;
        }
        var slice = lastSorted.slice(startIdx);
        cp.el.querySelector('.tl-cp-title').textContent = '👥 Continuação (' + slice.length + ')';

        var html = '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' +
            '<th style="position:sticky;top:0;background:#f9fafb;padding:8px 4px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;text-align:center;width:28px">#</th>' +
            '<th style="position:sticky;top:0;background:#f9fafb;padding:8px 10px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;text-transform:uppercase;letter-spacing:.04em">Associado</th>' +
            '<th style="position:sticky;top:0;background:#f9fafb;padding:8px 10px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;text-transform:uppercase;text-align:right">Pacotes</th>' +
            '<th style="position:sticky;top:0;background:#f9fafb;padding:8px 10px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;text-transform:uppercase;text-align:right">Pkgs/h</th>' +
            '<th style="position:sticky;top:0;background:#f9fafb;padding:8px 10px;font-size:11px;font-weight:700;color:#6b7280;border-bottom:1px solid #e5e7eb;text-transform:uppercase;text-align:right">Erros</th>' +
            '</tr></thead><tbody>';
        slice.forEach(function(r, j) { html += buildChainRow(r, startIdx + j); });
        html += '</tbody></table>';
        cp.bodyEl.innerHTML = html;

        // Scroll no body do chain panel → sync o próximo
        cp.bodyEl.onscroll = debounceSync;
    }

    // Largura base do popup antes de qualquer redimensionamento manual
    var popupBaseLeft = null; // será fixado quando os painéis forem abertos

    function computeAllWidths() {
        // Total de painéis = popup principal + chain panels
        var chainCount = chainPanels.filter(function(cp) { return cp.open; }).length;
        var total      = 1 + chainCount;
        var margin     = 8;   // margem nas bordas
        var gap        = 6;   // gap entre painéis
        var available  = window.innerWidth - margin * 2 - gap * (total - 1);
        var w          = Math.max(260, Math.floor(available / total));
        return { mainW: w, chainW: w, count: total };
    }

    function applyAllWidths() {
        if (!chainPanels.length) return;
        var ws    = computeAllWidths();
        var left  = 8; // começa na margem esquerda

        // Redimensiona e reposiciona o popup principal
        popup.style.transform = 'none';
        popup.style.width     = ws.mainW + 'px';
        popup.style.left      = left + 'px';
        // Mantém top atual (não força novo top)
        left += ws.mainW + 6;

        // Reposiciona chain panels
        var mainR = popup.getBoundingClientRect();
        chainPanels.forEach(function(cp, i) {
            if (!cp.open) return;
            cp.el.style.top       = mainR.top + 'px';
            cp.el.style.height    = mainR.height + 'px';
            cp.el.style.maxHeight = mainR.height + 'px';
            cp.el.style.width     = ws.chainW + 'px';
            cp.el.style.left      = left + 'px';
            left += ws.chainW + 6;
        });
    }

    function restorePopupWidth() {
        if (!chainPanels.length) {
            popup.style.width     = '640px';
            popup.style.left      = '50%';
            popup.style.transform = 'translate(-50%,0)';
            popup.style.top       = '10%';
        }
    }

    function positionChainPanel(cp, chainIdx, widths) {
        // widths param kept for compat but we now use applyAllWidths for everything
        applyAllWidths();
    }

    function syncChain() {
        if (!popupOpen) return;

        // Calcula quantos painéis são necessários percorrendo o overflow
        var prevBody  = document.getElementById('tl-prod-body');
        var needed    = 0;
        var startIdxs = [];

        for (var pass = 0; pass < 20; pass++) { // max 20 painéis
            var si = getFirstHiddenIdx(prevBody);
            if (si < 0 || si >= lastSorted.length) break;
            startIdxs.push(si);
            needed++;

            // Simula o body do próximo painel usando um elemento temporário
            // Não podemos calcular overflow sem renderizar, então limitamos pela altura
            // e estimamos quantas rows cabem
            var rowH    = 37; // altura média de uma row em px
            var mainH   = popup.getBoundingClientRect().height;
            var headers = 56; // header + footer do chain panel
            var rows    = Math.max(1, Math.floor((mainH - headers) / rowH));
            var nextSi  = si + rows;
            if (nextSi >= lastSorted.length) break;

            // Cria um fake prevBody para a próxima iteração
            var fakeBody = { _fakeStart: nextSi };
            prevBody = fakeBody;
        }

        // Fecha painéis em excesso
        while (chainPanels.length > needed) {
            chainPanels[chainPanels.length - 1].el.remove();
            chainPanels.pop();
        }

        // Abre painéis faltantes
        while (chainPanels.length < needed) {
            var cp = createChainPanel(chainPanels.length);
            chainPanels.push(cp);
        }

        if (!chainPanels.length) { restorePopupWidth(); return; }

        applyAllWidths();

        // Agora renderiza cada painel com seu startIdx real (usando DOM real após posicionamento)
        var realPrevBody = document.getElementById('tl-prod-body');
        chainPanels.forEach(function(cp) {
            var realSi = getFirstHiddenIdx(realPrevBody);
            if (realSi < 0 || realSi >= lastSorted.length) { renderChainBody(cp, -1); return; }
            renderChainBody(cp, realSi);
            realPrevBody = cp.bodyEl;
        });
    }

    function createChainPanel(chainIdx) {
        var el = document.createElement('div');
        el.className = 'tl-chain-panel';
        el.innerHTML =
            '<div class="tl-cp-header">' +
                '<span class="tl-cp-title">👥 Continuação</span>' +
                '<button type="button" class="tl-cp-close" title="Fechar">✕</button>' +
            '</div>' +
            '<div class="tl-cp-body"></div>';

        el.addEventListener('click',     function(e) { e.stopPropagation(); });
        el.addEventListener('mousedown', function(e) { e.stopPropagation(); });

        el.querySelector('.tl-cp-close').addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            var myIdx = -1;
            for (var i = 0; i < chainPanels.length; i++) { if (chainPanels[i].el === el) { myIdx = i; break; } }
            if (myIdx < 0) return;
            for (var j = chainPanels.length - 1; j >= myIdx; j--) {
                chainPanels[j].el.remove();
                chainPanels.splice(j, 1);
            }
            if (chainPanels.length) { applyAllWidths(); } else { restorePopupWidth(); }
        });

        document.body.appendChild(el);
        return { el: el, bodyEl: el.querySelector('.tl-cp-body'), open: true };
    }

    function openNextPanel(fromIdx) {
        var nextIdx = fromIdx + 1;
        while (chainPanels.length > nextIdx) {
            chainPanels[chainPanels.length - 1].el.remove();
            chainPanels.pop();
        }
        var cp = createChainPanel(nextIdx);
        chainPanels.push(cp);
        applyAllWidths();
        syncChain();
    }

    function closeAllChainPanels() {
        chainPanels.forEach(function(cp) { cp.el.remove(); });
        chainPanels = [];
        restorePopupWidth();
    }

    // Scroll no painel principal → sync
    setTimeout(function() {
        var mainBody = document.getElementById('tl-prod-body');
        if (mainBody) mainBody.addEventListener('scroll', debounceSync);
    }, 500);

    // ResizeObserver no popup principal → reposiciona e sync
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function() { debounceSync(); }).observe(popup);
    }

    // ── Open / Close ──────────────────────────────────────────────────────────
    function openPopup() {
        popupOpen = true;
        overlay.classList.add('open');
        popup.style.display = 'flex';
        popup.style.animation = 'tl-popup-in .22s cubic-bezier(.4,0,.2,1)';
        if (!lastData.length) fetchProductivity();
        else debounceSync();
        applyAutoRefresh();
    }

    function closePopup() {
        popupOpen = false;
        overlay.classList.remove('open');
        popup.style.display = 'none';
        closeAllChainPanels();
    }

    // ── Events ────────────────────────────────────────────────────────────────
    popup.addEventListener('click',     function(e) { e.stopPropagation(); });
    popup.addEventListener('mousedown', function(e) { e.stopPropagation(); });

    fab.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    fab.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (popupOpen) closePopup(); else openPopup();
    });
    overlay.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); closePopup(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && popupOpen) closePopup(); });

    setTimeout(function() {
        // Fechar
        var closeBtn = document.getElementById('tl-prod-close');
        if (closeBtn) closeBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); closePopup(); });

        // Atualizar manual
        var refreshBtn = document.getElementById('tl-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            antiCsrfToken = '';
            fetchProductivity();
            if (autoRefreshOn) {
                stopAutoRefresh();
                startAutoRefresh();
            }
        });

        // Tabs de período
        popup.querySelectorAll('.tl-tab').forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                var ms = parseInt(tab.dataset.ms);
                if (ms === 0) {
                    // Custom
                    customMode = true;
                    customRow.classList.remove('hidden');
                } else {
                    customMode     = false;
                    selectedPreset = ms;
                    customRow.classList.add('hidden');
                    fetchProductivity();
                }
                popup.querySelectorAll('.tl-tab').forEach(function(b) { b.classList.remove('active'); });
                tab.classList.add('active');
            });
        });

        // Aplicar custom
        var applyBtn = document.getElementById('tl-apply-btn');
        if (applyBtn) applyBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            fetchProductivity();
        });

        // Node input
        var nodeInput = document.getElementById('tl-node-input');
        if (nodeInput) {
            nodeInput.addEventListener('change', function() {
                var v = nodeInput.value.trim().toUpperCase();
                if (v) {
                    CURRENT_NODE = v;
                    GM_setValue('tl_node', CURRENT_NODE);
                    antiCsrfToken = '';
                }
                nodeInput.value = CURRENT_NODE;
            });
        }

        // Atualiza min/max do date picker diariamente
        var datePick = document.getElementById('tl-date-pick');
        if (datePick) {
            var dl2 = getDateLimits();
            datePick.min = dl2.min;
            datePick.max = dl2.max;
        }

        // Salvar meta pkgs/h
        var goalSaveBtn = document.getElementById('tl-goal-save');
        if (goalSaveBtn) goalSaveBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            var inp = document.getElementById('tl-goal-input');
            var v = parseInt(inp && inp.value);
            if (v > 0) {
                goalPph = v;
                GM_setValue('tl_goal_pph', goalPph);
                if (lastData.length) renderTable();
                goalSaveBtn.textContent = '✓ Salvo';
                setTimeout(function() { goalSaveBtn.textContent = 'Salvar'; }, 1500);
            }
        });

        // Toggle auto-refresh
        var toggle = document.getElementById('tl-auto-toggle');
        if (toggle) toggle.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            autoRefreshOn = !autoRefreshOn;
            GM_setValue('tl_auto_on', autoRefreshOn);
            applyAutoRefresh();
        });

        // Toggle blur erros
        var blurBtn = document.getElementById('tl-blur-toggle');
        if (blurBtn) blurBtn.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            blurErrors = !blurErrors;
            GM_setValue('tl_blur_errors', blurErrors);
            applyBlurErrors();
        });

        // Seletor de intervalo
        var sel = document.getElementById('tl-auto-select');
        if (sel) sel.addEventListener('change', function() {
            autoRefreshInterval = parseInt(sel.value);
            GM_setValue('tl_auto_ms', autoRefreshInterval);
            if (autoRefreshOn) {
                stopAutoRefresh();
                startAutoRefresh();
            }
        });

    }, 0);

    popup.style.display = 'none';

    // Aplica estado salvo do auto-refresh se já estava ligado
    if (autoRefreshOn) {
        setTimeout(function() { applyAutoRefresh(); }, 100);
    }

    // Aplica estado salvo do blur de erros
    if (blurErrors) applyBlurErrors();

})();


