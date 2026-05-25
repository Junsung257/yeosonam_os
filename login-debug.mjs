import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  try {
    // Check login page
    console.log('Going to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'load', timeout: 20000 });
    await sleep(3000);
    
    console.log('Title:', await page.title());
    
    // Dump full HTML structure
    console.log('\n=== ALL FORM ELEMENTS ===');
    const formInfo = await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      const result = [];
      forms.forEach((f, fi) => {
        result.push(`[Form ${fi}] action="${f.action}" method="${f.method}"`);
        f.querySelectorAll('input, button, select, textarea').forEach(el => {
          const tag = el.tagName.toLowerCase();
          const type = el.getAttribute('type') || '';
          const name = el.getAttribute('name') || '';
          const id = el.getAttribute('id') || '';
          const placeholder = el.getAttribute('placeholder') || '';
          const cls = el.className || '';
          const text = el.textContent ? el.textContent.trim().substring(0, 40) : '';
          result.push(`  <${tag}> type="${type}" name="${name}" id="${id}" placeholder="${placeholder}" class="${cls.substring(0, 30)}" text="${text}"`);
        });
      });
      return result.join('\n');
    });
    console.log(formInfo);
    
    // Check all clickable elements
    console.log('\n=== ALL BUTTONS & LINKS ===');
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a[href], [role="button"]')).map(el => {
        const tag = el.tagName.toLowerCase();
        const text = el.textContent.trim().substring(0, 40);
        const href = el.getAttribute('href') || '';
        const cls = el.className.substring(0, 30);
        const onclick = el.getAttribute('onclick') ? 'has_onclick' : '';
        return `<${tag}> text="${text}" href="${href}" class="${cls}" ${onclick}`;
      });
    });
    buttons.forEach(b => console.log(`  ${b}`));

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
}

main();
