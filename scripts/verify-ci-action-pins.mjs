import { readFileSync, readdirSync } from "node:fs";

const workflowDirectory = ".github/workflows";
const criticalWorkflowPath = `${workflowDirectory}/ci.yml`;
const usesPattern = /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm;
const immutableActionPattern =
  /^[^/\s]+\/[^@\s/]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/i;
const immutableDockerPattern = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/i;
const reviewedActionPins = new Map([
  [
    "actions/checkout",
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  ], // v7.0.1
  [
    "actions/setup-node",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  ], // v7.0.0
  [
    "actions/upload-artifact",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ], // v7.0.1
  [
    "actions/github-script",
    "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
  ], // v9.0.0
  [
    "treosh/lighthouse-ci-action",
    "treosh/lighthouse-ci-action@3e7e23fb74242897f95c0ba9cabad3d0227b9b18",
  ], // 12.6.2
  [
    "dependency-check/Dependency-Check_Action",
    "dependency-check/Dependency-Check_Action@1e54355a8b4c8abaa8cc7d0b70aa655a3bb15a6c",
  ], // reviewed main 2026-09-01; upstream has no current release tag
  [
    "slackapi/slack-github-action",
    "slackapi/slack-github-action@dcb1066f776dd043e64d0e8ba94ca15cc7e1875d",
  ], // v4.0.0
  [
    "peter-evans/create-pull-request",
    "peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1",
  ], // v8.1.1
  [
    "codecov/codecov-action",
    "codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f",
  ], // v7.0.0
]);
const violations = [];

const workflowPaths = readdirSync(workflowDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => `${workflowDirectory}/${entry.name}`)
  .sort();

for (const workflowPath of workflowPaths) {
  const workflow = readFileSync(workflowPath, "utf8");
  for (const match of workflow.matchAll(usesPattern)) {
    const reference = match[1];
    if (reference.startsWith("./")) continue;

    const actionName = reference.split("@", 1)[0];
    const expected = reviewedActionPins.get(actionName);
    if (expected && reference !== expected) {
      violations.push({
        workflowPath,
        reference,
        reason: `reviewed workflow action must use the immutable pin ${expected}`,
      });
      continue;
    }

    if (
      !immutableActionPattern.test(reference) &&
      !immutableDockerPattern.test(reference)
    ) {
      violations.push({
        workflowPath,
        reference,
        reason: "workflow actions must use immutable commit or image digest pins",
      });
    }
  }
}

const criticalWorkflow = readFileSync(criticalWorkflowPath, "utf8");
if (!criticalWorkflow.includes("npx --yes @lhci/cli@0.15.1 autorun")) {
  violations.push({
    workflowPath: criticalWorkflowPath,
    reference: "@lhci/cli",
    reason:
      "Lighthouse CI must use the reviewed 0.15.1 CLI instead of a floating dist-tag",
  });
}

if (violations.length > 0) {
  console.error("GitHub Action pin policy violations:");
  for (const violation of violations) {
    console.error(
      `- ${violation.workflowPath}: ${violation.reference} — ${violation.reason}`,
    );
  }
  process.exit(1);
}

console.log(
  `Verified ${reviewedActionPins.size} reviewed action pins, immutable external references across ${workflowPaths.length} workflows, and the Lighthouse CLI version.`,
);
