#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has('--json');
const apply = args.has('--apply');

function reportAndExit(report, code = report.status === 'pass' || report.status === 'warn' ? 0 : 1) {
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${apply ? 'Apply' : 'Dry-run'} CI management secret bootstrap: ${report.status}`);
    for (const item of report.secrets) {
      const action = item.applied ? 'applied' : item.available ? 'available' : 'missing';
      console.log(`- ${item.key}: ${action} (${item.source || 'no source'})`);
    }
    if (report.notes.length) {
      console.log('Notes:');
      for (const note of report.notes) console.log(`- ${note}`);
    }
  }
  process.exit(code);
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function vercelAuthCandidates() {
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return [
    appData && join(appData, 'com.vercel.cli', 'Data', 'auth.json'),
    appData && join(appData, 'xdg.data', 'com.vercel.cli', 'auth.json'),
    appData && join(appData, 'com.vercel.cli', 'auth.json'),
    appData && join(appData, 'vercel', 'auth.json'),
    localAppData && join(localAppData, 'com.vercel.cli', 'auth.json'),
    home && join(home, '.vercel', 'auth.json'),
  ].filter(Boolean);
}

function readVercelCliToken() {
  if (process.env.VERCEL_TOKEN?.trim()) {
    return { value: process.env.VERCEL_TOKEN.trim(), source: 'env:VERCEL_TOKEN' };
  }
  for (const path of vercelAuthCandidates()) {
    if (!existsSync(path)) continue;
    const parsed = readJsonFile(path);
    if (parsed?.token && String(parsed.token).trim()) {
      return { value: String(parsed.token).trim(), source: 'local-vercel-cli-auth' };
    }
  }
  return { value: '', source: '' };
}

function readWindowsSupabaseCliToken() {
  if (process.platform !== 'win32') return '';
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
public class CodexSupabaseCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr buffer);
  public static byte[] ReadBytes(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] b = new byte[c.CredentialBlobSize];
      Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return b;
    } finally {
      CredFree(p);
    }
  }
}
'@
Add-Type $src
[Text.Encoding]::UTF8.GetString([CodexSupabaseCred]::ReadBytes('Supabase CLI:supabase')).Trim([char]0)
`;
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

function readSupabaseCliToken() {
  const envToken = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || '';
  if (envToken.trim()) return { value: envToken.trim(), source: envToken === process.env.SUPABASE_PAT ? 'env:SUPABASE_PAT' : 'env:SUPABASE_ACCESS_TOKEN' };
  const windowsToken = readWindowsSupabaseCliToken();
  if (windowsToken) return { value: windowsToken, source: 'local-supabase-cli-auth' };
  return { value: '', source: '' };
}

function ghSecretNames() {
  const result = spawnSync('gh', ['secret', 'list', '--json', 'name'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr || result.stdout || result.error?.message || 'gh secret list failed');
  }
  const rows = JSON.parse(result.stdout || '[]');
  return new Set((Array.isArray(rows) ? rows : []).map((row) => row.name).filter(Boolean));
}

function applySecret(key, value) {
  const result = spawnSync('gh', ['secret', 'set', key], {
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(result.stderr || result.stdout || result.error?.message || `gh secret set ${key} failed`);
  }
}

let existingSecrets;
try {
  existingSecrets = ghSecretNames();
} catch (err) {
  reportAndExit({
    status: 'fail',
    applied: false,
    secrets: [],
    notes: [err instanceof Error ? err.message : String(err)],
  }, 1);
}

const candidates = [
  { key: 'VERCEL_TOKEN', ...readVercelCliToken() },
  { key: 'SUPABASE_ACCESS_TOKEN', ...readSupabaseCliToken() },
];

const notes = [
  'Secret values are never printed. When --apply is used, values are passed to gh secret set through stdin.',
];
const secretReports = [];

try {
  for (const candidate of candidates) {
    const alreadyPresent = existingSecrets.has(candidate.key);
    const available = Boolean(candidate.value);
    let applied = false;
    if (apply && available && !alreadyPresent) {
      applySecret(candidate.key, candidate.value);
      applied = true;
    }
    secretReports.push({
      key: candidate.key,
      presentInGitHub: alreadyPresent || applied,
      available,
      source: candidate.source || '',
      applied,
      skipped: !available || alreadyPresent || !apply,
    });
  }
} catch (err) {
  reportAndExit({
    status: 'fail',
    applied: false,
    secrets: secretReports,
    notes: [err instanceof Error ? err.message : String(err)],
  }, 1);
}

const missingSources = secretReports.filter((item) => !item.available).map((item) => item.key);
const missingGitHub = secretReports.filter((item) => !item.presentInGitHub).map((item) => item.key);
if (missingSources.length) {
  notes.push(`No local source was found for: ${missingSources.join(', ')}.`);
}
if (missingGitHub.length && !apply) {
  notes.push(`Run with --apply to set available missing GitHub secrets: ${missingGitHub.join(', ')}.`);
}

reportAndExit({
  status: missingSources.length ? 'warn' : 'pass',
  applied: apply,
  secrets: secretReports,
  notes,
});
