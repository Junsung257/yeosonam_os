const res = await fetch('http://localhost:3000/api/qa/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '부산에서 보홀 직항 패키지 있나요? 7월초 2명',
    history: [],
    sessionId: 'sc-12-retry'
  })
});
const text = await res.text();
const fs = await import('fs');
fs.writeFileSync('result-sc12.txt', text, 'utf8');

// Parse NDJSON
const lines = text.trim().split('\n').filter(l => l);
let reply = '';
let hasError = false;
for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.type === 'text' || ev.type === 'text_final') reply += ev.content;
  if (ev.type === 'error') { hasError = true; console.log('ERROR:', ev.message); }
  if (ev.type === 'meta') console.log('META:', JSON.stringify(ev));
}
console.log('Reply:', reply.substring(0, 300));
console.log('Error:', hasError);
console.log('Length:', text.length);
