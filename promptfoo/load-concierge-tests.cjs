'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = async function loadConciergeTests() {
  const datasetPath = path.resolve(__dirname, '..', 'tests', 'evals', 'concierge-set.jsonl');
  const rows = fs.readFileSync(datasetPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return rows.map((row) => ({
    description: `${row.id}: ${row.question}`,
    vars: {
      candidate_answer: String(row.candidate_answer ?? ''),
      expected_keywords: Array.isArray(row.expected_keywords) ? row.expected_keywords : [],
      forbidden_keywords: Array.isArray(row.forbidden_keywords) ? row.forbidden_keywords : [],
    },
    metadata: {
      corpus_id: String(row.id ?? ''),
      question: String(row.question ?? ''),
      source: 'tests/evals/concierge-set.jsonl',
    },
  }));
};
