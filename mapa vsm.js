// ==UserScript==
// @name         Amazon Logistics - VRID Lookup com Mapa VSM (auto refresh)
// @namespace    http://tampermonkey.net/
// @version      44.12
// @author       emanunec@
// @description  Consulta VRIDs. Configurações dinâmicas. Layout Físico atualizado.
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ib*
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      trans-logistics.amazon.com
// @run-at       document-start
// ==/UserScript==

/* global XLSX */

(function () {
    'use strict';

    const BASE = location.hostname.includes('-fe.') ? 'https://trans-logistics-fe.amazon.com/'
               : location.hostname.includes('-eu.') ? 'https://trans-logistics-eu.amazon.com/'
               : 'https://trans-logistics.amazon.com/';

    const CSRF_TTL = 15 * 60 * 1000;
    const FETCH_CONCURRENCY = 50;

    let _csrf = '';

    // ==========================================
    // CONFIGURAÇÕES PADRÃO (DEFAULT)
    // ==========================================
    const DEFAULT_VSM_SEGMENT_MAP = {
        'SCP9': ['AA11'], 'SOG9': ['AA12'], 'DBS5': ['AA21'], 'SJO9': ['AA22'], 'STA9': ['AA31'],
        'SBP9': ['AA32'],
        'SUA9': ['AA42'], 'SVA9': ['AA51'], 'SSD9': ['AA52'], 'SBT9': ['AA53'], 'XSP2': ['AB31'], 'SPC9': ['AB32'], 'SSP9': ['AB41'], 'SBZ1_C2': ['AB42'],
        'SSO9': ['AB51'], 'SSC9': ['AB52'], 'SRG9': ['AB53'], 'DSA8': ['AB61'],
        'SDI9_C2': ['CC11'], 'DSP4': ['CC12'], 'DBR9_EF': ['CC13'], 'SLI9_C2': ['CC21'], 'SCG9': ['CC22'],
        'DBR9': ['CC23'], 'SCZ9': ['CC31'], 'SDA9': ['CC32'], 'SBZ1': ['CC34'],
        'SDI9': ['CC35'], 'SLI9': ['CC36'], 'SLO9': ['CC41'],
        'SBZ2': ['CC61'], 'DSP2': ['CD11'], 'SQA9': ['CD12'], 'SFC9': ['CD13'], 'SFI9': ['CD21'],
        'DFR2': ['CD23'], 'SRP9': ['CD31'], 'SAE9': ['CD32'], 'SCB9': ['CD33'], 'DBS5_EF': ['CD41'],
        'SBL9': ['CD51'], 'SFM9': ['CD52'], 'DRS5': ['CD53'], 'SPM9': ['CD61'], 'TBAV': ['H-11'],
        'STJ9': ['H-31'], 'SSJ9': ['H-32'], 'SUB9': ['H-41'], 'DSP5': ['H-51'],
        'GIG7': ['H-61'], 'CNF7': ['X-12'], 'DGO2': ['X-21'], 'SSV9': ['X-22'],
        'REC9': ['X-31'], 'DPR2': ['X-41'], 'SBU9': ['X-51'], 'DSP2_EF': ['X-53'], 'DRS5_EF': ['X-61'],
        'DSP4_EF': ['X-62']
    };

    const DEFAULT_BELT_GROUPS = [
        { id:  1, vsms: ['H-12','H-11','H-31','H-32'] },
        { id:  2, vsms: ['H-41','H-51','H-61'] },
        { id:  3, vsms: ['CD12','CD13','CD11'] },
        { id:  4, vsms: ['CD23','CD31','CD32','CD33','CD21'] },
        { id:  5, vsms: ['CC12','CC11','CC13','CC14'] },
        { id:  6, vsms: ['CC23','CC22','CC21'] },
        { id:  7, vsms: ['CC36','CC35','CC34','CC32','CC31'] },
        { id:  8, vsms: ['CC61','CC41'] },
        { id:  9, vsms: ['X-22','X-21','X-12'] },
        { id: 10, vsms: ['X-41','X-32','X-31'] },
        { id: 11, vsms: ['X-53','X-52','X-51'] },
        { id: 12, vsms: ['X-61','X-62'] },
        { id: 13, vsms: ['AA11','AA12','AA21','AA22'] },
        { id: 14, vsms: ['AA31','AA32','AA42','AA52','AA51','AA53'] },
        { id: 15, vsms: ['AB31','AB32','AB41','AB42'] },
        { id: 16, vsms: ['AB51','AB52','AB53','AB61'] },
        { id: 17, vsms: ['CD51','CD52','CD53','CD61'] }
    ];

    const DEFAULT_MAP_MATRIX = [
        ["","","","","","","","","","[F1]","[L_F1]","","","[L_TS]","[SKIP]","","","[L_F2]","[F2]","","","","","","","","","",""],
        ["","","","","","","","","","","","","","[TS_V]","[SKIP]","","","","","","","","","","","","","",""],
        ["","","","","","[B17]","","","","","","","","","","","","","","","","","","","","","","",""],
        ["0","0","0","0","0","0","","","","","","","","","","","","","","","","","","","","","","",""],
        ["-","CD51","CD52","CD53","CD61","CD61","","","","","","","","","","","","","","","","","","","","","","",""],
        ["","","","","","","","","","","","","","","","","","","","","","","","","","","","",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0","0"],
        ["H-12","H-11","H-31","H-31","H-32","H-32","","CC12","CC11","CC11","CC13","CC14","-","","","X-22","X-22","X-21","X-21","X-12","X-12","","AA11","AA11","AA12","AA12","AA21","AA21","AA22"],
        ["","","","","","[B1]","","","[B5]","","","","","","","","","","","","[B9]","","[B13]","","","","","",""],
        ["-","H-11","H-31","H-32","H-32","H-32","","CC12","CC12","CC12","CC13","CC14","-","","","X-22","X-22","X-21","X-21","X-12","X-12","","AA11","AA11","AA12","AA12","AA21","AA21","AA22"],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0","0"],
        ["","","","","","","","","","","","","","","","","","","","","","","","","","","","",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0",""],
        ["H-41","H-41","H-51","H-61","H-61","H-61","","CC23","CC23","CC22","CC22","CC22","CC21","","","-","X-41","X-41","X-32","X-31","X-31","","AA31","AA31","AA32","AA42","AA52","-",""],
        ["","","","","","[B2]","","","[B6]","","","","","","","","","","","","[B10]","","[B14]","","","","","",""],
        ["H-41","H-41","H-41","H-51","H-61","H-61","","CC23","CC23","CC23","CC22","CC22","CC21","","","-","-","X-41","X-41","X-31","X-31","","AA31","AA31","AA32","AA51","AA53","-",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0",""],
        ["","","","","","","","","","","","","","","","","","","","","","","","","","","","",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0",""],
        ["CD12","CD12","CD13","CD13","CD11","CD11","","CC36","CC35","CC34","CC34","CC32","CC31","","","","X-53","X-52","X-51","X-51","X-51","","AB31","AB31","AB32","AB32","AB41","-",""],
        ["","","","","","[B3]","","","[B7]","","","","","","","","","","","","[B11]","","[B15]","","","","","",""],
        ["CD12","CD12","CD13","CD13","CD11","CD11","","CC36","CC35","CC34","CC34","CC32","CC31","","","-","-","-","-","X-51","X-51","","AB31","AB32","AB32","AB41","AB41","AB42",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0",""],
        ["","","","","","","","","","","","","","","","","","","","","","","","","","","","",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0","0"],
        ["CD23","CD23","CD31","CD31","CD32","CD33","","CC61","CC61","CC61","CC41","CC41","CC41","","","","","","X-61","X-61","X-61","","AB51","AB52","AB52","AB53","AB61","AB61","AIR"],
        ["","","","","","[B4]","","","[B8]","","","","","","","","","","","","[B12]","","[B16]","","","","","",""],
        ["CD21","CD23","CD23","CD31","CD31","CD32","","CC61","CC61","CC61","CC41","CC41","CC41","","","-","-","-","X-62","X-61","X-61","","AB52","AB52","AB53","AB61","AB61","AB61",""],
        ["0","0","0","0","0","0","","0","0","0","0","0","0","","","0","0","0","0","0","0","","0","0","0","0","0","0",""]
    ];

    const DEFAULT_FINGERS = [
        { id: 1, name: "Finger 1", belts: [1,2,3,4,5,6,7,8] },
        { id: 2, name: "Finger 2", belts: [9,10,11,12,13,14,15,16] }
    ];

    // Variáveis ativas baseadas na configuração
    let activeNodeId = 'CGH7';
    let ALL_VSMS = [];
    let VSM_SEGMENT_MAP = {};
    let BELT_GROUPS = [];
    let activeMapMatrix = [];
    let activeFingers = [];

    let activeMappings = [];
    let configIsDirty = false;

    let currentCountMode = 'totalCount';
    let currentVsmTotals = {};
    let currentVsmMatrix = {};
    let staticMaxPkgsPerHour = 400;
    let staticFingerRate = 4000;
    let staticSelectedHour = -1;
    let cbRate = 500;
    let poRate = 1000;
    let lastExportData = [];

    let autoRefreshTimer = null;
    let autoRefreshCountdownInterval = null;
    let autoRefreshNextTimestamp = 0;
    let lastSearch = null;
    let isRefreshing = false;

    let selectedVrids = new Set();
    let hideZeroPkgs = true;

    // ==========================================
    // SISTEMA DE CONFIGURAÇÕES
    // ==========================================
    function initializeConfig() {
        const savedNode = GM_getValue('vsm_custom_node');
        if (savedNode) activeNodeId = savedNode;

        const savedMap = GM_getValue('vsm_custom_map_matrix');
        if (savedMap) {
            try { activeMapMatrix = JSON.parse(savedMap); }
            catch (e) { activeMapMatrix = JSON.parse(JSON.stringify(DEFAULT_MAP_MATRIX)); }
        } else {
            activeMapMatrix = JSON.parse(JSON.stringify(DEFAULT_MAP_MATRIX));
        }

        const saved = GM_getValue('vsm_custom_config');
        if (saved) {
            try { activeMappings = JSON.parse(saved); }
            catch (e) { buildDefaultMappings(); }
        } else {
            buildDefaultMappings();
        }

        const savedFingers = GM_getValue('vsm_custom_fingers');
        if (savedFingers) {
            try { activeFingers = JSON.parse(savedFingers); }
            catch (e) { activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS)); }
        } else {
            activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS));
        }

        rebuildDictionaries();
    }

    function buildDefaultMappings() {
        activeMappings = [];
        const vsmToGroup = {};
        for (const group of DEFAULT_BELT_GROUPS) {
            for (const vsm of group.vsms) vsmToGroup[vsm] = group.id;
        }

        for (const route in DEFAULT_VSM_SEGMENT_MAP) {
            const vsms = DEFAULT_VSM_SEGMENT_MAP[route];
            for (const vsm of vsms) {
                activeMappings.push({
                    route: route,
                    vsm: vsm,
                    group: vsmToGroup[vsm] || 99
                });
            }
        }
    }

    function rebuildDictionaries() {
        VSM_SEGMENT_MAP = {};
        const vsmSet = new Set(['AIR']);

        BELT_GROUPS = JSON.parse(JSON.stringify(DEFAULT_BELT_GROUPS));
        BELT_GROUPS.forEach(g => { g.vsms = []; });

        activeMappings.forEach(m => {
            const routeUpper = m.route.toUpperCase();
            const vsmUpper = m.vsm.toUpperCase();
            const groupId = parseInt(m.group, 10);

            if (!VSM_SEGMENT_MAP[routeUpper]) VSM_SEGMENT_MAP[routeUpper] = [];
            if (!VSM_SEGMENT_MAP[routeUpper].includes(vsmUpper)) {
                VSM_SEGMENT_MAP[routeUpper].push(vsmUpper);
            }

            vsmSet.add(vsmUpper);

            let groupObj = BELT_GROUPS.find(bg => bg.id === groupId);
            if (!groupObj && !isNaN(groupId)) {
                groupObj = { id: groupId, vsms: [] };
                BELT_GROUPS.push(groupObj);
            }
            if (groupObj) {
                if (!groupObj.vsms.includes(vsmUpper)) groupObj.vsms.push(vsmUpper);
            }
        });

        ALL_VSMS = Array.from(vsmSet).sort();
    }

    function saveConfig() {
        const nodeInput = document.getElementById('cfg-node-input');
        if (nodeInput) {
            const val = nodeInput.value.trim().toUpperCase();
            if (val) {
                activeNodeId = val;
                GM_setValue('vsm_custom_node', activeNodeId);
            }
        }

        const tbody = document.getElementById('config-table-body');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr.cfg-row');
            const newMappings = [];
            rows.forEach(row => {
                const r = row.querySelector('.cfg-route').value.trim();
                const v = row.querySelector('.cfg-vsm-input').value.trim();
                const g = row.querySelector('.cfg-group').value.trim();
                if (r && v && g) newMappings.push({ route: r, vsm: v, group: g });
            });
            activeMappings = newMappings;
            GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
        }

        const fTbody = document.getElementById('config-finger-body');
        if (fTbody) {
            const fRows = fTbody.querySelectorAll('tr.cfg-finger-row');
            const newFingers = [];
            fRows.forEach(row => {
                const id = parseInt(row.querySelector('.cfg-f-id').value, 10);
                const name = row.querySelector('.cfg-f-name').value.trim();
                const beltsStr = row.querySelector('.cfg-f-belts').value;
                if (!isNaN(id)) {
                    const belts = beltsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                    newFingers.push({ id, name, belts });
                }
            });
            activeFingers = newFingers;
            GM_setValue('vsm_custom_fingers', JSON.stringify(activeFingers));
        }

        rebuildDictionaries();
        configIsDirty = false;

        renderConfigTable();
        if(lastExportData.length > 0) computeAndRenderAll();
    }

    function resetConfigToDefault() {
        if(confirm("Tem certeza que deseja restaurar as configurações padrão (Node, Rotas, VSM, Grupos e Fingers)?")) {
            activeNodeId = 'CGH7';
            buildDefaultMappings();
            activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS));

            GM_setValue('vsm_custom_node', activeNodeId);
            GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
            GM_setValue('vsm_custom_fingers', JSON.stringify(activeFingers));

            const nodeInput = document.getElementById('cfg-node-input');
            if (nodeInput) nodeInput.value = activeNodeId;

            rebuildDictionaries();
            configIsDirty = false;
            renderConfigTable();
            if(lastExportData.length > 0) computeAndRenderAll();
        }
    }


    function loadCsrfFromStorage() {
        try {
            const t = localStorage.getItem('gql_csrf_token');
            const ts = parseInt(localStorage.getItem('gql_csrf_ts') || '0', 10);
            if (t && t.length > 10 && (Date.now() - ts) < CSRF_TTL) {
                _csrf = t;
                return true;
            }
        } catch (e) {}
        return false;
    }

    function saveCsrf(t) {
        if (!t || t.length <= 10) return;
        _csrf = t;
        try {
            localStorage.setItem('gql_csrf_token', t);
            localStorage.setItem('gql_csrf_ts', String(Date.now()));
        } catch (e) {}
    }

    (function patchNetwork() {
        const oOpen = XMLHttpRequest.prototype.open;
        const oSet  = XMLHttpRequest.prototype.setRequestHeader;
        const oSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) {
            this._url = u || '';
            return oOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (/anti-csrftoken-a2z/i.test(name) && value && value.length > 10) {
                _csrf = value;
                saveCsrf(value);
            }
            return oSet.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (!_csrf && body && typeof body === 'string' && body.includes('nti-csrftoken-a2z=')) {
                try {
                    const ex = decodeURIComponent(body.split('nti-csrftoken-a2z=')[1].split('&')[0]);
                    if (ex && ex.length > 10) {
                        _csrf = ex;
                        saveCsrf(ex);
                    }
                } catch (e) {}
            }
            return oSend.apply(this, arguments);
        };

        const originalFetch = window.fetch;
        if(originalFetch) {
            window.fetch = async function () {
                if (arguments[1] && arguments[1].headers) {
                    try {
                        const headers = new Headers(arguments[1].headers);
                        const token = headers.get('anti-csrftoken-a2z');
                        if (token) {
                            _csrf = token;
                            saveCsrf(token);
                        }
                    } catch(e) {}
                }
                return originalFetch.apply(this, arguments);
            };
        }
    })();

    loadCsrfFromStorage();
    initializeConfig();

    function parseLocalDateTime(s) {
        if (!s) return null;
        const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
        if (!m) return null;
        const months = {
            Jan: 0, Fev: 1, Feb: 1, Mar: 2, Abr: 3, Apr: 3, Mai: 4, May: 4,
            Jun: 5, Jul: 6, Ago: 7, Aug: 7, Set: 8, Sep: 8, Out: 9, Oct: 9,
            Nov: 10, Dez: 11, Dec: 11
        };
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        return new Date(year, months[m[2]], parseInt(m[1], 10), parseInt(m[4], 10), parseInt(m[5], 10));
    }

    function getLocalDayTs(date) {
        const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
        const e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
        return { start: String(s.getTime()), end: String(e.getTime()) };
    }

    function esc(s) {
        return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function getLoadObject(item) {
        if (!item) return {};
        if (item.load) return item.load;
        const found = Object.values(item).find(v => v && typeof v === 'object' && (v.vrid || v.vrId || v.vId || v.planId || v.planForOrderId));
        return found || item;
    }

    function fetchVRIData(startTimestamp, endTimestamp, callback) {
        const params = new URLSearchParams({
            entity: 'getInboundDockView',
            nodeId: activeNodeId,
            startDate: startTimestamp,
            endDate: endTimestamp,
            loadCategories: 'inboundScheduled,inboundArrived,inboundCompleted',
            shippingPurposeType: 'TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON'
        });
        GM_xmlhttpRequest({
            method: 'POST',
            url: BASE + 'ssp/dock/hrz/ib/fetchdata',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'anti-csrftoken-a2z': _csrf
            },
            data: params.toString(),
            withCredentials: true,
            timeout: 20000,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText.replace(/^\uFEFF/, ''));
                    callback(null, data);
                } catch (e) {
                    callback(e, null);
                }
            },
            onerror: function (error) { callback(error, null); },
            ontimeout: function () { callback('Timeout', null); }
        });
    }

    function fetchContainers(planIds, callback) {
        if (!planIds || planIds.length === 0) { callback(null, {}); return; }
        const idsParam = planIds.join(',');
        const params = new URLSearchParams({
            entity: 'getCDTBasedContainerCount',
            inboundLoadIds: idsParam,
            nodeId: activeNodeId
        });
        GM_xmlhttpRequest({
            method: 'POST',
            url: BASE + 'ssp/dock/hrz/ib/fetchdata',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'anti-csrftoken-a2z': _csrf
            },
            data: params.toString(),
            withCredentials: true,
            timeout: 20000,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText.replace(/^\uFEFF/, ''));
                    callback(null, data);
                } catch (e) {
                    callback(e, null);
                }
            },
            onerror: function (error) { callback(error, null); },
            ontimeout: function () { callback('Timeout', null); }
        });
    }

    function fetchCompletePercent(planIds, callback) {
        if (!planIds || planIds.length === 0) { callback(null, {}); return; }
        const idsParam = planIds.join(',');
        const params = new URLSearchParams({
            entity: 'getInboundContainerCount',
            inboundLoadIds: idsParam,
            nodeId: activeNodeId
        });
        GM_xmlhttpRequest({
            method: 'POST',
            url: BASE + 'ssp/dock/hrz/ib/fetchdata',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'anti-csrftoken-a2z': _csrf
            },
            data: params.toString(),
            withCredentials: true,
            timeout: 20000,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText.replace(/^\uFEFF/, ''));
                    callback(null, data);
                } catch (e) {
                    callback(e, null);
                }
            },
            onerror: function (error) { callback(error, null); },
            ontimeout: function () { callback('Timeout', null); }
        });
    }

    function getVRIDsFromData(data, startDate, startHour, endDate, endHour) {
        if (!data || !data.ret || !data.ret.aaData) return [];

        const dataArray = Array.isArray(data.ret.aaData) ? data.ret.aaData : Object.values(data.ret.aaData);
        const results = [];

        const startDateTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startHour - 1, 0, 0);
        const endDateTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), endHour, 59, 59);

        if (startDateTime.getTime() >= endDateTime.getTime()) return [];

        for (let i = 0; i < dataArray.length; i++) {
            const item = dataArray[i];
            const load = getLoadObject(item);

            const scheduledTimeStr = load.scheduledArrivalTime;
            if (!scheduledTimeStr) continue;

            const scheduledDate = parseLocalDateTime(scheduledTimeStr);
            if (!scheduledDate) continue;

            const scheduledMs = scheduledDate.getTime();
            if (scheduledMs >= startDateTime.getTime() && scheduledMs <= endDateTime.getTime()) {
                results.push({
                    vrid: load.vrid || load.vrId || load.vId,
                    planId: load.planId || load.planForOrderId,
                    scheduledArrivalTime: load.scheduledArrivalTime,
                    route: load.route,
                    actualArrivalTime: load.actualArrivalTime || load.actualDepartureTime || 'N/A'
                });
            }
        }
        return results;
    }

    function getCounts(container) {
        let counts = container[currentCountMode];
        if (!counts) {
            const struct = container.loadGroupCountStruct;
            if (struct && struct[currentCountMode]) counts = struct[currentCountMode];
        }
        if (!counts) counts = { P: 0, C: 0 };
        return { P: counts.P !== undefined ? counts.P : 0, C: counts.C !== undefined ? counts.C : 0 };
    }

    function simplifyLane(lane) {
        if (!lane) return '—';
        if (lane.indexOf('->') === -1) return lane;
        const parts = lane.split('->');
        if (parts[0] === activeNodeId) return parts[1];
        if (parts[1] === activeNodeId) return parts[0];
        return lane;
    }

    function splitLaneSegments(lane) {
        if (!lane) return [''];
        if (lane.indexOf('->') === -1) return [lane];
        const parts = lane.split('->');
        const afterArrow = parts[1];
        if (afterArrow.indexOf('-') === -1) return [afterArrow];
        if (/-(BUS|B)$/i.test(afterArrow)) return [afterArrow];
        const segments = afterArrow.split('-');
        const allNodes = segments.every(p => /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(p));
        if (allNodes) return segments;
        return [afterArrow];
    }

    function segmentToVSM(segment) {
        if (!segment) return [];
        const upper = segment.toUpperCase();
        if (VSM_SEGMENT_MAP[upper]) return VSM_SEGMENT_MAP[upper];
        return [];
    }

    function computeVsmHourlyMatrixFromExportData(exportDataList) {
        const matrix = {};
        for (const vsm of ALL_VSMS) {
            matrix[vsm] = new Array(25).fill(0);
        }

        for (const vridData of exportDataList) {
            const timeStr = vridData.actualArrivalTime && vridData.actualArrivalTime !== 'N/A' ? vridData.actualArrivalTime : vridData.scheduledArrivalTime;
            if (!timeStr) continue;
            const vridDate = parseLocalDateTime(timeStr);
            if (!vridDate) continue;

            const hour = vridDate.getHours();
            const minute = vridDate.getMinutes();
            const currentRatio = (60 - minute) / 60;

            const route = vridData.route || '';
            const isMMRoute = route.toUpperCase().endsWith('_MM');

            const containers = vridData.containers || [];
            for (const container of containers) {
                const counts = getCounts(container);
                if (counts.C > 0 || counts.P === 0) continue;

                if (isMMRoute) {
                    const curP = Math.round(counts.P * currentRatio);
                    const nextP = counts.P - curP;

                    if(matrix['AIR']) {
                        matrix['AIR'][hour] += curP;
                        let nextIndex = hour + 1;
                        if (nextIndex >= 24) nextIndex = 24;
                        matrix['AIR'][nextIndex] += nextP;
                    }
                    continue;
                }

                const originalLane = container.lane || '';
                const segments = splitLaneSegments(originalLane);
                const nSeg = segments.length;
                if (nSeg === 0) continue;

                const baseP = Math.floor(counts.P / nSeg);
                const remP  = counts.P % nSeg;

                for (let i = 0; i < nSeg; i++) {
                    const seg  = segments[i];
                    const addP = baseP + (i < remP ? 1 : 0);
                    if (addP === 0) continue;

                    const targetVsms = segmentToVSM(seg);
                    if (targetVsms && targetVsms.length > 0) {
                        const subBaseP = Math.floor(addP / targetVsms.length);
                        const subRemP = addP % targetVsms.length;

                        for(let j = 0; j < targetVsms.length; j++) {
                            const vsm = targetVsms[j];
                            if (ALL_VSMS.includes(vsm)) {
                                const finalAddP = subBaseP + (j < subRemP ? 1 : 0);
                                if (finalAddP === 0) continue;

                                const curP = Math.round(finalAddP * currentRatio);
                                const nextP = finalAddP - curP;

                                matrix[vsm][hour] += curP;
                                let nextIndex = hour + 1;
                                if (nextIndex >= 24) nextIndex = 24;
                                matrix[vsm][nextIndex] += nextP;
                            }
                        }
                    }
                }
            }
        }
        return matrix;
    }

    function getVsmCellStyle(count) {
        if (count === 0)    return { bg: '#141f2c', fg: '#2a3a4a' };
        if (count <= 50)    return { bg: '#1a3a2a', fg: '#4dbb7a' };
        if (count <= 150)   return { bg: '#1e5c32', fg: '#a8edbe' };
        if (count <= 350)   return { bg: '#7a5c00', fg: '#ffd454' };
        if (count <= 600)   return { bg: '#8a3d00', fg: '#ffaa55' };
        return                { bg: '#6a1020', fg: '#ff7090' };
    }

    function renderVsmHourlyTable(matrix, container) {
        const hourTotals = new Array(25).fill(0);
        let grandTotal = 0;
        const activeVsms = [];

        for (const vsm of ALL_VSMS) {
            const row = matrix[vsm];
            const total = row.reduce((a, b) => a + b, 0);
            if (total === 0) continue;
            activeVsms.push(vsm);
            for (let h = 0; h <= 24; h++) hourTotals[h] += row[h];
            grandTotal += total;
        }

        const showExtraHour = hourTotals[24] > 0;

        let html = '<div class="vsm-tbl-wrap"><table class="vsm-hourly-table" id="vsm-ht">';
        html += '<thead>';
        html += '<th class="vsm-label-hdr">VSM</th>';
        for (let h = 0; h < 24; h++) {
            const hdrStyle = getVsmCellStyle(hourTotals[h]);
            html += `<th class="hour-col" data-col="${h}" style="background:${hdrStyle.bg};color:${hdrStyle.fg};">${h}:00</th>`;
        }
        if (showExtraHour) {
            const hdrStyle = getVsmCellStyle(hourTotals[24]);
            html += `<th class="hour-col" data-col="24" style="background:${hdrStyle.bg};color:${hdrStyle.fg};">00:00 (+1)</th>`;
        }

        const grandHdrStyle = getVsmCellStyle(grandTotal);
        html += `<th class="total-col" style="background:${grandHdrStyle.bg};color:${grandHdrStyle.fg};">Total</th>`;
        html += '</thead><tbody>';

        for (const vsm of activeVsms) {
            const row = matrix[vsm];
            const total = row.reduce((a, b) => a + b, 0);
            html += `<tr data-row="${esc(vsm)}">`;
            html += `<td class="vsm-label" data-row="${esc(vsm)}">${esc(vsm)}</td>`;
            for (let h = 0; h < 24; h++) {
                const val = row[h];
                const style = getVsmCellStyle(val);
                html += `<td class="hour-cell" data-row="${esc(vsm)}" data-col="${h}" style="background:${style.bg};color:${style.fg};">${val || 0}</td>`;
            }
            if (showExtraHour) {
                const val = row[24];
                const style = getVsmCellStyle(val);
                html += `<td class="hour-cell" data-row="${esc(vsm)}" data-col="24" style="background:${style.bg};color:${style.fg};">${val || 0}</td>`;
            }
            const totalStyle = getVsmCellStyle(total);
            html += `<td class="total-cell" data-row="${esc(vsm)}" style="background:${totalStyle.bg};color:${totalStyle.fg};font-weight:700;">${total}</td>`;
            html += '</tr>';
        }

        html += '<tr class="hour-total-row">';
        html += '<td class="vsm-label"><strong>Total por hora</strong></td>';
        for (let h = 0; h < 24; h++) {
            const val = hourTotals[h];
            const style = getVsmCellStyle(val);
            html += `<td class="hour-cell" data-col="${h}" style="background:${style.bg};color:${style.fg};font-weight:700;">${val || 0}</td>`;
        }
        if (showExtraHour) {
            const val = hourTotals[24];
            const style = getVsmCellStyle(val);
            html += `<td class="hour-cell" data-col="24" style="background:${style.bg};color:${style.fg};font-weight:700;">${val || 0}</td>`;
        }
        const grandStyle = getVsmCellStyle(grandTotal);
        html += `<td class="total-cell" style="background:${grandStyle.bg};color:${grandStyle.fg};font-weight:700;">${grandTotal}</td>`;
        html += '</tr>';
        html += '</tbody></table></div>';

        container.innerHTML = html;

        const tbl = container.querySelector('#vsm-ht');
        if (tbl) {
            tbl.addEventListener('mouseover', e => {
                const td = e.target.closest('[data-row],[data-col]');
                if (!td) return;
                const row = td.dataset.row;
                const col = td.dataset.col;
                tbl.querySelectorAll('[data-row]').forEach(el => {
                    el.classList.toggle('vsm-row-hl', el.dataset.row === row && !!row);
                });
                tbl.querySelectorAll('[data-col]').forEach(el => {
                    el.classList.toggle('vsm-col-hl', el.dataset.col === col && col !== undefined);
                });
            });
            tbl.addEventListener('mouseleave', () => {
                tbl.querySelectorAll('.vsm-row-hl').forEach(el => el.classList.remove('vsm-row-hl'));
                tbl.querySelectorAll('.vsm-col-hl').forEach(el => el.classList.remove('vsm-col-hl'));
            });
        }
    }

    function computeAndRenderAll() {
        let filtered = getFilteredExportData();
        if (hideZeroPkgs) {
            filtered = filtered.filter(v => {
                const totalP = (v.containers || []).reduce((sum, c) => sum + getCounts(c).P, 0);
                return totalP > 0;
            });
        }
        const matrix = computeVsmHourlyMatrixFromExportData(filtered);
        currentVsmMatrix = matrix;
        const totals = {};
        let hasExtraSpillover = false;

        for (const vsm of ALL_VSMS) {
            totals[vsm] = matrix[vsm].reduce((a, b) => a + b, 0);
            if (matrix[vsm][24] > 0) hasExtraSpillover = true;
        }
        currentVsmTotals = totals;

        const mapContainer = document.getElementById('vsm-map-container');
        if (mapContainer) {
            if (!filtered.length) {
                mapContainer.innerHTML = '<div class="vsm-map-empty">Nenhum dado disponível para o mapa.</div>';
            } else {
                renderVsmHourlyTable(matrix, mapContainer);
            }
        }

        const pillNextDay = document.getElementById('pill-next-day');
        if (pillNextDay) {
            pillNextDay.style.display = hasExtraSpillover ? 'inline-block' : 'none';
            if (!hasExtraSpillover && staticSelectedHour === 24) {
                staticSelectedHour = -1;
                document.querySelectorAll('.hour-pill').forEach(b => b.classList.remove('active'));
                document.querySelector('.hour-pill[data-hour="-1"]').classList.add('active');
            }
        }

        renderStaticVsmMap();
    }

    function isMeaningful(value) {
        if (!value || value === "") return false;
        const upper = String(value).toUpperCase();
        if (upper === "0") return true;
        if (/^\[.*\]$/.test(upper)) return true; // Mantém todas as TAGS criadas pra não ser cortadas do grid
        if (/^[HX][-]/.test(upper)) return true;
        if (/^CC/.test(upper)) return true;
        if (/^AA/.test(upper)) return true;
        if (/^AB/.test(upper)) return true;
        if (/^CD/.test(upper)) return true;
        if (upper === "AIR") return true;
        return false;
    }

    function getBoundingBox(matrix) {
        let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
        for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
                if (isMeaningful(matrix[r][c])) {
                    if (r < minRow) minRow = r;
                    if (r > maxRow) maxRow = r;
                    if (c < minCol) minCol = c;
                    if (c > maxCol) maxCol = c;
                }
            }
        }
        if (minRow === Infinity) return null;
        return { minRow, maxRow, minCol, maxCol };
    }

    function cropWithMargin(matrix, margin = 1) {
        const bbox = getBoundingBox(matrix);
        if (!bbox) return [];
        let startRow = Math.max(0, bbox.minRow - margin);
        let endRow = Math.min(matrix.length - 1, bbox.maxRow + margin);
        let startCol = Math.max(0, bbox.minCol - margin);
        let endCol = Math.min(matrix[0].length - 1, bbox.maxCol + margin);
        const cropped = [];
        for (let r = startRow; r <= endRow; r++) {
            const row = [];
            for (let c = startCol; c <= endCol; c++) {
                row.push(matrix[r][c]);
            }
            cropped.push(row);
        }
        return cropped;
    }

    function getCellCategory(value) {
        if (!value || value === "") return "default";
        if (value === "0") return "ZERO";
        if (value.startsWith("H-")) return "H";
        if (value.startsWith("CC")) return "CC";
        if (value.startsWith("X-")) return "X";
        if (value.startsWith("AA")) return "AA";
        if (value.startsWith("AB")) return "AB";
        if (value.startsWith("CD")) return "CD";
        if (value === "AIR") return "AIR";
        return "default";
    }

    function findVsmForZero(croppedMatrix, row, col, allVsmsSet) {
        if (row > 0) {
            const above = croppedMatrix[row - 1][col];
            if (above && above !== "0" && allVsmsSet.has(above)) return above;
        }
        if (row < croppedMatrix.length - 1) {
            const below = croppedMatrix[row + 1][col];
            if (below && below !== "0" && allVsmsSet.has(below)) return below;
        }
        return null;
    }

    function getStaticVsmTotals() {
        if (staticSelectedHour === -1) return currentVsmTotals;
        const result = {};
        for (const vsm of ALL_VSMS) {
            result[vsm] = (currentVsmMatrix[vsm] && currentVsmMatrix[vsm][staticSelectedHour]) || 0;
        }
        return result;
    }

    function getFilteredExportData() {
        if (!lastExportData.length) return [];
        return lastExportData.filter(v => selectedVrids.has(v.vrid));
    }

    function updateLayoutFromSelection() {
        computeAndRenderAll();
    }

    function renderStaticVsmMap(vsmTotals) {
        const container = document.getElementById('vsm-layout-container');
        if (!container) return;

        const vsmTotalsLocal = vsmTotals || getStaticVsmTotals();
        const croppedMatrix = cropWithMargin(activeMapMatrix, 1);
        if (!croppedMatrix.length) {
            container.innerHTML = '<div class="vsm-map-empty">Nenhum dado disponível para o layout físico.</div>';
            return;
        }

        const allVsmsSet = new Set(ALL_VSMS);
        const beltSums = {};

        for (const group of BELT_GROUPS) {
            const sum = group.vsms.reduce((acc, vsm) => acc + (vsmTotalsLocal[vsm] || 0), 0);
            if (sum > 0) {
                const cbNeed = Math.max(1, Math.ceil(sum / cbRate));
                let poNeed = Math.max(1, Math.ceil(sum / poRate));
                const poExceeded = poNeed > 2;
                if (poExceeded) poNeed = 2;
                beltSums[group.id] = { sum, cbNeed, poNeed, poExceeded };
            }
        }

        // Lógica de Somas Específicas Dinâmicas
        const fingerSums = {};
        let totalSortation = 0;

        for (const f of activeFingers) {
            let sum = 0;
            for (const bId of f.belts) {
                if (beltSums[bId]) sum += beltSums[bId].sum;
            }
            fingerSums[f.id] = { sum, name: f.name };
            totalSortation += sum;
        }

        let html = '<div class="vsm-static-wrap"><table class="vsm-static-table">';

        for (let r = 0; r < croppedMatrix.length; r++) {
            html += '<tr>';
            for (let c = 0; c < croppedMatrix[r].length; c++) {
                let cellValue = String(croppedMatrix[r][c]).trim();

                // Lógica de Leitura das Tags Dinâmicas
                if (cellValue === '[SKIP]') {
                    continue;
                }
                if (cellValue === '[L_TS]') {
                    html += `<td colspan="2" class="total-finger-label" style="text-align:center;">Total Sortation</td>`;
                    continue;
                }
                if (cellValue === '[TS_V]') {
                    const blinkClass = totalSortation > staticFingerRate * 2 ? 'blink-red-finger' : '';
                    html += `<td colspan="2" class="belt-sum-cell ${blinkClass}" style="text-align:center;">
                                <span class="belt-sum-total">${totalSortation.toLocaleString('pt-BR')}</span>
                                <span class="belt-sum-label">pkgs/h</span>
                             </td>`;
                    continue;
                }

                // MATCH DINÂMICO DOS LABELS DOS FINGERS: [L_F1], [L_F2], [L_F3]...
                const lfMatch = cellValue.match(/^\[L_F(\d+)\]$/);
                if (lfMatch) {
                    const fId = parseInt(lfMatch[1], 10);
                    const fName = fingerSums[fId] ? fingerSums[fId].name : `Finger ${fId}`;
                    html += `<td class="total-finger-label">${esc(fName)}</td>`;
                    continue;
                }

                // MATCH DINÂMICO DOS VALORES DOS FINGERS: [F1], [F2], [F3]...
                const fMatch = cellValue.match(/^\[F(\d+)\]$/);
                if (fMatch) {
                    const fId = parseInt(fMatch[1], 10);
                    const fData = fingerSums[fId] || { sum: 0 };
                    const blinkClass = (fData.sum > staticFingerRate) ? 'blink-red-finger' : '';
                    html += `<td class="belt-sum-cell ${blinkClass}">
                                <span class="belt-sum-total">${fData.sum.toLocaleString('pt-BR')}</span>
                                <span class="belt-sum-label">pkgs/h</span>
                             </td>`;
                    continue;
                }

                const beltMatch = cellValue.match(/^\[B(\d+)\]$/);
                if (beltMatch) {
                    const beltId = parseInt(beltMatch[1], 10);
                    const beltSumData = beltSums[beltId];
                    if (beltSumData && beltSumData.sum > 0) {
                        const poClass = beltSumData.poExceeded ? 'belt-po-need belt-po-warning' : 'belt-po-need';
                        html += `<td class="belt-sum-cell">
                                    <span class="belt-sum-total">${beltSumData.sum.toLocaleString('pt-BR')}</span>
                                    <span class="belt-sum-label">pkgs/h</span>
                                    <span class="belt-cb-need"><span class="belt-need-val">${beltSumData.cbNeed}</span><span class="belt-need-lbl">CB</span></span>
                                    <span class="${poClass}"><span class="belt-need-val">${beltSumData.poNeed}</span><span class="belt-need-lbl">PO</span></span>
                                 </td>`;
                    } else {
                        html += `<td class="belt-sum-cell" style="opacity: 0.3;">
                                    <span class="belt-sum-total">0</span>
                                    <span class="belt-sum-label">pkgs/h</span>
                                 </td>`;
                    }
                    continue;
                }

                // Renderização padrão da célula
                let content = cellValue;
                let cellClass = '';
                let dataCat = '';

                if (cellValue === '') {
                    cellClass = 'empty-cell';
                } else if (cellValue === '0' || cellValue === 0) {
                    const associatedVsm = findVsmForZero(croppedMatrix, r, c, allVsmsSet);
                    if (associatedVsm && vsmTotalsLocal && vsmTotalsLocal[associatedVsm] !== undefined) {
                        content = vsmTotalsLocal[associatedVsm].toLocaleString('pt-BR');
                        cellClass = 'value-cell';
                        if (staticMaxPkgsPerHour > 0) {
                            const ratio = vsmTotalsLocal[associatedVsm] / staticMaxPkgsPerHour;
                            if (ratio >= 1) dataCat = 'ZERO_RED';
                            else if (ratio >= 0.8) dataCat = 'ZERO_YELLOW';
                            else if (ratio > 0) dataCat = 'VALUE_LOW';
                            else dataCat = 'ZERO';
                        } else {
                            if (vsmTotalsLocal[associatedVsm] > 0) dataCat = 'VALUE_LOW';
                            else dataCat = 'ZERO';
                        }
                    } else {
                        content = '0';
                        cellClass = 'value-cell';
                        dataCat = 'ZERO';
                    }
                } else {
                    const cat = getCellCategory(cellValue);
                    if (cat !== 'default') {
                        dataCat = cat;
                        cellClass = 'vsm-code';
                    }
                }

                content = String(content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                if (dataCat) {
                    html += `<td class="${cellClass}" data-cat="${dataCat}">${content}</td>`;
                } else if (cellClass) {
                    html += `<td class="${cellClass}">${content}</td>`;
                } else {
                    html += `<td class="empty-cell">${content}</td>`;
                }
            }
            html += '</tr>';
        }
        html += '</table></div>';

        container.innerHTML = html;
        updateNeedSummary();
    }

    function updateStaticMapWithTotals() {
        const staticContainer = document.getElementById('vsm-layout-container');
        if (staticContainer && staticContainer.innerHTML !== '') {
            renderStaticVsmMap(getStaticVsmTotals());
        }
    }

    function updateNeedSummary() {
        const summaryEl = document.getElementById('static-need-summary');
        if (!summaryEl) return;
        const totals = getStaticVsmTotals();
        const totalPkgs = Object.values(totals).reduce((a, b) => a + b, 0);
        if (totalPkgs === 0) {
            summaryEl.style.display = 'none';
            return;
        }
        summaryEl.style.display = 'flex';

        let cbTotal = 0;
        let poTotal = 0;
        for (const group of BELT_GROUPS) {
            const sum = group.vsms.reduce((acc, vsm) => acc + (totals[vsm] || 0), 0);
            if (sum > 0) {
                cbTotal += Math.max(1, Math.ceil(sum / cbRate));
                poTotal += Math.max(1, Math.ceil(sum / poRate));
            }
        }
        cbTotal = Math.max(17, cbTotal);
        poTotal = Math.max(17, poTotal);

        const cbEl = document.getElementById('need-cb-total');
        const poEl = document.getElementById('need-po-total');
        if (cbEl) cbEl.textContent = cbTotal;
        if (poEl) poEl.textContent = poTotal;
    }

    function getStatusInfo(percent) {
        if (percent === undefined || percent === null) return { text: 'N/A', color: '#aaa', order: 4 };
        if (percent <= 2) return { text: 'Não processado', color: '#ff6b6b', order: 2 };
        if (percent < 93) return { text: 'Em processamento', color: '#aad4ff', order: 1 };
        return { text: 'Concluído', color: '#88cc99', order: 3 };
    }

    function renderVridList() {
        const container = document.getElementById('vrid-list-container');
        if (!container) return;

        if (!lastExportData || lastExportData.length === 0) {
            container.innerHTML = '<div class="vsm-map-empty">Nenhum VRID carregado.</div>';
            return;
        }

        const enriched = lastExportData.map(v => {
            const totalP = (v.containers || []).reduce((s, c) => s + getCounts(c).P, 0);
            const percent = v.completePercent !== undefined ? v.completePercent : null;
            const status = getStatusInfo(percent);
            return { ...v, totalP, status };
        }).filter(v => !hideZeroPkgs || v.totalP > 0);

        enriched.sort((a, b) => {
            if (a.status.order !== b.status.order) return a.status.order - b.status.order;
            return b.totalP - a.totalP;
        });

        let html = `
            <div class="vrid-list-controls" style="flex-wrap: wrap;">
                <input type="text" id="vrid-search-input" placeholder="Filtrar por VRID, rota ou horário..." class="vrid-search" style="min-width: 150px;">
                <div style="display:flex; gap:6px; flex-wrap: wrap;">
                    <button id="btn-sel-all" class="vl-btn-small">Todos</button>
                    <button id="btn-sel-proc" class="vl-btn-small" style="background:#1a2a4a; color:#aad4ff; border: 1px solid #2a4a6a;">Processamento</button>
                    <button id="btn-sel-unproc" class="vl-btn-small" style="background:#4a0a14; color:#ff8888; border: 1px solid #8a1a2a;">Não proc.</button>
                    <button id="btn-sel-done" class="vl-btn-small" style="background:#1a3a2a; color:#88cc99; border: 1px solid #2a5a3a;">Concluídos</button>
                    <button id="toggle-zero-pkgs-btn" class="vl-btn-small" style="background: ${hideZeroPkgs ? '#ff9900' : '#2a3a4a'}; color: ${hideZeroPkgs ? '#0f1923' : '#99a'};">Ocultar zeros ${hideZeroPkgs ? '✔' : '✘'}</button>
                </div>
            </div>
            <div id="vrid-list-items" class="vrid-badge-grid">
        `;

        for (const v of enriched) {
            const checked = selectedVrids.has(v.vrid);
            const sat = v.scheduledArrivalTime || 'N/A';
            const aat = v.actualArrivalTime && v.actualArrivalTime !== 'N/A' ? v.actualArrivalTime : '—';
            const route = v.route || 'N/A';
            const percent = v.completePercent !== undefined ? v.completePercent : null;
            const status = v.status;

            html += `
                <div class="vrid-badge ${checked ? 'selected' : ''}" data-vrid="${esc(v.vrid)}" data-status-order="${status.order}">
                    <div class="vrid-badge-content">
                        <div class="vrid-badge-header">
                            <span class="vrid-badge-vrid">🚛 ${esc(v.vrid)}</span>
                            <span class="vrid-badge-pkgs">📦 ${v.totalP} / ${(v.containers || []).reduce((s,c) => s + getCounts(c).C, 0)}</span>
                        </div>
                        <div class="vrid-badge-times">
                            <span>⏰ SAT: ${esc(sat)}</span>
                            <span>🛬 AAT: ${esc(aat)}</span>
                        </div>
                        <div class="vrid-badge-route">🛣 ${esc(route)}</div>
                        <div class="vrid-badge-status" style="color: ${status.color}; font-weight: bold;">
                            ${percent !== null ? `📊 ${percent}% ` : ''}${status.text}
                        </div>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
        container.innerHTML = html;

        const searchInput = document.getElementById('vrid-search-input');
        const itemsContainer = document.getElementById('vrid-list-items');

        function filterList() {
            const searchTerm = searchInput.value.trim().toLowerCase();
            itemsContainer.querySelectorAll('.vrid-badge').forEach(badge => {
                const text = badge.textContent.toLowerCase();
                badge.style.display = (searchTerm === '' || text.includes(searchTerm)) ? '' : 'none';
            });
        }
        searchInput.addEventListener('input', filterList);

        itemsContainer.querySelectorAll('.vrid-badge').forEach(badge => {
            badge.addEventListener('click', () => {
                const vrid = badge.dataset.vrid;
                if (selectedVrids.has(vrid)) {
                    selectedVrids.delete(vrid);
                    badge.classList.remove('selected');
                } else {
                    selectedVrids.add(vrid);
                    badge.classList.add('selected');
                }
                computeAndRenderAll();
            });
        });

        function filterSelectionByStatus(targetOrder) {
            itemsContainer.querySelectorAll('.vrid-badge:not([style*="display: none"])').forEach(b => {
                const vrid = b.dataset.vrid;
                const statusOrder = parseInt(b.dataset.statusOrder, 10);
                if (statusOrder === targetOrder) {
                    selectedVrids.add(vrid);
                    b.classList.add('selected');
                } else {
                    selectedVrids.delete(vrid);
                    b.classList.remove('selected');
                }
            });
            computeAndRenderAll();
        }

        document.getElementById('btn-sel-all').addEventListener('click', () => {
            const visibleBadges = Array.from(itemsContainer.querySelectorAll('.vrid-badge:not([style*="display: none"])'));

            // Verifica se TODOS os visíveis já estão selecionados
            const allSelected = visibleBadges.length > 0 && visibleBadges.every(b => b.classList.contains('selected'));

            visibleBadges.forEach(b => {
                const vrid = b.dataset.vrid;
                if (allSelected) {
                    // Se já estiverem todos selecionados, vamos DESMARCAR tudo
                    selectedVrids.delete(vrid);
                    b.classList.remove('selected');
                } else {
                    // Se faltar algum (ou nenhum estiver), SELECIONAMOS tudo
                    selectedVrids.add(vrid);
                    b.classList.add('selected');
                }
            });
            computeAndRenderAll();
        });

        document.getElementById('btn-sel-proc').addEventListener('click', () => filterSelectionByStatus(1));
        document.getElementById('btn-sel-unproc').addEventListener('click', () => filterSelectionByStatus(2));
        document.getElementById('btn-sel-done').addEventListener('click', () => filterSelectionByStatus(3));

        document.getElementById('toggle-zero-pkgs-btn').addEventListener('click', () => {
            hideZeroPkgs = !hideZeroPkgs;
            renderVridList();
            computeAndRenderAll();
        });

        filterList();
    }

    function renderContainersWithControls(containerData, containerDiv, totalsSpan) {
        const containers = containerData.ret && containerData.ret.inboundCDTContainerCount ? Object.values(containerData.ret.inboundCDTContainerCount)[0] : null;
        if (!containers || containers.length === 0) {
            containerDiv.innerHTML = '<small>Nenhum container encontrado.</small>';
            if (totalsSpan) totalsSpan.innerText = ' (P:0, C:0)';
            return;
        }
        let totals = { totalP: 0, totalC: 0 };
        for (const c of containers) {
            const counts = getCounts(c);
            totals.totalP += counts.P;
            totals.totalC += counts.C;
        }
        if (totalsSpan) totalsSpan.innerText = ` (P:${totals.totalP}, C:${totals.totalC})`;

        let mode = 'detailed';
        function refreshDisplay() {
            let html = '';
            if (mode === 'detailed') {
                html += '<div><strong>📦 Detalhado:</strong></div>';
                for (const c of containers) {
                    const lane = simplifyLane(c.lane || 'N/A');
                    const counts = getCounts(c);
                    if (counts.P === 0) continue;
                    const cpt = c.criticalPullTime || 'N/A';
                    const suffix = counts.C > 0 ? ' - Xdock' : '';
                    html += `<div style="margin-left:12px; font-size:11px;">⏱️ ${cpt} | 🚚 ${lane} | 📦 ${counts.P} P / ${counts.C} C${suffix}</div>`;
                }
            } else {
                const consolidated = consolidateContainers(containers);
                html += '<div><strong>📦 Consolidado por rota:</strong></div>';
                for (const entry of consolidated) {
                    const suffix = entry.hasXdock ? ' - Xdock' : '';
                    html += `<div style="margin-left:12px; font-size:11px;">🚚 ${entry.lane} | 📦 ${entry.P} P / ${entry.C} C${suffix}</div>`;
                }
            }
            html += `<div class="container-control"><button class="toggle-mode-btn">${mode === 'detailed' ? 'Consolidar' : 'Detalhado'}</button></div>`;
            containerDiv.innerHTML = html;
            const btn = containerDiv.querySelector('.toggle-mode-btn');
            if (btn) {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    mode = (mode === 'detailed' ? 'consolidated' : 'detailed');
                    refreshDisplay();
                });
            }
        }
        refreshDisplay();
    }

    function consolidateContainers(containers) {
        const nonXdock = new Map();
        const xdock = new Map();
        for (const c of containers) {
            const lane = simplifyLane(c.lane || 'N/A');
            const counts = getCounts(c);
            if (counts.C === 0) {
                if (!nonXdock.has(lane)) nonXdock.set(lane, { P: 0, C: 0 });
                const entry = nonXdock.get(lane);
                entry.P += counts.P;
                entry.C += counts.C;
            } else {
                if (!xdock.has(lane)) xdock.set(lane, { P: 0, C: 0 });
                const entry = xdock.get(lane);
                entry.P += counts.P;
                entry.C += counts.C;
            }
        }
        const result = [];
        nonXdock.forEach((value, lane) => {
            if (value.P > 0) result.push({ lane, P: value.P, C: value.C, hasXdock: false });
        });
        xdock.forEach((value, lane) => {
            if (value.P > 0) result.push({ lane, P: value.P, C: value.C, hasXdock: true });
        });
        result.sort((a, b) => a.lane.localeCompare(b.lane));
        return result;
    }

    function renderCardsFromCache() {
        if (!lastExportData || lastExportData.length === 0) return;
        const resultDiv = document.getElementById('vl-result');
        if (!resultDiv) return;
        resultDiv.innerHTML = '';

        const sorted = [...lastExportData].sort((a, b) => {
            const sumP = v => (v.containers || []).reduce((s, c) => s + getCounts(c).P, 0);
            return sumP(b) - sumP(a);
        });

        for (let i = 0; i < sorted.length; i++) {
            const v = sorted[i];
            const cardId = `vl-card-${i}`;
            resultDiv.insertAdjacentHTML('beforeend', `
                <div class="vl-card" id="${cardId}">
                    <div class="vl-card-head" data-idx="${i}">
                        <span class="vl-card-vrid">🚛 ${esc(v.vrid)}</span>
                        <span class="vl-card-meta">
                            ${v.scheduledArrivalTime ? `⏰ ${esc(v.scheduledArrivalTime)}` : ''}
                            ${v.route ? ` &nbsp;·&nbsp; 🛣 ${esc(v.route)}` : ''}
                        </span>
                        <span class="vl-card-count" id="vl-count-${i}"></span>
                        <span class="vl-chevron" id="vl-chev-${i}">▸</span>
                    </div>
                    <div class="vl-card-body" id="vl-body-${i}">
                    </div>
                </div>`);

            const bodyEl  = document.getElementById(`vl-body-${i}`);
            const countEl = document.getElementById(`vl-count-${i}`);

            const tempContainer = document.createElement('div');
            renderContainersWithControls(
                { ret: { inboundCDTContainerCount: { [v.planId]: v.containers } } },
                tempContainer, countEl
            );
            bodyEl.innerHTML = '';
            bodyEl.appendChild(tempContainer);

            document.getElementById(cardId)?.querySelector('.vl-card-head')
                ?.addEventListener('click', () => {
                    bodyEl.classList.toggle('show');
                    const chev = document.getElementById(`vl-chev-${i}`);
                    chev.textContent = bodyEl.classList.contains('show') ? '▾' : '▸';
                });
        }
    }

    function promiseFetchContainers(planIds) {
        return new Promise((resolve, reject) => {
            fetchContainers(planIds, (err, data) => {
                if (err) reject(err); else resolve(data);
            });
        });
    }

    function promiseFetchCompletePercent(planIds) {
        return new Promise((resolve, reject) => {
            fetchCompletePercent(planIds, (err, data) => {
                if (err) reject(err); else resolve(data);
            });
        });
    }

    async function processVRIDs(vridList, label) {
        const resultDiv   = document.getElementById('vl-result');
        const progressDiv = document.getElementById('vl-progress');
        resultDiv.innerHTML = '';

        const allExportData = [];
        const total = vridList.length;

        function setProgress(n, text) {
            progressDiv.style.display = 'block';
            progressDiv.querySelector('.vl-prog-text').textContent = text;
            progressDiv.querySelector('.vl-prog-fill').style.width = `${Math.round((n / total) * 100)}%`;
        }

        setProgress(0, `Processando VRIDs… 0 / ${total}`);

        for (let i = 0; i < total; i++) {
            const v = vridList[i];
            resultDiv.insertAdjacentHTML('beforeend', `
                <div class="vl-card" id="vl-card-${i}">
                    <div class="vl-card-head" data-idx="${i}">
                        <span class="vl-card-vrid">🚛 ${esc(v.vrid)}</span>
                        <span class="vl-card-meta">
                            ${v.scheduledArrivalTime ? `⏰ ${esc(v.scheduledArrivalTime)}` : ''}
                            ${v.route ? ` &nbsp;·&nbsp; 🛣 ${esc(v.route)}` : ''}
                        </span>
                        <span class="vl-card-count" id="vl-count-${i}"></span>
                        <span class="vl-chevron" id="vl-chev-${i}">▸</span>
                    </div>
                    <div class="vl-card-body" id="vl-body-${i}">
                        <div class="skel-block">
                            <div class="skel-row-flex">
                                <div class="skeleton skel-circle"></div>
                                <div style="flex:1">
                                    <div class="skeleton skel-bar" style="width: 70%; margin-bottom: 6px;"></div>
                                    <div class="skeleton skel-bar" style="width: 40%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`);

            const bodyEl = document.getElementById(`vl-body-${i}`);
            document.getElementById(`vl-card-${i}`)?.querySelector('.vl-card-head')
                ?.addEventListener('click', () => {
                    bodyEl.classList.toggle('show');
                    const chev = document.getElementById(`vl-chev-${i}`);
                    if (chev) chev.textContent = bodyEl.classList.contains('show') ? '▾' : '▸';
                });
        }

        let done = 0;
        for (let start = 0; start < total; start += FETCH_CONCURRENCY) {
            const batch = vridList.slice(start, start + FETCH_CONCURRENCY);
            const planIds = batch.map(v => v.planId).filter(id => id);

            let containersMap = {};
            let percentMap = {};
            try {
                const [containersData, percentData] = await Promise.all([
                    promiseFetchContainers(planIds),
                    promiseFetchCompletePercent(planIds)
                ]);
                containersMap = containersData.ret?.inboundCDTContainerCount || {};
                percentMap = percentData.ret?.inboundContainerCount || {};
            } catch (err) {
                console.error('Error fetching data:', err);
            }

            for (let bi = 0; bi < batch.length; bi++) {
                const v = batch[bi];
                const i = start + bi;
                const bodyEl  = document.getElementById(`vl-body-${i}`);
                const countEl = document.getElementById(`vl-count-${i}`);

                const planId = v.planId;
                if (!planId) {
                    countEl.innerHTML = `<span class="badge-err">sem Plan ID</span>`;
                    bodyEl.innerHTML  = `<div class="vl-err">Plan ID não disponível.</div>`;
                    done++;
                    setProgress(done, `Processando VRIDs… ${done} / ${total}`);
                    continue;
                }

                const containers = containersMap[planId] || [];
                const percentInfo = percentMap[planId] || {};
                const completePercent = percentInfo.completePercent !== undefined ? percentInfo.completePercent : null;

                const tempContainer = document.createElement('div');
                renderContainersWithControls({ ret: { inboundCDTContainerCount: { [planId]: containers } } }, tempContainer, countEl);
                bodyEl.innerHTML = '';
                bodyEl.appendChild(tempContainer);

                allExportData.push({
                    vrid: v.vrid,
                    planId: v.planId,
                    scheduledArrivalTime: v.scheduledArrivalTime,
                    route: v.route,
                    actualArrivalTime: v.actualArrivalTime,
                    containers: containers,
                    completePercent: completePercent
                });

                done++;
                setProgress(done, `Processando VRIDs… ${done} / ${total}`);
            }
        }

        setProgress(total, `Concluído: ${allExportData.length} VRIDs`);
        progressDiv.querySelector('.vl-prog-fill').style.background = '#2d8a4e';
        setTimeout(() => { progressDiv.style.display = 'none'; }, 2000);

        if (!resultDiv.children.length) {
            resultDiv.innerHTML = '<div class="vl-err">Nenhum VRID encontrado.</div>';
        }

        const isRefresh = lastExportData.length > 0;
        const oldKnownVrids = new Set(lastExportData.map(v => v.vrid));
        const newSelectedVrids = new Set();

        allExportData.forEach(v => {
            if (isRefresh && oldKnownVrids.has(v.vrid)) {
                if (selectedVrids.has(v.vrid)) newSelectedVrids.add(v.vrid);
            } else {
                newSelectedVrids.add(v.vrid);
            }
        });

        selectedVrids = newSelectedVrids;
        lastExportData = allExportData;

        computeAndRenderAll();
        renderVridList();
        renderCardsFromCache();
    }

    async function doSingleSearch(vrid) {
        const resultDiv = document.getElementById('vl-result');
        const progDiv   = document.getElementById('vl-progress');
        resultDiv.innerHTML = '';
        progDiv.querySelector('.vl-prog-text').textContent = 'Buscando VRIDs…';
        progDiv.querySelector('.vl-prog-fill').style.width = '0';
        progDiv.style.display = 'block';

        let data;
        try {
            const ts = getLocalDayTs(new Date());
            data = await new Promise((resolve, reject) => {
                fetchVRIData(ts.start, ts.end, (err, res) => {
                    if (err) reject(err); else resolve(res);
                });
            });
        } catch (e) {
            resultDiv.innerHTML = `<div class="vl-err">Erro ao buscar VRIDs: ${esc(String(e))}</div>`;
            progDiv.style.display = 'none';
            return;
        }

        const all = (function() {
            const src = data?.ret?.aaData ?? {};
            const arr = Array.isArray(src) ? src : Object.values(src);
            return arr.map(item => {
                const l = getLoadObject(item);
                return {
                    vrid: l.vrid || l.vrId || l.vId || '',
                    planId: l.planId || l.planForOrderId || '',
                    scheduledArrivalTime: l.scheduledArrivalTime || '',
                    route: l.route || '',
                    actualArrivalTime: l.actualArrivalTime || l.actualDepartureTime || ''
                };
            }).filter(v => v.vrid);
        })();

        const found = all.find(v => v.vrid.toUpperCase() === vrid);
        if (!found) {
            resultDiv.innerHTML = '<div class="vl-err">VRID não encontrado no período de hoje.</div>';
            progDiv.style.display = 'none';
            return;
        }

        lastSearch = { mode: 'single', vrid: found.vrid };
        await processVRIDs([found], `VRID_${found.vrid}`);
    }

    async function doRangeSearch(startDate, endDate, startHour, endHour) {
        const resultDiv = document.getElementById('vl-result');
        const progDiv   = document.getElementById('vl-progress');
        resultDiv.innerHTML = '';
        progDiv.querySelector('.vl-prog-text').textContent = 'Buscando VRIDs…';
        progDiv.querySelector('.vl-prog-fill').style.width = '0';
        progDiv.style.display = 'block';

        let data;
        try {
            const queryStart = new Date(startDate);
            if (startHour === 0) {
                queryStart.setDate(queryStart.getDate() - 1);
            }

            const tsStart = getLocalDayTs(queryStart);
            const tsEnd   = getLocalDayTs(endDate);

            data = await new Promise((resolve, reject) => {
                fetchVRIData(tsStart.start, tsEnd.end, (err, res) => {
                    if (err) reject(err); else resolve(res);
                });
            });
        } catch (e) {
            resultDiv.innerHTML = `<div class="vl-err">Erro ao buscar VRIDs: ${esc(String(e))}</div>`;
            progDiv.style.display = 'none';
            return;
        }

        const filtered = getVRIDsFromData(data, startDate, startHour, endDate, endHour);
        if (!filtered.length) {
            resultDiv.innerHTML = '<div class="vl-err">Nenhum VRID encontrado neste período.</div>';
            progDiv.style.display = 'none';
            return;
        }

        const lbl = `${startDate.toISOString().slice(0,10)}_${endDate.toISOString().slice(0,10)}_${startHour}-${endHour}h`;

        lastSearch = { mode: 'range', startDate, endDate, startHour, endHour };
        await processVRIDs(filtered, lbl);
    }

    function updateCountdownDisplay() {
        const statusSpan = document.getElementById('auto-refresh-status');
        const toggleEl = document.getElementById('auto-refresh-toggle');
        if (!statusSpan) return;

        if (autoRefreshNextTimestamp > 0) {
            const remainingMs = Math.max(0, autoRefreshNextTimestamp - Date.now());
            const remainingSec = Math.floor(remainingMs / 1000);
            const minutes = Math.floor(remainingSec / 60);
            const seconds = remainingSec % 60;
            statusSpan.textContent = ` (próximo em ${minutes}:${seconds.toString().padStart(2,'0')})`;
            statusSpan.style.color = '#4dbb7a';
        } else {
            if (toggleEl && toggleEl.checked) {
                statusSpan.textContent = ' (aguardando busca...)';
                statusSpan.style.color = '#ffaa55';
            } else {
                statusSpan.textContent = ' (desligado)';
                statusSpan.style.color = '#778';
            }
        }
    }

    function stopAutoRefresh() {
        if (autoRefreshTimer) {
            clearTimeout(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        if (autoRefreshCountdownInterval) {
            clearInterval(autoRefreshCountdownInterval);
            autoRefreshCountdownInterval = null;
        }
        autoRefreshNextTimestamp = 0;
        updateCountdownDisplay();
    }

    function startAutoRefresh(intervalMinutes) {
        stopAutoRefresh();

        if (!lastSearch) {
            updateCountdownDisplay();
            return;
        }

        const intervalMs = intervalMinutes * 60 * 1000;

        function scheduleNext() {
            autoRefreshTimer = setTimeout(refreshNow, intervalMs);
            autoRefreshNextTimestamp = Date.now() + intervalMs;
            updateCountdownDisplay();
        }

        async function refreshNow() {
            if (isRefreshing) return;
            isRefreshing = true;
            try {
                if (lastSearch.mode === 'single') {
                    await doSingleSearch(lastSearch.vrid);
                } else if (lastSearch.mode === 'range') {
                    await doRangeSearch(lastSearch.startDate, lastSearch.endDate, lastSearch.startHour, lastSearch.endHour);
                }
            } catch(e) {
                console.error('Auto refresh error:', e);
            } finally {
                isRefreshing = false;
                scheduleNext();
            }
        }

        scheduleNext();

        if (!autoRefreshCountdownInterval) {
            autoRefreshCountdownInterval = setInterval(() => {
                updateCountdownDisplay();
            }, 1000);
        }
    }

    GM_addStyle(`
        @keyframes shimmer {
            0% { background-position: -200px 0; }
            100% { background-position: calc(200px + 100%) 0; }
        }
        .skeleton {
            background: #1a2a3a;
            background-image: linear-gradient(90deg, #1a2a3a 0px, #2a3a4a 40px, #1a2a3a 80px);
            background-size: 200px 100%;
            animation: shimmer 1.5s infinite linear;
            border-radius: 4px;
        }
        .skel-block {
            padding: 4px 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .skel-row-flex { display: flex; gap: 10px; align-items: center; }
        .skel-circle { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
        .skel-bar { height: 10px; border-radius: 4px; }

        #vl-panel {
            position: fixed;
            top: 2%;
            right: 2%;
            width: 96%;
            height: 92%;
            max-width: 98vw;
            max-height: 94vh;
            background: #0f1923;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,.6), 0 0 0 1px rgba(255,153,0,.15);
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 13px;
            color: #e8eaed;
            z-index: 99999;
            display: none;
            resize: both;
            border: 1px solid #2a3a4a;
            transition: all .2s ease;
        }
        #vl-panel.vl-fullscreen {
            top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
            width: 100vw !important; height: 100vh !important; max-width: 100vw !important;
            max-height: 100vh !important; border-radius: 0 !important; resize: none !important;
        }
        #vl-panel-head {
            background: linear-gradient(90deg, #1a2a3a 0%, #0f1923 100%);
            border-bottom: 1px solid #2a3a4a; color: #e8eaed; padding: 0 16px;
            height: 52px; display: flex; align-items: center; gap: 12px; cursor: grab; user-select: none;
        }
        #vl-panel-head:active { cursor: grabbing; }
        #vl-panel-head h3 { margin: 0; font-size: 14px; font-weight: 700; flex: 1; letter-spacing: .5px; color: #fff; }
        #vl-panel-head h3 span { color: #ff9900; }
        #vl-head-actions { display: flex; gap: 6px; align-items: center; }
        .vl-head-btn {
            background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); color: #aab;
            font-size: 13px; width: 30px; height: 30px; border-radius: 6px; cursor: pointer;
            display: flex; align-items: center; justify-content: center; transition: all .15s; padding: 0; line-height: 1;
        }
        .vl-head-btn:hover { background: rgba(255,153,0,.2); color: #ff9900; border-color: rgba(255,153,0,.4); }
        #vl-close-btn { font-size: 18px; }
        #vl-panel-body {
            padding: 14px 16px; overflow-y: auto; height: calc(100% - 52px);
            background: #0f1923; scrollbar-width: thin; scrollbar-color: #2a3a4a #0f1923;
        }
        #vl-panel-body::-webkit-scrollbar { width: 6px; }
        #vl-panel-body::-webkit-scrollbar-track { background: #0f1923; }
        #vl-panel-body::-webkit-scrollbar-thumb { background: #2a3a4a; border-radius: 3px; }
        .vl-controls-bar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .vl-ctrl-chip {
            display: flex; align-items: center; gap: 8px; background: #1a2a3a;
            border: 1px solid #2a3a4a; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #aab;
        }
        .vl-ctrl-chip label { font-size: 12px; font-weight: 600; color: #ccd; white-space: nowrap; }
        .vl-ctrl-chip select, .vl-ctrl-chip input[type="checkbox"] {
            background: #0f1923; color: #e8eaed; border: 1px solid #3a4a5a;
            border-radius: 5px; padding: 3px 8px; font-size: 12px; cursor: pointer;
        }
        .vl-ctrl-chip input[type="checkbox"] { width: 15px; height: 15px; accent-color: #ff9900; padding: 0; }
        #auto-refresh-status { font-size: 11px; font-weight: 600; transition: color 0.2s; }
        .vl-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #2a3a4a; }
        .vl-tab {
            background: none; border: none; padding: 8px 16px; font-size: 13px; font-weight: 600;
            color: #99a; cursor: pointer; border-radius: 8px 8px 0 0; transition: all .15s;
        }
        .vl-tab.active { color: #ff9900; background: #1a2a3a; border-bottom: 2px solid #ff9900; }
        .vl-tab:hover:not(.active) { color: #ccd; background: #1a2a3a; }
        .vl-tab-content { display: none; }
        .vl-tab-content.active { display: block; }
        .vl-section {
            margin-bottom: 16px; border: 1px solid #2a3a4a; border-radius: 10px;
            padding: 12px 14px; background: #141f2c;
        }
        .vl-section-title { font-weight: 700; font-size: 12px; margin-bottom: 10px; color: #ff9900; letter-spacing: .8px; text-transform: uppercase; }
        .vl-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        .vl-row input[type="text"], .vl-row input[type="date"], .vl-row select {
            flex: 1; padding: 7px 10px; border: 1px solid #2a3a4a; border-radius: 6px;
            font-size: 12px; background: #0f1923; color: #e8eaed; outline: none; transition: border-color .15s; min-width: 80px;
        }
        .vl-row input:focus, .vl-row select:focus { border-color: #ff9900; }
        .vl-row span { color: #556; font-size: 12px; }
        .vl-hint { font-size: 10px; color: #445; margin-top: 2px; }
        .vl-btn {
            background: #ff9900; color: #0f1923; border: none; padding: 7px 16px;
            border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; white-space: nowrap;
            letter-spacing: .3px; transition: background .15s, transform .1s;
        }
        .vl-btn:hover { background: #ffb340; transform: translateY(-1px); }
        .vl-btn:active { transform: translateY(0); }
        .vl-btn-full { width: 100%; }
        .vl-btn-small { background: #ff9900; color: #0f1923; border: none; padding: 4px 12px; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; transition: background .15s; }
        .vl-btn-small:hover { background: #ffb340; }
        #vl-progress { display: none; margin-bottom: 12px; }
        .vl-prog-text { font-size: 11px; color: #778; margin-bottom: 5px; }
        .vl-prog-track { height: 4px; background: #1a2a3a; border-radius: 2px; overflow: hidden; }
        .vl-prog-fill { height: 100%; width: 0; background: linear-gradient(90deg, #ff9900, #ffb340); border-radius: 2px; transition: width .25s, background .3s; }
        .vl-card {
            background: #141f2c; border: 1px solid #2a3a4a; border-radius: 8px;
            margin-bottom: 8px; overflow: hidden; transition: border-color .15s;
        }
        .vl-card:hover { border-color: #3a4a5a; }
        .vl-card-head {
            display: flex; align-items: center; gap: 8px; padding: 9px 12px;
            background: #1a2a3a; cursor: pointer; border-bottom: 1px solid #2a3a4a; transition: background .15s;
        }
        .vl-card-head:hover { background: #1e3040; }
        .vl-card-vrid { font-weight: 700; color: #ff9900; font-size: 13px; }
        .vl-card-meta { font-size: 11px; color: #667; flex: 1; }
        .vl-card-count { font-size: 11px; color: #99a; }
        .vl-chevron { color: #445; font-size: 12px; margin-left: 2px; transition: transform .15s; }
        .vl-card-body { display: none; padding: 10px 12px; font-size: 11px; color: #99a; }
        .vl-card-body.show { display: block; }
        .vl-loading { color: #445; font-size: 11px; font-style: italic; padding: 4px 0; }
        .vl-err { color: #e05; font-size: 12px; padding: 4px 0; }
        .container-control { text-align: right; margin-top: 8px; }
        .container-control button {
            background: #1a2a3a; border: 1px solid #2a3a4a; border-radius: 4px;
            color: #99a; font-size: 10px; padding: 3px 9px; cursor: pointer; transition: all .15s;
        }
        .container-control button:hover { background: #2a3a4a; color: #ccd; }
        .badge-err { background: rgba(220,53,69,.2); color: #f66; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid rgba(220,53,69,.3); }
        .vsm-map-empty {
            padding: 32px 24px; text-align: center; color: #445; font-size: 12px;
            border: 2px dashed #2a3a4a; border-radius: 10px; margin-top: 8px;
        }
        .vsm-tbl-wrap {
            overflow-x: auto; margin-top: 10px; border-radius: 8px;
            border: 1px solid #2a3a4a; scrollbar-width: thin; scrollbar-color: #2a3a4a #0f1923;
        }
        .vsm-tbl-wrap::-webkit-scrollbar { height: 5px; }
        .vsm-tbl-wrap::-webkit-scrollbar-thumb { background: #2a3a4a; border-radius: 3px; }
        .vsm-hourly-table { border-collapse: collapse; font-size: 11px; width: 100%; white-space: nowrap; }
        .vsm-hourly-table thead tr { border-bottom: 2px solid #2a3a4a; }
        .vsm-hourly-table th, .vsm-hourly-table td { border: 1px solid rgba(42,58,74,.6); padding: 5px 7px; text-align: center; transition: filter .12s; }
        .vsm-hourly-table th { font-weight: 700; font-size: 10px; letter-spacing: .3px; }
        .vsm-label-hdr { background: #1a2a3a !important; color: #778 !important; font-size: 10px !important; text-align: left !important; position: sticky; left: 0; z-index: 2; min-width: 52px; }
        .vsm-hourly-table .vsm-label { font-weight: 700; text-align: left; position: sticky; left: 0; z-index: 1; background: #141f2c; color: #ccd; border-right: 2px solid #2a3a4a; min-width: 52px; }
        .hour-col { min-width: 46px; font-size: 10px; }
        .total-col { font-weight: 700; border-left: 2px solid #2a3a4a !important; min-width: 50px; }
        .hour-cell { font-size: 10px; font-weight: 600; }
        .total-cell { font-size: 11px; font-weight: 700; border-left: 2px solid #2a3a4a !important; }
        .hour-total-row td { border-top: 2px solid #2a3a4a !important; font-weight: 700; }
        .vsm-row-hl { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); }
        .vsm-col-hl { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); }
        .vsm-static-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #2a3a4a; background: #0f1923; margin-top: 12px; }
        .vsm-static-table { border-collapse: collapse; font-family: 'SF Mono', monospace; font-size: 0.7rem; width: 100%; background: #0f1923; }
        .vsm-static-table td { padding: 6px 5px; text-align: center; border: 1px solid #2a3a4a; min-width: 44px; background-color: #141f2c; }
        .vsm-static-table td.empty-cell { background-color: #0f1923; border-color: #0f1923; }
        .vsm-static-table td.vsm-code { font-weight: 700; }
        .vsm-static-table td.belt-sum-cell { background-color: #1a1040; border: 1px solid #6655cc; border-radius: 3px; padding: 4px 5px; cursor: default; }
        .belt-sum-total { display: block; font-size: 13px; font-weight: 800; color: #c8b8ff; line-height: 1.2; }
        .belt-sum-label { display: block; font-size: 10px; font-weight: 600; color: #7766aa; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.2; }
        .belt-cb-need, .belt-po-need { display: inline-flex; align-items: center; justify-content: center; gap: 3px; margin-top: 4px; margin-right: 4px; padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: 700; line-height: 1.2; }
        .belt-cb-need { background: rgba(0, 180, 120, 0.18); border: 1px solid rgba(0, 180, 120, 0.35); color: #4dddaa; }
        .belt-po-need { background: rgba(255, 153, 0, 0.15); border: 1px solid rgba(255, 153, 0, 0.35); color: #ffbb44; }
        .belt-po-warning { background: rgba(255, 0, 0, 0.6) !important; border: 1px solid #ff0000 !important; animation: po-blink 0.8s step-start infinite; color: #fff !important; }
        @keyframes po-blink { 50% { opacity: 0.5; } }
        .blink-red-finger { animation: pulse-red-finger-anim 1.5s ease-in-out infinite !important; font-weight: bold !important; }
        @keyframes pulse-red-finger-anim { 0% { background-color: #1a1040; color: #c8b8ff; border-color: #6655cc; box-shadow: none; } 50% { background-color: #8a0b1c; color: #ffffff; border-color: #ff3333; box-shadow: inset 0 0 10px rgba(255,51,51,0.8); } 100% { background-color: #1a1040; color: #c8b8ff; border-color: #6655cc; box-shadow: none; } }
        .belt-need-val { font-size: 12px; font-weight: 800; }
        .belt-need-lbl { font-size: 8px; font-weight: 600; letter-spacing: 0.4px; opacity: 0.85; }

        .vsm-static-table td[data-cat="ZERO"] { background-color: #141f2c; color: #445566; font-weight: 600; }
        .vsm-static-table td[data-cat="VALUE_LOW"] { background-color: #1a3a2a; color: #88cc99; font-weight: 700; border: 1px solid #2a5a3a !important; }
        .vsm-static-table td.value-cell { font-weight: 600; }
        .vsm-static-table td[data-cat="H"] { background-color: #5a3a2a; color: #ffb085; }
        .vsm-static-table td[data-cat="CC"] { background-color: #2a4a6a; color: #aad4ff; }
        .vsm-static-table td[data-cat="X"] { background-color: #2a5a3a; color: #aaffaa; }
        .vsm-static-table td[data-cat="AA"] { background-color: #6a5a2a; color: #ffe5aa; }
        .vsm-static-table td[data-cat="AB"] { background-color: #6a4a6a; color: #ffc0ff; }
        .vsm-static-table td[data-cat="CD"] { background-color: #4a5a6a; color: #ccddff; }
        .vsm-static-table td[data-cat="AIR"] { background-color: #3a4a5a; color: #e8eaed; }
        .vsm-static-table td[data-cat="ZERO_YELLOW"] { background-color: #4a3d00; color: #ffe066; font-weight: 700; border: 1px solid #cc9900 !important; }
        .vsm-static-table td[data-cat="ZERO_RED"] { background-color: #4a0a14; color: #ff6b6b; font-weight: 700; border: 1px solid #cc2233 !important; animation: vsm-pulse 1.4s ease-in-out infinite; }
        @keyframes vsm-pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
        .vsm-legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 0.6rem 0; margin-top: 10px; border-top: 1px solid #2a3a4a; font-size: 0.65rem; color: #b0c4de; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-color { width: 14px; height: 14px; border-radius: 3px; }
        .total-finger-label { background-color: #2a3a4a; color: #ffd966; font-weight: bold; text-align: center; font-size: 0.8rem; }
        .vsm-need-summary { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
        .need-card { display: flex; flex-direction: column; align-items: center; padding: 8px 18px; border-radius: 8px; min-width: 110px; }
        .need-card.need-cb { background: rgba(0, 180, 120, 0.12); border: 1px solid rgba(0, 180, 120, 0.35); }
        .need-card.need-po { background: rgba(255, 153, 0, 0.10); border: 1px solid rgba(255, 153, 0, 0.35); }
        .need-val { font-size: 24px; font-weight: 800; line-height: 1.1; }
        .need-card.need-cb .need-val { color: #4dddaa; }
        .need-card.need-po .need-val { color: #ffbb44; }
        .need-label { font-size: 10px; font-weight: 700; letter-spacing: 0.4px; color: #99a; margin-top: 2px; }
        .need-sub { font-size: 9px; color: #556; margin-top: 1px; }
        .vsm-static-controls { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
        .mode-pill-group { display: flex; gap: 3px; }
        .mode-pill { background: #1a2a3a; border: 1px solid #2a3a4a; color: #778; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer; transition: all .15s; white-space: nowrap; }
        .mode-pill:hover { background: #233040; color: #ccd; }
        .mode-pill.active { background: #ff9900; color: #0f1923; border-color: #ff9900; }
        .hour-pill-group { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; padding: 8px 10px; background: #141f2c; border: 1px solid #2a3a4a; border-radius: 8px; }
        .hour-pill { background: #1a2a3a; border: 1px solid #2a3a4a; color: #778; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 5px; cursor: pointer; transition: all .12s; min-width: 32px; text-align: center; font-family: 'SF Mono', monospace; }
        .hour-pill:hover { background: #233040; color: #ccd; border-color: #3a4a5a; }
        .hour-pill.active { background: #ff9900; color: #0f1923; border-color: #ff9900; font-weight: 800; }
        .hour-pill[data-hour="-1"] { min-width: 48px; letter-spacing: .3px; }
        .vsm-meta-input { background: #0f1923; color: #e8eaed; border: 1px solid #3a4a5a; border-radius: 5px; padding: 4px 8px; font-size: 12px; font-weight: 700; width: 72px; text-align: center; }
        .vsm-meta-input:focus { outline: none; border-color: #ff9900; }
        .vrid-list-container { margin-top: 16px; border-top: 1px solid #2a3a4a; padding-top: 12px; }
        .vrid-list-controls { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
        .vrid-search { flex: 1; background: #0f1923; border: 1px solid #2a3a4a; border-radius: 6px; padding: 6px 10px; color: #e8eaed; font-size: 12px; }
        .vrid-badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; max-height: 400px; overflow-y: auto; padding: 4px; }
        .vrid-badge { background: #141f2c; border: 2px solid #2a3a4a; border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; opacity: 0.45; transform: scale(0.98); user-select: none; }
        .vrid-badge:hover { opacity: 0.75; background: #1a2a3a; }
        .vrid-badge.selected { opacity: 1; transform: scale(1); border-color: #ff9900; background: #1a2a3a; box-shadow: 0 6px 12px rgba(0,0,0,0.4); }
        .vrid-badge:active { transform: scale(0.95); }
        .vrid-badge-content { width: 100%; font-size: 14px; line-height: 1.4; }
        .vrid-badge-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
        .vrid-badge-vrid { font-weight: 700; color: #ff9900; font-size: 16px; }
        .vrid-badge-pkgs { background: rgba(0, 180, 120, 0.15); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; font-weight: 600; color: #4dddaa; }
        .vrid-badge-times { display: flex; gap: 14px; margin-bottom: 3px; color: #99a; font-size: 13px; }
        .vrid-badge-route { color: #668; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vrid-badge-status { font-size: 12px; margin-top: 4px; }
        #vl-toggle { position: fixed; bottom: 20px; right: 20px; background: linear-gradient(135deg, #1a2a3a 0%, #232f3e 100%); color: #ff9900; border: 1px solid rgba(255,153,0,.3); border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.4); z-index: 99998; transition: all .2s; letter-spacing: .3px; }
        #vl-toggle:hover { background: linear-gradient(135deg, #232f3e 0%, #2a3a4a 100%); box-shadow: 0 6px 20px rgba(0,0,0,.5); transform: translateY(-2px); }

        .vsm-config-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
        .vsm-config-table th, .vsm-config-table td { border: 1px solid #2a3a4a; padding: 8px 12px; }
        .vsm-config-table th { background: #1a2a3a; color: #ff9900; font-weight: 700; position: sticky; top: 0; z-index: 1;}
        .vsm-config-table tr:nth-child(even) { background: #141f2c; }
        .vsm-config-table tr:hover { background: #1e3040; }
        .cfg-input { background: #0f1923; border: 1px solid #3a4a5a; color: #e8eaed; padding: 4px 8px; border-radius: 4px; width: 100%; font-size: 12px; transition: border-color 0.2s; }
        .cfg-input:focus { outline: none; border-color: #ff9900; }
        .cfg-del-btn { opacity: 0.6; transition: opacity 0.2s; }
        .cfg-del-btn:hover { opacity: 1; }
    `);

    function generateHourOpts(def) {
        return Array.from({ length: 24 }, (_, i) =>
            `<option value="${i}"${i === def ? ' selected' : ''}>${String(i).padStart(2, '0')}:00</option>`
        ).join('');
    }

    function renderConfigTable() {
        const tbody = document.getElementById('config-table-body');
        if (!tbody) return;

        // Clone para ordenar sem quebrar a array base
        const rows = [...activeMappings];

        // Ordena por número do Grupo e depois Alfabeticamente pela Rota
        rows.sort((a, b) => {
            const gA = parseInt(a.group, 10) || 999;
            const gB = parseInt(b.group, 10) || 999;
            if(gA !== gB) return gA - gB;
            return a.route.localeCompare(b.route);
        });

        let html = '';
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            html += `<tr class="cfg-row">
                <td><input type="text" class="cfg-input cfg-route" value="${esc(row.route)}" placeholder="Rota"></td>
                <td><input type="text" class="cfg-input cfg-vsm-input" value="${esc(row.vsm)}" placeholder="VSM"></td>
                <td style="width: 100px;"><input type="number" class="cfg-input cfg-group" value="${esc(row.group)}" placeholder="ID Grupo"></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-del-btn" style="background:#e05;">X</button></td>
            </tr>`;
        }

        tbody.innerHTML = html;

        // Eventos para detectar alterações e remoções
        tbody.addEventListener('input', () => { configIsDirty = true; });
        tbody.querySelectorAll('.cfg-del-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.target.closest('tr').remove();
                configIsDirty = true;
            });
        });

        // ==========================================
        // Render Fingers Table
        // ==========================================
        const fTbody = document.getElementById('config-finger-body');
        if (fTbody) {
            let fHtml = '';
            activeFingers.forEach(f => {
                fHtml += `<tr class="cfg-finger-row">
                    <td style="width: 120px;"><input type="number" class="cfg-input cfg-f-id" value="${f.id}" placeholder="ID"></td>
                    <td><input type="text" class="cfg-input cfg-f-name" value="${esc(f.name)}" placeholder="Ex: Finger 1"></td>
                    <td><input type="text" class="cfg-input cfg-f-belts" value="${f.belts.join(',')}" placeholder="Ex: 1,2,3"></td>
                    <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-f-del-btn" style="background:#e05;">X</button></td>
                </tr>`;
            });
            fTbody.innerHTML = fHtml;

            fTbody.addEventListener('input', () => { configIsDirty = true; });
            fTbody.querySelectorAll('.cfg-f-del-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.target.closest('tr').remove();
                    configIsDirty = true;
                });
            });
        }

        // Refaz a pesquisa caso a pessoa mude algo enquanto procura
        document.getElementById('cfg-search').dispatchEvent(new Event('input'));
    }

    function createPanel() {
        if (document.getElementById('vl-panel')) return;

        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);

        const panel = document.createElement('div');
        panel.id = 'vl-panel';
        // Inicia o painel escondido para evitar bugs de getComputedStyle depois
        panel.style.display = 'none';
        panel.innerHTML = `
            <div id="vl-panel-head">
                <h3>🔍 <span>VRID</span> Lookup — Mapa VSM</h3>
                <div id="vl-head-actions">
                    <button class="vl-head-btn" id="vl-fullscreen-btn" title="Tela cheia">⛶</button>
                    <button class="vl-head-btn" id="vl-close-btn" title="Minimizar">−</button>
                </div>
            </div>
            <div id="vl-panel-body">

                <div class="vl-controls-bar">
                    <div class="vl-ctrl-chip">
                        <label>📊 Exibir:</label>
                        <div class="mode-pill-group" id="count-mode-pills">
                            <button class="mode-pill active" data-mode="totalCount">Total</button>
                            <button class="mode-pill" data-mode="inTrailerCount">Não proc.</button>
                        </div>
                    </div>
                    <div class="vl-ctrl-chip">
                        <input type="checkbox" id="auto-refresh-toggle">
                        <label for="auto-refresh-toggle">Auto Refresh</label>
                        <select id="auto-refresh-interval">
                            <option value="5" selected>5 min</option>
                            <option value="10">10 min</option>
                            <option value="15">15 min</option>
                        </select>
                        <span id="auto-refresh-status" style="margin-left:4px;"> (desligado)</span>
                    </div>
                </div>

                <div class="vl-tabs">
                    <button class="vl-tab active" data-tab="hourly">Horas x VSM</button>
                    <button class="vl-tab" data-tab="static">Layout Físico</button>
                    <button class="vl-tab" data-tab="config">⚙️ Configurações</button>
                </div>

                <div id="tab-hourly" class="vl-tab-content active">
                    <div class="vl-section">
                        <div class="vl-section-title">VRID Único</div>
                        <div class="vl-row">
                            <input id="vl-vrid-input" type="text" placeholder="Digite o VRID…">
                            <button class="vl-btn" id="vl-search-btn">Buscar</button>
                        </div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title">Por Horário</div>
                        <div class="vl-row">
                            <input type="date" id="range-start-date" value="${todayStr}">
                            <span>até</span>
                            <input type="date" id="range-end-date"   value="${todayStr}">
                        </div>
                        <div class="vl-row">
                            <select id="range-start-hour">${generateHourOpts(0)}</select>
                            <span>até</span>
                            <select id="range-end-hour">${generateHourOpts(23)}</select>
                        </div>
                        <div class="vl-row">
                            <button class="vl-btn vl-btn-full" id="vl-range-btn">Buscar VRIDs</button>
                        </div>
                        <div class="vl-hint">Máximo 7 dias entre as datas</div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title">🗺 Mapa VSM (Horas x VSM)</div>
                        <div id="vsm-map-container">
                            <div class="vsm-map-empty">Carregue VRIDs para visualizar o mapa.</div>
                        </div>
                    </div>
                </div>

                <div id="tab-static" class="vl-tab-content">
                    <div class="vl-section">
                        <div class="vl-section-title">🗺 Layout Físico (Mapa Estático)</div>
                        <div class="vsm-static-controls">
                            <div class="vl-ctrl-chip">
                                <label>🎯 Meta pkgs/h:</label>
                                <input type="number" id="static-max-pkgs" class="vsm-meta-input" value="400" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">pkgs/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>✋ Rate Finger:</label>
                                <input type="number" id="static-finger-rate" class="vsm-meta-input" value="4000" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">pkgs/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>🏗 Rate CB:</label>
                                <input type="number" id="static-cb-rate" class="vsm-meta-input" value="500" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>🔄 Rate PO:</label>
                                <input type="number" id="static-po-rate" class="vsm-meta-input" value="1000" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">/h</span>
                            </div>
                        </div>
                        <div id="static-need-summary" class="vsm-need-summary" style="display:none;">
                            <div class="need-card need-cb">
                                <span class="need-val" id="need-cb-total">—</span>
                                <span class="need-label">Container Builders</span>
                                <span class="need-sub">(mín. 17)</span>
                            </div>
                            <div class="need-card need-po">
                                <span class="need-val" id="need-po-total">—</span>
                                <span class="need-label">Pickoffs</span>
                                <span class="need-sub">(mín. 17)</span>
                            </div>
                        </div>
                        <div class="vl-section-title" style="margin-top:10px;">🕐 Hora</div>
                        <div class="hour-pill-group" id="static-hour-pills">
                            <button class="hour-pill active" data-hour="-1">Total</button>
                            ${Array.from({length:24},(_,i)=>`<button class="hour-pill" data-hour="${i}">${String(i).padStart(2,'0')}</button>`).join('')}
                            <button class="hour-pill" data-hour="24" id="pill-next-day" style="display:none; min-width: 60px;">00h (+1)</button>
                        </div>
                        <div id="vsm-layout-container">
                            <div class="vsm-map-empty">Carregando mapa estático...</div>
                        </div>
                    </div>

                    <div class="vrid-list-container" id="vrid-list-container">
                        <div class="vsm-map-empty">Carregando lista de VRIDs...</div>
                    </div>
                </div>

                <div id="tab-config" class="vl-tab-content">

                    <div class="vl-section" style="background: #1a2a3a; border-color: #ff9900; padding: 12px 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-weight: 700; color: #ff9900; font-size: 14px;">⚙️ Configurações Gerais</span>
                                <div class="vl-ctrl-chip" style="background: #0f1923; border-color: #3a4a5a; padding: 6px 10px;">
                                    <label style="font-size: 12px;">📍 Site (Node):</label>
                                    <input type="text" id="cfg-node-input" class="vsm-meta-input" style="text-transform: uppercase; width: 75px;" value="${activeNodeId}" maxlength="8">
                                </div>
                            </div>
                            <button id="cfg-save-btn" class="vl-btn" style="background:#ff9900; color:#0f1923; font-size: 13px; padding: 8px 20px; box-shadow: 0 2px 8px rgba(255,153,0,0.4);">💾 Salvar Todas as Alterações</button>
                        </div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Configuração dos Fingers (Agrupamento de Belts)</span>
                            <button id="cfg-add-finger-btn" class="vl-btn-small" style="background:#2d8a4e;">+ Novo Finger</button>
                        </div>
                        <div class="vsm-tbl-wrap" style="max-height: 25vh;">
                            <table class="vsm-config-table">
                                <thead>
                                    <tr><th>ID (Ex: pra Tag [F3] use 3)</th><th>Nome de Exibição</th><th>Belts (Separe por vírgula)</th><th>Ação</th></tr>
                                </thead>
                                <tbody id="config-finger-body">
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="vl-section" style="border-color: #3a6a8a; background: #121822;">
                        <div class="vl-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; color: #aad4ff;">
                            <span>Matriz do Mapa (Layout Físico)</span>
                            <div style="display:flex; gap: 8px;">
                                <button id="cfg-map-export-btn" class="vl-btn-small" style="background:#1a4a2a; color:#aaffaa; border: 1px solid #2a6a3a;">📥 Baixar Mapa (.xlsx)</button>
                                <button id="cfg-map-import-btn" class="vl-btn-small" style="background:#2a4a6a; color:#aad4ff; border: 1px solid #3a6a8a;">📤 Subir Mapa (.xlsx)</button>
                                <input type="file" id="cfg-map-file-input" accept=".xlsx, .xls" style="display:none;">
                                <button id="cfg-map-reset-btn" class="vl-btn-small" style="background:#4a5a6a; color:#fff;">🔄 Restaurar Mapa Padrão</button>
                            </div>
                        </div>
                        <p style="font-size: 11px; color: #889; margin: 0; line-height: 1.5;">
                            Ao baixar o mapa, você verá TAGS especiais para as somas. Edite no Excel e faça upload novamente. <br>
                            <strong>Tags:</strong> <code>[B1]</code> a <code>[B17]</code> (Soma das Belts) | <code>[F1]</code> e <code>[F2]</code> (Soma dos Fingers) | <code>[TS_V]</code> (Total Sortation) | <code>[L_F1]</code>, <code>[L_F2]</code>, <code>[L_TS]</code> (Títulos das seções) | <code>[SKIP]</code> (Pula a renderização da célula)
                        </p>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title" style="display:flex; flex-direction:column; gap:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <span>Mapeamento Base (Rotas -> VSM -> Grupos)</span>
                                <div style="display:flex; gap: 8px;">
                                    <button id="cfg-export-btn" class="vl-btn-small" style="background:#1a4a2a; color:#aaffaa; border: 1px solid #2a6a3a;">📥 Baixar Mapeamento (.xlsx)</button>
                                    <button id="cfg-import-btn" class="vl-btn-small" style="background:#2a4a6a; color:#aad4ff; border: 1px solid #3a6a8a;">📤 Subir Mapeamento (.xlsx)</button>
                                    <input type="file" id="cfg-file-input" accept=".xlsx, .xls" style="display:none;">
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <input type="text" id="cfg-search" class="cfg-input" style="width:280px;" placeholder="🔍 Pesquisar Rota, VSM ou Grupo...">
                                <div style="display:flex; gap: 8px;">
                                    <button id="cfg-add-btn" class="vl-btn-small" style="background:#2d8a4e;">+ Nova Linha</button>
                                    <button id="cfg-reset-btn" class="vl-btn-small" style="background:#4a5a6a; color:#fff;">🔄 Restaurar Mapeamento Padrão</button>
                                </div>
                            </div>
                        </div>
                        <div class="vsm-tbl-wrap" style="max-height: 45vh;">
                            <table class="vsm-config-table">
                                <thead>
                                    <tr><th>Rota</th><th>VSM</th><th>Grupo de VSMs (Belt)</th><th>Ação</th></tr>
                                </thead>
                                <tbody id="config-table-body">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="vl-progress">
                    <div class="vl-prog-text"></div>
                    <div class="vl-prog-track"><div class="vl-prog-fill"></div></div>
                </div>

                <div id="vl-result"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // Handler pro Node input ficar sujo e sempre maiúsculo
        const nodeInputEl = document.getElementById('cfg-node-input');
        if (nodeInputEl) {
            nodeInputEl.addEventListener('input', (e) => {
                e.target.value = e.target.value.toUpperCase();
                configIsDirty = true;
            });
        }

        // ==========================================
        // HANDLERS MAPEAMENTO BASE
        // ==========================================
        document.getElementById('cfg-add-btn').addEventListener('click', () => {
            const tbody = document.getElementById('config-table-body');
            const tr = document.createElement('tr');
            tr.className = 'cfg-row';
            tr.innerHTML = `
                <td><input type="text" class="cfg-input cfg-route" value="" placeholder="NOVA_ROTA"></td>
                <td><input type="text" class="cfg-input cfg-vsm-input" value="" placeholder="NOVA_VSM"></td>
                <td style="width: 100px;"><input type="number" class="cfg-input cfg-group" value="99" placeholder="ID Grupo"></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-del-btn" style="background:#e05;">X</button></td>
            `;
            tr.querySelector('.cfg-del-btn').addEventListener('click', e => {
                e.target.closest('tr').remove();
                configIsDirty = true;
            });
            tbody.insertBefore(tr, tbody.firstChild);
            configIsDirty = true;
        });

        document.getElementById('cfg-add-finger-btn')?.addEventListener('click', () => {
            const fTbody = document.getElementById('config-finger-body');
            const tr = document.createElement('tr');
            tr.className = 'cfg-finger-row';
            tr.innerHTML = `
                <td style="width: 120px;"><input type="number" class="cfg-input cfg-f-id" value="" placeholder="ID"></td>
                <td><input type="text" class="cfg-input cfg-f-name" value="" placeholder="Nome do Finger"></td>
                <td><input type="text" class="cfg-input cfg-f-belts" value="" placeholder="1,2,3..."></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-f-del-btn" style="background:#e05;">X</button></td>
            `;
            tr.querySelector('.cfg-f-del-btn').addEventListener('click', e => {
                e.target.closest('tr').remove();
                configIsDirty = true;
            });
            fTbody.appendChild(tr);
            configIsDirty = true;
        });

        document.getElementById('cfg-save-btn').addEventListener('click', saveConfig);
        document.getElementById('cfg-reset-btn').addEventListener('click', resetConfigToDefault);

        document.getElementById('cfg-search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const rows = document.querySelectorAll('#config-table-body tr.cfg-row');
            rows.forEach(row => {
                const r = row.querySelector('.cfg-route').value.toLowerCase();
                const v = row.querySelector('.cfg-vsm-input').value.toLowerCase();
                const g = row.querySelector('.cfg-group').value.toLowerCase();
                if (r.includes(term) || v.includes(term) || g.includes(term)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });

        document.getElementById('cfg-export-btn').addEventListener('click', () => {
            if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou. Tente novamente em alguns segundos."); return; }
            const rows = document.querySelectorAll('#config-table-body tr.cfg-row');
            const exportData = [];
            rows.forEach(row => {
                const r = row.querySelector('.cfg-route').value.trim();
                const v = row.querySelector('.cfg-vsm-input').value.trim();
                const g = row.querySelector('.cfg-group').value.trim();
                if (r && v && g) exportData.push({ "Rota": r, "VSM": v, "Grupo": g });
            });
            if (exportData.length === 0) { alert("Não há dados para exportar."); return; }
            const worksheet = XLSX.utils.json_to_sheet(exportData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "VSM_Config");
            XLSX.writeFile(workbook, `Configuracoes_VSM_${new Date().toISOString().slice(0,10)}.xlsx`);
        });

        document.getElementById('cfg-import-btn').addEventListener('click', () => {
            if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou. Tente novamente em alguns segundos."); return; }
            document.getElementById('cfg-file-input').click();
        });

        document.getElementById('cfg-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet);

                    const newMappings = [];
                    json.forEach(row => {
                        const r = row['Rota'] || row['rota'] || row['route'];
                        const v = row['VSM'] || row['vsm'];
                        const g = row['Grupo'] || row['grupo'] || row['group'] || 99;
                        if (r && v) {
                            newMappings.push({ route: String(r).trim(), vsm: String(v).trim(), group: String(g).trim() });
                        }
                    });

                    if (newMappings.length > 0) {
                        activeMappings = newMappings;
                        GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
                        rebuildDictionaries();
                        configIsDirty = false;
                        renderConfigTable();
                        if(lastExportData.length > 0) computeAndRenderAll();
                        alert(`Sucesso! ${newMappings.length} mapeamentos importados.`);
                    } else {
                        alert('Nenhum dado válido encontrado no arquivo. Certifique-se de manter as colunas "Rota", "VSM" e "Grupo".');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Erro ao processar o arquivo Excel.');
                }
                document.getElementById('cfg-file-input').value = '';
            };
            reader.readAsArrayBuffer(file);
        });

        // ==========================================
        // HANDLERS MATRIZ DO MAPA
        // ==========================================
        document.getElementById('cfg-map-export-btn').addEventListener('click', () => {
            if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou."); return; }

            const worksheet = XLSX.utils.aoa_to_sheet(activeMapMatrix);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Layout_Mapa");
            XLSX.writeFile(workbook, `Layout_Mapa_VSM_${new Date().toISOString().slice(0,10)}.xlsx`);
        });

        document.getElementById('cfg-map-import-btn').addEventListener('click', () => {
            if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou."); return; }
            document.getElementById('cfg-map-file-input').click();
        });

        document.getElementById('cfg-map-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                try {
                    const data = new Uint8Array(evt.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];

                    const aoa = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: ""});

                    if (aoa.length > 0) {
                        activeMapMatrix = aoa;
                        GM_setValue('vsm_custom_map_matrix', JSON.stringify(activeMapMatrix));
                        if(lastExportData.length > 0) computeAndRenderAll(); else renderStaticVsmMap();
                        alert('Layout do mapa importado e atualizado com sucesso!');
                    } else {
                        alert('Arquivo de mapa vazio ou inválido.');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Erro ao processar o arquivo de mapa.');
                }
                document.getElementById('cfg-map-file-input').value = '';
            };
            reader.readAsArrayBuffer(file);
        });

        document.getElementById('cfg-map-reset-btn').addEventListener('click', () => {
            if(confirm("Tem certeza que deseja restaurar o layout visual do mapa para o padrão original?")) {
                activeMapMatrix = JSON.parse(JSON.stringify(DEFAULT_MAP_MATRIX));
                GM_setValue('vsm_custom_map_matrix', JSON.stringify(activeMapMatrix));
                if(lastExportData.length > 0) computeAndRenderAll(); else renderStaticVsmMap();
                alert('Mapa restaurado para o padrão.');
            }
        });
    }

    function checkDirtyConfig() {
        if (configIsDirty) {
            if(confirm('Você tem alterações não salvas nas Configurações. Deseja salvar agora?')) {
                saveConfig();
            } else {
                renderConfigTable();
                configIsDirty = false;
            }
        }
    }

    function init() {
        const toggle = document.createElement('button');
        toggle.id = 'vl-toggle';
        toggle.textContent = '🔍 Layout Digital';

        // Lógica CORRIGIDA do Toggle de abertura do painel
        toggle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const p = document.getElementById('vl-panel');
            const isHidden = window.getComputedStyle(p).display === 'none';

            if (!isHidden) {
                checkDirtyConfig();
                p.style.display = 'none';
                toggle.style.display = 'block';
            } else {
                p.style.display = 'block';
                toggle.style.display = 'none';
            }
        };
        document.body.appendChild(toggle);

        createPanel();

        const panel = document.getElementById('vl-panel');
        if (panel) {
            panel.classList.add('vl-fullscreen');
            const fsBtn = document.getElementById('vl-fullscreen-btn');
            if (fsBtn) fsBtn.textContent = '⊡';
        }

        const staticFingerRateInput = document.getElementById('static-finger-rate');
        if (staticFingerRateInput) {
            staticFingerRateInput.addEventListener('change', () => {
                const v = parseInt(staticFingerRateInput.value, 10);
                if (!isNaN(v) && v > 0) {
                    staticFingerRate = v;
                    renderStaticVsmMap(getStaticVsmTotals());
                }
            });
            staticFingerRateInput.addEventListener('input', () => {
                const v = parseInt(staticFingerRateInput.value, 10);
                if (!isNaN(v) && v > 0) {
                    staticFingerRate = v;
                    renderStaticVsmMap(getStaticVsmTotals());
                }
            });
        }

        const resultDiv = document.getElementById('vl-result');
        const progDiv   = document.getElementById('vl-progress');

        const modePillGroup = document.getElementById('count-mode-pills');
        const modeSelect = { value: currentCountMode };

        modePillGroup.addEventListener('click', e => {
            const btn = e.target.closest('.mode-pill');
            if (!btn) return;
            modePillGroup.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCountMode = btn.dataset.mode;
            modeSelect.value = currentCountMode;

            renderCardsFromCache();
            renderVridList();
            computeAndRenderAll();
        });

        const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
        const autoRefreshIntervalSelect = document.getElementById('auto-refresh-interval');

        function updateAutoRefreshState() {
            if (autoRefreshToggle.checked) {
                if (lastSearch) {
                    const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                    startAutoRefresh(intervalMinutes);
                } else {
                    updateCountdownDisplay();
                }
            } else {
                stopAutoRefresh();
            }
        }

        autoRefreshToggle.addEventListener('change', updateAutoRefreshState);
        autoRefreshIntervalSelect.addEventListener('change', updateAutoRefreshState);

        document.getElementById('vl-close-btn').onclick = () => {
            checkDirtyConfig();
            const p = document.getElementById('vl-panel');
            p.style.display = 'none';
            toggle.style.display = 'block';
        };

        const fsBtn = document.getElementById('vl-fullscreen-btn');
        fsBtn.onclick = () => {
            const p = document.getElementById('vl-panel');
            p.classList.toggle('vl-fullscreen');
            fsBtn.textContent = p.classList.contains('vl-fullscreen') ? '⊡' : '⛶';
            fsBtn.title = p.classList.contains('vl-fullscreen') ? 'Sair da tela cheia' : 'Tela cheia';
        };

        const rangeStartDate = document.getElementById('range-start-date');
        const rangeEndDate   = document.getElementById('range-end-date');
        function clampRangeDates() {
            const start = new Date(rangeStartDate.value);
            if (isNaN(start.getTime())) return;
            const max = new Date(start);
            max.setDate(start.getDate() + 7);
            rangeEndDate.max = max.toISOString().slice(0, 10);
            if (new Date(rangeEndDate.value) < start) rangeEndDate.value = rangeStartDate.value;
            if (new Date(rangeEndDate.value) > max) rangeEndDate.value = max.toISOString().slice(0, 10);
        }
        rangeStartDate.addEventListener('change', clampRangeDates);
        rangeEndDate.addEventListener('change', clampRangeDates);
        clampRangeDates();

        const head = document.getElementById('vl-panel-head');
        let drag = false, ox, oy;
        head.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            drag = true;
            const r = panel.getBoundingClientRect();
            ox = e.clientX - r.left;
            oy = e.clientY - r.top;
            panel.style.right = 'auto';
            panel.style.top   = r.top  + 'px';
            panel.style.left  = r.left + 'px';
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top  = (e.clientY - oy) + 'px';
        });
        document.addEventListener('mouseup', () => { drag = false; });

        const tabs = document.querySelectorAll('.vl-tab');
        const contents = {
            hourly: document.getElementById('tab-hourly'),
            static: document.getElementById('tab-static'),
            config: document.getElementById('tab-config')
        };

        function switchTab(tabId) {
            const activeTabBefore = document.querySelector('.vl-tab.active')?.dataset.tab;
            if (activeTabBefore === 'config' && tabId !== 'config') {
                checkDirtyConfig();
            }

            tabs.forEach(tab => {
                if (tab.dataset.tab === tabId) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
            Object.keys(contents).forEach(id => {
                if (id === tabId) {
                    contents[id].classList.add('active');
                } else {
                    contents[id].classList.remove('active');
                }
            });
            if (resultDiv) {
                if (tabId === 'static' || tabId === 'config') {
                    resultDiv.style.display = 'none';
                } else if (tabId === 'hourly') {
                    resultDiv.style.display = '';
                }
            }
            if (tabId === 'static') {
                renderStaticVsmMap(getStaticVsmTotals());
            }
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;
                if (tabId === 'hourly' || tabId === 'static' || tabId === 'config') {
                    switchTab(tabId);
                }
            });
        });

        renderConfigTable();
        renderStaticVsmMap({});

        const staticMaxPkgsInput  = document.getElementById('static-max-pkgs');
        const staticHourPills     = document.getElementById('static-hour-pills');
        const staticCbRateInput   = document.getElementById('static-cb-rate');
        const staticPoRateInput   = document.getElementById('static-po-rate');

        staticMaxPkgsInput.addEventListener('change', () => {
            const v = parseInt(staticMaxPkgsInput.value, 10);
            if (!isNaN(v) && v > 0) {
                staticMaxPkgsPerHour = v;
                renderStaticVsmMap(getStaticVsmTotals());
            }
        });
        staticMaxPkgsInput.addEventListener('input', () => {
            const v = parseInt(staticMaxPkgsInput.value, 10);
            if (!isNaN(v) && v > 0) {
                staticMaxPkgsPerHour = v;
                renderStaticVsmMap(getStaticVsmTotals());
            }
        });

        function applyRateInput(inputEl, setter) {
            const v = parseInt(inputEl.value, 10);
            if (!isNaN(v) && v > 0) {
                setter(v);
                renderStaticVsmMap(getStaticVsmTotals());
            }
        }
        staticCbRateInput.addEventListener('change', () => applyRateInput(staticCbRateInput, v => { cbRate = v; }));
        staticCbRateInput.addEventListener('input',  () => applyRateInput(staticCbRateInput, v => { cbRate = v; }));
        staticPoRateInput.addEventListener('change', () => applyRateInput(staticPoRateInput, v => { poRate = v; }));
        staticPoRateInput.addEventListener('input',  () => applyRateInput(staticPoRateInput, v => { poRate = v; }));
        staticHourPills.addEventListener('click', e => {
            const btn = e.target.closest('.hour-pill');
            if (!btn) return;
            staticHourPills.querySelectorAll('.hour-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            staticSelectedHour = parseInt(btn.dataset.hour, 10);
            renderStaticVsmMap(getStaticVsmTotals());
        });

        const searchBtn  = document.getElementById('vl-search-btn');
        const vridInput  = document.getElementById('vl-vrid-input');

        async function doSingleSearchHandler() {
            const vrid = vridInput.value.trim().toUpperCase();
            if (!vrid) {
                resultDiv.innerHTML = '<div class="vl-err">Digite um VRID.</div>';
                return;
            }
            await doSingleSearch(vrid);
            if (autoRefreshToggle.checked && lastSearch) {
                const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                startAutoRefresh(intervalMinutes);
            }
            const activeTab = document.querySelector('.vl-tab.active');
            if (activeTab && activeTab.dataset.tab === 'hourly') {
                resultDiv.style.display = '';
            } else if (activeTab && (activeTab.dataset.tab === 'static' || activeTab.dataset.tab === 'config')) {
                resultDiv.style.display = 'none';
            }
        }

        searchBtn.addEventListener('click', doSingleSearchHandler);
        vridInput.addEventListener('keypress', e => { if (e.key === 'Enter') doSingleSearchHandler(); });

        const rangeBtn       = document.getElementById('vl-range-btn');
        const rangeStartHour = document.getElementById('range-start-hour');
        const rangeEndHour   = document.getElementById('range-end-hour');

        async function doRangeSearchHandler() {
            const startStr  = rangeStartDate.value;
            const endStr    = rangeEndDate.value;
            const startHour = parseInt(rangeStartHour.value, 10);
            const endHour   = parseInt(rangeEndHour.value, 10);

            if (!startStr || !endStr) {
                resultDiv.innerHTML = '<div class="vl-err">Selecione as datas.</div>';
                return;
            }
            const sd = new Date(startStr + 'T00:00:00');
            const ed = new Date(endStr   + 'T00:00:00');
            if (ed < sd) {
                resultDiv.innerHTML = '<div class="vl-err">Data final menor que inicial.</div>';
                return;
            }
            if ((ed - sd) / 86400000 > 7) {
                resultDiv.innerHTML = '<div class="vl-err">Intervalo máximo de 7 dias.</div>';
                return;
            }

            await doRangeSearch(sd, ed, startHour, endHour);
            if (autoRefreshToggle.checked && lastSearch) {
                const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                startAutoRefresh(intervalMinutes);
            }
            const activeTab = document.querySelector('.vl-tab.active');
            if (activeTab && activeTab.dataset.tab === 'hourly') {
                resultDiv.style.display = '';
            } else if (activeTab && (activeTab.dataset.tab === 'static' || activeTab.dataset.tab === 'config')) {
                resultDiv.style.display = 'none';
            }
        }

        rangeBtn.addEventListener('click', doRangeSearchHandler);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

