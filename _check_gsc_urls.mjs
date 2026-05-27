/**
 * GSC URL Inspection API로 특정 URL의 색인 상태를 확인하는 스크립트
 */
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const envPath = resolve('.env.local');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv();

// sc-domain:yeosonam.com (GSC 도메인 속성) 과 https://www.yeosonam.com/ (URL 접두사) 둘 다 시도
const SITE_URLS = [
  'sc-domain:yeosonam.com',
  'https://www.yeosonam.com/',
  'https://yeosonam.com/',
];

const serviceAccountJson = process.env.GSC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

async function inspectUrl(siteUrl, inspectionUrl) {
  try {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters'],
    });
    const client = await auth.getClient();
    const tokenRes = await client.getAccessToken();
    const accessToken = tokenRes?.token;
    if (!accessToken) {
      return { error: 'access token 발급 실패' };
    }

    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteUrl,
        inspectionUrl,
        languageCode: 'ko',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await res.json();
    const r = data.inspectionResult?.indexStatusResult || {};
    return {
      verdict: r.verdict,
      coverageState: r.coverageState,
      indexingState: r.indexingState,
      pageFetchState: r.pageFetchState,
      robotsTxtState: r.robotsTxtState,
      googleCanonical: r.googleCanonical,
      userCanonical: r.userCanonical,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function main() {
  if (!serviceAccountJson) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다.');
    process.exit(1);
  }

  const urlsToCheck = [
    'https://www.yeosonam.com/',
    'https://www.yeosonam.com/blog/%EC%97%AC%ED%96%89%EC%9E%90%EB%B3%B4%ED%97%98-%EB%B0%9B%EB%8A%94%EB%B2%95-2026',
    'https://www.yeosonam.com/blog/%EC%98%A4%EC%82%AC%EC%B9%B4-%ED%98%BC%EB%85%B8%EA%B0%80%EC%9A%94',
    'https://www.yeosonam.com/blog/%EB%B0%9C%EB%A6%AC-%EC%88%99%EC%86%8C-%EC%B6%94%EC%B2%9C-5%EB%B3%84%EC%B9%9C-%EC%99%84%EB%B2%BD%ED%9C%B4%EA%B0%80-%EA%B0%80%EC%9D%B4%EB%93%9C',
  ];

  for (const url of urlsToCheck) {
    console.log(`\n=== ${url} ===`);
    for (const siteUrl of SITE_URLS) {
      const result = await inspectUrl(siteUrl, url);
      if (result.error) {
        console.log(`  [${siteUrl}] ERROR: ${result.error.slice(0, 100)}...`);
      } else {
        console.log(`  [${siteUrl}] OK`);
        console.log(`    Verdict: ${result.verdict}`);
        console.log(`    Coverage: ${result.coverageState}`);
        console.log(`    Page Fetch: ${result.pageFetchState}`);
        console.log(`    User Canonical: ${result.userCanonical}`);
        break; // 성공하면 다음 URL로
      }
    }
  }
}

main().catch(console.error);
