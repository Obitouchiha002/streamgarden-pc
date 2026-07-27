import * as os from 'os';
import * as crypto from 'crypto';
import * as https from 'https';

/**
 * The same remote admin backend the Android app uses, so both platforms land in one
 * dashboard. This PC registers itself on launch and asks whether it's been blocked.
 *
 * Fail-open on purpose: if the backend is unreachable the app keeps working. Only an
 * explicit block stops it.
 */

const SUPABASE_URL = 'https://befdjbbzuyzjlyrckkxj.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZmRqYmJ6dXl6amx5cmNra3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDIyNjYsImV4cCI6MjA5OTU3ODI2Nn0.OLJterEVLS2zIKsFv2tAZmgU0TxwXxRbfeE_sEEkHj4';

export const APP_VERSION = '1.5';

export interface CheckinResult {
  blocked: boolean;
  reason: string | null;
  code: string | null;
  until: string | null;
  premium: boolean;
  latest_version: string | null;
  update_url: string | null;
  update_note: string | null;
}

const OFFLINE: CheckinResult = {
  blocked: false, reason: null, code: null, until: null, premium: false,
  latest_version: null, update_url: null, update_note: null,
};

/**
 * A stable id for this machine. Hostname plus the first non-virtual MAC survives reinstalls
 * and app-data wipes, which is the point — a blocked machine shouldn't be able to shrug it
 * off by reinstalling. Nothing identifying is sent beyond this hash and the computer name.
 */
export function deviceId(): string {
  const macs = Object.values(os.networkInterfaces())
    .flat()
    .filter((n): n is os.NetworkInterfaceInfo => Boolean(n) && !n!.internal && n!.mac !== '00:00:00:00:00:00')
    .map((n) => n.mac)
    .sort();
  const seed = `${os.hostname()}|${os.platform()}|${macs[0] || 'nomac'}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export function deviceName(): string {
  return `${os.hostname()} (${os.platform() === 'win32' ? 'Windows' : os.platform()})`;
}

function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
      {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 12000,
      },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) return reject(new Error(out.slice(0, 160)));
          try { resolve(JSON.parse(out || 'null')); } catch { reject(new Error('bad response')); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end(payload);
  });
}

/**
 * Claim a display name. Names are unique across every device, phone and PC alike, and the
 * backend decides — two people could otherwise pick the same one at the same moment.
 */
export async function claimName(name: string): Promise<'ok' | 'taken' | 'invalid' | 'offline'> {
  try {
    const r = await rpc<string>('claim_name', { p_id: deviceId(), p_name: name.trim() });
    return (r === 'ok' || r === 'taken' || r === 'invalid') ? r : 'offline';
  } catch {
    return 'offline';
  }
}

/** Register this PC and read back its status. Never throws. */
export async function checkin(profileName?: string): Promise<CheckinResult> {
  try {
    const rows = await rpc<CheckinResult[]>('checkin', {
      p_id: deviceId(),
      p_name: profileName?.trim() || deviceName(),
      p_version: APP_VERSION,
      p_platform: 'windows',
      p_email: null,
    });
    const r = Array.isArray(rows) ? rows[0] : (rows as unknown as CheckinResult);
    return r ? { ...OFFLINE, ...r } : OFFLINE;
  } catch {
    return OFFLINE;
  }
}
