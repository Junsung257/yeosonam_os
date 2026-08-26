# External API contracts

`v1-openapi.json` and `src/generated/v1-api.d.ts` are generated from
`src/lib/api-contracts/v1.ts`.

```bash
npm run generate:openapi:v1
npm run verify:openapi:v1
```

The public runtime document is served at `/api/v1/openapi`.
