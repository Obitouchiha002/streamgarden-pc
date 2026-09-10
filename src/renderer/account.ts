// Accounts for the desktop app: email + password sign-in (and the same Supabase project as the
// device check-in), so Premium follows the user's account. Runs in the renderer, which is a
// browser, so plain fetch + localStorage work. Mirrors the mobile/web account system.

const SUPABASE_URL = 'https://befdjbbzuyzjlyrckkxj.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZmRqYmJ6dXl6amx5cmNra3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDIyNjYsImV4cCI6MjA5OTU3ODI2Nn0.OLJterEVLS2zIKsFv2tAZmgU0TxwXxRbfeE_sEEkHj4';

const SESSION_KEY = 'sg_session';
const ACCT_PREMIUM_KEY = 'sg_acct_premium';

export interface Session { access_token: string; refresh_token: string; user: { id: string; email: string }; }
export interface Status { name: string; email: string; premium: boolean; premium_until: string | null; }

export function getSession(): Session | null {
  try { const s = localStorage.getItem(SESSION_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveSession(s: Session | null) {
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
export function isSignedIn(): boolean { return !!getSession(); }
export function currentUser() { return getSession()?.user || null; }

export function cacheAcctPremium(p: boolean) {
  try { localStorage.setItem(ACCT_PREMIUM_KEY, p ? '1' : '0'); } catch { /* ignore */ }
}
export function isAcctPremium(): boolean {
  try { return localStorage.getItem(ACCT_PREMIUM_KEY) === '1'; } catch { return false; }
}

async function post(path: string, body: any, token?: string) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token || ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function keep(r: any): boolean {
  if (!r.data?.access_token) return false;
  saveSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token, user: { id: r.data.user.id, email: r.data.user.email } });
  return true;
}

export async function signUp(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await post('/auth/v1/signup', { email: email.trim(), password });
    if (r.status >= 400) return { ok: false, error: r.data?.msg || r.data?.error_description || 'Could not create account' };
    if (keep(r)) { await refreshStatus(); return { ok: true }; }
    return { ok: false, error: 'Account created — please sign in' };
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await post('/auth/v1/token?grant_type=password', { email: email.trim(), password });
    if (r.status >= 400 || !keep(r)) return { ok: false, error: r.data?.error_description || r.data?.msg || 'Wrong email or password' };
    await refreshStatus();
    return { ok: true };
  } catch { return { ok: false, error: 'Network error' }; }
}

export async function refreshStatus(): Promise<Status | null> {
  const s = getSession();
  if (!s) { cacheAcctPremium(false); return null; }
  try {
    let r = await post('/rest/v1/rpc/my_status', {}, s.access_token);
    if (r.status === 401 && (await tryRefresh())) r = await post('/rest/v1/rpc/my_status', {}, getSession()!.access_token);
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) { cacheAcctPremium(false); return null; }
    cacheAcctPremium(!!row.premium);
    return { name: row.name || '', email: row.email || s.user.email, premium: !!row.premium, premium_until: row.premium_until || null };
  } catch { return null; }
}

async function tryRefresh(): Promise<boolean> {
  const s = getSession(); if (!s?.refresh_token) return false;
  try {
    const r = await post('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (r.status >= 400 || !r.data?.access_token) return false;
    saveSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token, user: s.user });
    return true;
  } catch { return false; }
}

export function signOut() { saveSession(null); cacheAcctPremium(false); }

// ---- download gate: login required + a free daily limit (same as mobile) --------------------
export const FREE_DAILY_LIMIT = 8;
const DL_DAY = 'sg_dl_day';
const DL_CNT = 'sg_dl_count';
function today() { return new Date().toISOString().slice(0, 10); }
export function dailyCount(): number {
  try {
    if (localStorage.getItem(DL_DAY) !== today()) return 0;
    return parseInt(localStorage.getItem(DL_CNT) || '0', 10) || 0;
  } catch { return 0; }
}
export function bumpDaily() {
  try {
    if (localStorage.getItem(DL_DAY) !== today()) { localStorage.setItem(DL_DAY, today()); localStorage.setItem(DL_CNT, '1'); return; }
    localStorage.setItem(DL_CNT, String(dailyCount() + 1));
  } catch { /* ignore */ }
}
export function canDownload(isPremium: boolean): { ok: boolean; reason?: 'login' | 'limit' } {
  if (!isSignedIn()) return { ok: false, reason: 'login' };
  if (!isPremium && dailyCount() >= FREE_DAILY_LIMIT) return { ok: false, reason: 'limit' };
  return { ok: true };
}
