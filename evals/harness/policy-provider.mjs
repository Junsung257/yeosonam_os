import { runContract } from '../../scripts/eval-harness-contract.mjs';

export default class DeterministicHarnessContractProvider {
  id() { return 'yeosonam:deterministic-harness-contract'; }
  async callApi(prompt) { return { output: JSON.stringify(runContract(String(prompt).trim())) }; }
}
