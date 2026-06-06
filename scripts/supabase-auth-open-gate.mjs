#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const DEFAULT_PROJECT_REF = 'ixaxnvbmhzjvupissmly';
const AUTH_CONFIG_PATH = '/v1/projects/{ref}/config/auth';
const REQUIRED_PASSWORD_POLICY = {
  password_min_length: 10,
  password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  security_update_password_require_reauthentication: true,
};

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readWindowsSupabaseCliToken() {
  if (process.platform !== 'win32') return null;
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
    return null;
  }
}

function getAccessToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_PAT || readWindowsSupabaseCliToken();
  if (!token) {
    throw new Error('Missing Supabase Management API token. Set SUPABASE_ACCESS_TOKEN or run `npx supabase login`.');
  }
  return token;
}

function getProjectRef() {
  const explicit = argValue('--project-ref') || process.env.SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_ID;
  if (explicit) return explicit;
  try {
    const raw = execFileSync('npx', ['supabase', 'projects', 'list', '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const projects = JSON.parse(raw);
    const linked = Array.isArray(projects) ? projects.find((project) => project.linked) : null;
    return linked?.ref || linked?.id || DEFAULT_PROJECT_REF;
  } catch {
    return DEFAULT_PROJECT_REF;
  }
}

async function requestAuthConfig(projectRef, token, init = {}) {
  const url = `https://api.supabase.com${AUTH_CONFIG_PATH.replace('{ref}', projectRef)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    const err = new Error(body?.message || `Supabase Management API failed with ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function summarize(config, projectRef) {
  return {
    project_ref: projectRef,
    site_url: config.site_url,
    uri_allow_list: config.uri_allow_list,
    password_hibp_enabled: config.password_hibp_enabled === true,
    password_min_length: config.password_min_length,
    password_required_characters: config.password_required_characters,
    security_update_password_require_reauthentication:
      config.security_update_password_require_reauthentication === true,
  };
}

function isPasswordPolicyHardened(config) {
  return (
    Number(config.password_min_length || 0) >= REQUIRED_PASSWORD_POLICY.password_min_length &&
    config.password_required_characters === REQUIRED_PASSWORD_POLICY.password_required_characters &&
    config.security_update_password_require_reauthentication === true
  );
}

async function main() {
  const projectRef = getProjectRef();
  const token = getAccessToken();
  const json = hasArg('--json');
  const allowPlanBlocked = hasArg('--allow-plan-blocked');

  if (hasArg('--harden-password-policy')) {
    await requestAuthConfig(projectRef, token, {
      method: 'PATCH',
      body: JSON.stringify(REQUIRED_PASSWORD_POLICY),
    });
  }

  if (hasArg('--enable-hibp')) {
    try {
      await requestAuthConfig(projectRef, token, {
        method: 'PATCH',
        body: JSON.stringify({ password_hibp_enabled: true }),
      });
    } catch (err) {
      const message = err?.body?.message || err.message;
      if (!allowPlanBlocked || !/Pro Plans and up|paid tier|upgrade/i.test(message)) throw err;
      const payload = {
        project_ref: projectRef,
        status: 'plan_blocked',
        message,
      };
      console.log(json ? JSON.stringify(payload, null, 2) : `PLAN_BLOCKED: ${message}`);
    }
  }

  const config = await requestAuthConfig(projectRef, token);
  const summary = summarize(config, projectRef);
  const result = {
    ...summary,
    password_policy_hardened: isPasswordPolicyHardened(config),
    open_gate_passed: summary.password_hibp_enabled === true && isPasswordPolicyHardened(config),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.table([result]);
  }

  if (hasArg('--check') && !result.open_gate_passed) {
    if (allowPlanBlocked && result.password_policy_hardened && !result.password_hibp_enabled) {
      console.error('WARN: HIBP is still disabled because the current Supabase plan does not support it.');
      return;
    }
    throw new Error('Supabase Auth open gate failed.');
  }
}

main().catch((err) => {
  console.error(err?.body?.message || err.message || err);
  process.exit(1);
});
