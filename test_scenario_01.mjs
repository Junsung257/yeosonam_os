const res = await fetch('http://localhost:3000/api/qa/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '다낭 6월에 특가 있어?',
    history: [],
    sessionId: 'sc-01'
  })
});
const text = await res.text();
const fs = await import('fs');
fs.writeFileSync('result-01.txt', text, 'utf8');
console.log('DONE, length:', text.length);
