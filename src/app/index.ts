import '../style/app.css';
import '../style/dashboard.css';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';
import { ACTION } from '../common/Action';
import { SERVER_PORT } from '../common/Constants';
import VideoSettings from './VideoSettings';
import Size from './Size';

/* ── Types ─────────────────────────────────────────────── */
interface DeviceInfo {
    udid: string;
    model: string;
    os: string;
    state: string;
}

interface DeviceDetailInfo {
    model: string;
    os: string;
    resolution: string;
    ip: string;
    battery: number;
    cpu: number;
    ram: { used: number; total: number };
}

/* ── State ──────────────────────────────────────────────── */
let activeUdid = '';
let currentDevices: DeviceInfo[] = [];
let infoInterval = 0;
let currentStreamClient: StreamClientScrcpy | null = null;
let currentPlayerName = '';
let rotation = 0;

/* ── DOM helpers ────────────────────────────────────────── */
function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    html?: string,
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (html !== undefined) e.innerHTML = html;
    return e;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setText(id: string, text: string): void {
    const e = document.getElementById(id);
    if (e) e.textContent = text;
}

/* ── Layout builder ─────────────────────────────────────── */
function buildLayout(): void {
    const topbar = buildTopbar();
    const shell = el('div', 'ms-shell');
    const rail = buildRail();
    const stage = buildStage();
    const sidebar = buildSidebar();
    shell.append(rail, stage, sidebar);
    document.body.append(topbar, shell);
    wireTopBarButtons();
    buildSettingsModal();
}

/* ── Topbar ─────────────────────────────────────────────── */
function buildTopbar(): HTMLElement {
    const topbar = el('div', 'ms-topbar');
    topbar.innerHTML = `
        <div class="ms-brand">
            <div class="ms-brand-mark"></div>
            <span class="ms-brand-name">mirror<span>/studio</span></span>
            <span class="ms-brand-version">v2.0</span>
        </div>
        <div class="ms-status-badge" id="ms-status-badge">
            <span class="ms-status-dot"></span>
            <span id="ms-status-text">ONLINE · 0 dev</span>
        </div>
        <div class="ms-cmdbar">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input type="text" placeholder="adb shell, package, logcat tag…" readonly>
            <kbd>⌘K</kbd>
        </div>
        <div class="ms-topbar-spacer"></div>
        <div class="ms-topbar-actions">
            <button class="ms-topbar-btn" id="btn-rotate">⟳ Rotate</button>
            <button class="ms-topbar-btn" id="btn-screenshot">⬛ Capture</button>
            <button class="ms-topbar-btn primary" id="btn-stream">▶ Stream</button>
            <button class="ms-topbar-btn" id="btn-settings">⚙ Settings</button>
        </div>`;
    return topbar;
}

/* ── Left rail ──────────────────────────────────────────── */
function buildRail(): HTMLElement {
    const rail = el('div', 'ms-rail');

    const header = el('div', 'ms-rail-section');
    header.id = 'ms-rail-header';
    header.textContent = 'Devices · 0 online';

    const deviceList = el('div', 'ms-device-list');
    deviceList.id = 'ms-device-list';
    deviceList.innerHTML = '<span class="ms-devices-empty">Searching…</span>';

    const pairBtn = el('div', 'ms-pair-btn');
    pairBtn.textContent = '+ Pair device';

    const stats = el('div', 'ms-session-stats');
    stats.id = 'ms-session-stats';
    stats.innerHTML = `
        <div class="ms-stat-row"><span class="ms-stat-k">Latency</span><span class="ms-stat-v" id="ss-latency">—</span></div>
        <div class="ms-stat-row"><span class="ms-stat-k">Throughput</span><span class="ms-stat-v" id="ss-throughput">—</span></div>
        <div class="ms-stat-row"><span class="ms-stat-k">Bitrate</span><span class="ms-stat-v" id="ss-bitrate">—</span></div>
        <div class="ms-stat-row"><span class="ms-stat-k">Codec</span><span class="ms-stat-v" id="ss-codec">H.264</span></div>
        <div class="ms-stat-row"><span class="ms-stat-k">Uptime</span><span class="ms-stat-v" id="ss-uptime">—</span></div>`;

    rail.append(header, deviceList, pairBtn, stats);
    return rail;
}

/* ── Center stage ───────────────────────────────────────── */
function buildStage(): HTMLElement {
    const stage = el('div', 'ms-stage');

    // Meta bar
    const metaBar = el('div', 'ms-meta-bar');
    metaBar.id = 'ms-meta-bar';
    metaBar.innerHTML = `
        <span class="ms-rec-badge" id="ms-rec-badge" style="display:none">REC</span>
        <span class="ms-meta-device" id="ms-meta-device">No device selected</span>
        <span class="ms-meta-sep">│</span>
        <span id="ms-meta-res">—</span>
        <span class="ms-meta-sep">│</span>
        <span id="ms-meta-fps">— fps</span>
        <div class="ms-meta-spacer"></div>
        <span id="ms-meta-latency" style="color:var(--text-disabled)">—</span>`;

    // Phone area
    const phoneArea = el('div', 'ms-phone-area');

    // Phone wrapper (stream renders here)
    const phoneWrap = el('div', 'ms-phone-wrap');
    const streamContainer = el('div');
    streamContainer.id = 'vpm-stream-container';
    streamContainer.innerHTML = `
        <div class="ms-stream-placeholder">
            <span>▣</span>
            <p>Select a device</p>
        </div>`;
    phoneWrap.appendChild(streamContainer);

    // Hardware button rail (flex sibling — no absolute positioning)
    const hwRail = buildHwRail();

    phoneArea.append(phoneWrap, hwRail);

    // Bottom pills
    const pills = el('div', 'ms-bottom-pills');
    const pillDefs = [
        { label: '1×', key: '1x', active: true },
        { label: 'Fit', key: 'fit', active: false },
        { label: 'Record', key: 'record', active: false },
        { label: 'Screenshot', key: 'screenshot', active: false },
    ];
    pillDefs.forEach(({ label, key, active }) => {
        const pill = el('button', 'ms-pill' + (active ? ' active' : ''));
        pill.textContent = label;
        pill.dataset.pill = key;
        pills.appendChild(pill);
    });
    wirePills(pills);

    stage.append(metaBar, phoneArea, pills);
    return stage;
}

const HW_BUTTONS = [
    { label: 'VOL+', keycode: 24 },
    { label: 'VOL−', keycode: 25 },
    { label: 'BACK', keycode: 4 },
    { label: 'HOME', keycode: 3 },
    { label: 'MENU', keycode: 82 },
    { label: 'LOCK', keycode: 223 },
    { label: 'PWR', keycode: 26, danger: true },
];

function buildHwRail(): HTMLElement {
    const rail = el('div', 'ms-hw-rail');
    HW_BUTTONS.forEach(({ label, keycode, danger }) => {
        const btn = el('button', 'ms-hw-btn' + (danger ? ' danger' : ''));
        btn.textContent = label;
        btn.title = label;
        btn.addEventListener('click', () => sendKeyevent(keycode));
        rail.appendChild(btn);
    });
    return rail;
}

function wirePills(container: HTMLElement): void {
    container.addEventListener('click', (e) => {
        const pill = (e.target as HTMLElement).closest('.ms-pill') as HTMLElement | null;
        if (!pill) return;
        const action = pill.dataset.pill;
        if (action === 'screenshot') {
            doScreenshot();
        } else if (action === 'record') {
            const recBadge = document.getElementById('ms-rec-badge');
            if (recBadge) {
                const isOn = recBadge.style.display !== 'none';
                recBadge.style.display = isOn ? 'none' : 'inline';
                pill.classList.toggle('active', !isOn);
            }
        } else if (action === '1x' || action === 'fit') {
            container.querySelectorAll('.ms-pill').forEach((p) => {
                const el = p as HTMLElement;
                if (el.dataset.pill === '1x' || el.dataset.pill === 'fit') {
                    el.classList.toggle('active', el === pill);
                }
            });
        }
    });
}

/* ── Right sidebar ──────────────────────────────────────── */
const TABS = ['Info', 'Apps', 'Logs', 'Files', 'Input'] as const;

function buildSidebar(): HTMLElement {
    const sidebar = el('div', 'ms-sidebar');

    const tabStrip = el('div', 'ms-tabs');
    const panels: HTMLElement[] = [];

    TABS.forEach((name, i) => {
        const tab = el('button', 'ms-tab' + (i === 0 ? ' active' : ''));
        tab.textContent = name;
        tab.dataset.tab = name.toLowerCase();
        tabStrip.appendChild(tab);

        const panel = buildTabPanel(name);
        panel.classList.add('ms-tab-panel');
        if (i === 0) panel.classList.add('active');
        panel.dataset.panel = name.toLowerCase();
        panels.push(panel);
    });

    wireTabSwitching(tabStrip, panels);
    sidebar.append(tabStrip, ...panels);
    return sidebar;
}

function wireTabSwitching(strip: HTMLElement, panels: HTMLElement[]): void {
    strip.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest('.ms-tab') as HTMLElement | null;
        if (!tab) return;
        strip.querySelectorAll('.ms-tab').forEach((t) => t.classList.remove('active'));
        panels.forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = panels.find((p) => p.dataset.panel === tab.dataset.tab);
        if (panel) panel.classList.add('active');
    });
}

function buildTabPanel(name: typeof TABS[number]): HTMLElement {
    const panel = el('div');
    switch (name) {
        case 'Info':
            panel.innerHTML = `
                <div class="ms-section-title">Identity</div>
                <div class="ms-kv-row"><span class="k">Model</span><span class="v" id="info-model">—</span></div>
                <div class="ms-kv-row"><span class="k">OS</span><span class="v" id="info-os">—</span></div>
                <div class="ms-kv-row"><span class="k">Resolution</span><span class="v" id="info-res">—</span></div>
                <div class="ms-kv-row"><span class="k">IP</span><span class="v" id="info-ip">—</span></div>
                <div class="ms-section-title" style="margin-top:18px">Performance</div>
                <div class="ms-perf-grid">
                    ${buildPerfCell('CPU', 'cpu', '%')}
                    ${buildPerfCell('GPU', 'gpu', '%')}
                    ${buildPerfCell('Battery', 'battery', '%')}
                    ${buildPerfCell('FPS', 'fps', 'fps')}
                    ${buildPerfCell('RAM', 'ram', 'MB')}
                    ${buildPerfCell('Net', 'net', 'Mbps')}
                </div>
                <div class="ms-info-placeholder" id="info-placeholder" style="display:none">Select a device</div>`;
            break;

        case 'Apps':
            panel.innerHTML = `
                <div class="ms-section-title">Installed apps</div>
                <div class="ms-app-grid">
                    ${[
                        { icon: '🌐', name: 'Chrome' },
                        { icon: '📷', name: 'Camera' },
                        { icon: '🗺', name: 'Maps' },
                        { icon: '📸', name: 'Photos' },
                        { icon: '🎵', name: 'Music' },
                        { icon: '📁', name: 'Files' },
                        { icon: '💬', name: 'Messages' },
                        { icon: '⚙', name: 'Settings' },
                    ].map(a => `
                        <div class="ms-app-tile">
                            <div class="ms-app-icon">${a.icon}</div>
                            <span class="ms-app-name">${a.name}</span>
                        </div>`).join('')}
                </div>
                <div class="ms-log-note">Live app list unavailable — connect a device with ADB</div>`;
            break;

        case 'Logs':
            panel.innerHTML = `
                <div class="ms-log-filters">
                    <button class="ms-log-filter active">All</button>
                    <button class="ms-log-filter">Verbose</button>
                    <button class="ms-log-filter">Info</button>
                    <button class="ms-log-filter">Warn</button>
                    <button class="ms-log-filter">Error</button>
                </div>
                <div class="ms-log-list">
                    ${[
                        { ts: '14:07:01', lv: 'I', tag: 'ActivityMgr', msg: 'Start proc: com.devcheck/.MainActivity' },
                        { ts: '14:07:01', lv: 'D', tag: 'OpenGLRenderer', msg: 'Davey! duration=132ms' },
                        { ts: '14:07:02', lv: 'I', tag: 'WifiManager', msg: 'CMD_RSSI_POLL rssi=-67' },
                        { ts: '14:07:02', lv: 'W', tag: 'BatteryStats', msg: 'No good package for uid 10245' },
                        { ts: '14:07:03', lv: 'E', tag: 'AudioManager', msg: 'setVolumeIndex failed' },
                    ].map(l => `
                        <div class="ms-log-line">
                            <span class="ts">${l.ts}</span>
                            <span class="lv ${l.lv}">${l.lv}</span>
                            <span class="tag">${l.tag}</span>
                            <span class="msg">${l.msg}</span>
                        </div>`).join('')}
                </div>
                <div class="ms-log-note">Live logcat unavailable — static preview only</div>`;
            // Wire log filter clicks
            setTimeout(() => {
                panel.querySelectorAll('.ms-log-filter').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        panel.querySelectorAll('.ms-log-filter').forEach((b) => b.classList.remove('active'));
                        btn.classList.add('active');
                    });
                });
            }, 0);
            break;

        case 'Files':
            panel.innerHTML = `
                <div class="ms-section-title">Transfer queue</div>
                <div class="ms-file-list">
                    ${[
                        { name: 'screenshot_2026_05_10.png', size: '1.4 MB', pct: 100 },
                        { name: 'logcat_session.txt', size: '847 KB', pct: 100 },
                        { name: 'app-debug.apk', size: '12.8 MB', pct: 64 },
                    ].map(f => `
                        <div class="ms-file-item">
                            <div class="ms-file-header">
                                <span class="ms-file-name">${f.name}</span>
                                <span class="ms-file-size">${f.size}</span>
                            </div>
                            <div class="ms-file-prog">
                                <div class="fill" style="width:${f.pct}%"></div>
                            </div>
                        </div>`).join('')}
                </div>
                <div class="ms-log-note">Drag-and-drop file push not yet available</div>`;
            break;

        case 'Input':
            panel.classList.add('ms-input-panel');
            panel.innerHTML = `
                <div class="ms-section-title">Inject text</div>
                <textarea class="ms-text-area" id="ms-text-input"
                    placeholder="Type to inject into focused field…"></textarea>
                <button class="ms-send-btn" id="ms-send-btn">Send</button>
                <div class="ms-section-title" style="margin-top:14px">Hardware keys</div>
                <div class="ms-hw-keys">
                    ${[
                        { label: 'Esc', keycode: 111 },
                        { label: 'Tab', keycode: 61 },
                        { label: 'Enter', keycode: 66 },
                        { label: 'Del', keycode: 67 },
                        { label: '↑', keycode: 19 },
                        { label: '↓', keycode: 20 },
                        { label: '←', keycode: 21 },
                        { label: '→', keycode: 22 },
                        { label: 'Home', keycode: 122 },
                        { label: 'End', keycode: 123 },
                        { label: 'PgUp', keycode: 92 },
                        { label: 'PgDn', keycode: 93 },
                    ].map(k => `<button class="ms-key" data-keycode="${k.keycode}">${k.label}</button>`).join('')}
                </div>`;
            // Wire key buttons after DOM insertion
            setTimeout(() => {
                panel.querySelectorAll('.ms-key').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const kc = parseInt((btn as HTMLElement).dataset.keycode ?? '0', 10);
                        if (kc) sendKeyevent(kc);
                    });
                });
                document.getElementById('ms-send-btn')?.addEventListener('click', () => {
                    const ta = document.getElementById('ms-text-input') as HTMLTextAreaElement | null;
                    const text = ta?.value.trim() ?? '';
                    if (!text) return;
                    if (!activeUdid) {
                        alert('Select a device first');
                        return;
                    }
                    // No text-inject endpoint — inform user
                    alert('Text injection requires ADB keyboard input method on the device.\nUse: adb shell input text "' + text + '"');
                });
            }, 0);
            break;
    }
    return panel;
}

function buildPerfCell(label: string, id: string, unit: string): string {
    return `
        <div class="ms-perf-cell">
            <div class="ms-perf-label">${label}</div>
            <div class="ms-perf-value" id="pv-${id}">—<span class="u"> ${unit}</span></div>
            <div class="ms-perf-bar"><div class="fill" id="pf-${id}" style="width:0%"></div></div>
        </div>`;
}

/* ── Top bar buttons ────────────────────────────────────── */
function wireTopBarButtons(): void {
    document.getElementById('btn-settings')?.addEventListener('click', openSettings);

    document.getElementById('btn-rotate')?.addEventListener('click', () => {
        rotation = (rotation + 90) % 360;
        const c = document.getElementById('vpm-stream-container');
        if (c) {
            c.style.transition = 'transform 0.3s ease';
            c.style.transform = `rotate(${rotation}deg)`;
        }
    });

    document.getElementById('btn-screenshot')?.addEventListener('click', doScreenshot);
}

function doScreenshot(): void {
    const container = document.getElementById('vpm-stream-container');
    if (!container) return;
    const link = document.createElement('a');
    const canvasEl = container.querySelector('canvas');
    const videoEl = container.querySelector('video');
    if (canvasEl) {
        link.href = canvasEl.toDataURL('image/png');
    } else if (videoEl) {
        const oc = document.createElement('canvas');
        oc.width = videoEl.videoWidth;
        oc.height = videoEl.videoHeight;
        oc.getContext('2d')?.drawImage(videoEl, 0, 0);
        link.href = oc.toDataURL('image/png');
    } else {
        return;
    }
    link.download = `screenshot-${activeUdid || 'device'}-${Date.now()}.png`;
    link.click();
}

/* ── Device list (rail) ─────────────────────────────────── */
async function refreshDevices(): Promise<void> {
    try {
        const resp = await fetch('/api/devices');
        if (!resp.ok) return;
        const { devices } = (await resp.json()) as { devices: DeviceInfo[] };
        currentDevices = devices;
        renderDeviceList(devices);
    } catch {
        // server not ready yet
    }
}

function renderDeviceList(devices: DeviceInfo[]): void {
    const list = document.getElementById('ms-device-list');
    const header = document.getElementById('ms-rail-header');
    const statusText = document.getElementById('ms-status-text');

    const onlineCount = devices.filter((d) => d.state === 'device').length;

    if (header) header.textContent = `Devices · ${onlineCount} online`;
    if (statusText) statusText.textContent = `ONLINE · ${onlineCount} dev`;

    if (!list) return;
    list.innerHTML = '';

    if (!devices.length) {
        list.innerHTML = '<span class="ms-devices-empty">No ADB devices connected</span>';
        return;
    }

    devices.forEach((d) => {
        const isActive = d.udid === activeUdid;
        const isOnline = d.state === 'device';
        const card = el('div', 'ms-device-card' + (isActive ? ' active' : ''));
        card.innerHTML = `
            <div class="ms-device-thumb"><div class="ms-thumb-placeholder">▣</div></div>
            <div class="ms-device-meta">
                <span class="ms-device-name">${escHtml(d.model || d.udid)}</span>
                <span class="ms-device-os">Android ${escHtml(d.os)}</span>
            </div>
            <span class="ms-device-status-dot ${isOnline ? 'online' : 'offline'}"></span>`;
        card.addEventListener('click', () => selectDevice(d));
        list.appendChild(card);
    });
}

/* ── Device selection ───────────────────────────────────── */
function selectDevice(device: DeviceInfo): void {
    activeUdid = device.udid;
    renderDeviceList(currentDevices);

    // Update meta bar
    setText('ms-meta-device', device.model || device.udid);
    setText('ms-meta-res', '—');
    setText('ms-meta-fps', '— fps');

    // Stop previous stream client
    if (currentStreamClient) {
        try { (currentStreamClient as any).stop?.(); } catch { /* ignore */ }
        currentStreamClient = null;
    }

    // Clear stream placeholder (StreamClientScrcpy will fill this)
    const container = document.getElementById('vpm-stream-container');
    console.log('[Mirror Studio] #vpm-stream-container:', container,
        'clientSize:', container?.clientWidth, 'x', container?.clientHeight);
    if (container) container.innerHTML = '';

    // Reset rotation
    rotation = 0;
    if (container) {
        container.style.transition = '';
        container.style.transform = '';
    }

    // Start stream
    const isSecure = location.protocol === 'https:';
    const port = location.port || (isSecure ? '443' : '80');
    const pathname = location.pathname;

    const wsBase = new URL(`${isSecure ? 'wss' : 'ws'}://${location.hostname}:${port}${pathname}`);
    wsBase.searchParams.set('action', ACTION.PROXY_ADB);
    wsBase.searchParams.set('remote', `tcp:${SERVER_PORT}`);
    wsBase.searchParams.set('udid', device.udid);

    const players = StreamClientScrcpy.getPlayers();
    const playerName = currentPlayerName || players[0]?.playerCodeName || 'mse';

    const params = new URLSearchParams({
        action: StreamClientScrcpy.ACTION,
        udid: device.udid,
        ws: wsBase.toString(),
        player: playerName,
        secure: String(isSecure),
        hostname: location.hostname,
        port,
        pathname,
    });

    console.log('[Mirror Studio] ws proxy URL:', wsBase.toString());
    console.log('[Mirror Studio] StreamClientScrcpy.start params:');
    params.forEach((v, k) => console.log(`  ${k} = ${v}`));

    try {
        currentStreamClient = StreamClientScrcpy.start(params);
        console.log('[Mirror Studio] StreamClientScrcpy.start() returned:', currentStreamClient);
    } catch (e) {
        console.error('[Mirror Studio] StreamClientScrcpy.start() threw:', e);
    }
    startInfoPolling(device.udid);
}

/* ── Info polling ───────────────────────────────────────── */
function startInfoPolling(udid: string): void {
    clearInterval(infoInterval);
    fetchAndUpdateInfo(udid);
    infoInterval = window.setInterval(() => fetchAndUpdateInfo(udid), 5000);
}

async function fetchAndUpdateInfo(udid: string): Promise<void> {
    try {
        const infoResp = await fetch(`/api/devices/${encodeURIComponent(udid)}/info`);
        if (infoResp.ok) {
            const info = (await infoResp.json()) as DeviceDetailInfo;
            updateInfoPanel(info);
        }
    } catch {
        // device may not be ready
    }
}

function updateInfoPanel(info: DeviceDetailInfo): void {
    setText('info-model', info.model ?? '—');
    setText('info-os', `Android ${info.os ?? '—'}`);
    setText('info-res', info.resolution ?? '—');
    setText('info-ip', info.ip ?? '—');

    // Update meta bar resolution
    setText('ms-meta-res', info.resolution ?? '—');

    setPerf('battery', info.battery ?? 0, `${Math.round(info.battery ?? 0)}`, '%');
    setPerf('cpu', info.cpu ?? 0, `${Math.round(info.cpu ?? 0)}`, '%');

    const ramPct = info.ram?.total > 0
        ? Math.round((info.ram.used / info.ram.total) * 100)
        : 0;
    setPerf('ram', ramPct, `${info.ram?.used ?? 0}`, 'MB');

    // GPU/FPS/Net not returned by API — leave as static placeholders
}

function setPerf(id: string, pct: number, value: string, unit: string): void {
    const valEl = document.getElementById(`pv-${id}`);
    if (valEl) valEl.innerHTML = `${escHtml(value)}<span class="u"> ${unit}</span>`;
    const fill = document.getElementById(`pf-${id}`);
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

/* ── Settings modal ─────────────────────────────────────── */
function buildSettingsModal(): void {
    const overlay = el('div', 'vpm-settings-overlay');
    overlay.id = 'vpm-settings-overlay';

    const modal = el('div', 'vpm-settings-modal');
    modal.innerHTML = `
        <div class="settings-header">
            <span class="settings-title">Stream Settings</span>
            <button class="settings-close" id="settings-close">✕</button>
        </div>
        <div class="settings-body">
            <div class="settings-field">
                <label class="settings-label">Player</label>
                <select class="settings-select" id="s-player"></select>
            </div>
            <div class="settings-field">
                <label class="settings-label">Bitrate (Kbps)</label>
                <input class="settings-input" id="s-bitrate" type="number" min="100" max="8000" step="100" value="2000">
            </div>
            <div class="settings-field">
                <label class="settings-label">Max FPS</label>
                <input class="settings-input" id="s-fps" type="number" min="1" max="60" step="1" value="30">
            </div>
            <div class="settings-field">
                <label class="settings-label">Max Width (px)</label>
                <input class="settings-input" id="s-width" type="number" min="240" max="1920" step="16" value="720">
            </div>
            <div class="settings-field">
                <label class="settings-label">Max Height (px)</label>
                <input class="settings-input" id="s-height" type="number" min="240" max="3840" step="16" value="1280">
            </div>
        </div>
        <div class="settings-footer">
            <span class="settings-hint">Player change restarts the stream</span>
            <div class="settings-actions">
                <button class="ms-topbar-btn" id="settings-cancel">Cancel</button>
                <button class="ms-topbar-btn settings-apply" id="settings-apply">Apply</button>
            </div>
        </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('settings-close')?.addEventListener('click', closeSettings);
    document.getElementById('settings-cancel')?.addEventListener('click', closeSettings);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });
    document.getElementById('settings-apply')?.addEventListener('click', applySettings);
}

const SETTINGS_KEY = 'mirror-studio-settings';
const SETTINGS_DEFAULTS = { player: 'WebCodecs', bitrate: 8000, maxFps: 30, maxWidth: 1080, maxHeight: 1920 };

function loadSettingsFromStorage(): typeof SETTINGS_DEFAULTS {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) } : { ...SETTINGS_DEFAULTS };
    } catch {
        return { ...SETTINGS_DEFAULTS };
    }
}

function saveSettingsToStorage(s: typeof SETTINGS_DEFAULTS): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function openSettings(): void {
    const overlay = document.getElementById('vpm-settings-overlay');
    if (!overlay) return;

    const sel = document.getElementById('s-player') as HTMLSelectElement | null;
    if (sel) {
        sel.innerHTML = '';
        StreamClientScrcpy.getPlayers().forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.playerCodeName;
            opt.textContent = p.playerFullName;
            opt.selected = p.playerCodeName === currentPlayerName;
            sel.appendChild(opt);
        });
    }

    // Load from localStorage first, then override with live stream values if active
    const saved = loadSettingsFromStorage();
    const bEl = document.getElementById('s-bitrate') as HTMLInputElement | null;
    const fEl = document.getElementById('s-fps') as HTMLInputElement | null;
    const wEl = document.getElementById('s-width') as HTMLInputElement | null;
    const hEl = document.getElementById('s-height') as HTMLInputElement | null;
    if (bEl) bEl.value = String(saved.bitrate);
    if (fEl) fEl.value = String(saved.maxFps);
    if (wEl) wEl.value = String(saved.maxWidth);
    if (hEl) hEl.value = String(saved.maxHeight);

    if (currentStreamClient) {
        const vs = (currentStreamClient as any)['player']?.getVideoSettings?.() as VideoSettings | undefined;
        if (vs) {
            if (bEl) bEl.value = String(Math.round(vs.bitrate / 1000));
            if (fEl) fEl.value = String(vs.maxFps ?? 30);
            if (vs.bounds) {
                if (wEl) wEl.value = String(vs.bounds.width);
                if (hEl) hEl.value = String(vs.bounds.height);
            }
        }
    }

    overlay.classList.add('open');
}

function closeSettings(): void {
    document.getElementById('vpm-settings-overlay')?.classList.remove('open');
}

function applySettings(): void {
    const get = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
    const bitrateKbps = parseInt(get('s-bitrate'), 10) || SETTINGS_DEFAULTS.bitrate;
    const maxFps = parseInt(get('s-fps'), 10) || SETTINGS_DEFAULTS.maxFps;
    const width = parseInt(get('s-width'), 10) || SETTINGS_DEFAULTS.maxWidth;
    const height = parseInt(get('s-height'), 10) || SETTINGS_DEFAULTS.maxHeight;
    const sel = document.getElementById('s-player') as HTMLSelectElement | null;
    const newPlayerCode = sel?.value ?? '';

    saveSettingsToStorage({ player: newPlayerCode || SETTINGS_DEFAULTS.player, bitrate: bitrateKbps, maxFps, maxWidth: width, maxHeight: height });

    if (currentStreamClient) {
        const vs = new VideoSettings({
            bitrate: bitrateKbps * 1000,
            maxFps,
            bounds: new Size(width, height),
            sendFrameMeta: false,
            iFrameInterval: 5,
            lockedVideoOrientation: -1,
        });
        currentStreamClient.sendNewVideoSetting(vs);
    }

    const playerChanged = newPlayerCode && newPlayerCode !== currentPlayerName;
    if (playerChanged && activeUdid) {
        currentPlayerName = newPlayerCode;
        const device = currentDevices.find((d) => d.udid === activeUdid);
        if (device) {
            closeSettings();
            selectDevice(device);
            return;
        }
    }

    closeSettings();
}

/* ── ADB keyevent ───────────────────────────────────────── */
function sendKeyevent(keycode: number): void {
    if (!activeUdid) return;
    fetch(`/api/devices/${encodeURIComponent(activeUdid)}/keyevent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keycode }),
    }).catch(() => {/* ignore */});
}

/* ── Entry point ────────────────────────────────────────── */
window.onload = async function (): Promise<void> {
    const hash = location.hash.replace(/^#!/, '');
    const parsedQuery = new URLSearchParams(hash);
    const action = parsedQuery.get('action');

    /// #if USE_BROADWAY
    const { BroadwayPlayer } = await import('./player/BroadwayPlayer');
    StreamClientScrcpy.registerPlayer(BroadwayPlayer);
    /// #endif

    /// #if USE_H264_CONVERTER
    const { MsePlayer } = await import('./player/MsePlayer');
    StreamClientScrcpy.registerPlayer(MsePlayer);
    /// #endif

    /// #if USE_TINY_H264
    const { TinyH264Player } = await import('./player/TinyH264Player');
    StreamClientScrcpy.registerPlayer(TinyH264Player);
    /// #endif

    /// #if USE_WEBCODECS
    const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
    StreamClientScrcpy.registerPlayer(WebCodecsPlayer);
    /// #endif

    // Backward compat: hash-based stream deep-link
    if (action === StreamClientScrcpy.ACTION && typeof parsedQuery.get('udid') === 'string') {
        StreamClientScrcpy.start(parsedQuery);
        return;
    }

    /// #if INCLUDE_APPL
    {
        const { DeviceTracker } = await import('./applDevice/client/DeviceTracker');

        /// #if USE_QVH_SERVER
        const { StreamClientQVHack } = await import('./applDevice/client/StreamClientQVHack');
        DeviceTracker.registerTool(StreamClientQVHack);

        /// #if USE_WEBCODECS
        const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
        StreamClientQVHack.registerPlayer(WebCodecsPlayer);
        /// #endif

        /// #if USE_H264_CONVERTER
        const { MsePlayerForQVHack } = await import('./player/MsePlayerForQVHack');
        StreamClientQVHack.registerPlayer(MsePlayerForQVHack);
        /// #endif

        if (action === StreamClientQVHack.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientQVHack.start(StreamClientQVHack.parseParameters(parsedQuery));
            return;
        }
        /// #endif

        /// #if USE_WDA_MJPEG_SERVER
        const { StreamClientMJPEG } = await import('./applDevice/client/StreamClientMJPEG');
        DeviceTracker.registerTool(StreamClientMJPEG);

        const { MjpegPlayer } = await import('./player/MjpegPlayer');
        StreamClientMJPEG.registerPlayer(MjpegPlayer);

        if (action === StreamClientMJPEG.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientMJPEG.start(StreamClientMJPEG.parseParameters(parsedQuery));
            return;
        }
        /// #endif
    }
    /// #endif

    /// #if INCLUDE_ADB_SHELL
    {
        const { ShellClient } = await import('./googDevice/client/ShellClient');
        if (action === ShellClient.ACTION && typeof parsedQuery.get('udid') === 'string') {
            ShellClient.start(ShellClient.parseParameters(parsedQuery));
            return;
        }
    }
    /// #endif

    /// #if INCLUDE_DEV_TOOLS
    {
        const { DevtoolsClient } = await import('./googDevice/client/DevtoolsClient');
        if (action === DevtoolsClient.ACTION) {
            DevtoolsClient.start(DevtoolsClient.parseParameters(parsedQuery));
            return;
        }
    }
    /// #endif

    /// #if INCLUDE_FILE_LISTING
    {
        const { FileListingClient } = await import('./googDevice/client/FileListingClient');
        if (action === FileListingClient.ACTION) {
            FileListingClient.start(FileListingClient.parseParameters(parsedQuery));
            return;
        }
    }
    /// #endif

    // Build Mirror Studio dashboard
    buildLayout();

    // Poll devices every 3s
    await refreshDevices();
    setInterval(refreshDevices, 3000);
};
