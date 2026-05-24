const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
  const mdPath = path.resolve(__dirname, 'google-ads-api-tool-design.md');
  const pdfPath = path.resolve(__dirname, 'google-ads-api-tool-design.pdf');
  
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }
h1 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
h2 { color: #2c3e50; margin-top: 30px; }
h3 { color: #34495e; }
pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
code { background: #f0f0f0; padding: 2px 4px; border-radius: 2px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #1a73e8; color: white; }
</style>
</head>
<body>${mdContent.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  .replace(/^## (.+)$/gm, '<h2>$1</h2>')
  .replace(/^# (.+)$/gm, '<h1>$1</h1>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/^- (.+)$/gm, '<li>$1</li>')
  .replace(/\n\n/g, '</p><p>')
  .replace(/^[A-Z][^<>]*$/gm, '<p>$&</p>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
}</body>
</html>`;

  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
  
  await browser.close();
  console.log('PDF created:', pdfPath);
})();
