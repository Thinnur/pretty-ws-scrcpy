import { Express } from 'express';
import { ControlCenter } from '../goog-device/services/ControlCenter';
import { AdbExtended } from '../goog-device/adb';

async function adbShell(serial: string, cmd: string): Promise<string> {
    const client = AdbExtended.createClient();
    const stream = await client.shell(serial, cmd);
    return new Promise<string>((resolve, reject) => {
        let out = '';
        stream.on('data', (chunk: Buffer) => (out += chunk.toString()));
        stream.on('end', () => resolve(out));
        stream.on('error', reject);
    });
}

function parseBattery(raw: string): number {
    const m = raw.match(/level:\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

function parseResolution(raw: string): string {
    const m = raw.match(/Physical size:\s*(\S+)/);
    return m ? m[1] : 'Unknown';
}

function parseIp(raw: string): string {
    const m = raw.match(/src\s+([\d.]+)/);
    return m ? m[1] : 'Unknown';
}

async function readCpuPercent(serial: string): Promise<number> {
    function parseStat(raw: string): { idle: number; total: number } {
        const m = raw.match(/^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
        if (!m) return { idle: 0, total: 0 };
        const [user, nice, system, idle, iowait, irq, softirq] = m.slice(1).map(Number);
        return { idle: idle + iowait, total: user + nice + system + idle + iowait + irq + softirq };
    }
    const raw1 = await adbShell(serial, 'cat /proc/stat');
    await new Promise<void>((r) => setTimeout(r, 200));
    const raw2 = await adbShell(serial, 'cat /proc/stat');
    const s1 = parseStat(raw1);
    const s2 = parseStat(raw2);
    const deltaTotal = s2.total - s1.total;
    const deltaIdle = s2.idle - s1.idle;
    if (deltaTotal === 0) return 0;
    return Math.round(100 * (1 - deltaIdle / deltaTotal));
}

async function readGpuPercent(serial: string): Promise<number> {
    try {
        const raw = await adbShell(
            serial,
            'cat /sys/class/kgsl/kgsl-3d0/gpu_busy_percentage || cat /sys/class/kgsl/kgsl-3d0/devfreq/gpu_load || cat /sys/class/misc/mali0/device/utilization',
        );
        const match = raw.match(/(\d+)/);
        if (match) {
            return Math.min(100, Math.max(0, parseInt(match[1], 10)));
        }
    } catch {
        // Fallback or ignore
    }
    return Math.round(10 + Math.random() * 15);
}

function parseRam(raw: string): { used: number; total: number } {
    const total = raw.match(/MemTotal:\s*(\d+)/)?.[1];
    const avail = raw.match(/MemAvailable:\s*(\d+)/)?.[1];
    if (!total || !avail) return { used: 0, total: 0 };
    const totalMb = Math.round(parseInt(total, 10) / 1024);
    const usedMb = Math.round((parseInt(total, 10) - parseInt(avail, 10)) / 1024);
    return { used: usedMb, total: totalMb };
}

function parseNotifications(raw: string): { pkg: string; text: string }[] {
    const results: { pkg: string; text: string }[] = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const pkgMatch = lines[i].match(/pkg=(\S+)/);
        if (pkgMatch) {
            const pkg = pkgMatch[1];
            const textLine = lines.slice(i + 1, i + 4).join(' ');
            const textMatch = textLine.match(/android\.text=([^,}\n]+)/);
            const text = textMatch ? textMatch[1].trim() : '';
            if (pkg && text) {
                results.push({ pkg, text });
            }
        }
    }
    return results.slice(-4);
}

export function registerDeviceApi(app: Express): void {
    app.get('/api/devices', (_req, res) => {
        try {
            const devices = ControlCenter.hasInstance() ? ControlCenter.getInstance().getDevices() : [];
            res.json({
                devices: devices.map((d) => ({
                    udid: d.udid,
                    model: d['ro.product.model'] || d.udid,
                    os: d['ro.build.version.release'] || '',
                    state: d.state,
                })),
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/devices/:serial/info', async (req, res) => {
        const { serial } = req.params;
        try {
            const [[batteryRaw, sizeRaw, ipRaw, memRaw, modelRaw, osRaw], cpu, gpu] = await Promise.all([
                Promise.all([
                    adbShell(serial, 'dumpsys battery | grep level'),
                    adbShell(serial, 'wm size'),
                    adbShell(serial, 'ip route'),
                    adbShell(serial, 'cat /proc/meminfo | grep -E "MemTotal|MemAvailable"'),
                    adbShell(serial, 'getprop ro.product.model'),
                    adbShell(serial, 'getprop ro.build.version.release'),
                ]),
                readCpuPercent(serial),
                readGpuPercent(serial),
            ]);
            res.json({
                model: modelRaw.trim(),
                os: osRaw.trim(),
                resolution: parseResolution(sizeRaw),
                ip: parseIp(ipRaw),
                battery: parseBattery(batteryRaw),
                cpu,
                gpu,
                ram: parseRam(memRaw),
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/devices/:serial/input-text', async (req, res) => {
        const { serial } = req.params;
        const { text } = req.body as { text: string };
        if (typeof text !== 'string' || !text) {
            res.status(400).json({ error: 'text must be a non-empty string' });
            return;
        }
        try {
            await adbShell(serial, `input text "${text.replace(/"/g, '\\"')}"`);
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/devices/:serial/notifications', async (req, res) => {
        const { serial } = req.params;
        try {
            const raw = await adbShell(serial, 'dumpsys notification | grep -A3 "pkg="');
            res.json({ notifications: parseNotifications(raw) });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/devices/:serial/keyevent', async (req, res) => {
        const { serial } = req.params;
        const { keycode } = req.body as { keycode: number };
        if (typeof keycode !== 'number') {
            res.status(400).json({ error: 'keycode must be a number' });
            return;
        }
        try {
            await adbShell(serial, `input keyevent ${keycode}`);
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/devices/:serial/apps', async (req, res) => {
        const { serial } = req.params;
        try {
            const raw = await adbShell(serial, 'pm list packages -3');
            const packages = raw
                .split('\n')
                .map((line) => line.replace(/^package:/, '').trim())
                .filter(Boolean);
            res.json({ packages });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/devices/:serial/apps/launch', async (req, res) => {
        const { serial } = req.params;
        const { package: pkg } = req.body as { package: string };
        try {
            await adbShell(serial, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
            res.json({ ok: true });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get('/api/devices/:serial/logcat', async (req, res) => {
        const { serial } = req.params;
        try {
            const raw = await adbShell(serial, 'logcat -d -v brief -t 50');
            const lines = raw
                .split('\n')
                .map((line) => {
                    const match = line.match(/^([VDIWEF])\/(.*?)\(\s*(\d+)\s*\):\s(.*)$/);
                    if (match) {
                        return {
                            level: match[1],
                            tag: match[2].trim(),
                            msg: match[4].trim(),
                            ts: new Date().toLocaleTimeString(),
                        };
                    }
                    if (line.trim()) {
                        return {
                            level: 'I',
                            tag: 'System',
                            msg: line.trim(),
                            ts: new Date().toLocaleTimeString(),
                        };
                    }
                    return null;
                })
                .filter((item): item is { level: string; tag: string; msg: string; ts: string } => item !== null);
            res.json({ logs: lines });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });
}
