import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/ci.yml";
const workflow = readFileSync(workflowPath, "utf8");
const usesPattern = /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm;
const immutableActionPattern =
  /^[^/\s]+\/[^@\s/]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/i;
const immutableDockerPattern = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i;
const violations = [];

for (const match of workflow.matchAll(usesPattern)) {
  const reference = match[1];
  if (reference.startsWith("./")) continue;
  if (
    !immutableActionPattern.test(reference) &&
    !immutableDockerPattern.test(reference)
  ) {
    violations.push(reference);
  }
}

if (violations.length > 0) {
  console.error(
    `External GitHub Actions in ${workflowPath} must use immutable 40-character commit SHAs:`,
  );
  for (const reference of violations) console.error(`- ${reference}`);
  process.exit(1);
}

console.log(`Verified immutable GitHub Action references in ${workflowPath}.`);
