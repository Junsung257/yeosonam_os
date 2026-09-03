# PR-01D Codex App Server Compatibility Evidence

## Official Contract

The current official [Codex App Server documentation](https://developers.openai.com/codex/app-server)
defines restricted read access as:

```json
{
  "type": "readOnly",
  "access": {
    "type": "restricted",
    "includePlatformDefaults": true,
    "readableRoots": ["/bounded/public-evidence"]
  }
}
```

The same documentation says generated JSON Schema is specific to the installed
Codex version, so local compatibility must be checked rather than inferred from
the website.

## Local Generated Schema

Command:

```text
codex --version
codex app-server generate-json-schema --out <temporary-directory>
```

Observed version: `codex-cli 0.151.0-alpha.7.2`.

Generated `v2/TurnStartParams.json` SHA-256:
`a3835e8c1e942e4b358e1a670939b89918b16c4d13105a579899892b7ade6dea`.

Its `ReadOnlySandboxPolicy` contained only:

```json
{
  "networkAccess": { "default": false, "type": "boolean" },
  "type": { "enum": ["readOnly"], "type": "string" }
}
```

It did not contain `access`, `restricted`, or `readableRoots` in the read-only
policy. The temporary generated schema was not committed.

## Decision

`CODEX_RESTRICTED_READ_ROOTS_UNSUPPORTED` is a hard stop. No thread, turn, model
call, tool call, install, or external write was attempted. The offline fixture
and evaluation preflight may proceed; the live Shadow Pilot may not.
