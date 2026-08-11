# Product registration V5 live shadow and mobile proof — 2026-08-10

This run used the latest local code against the operating Supabase project. It intentionally stopped before approval, customer publication, V5 authoritative mode, CAS publication, and outbox delivery.

## Result

- Source document: `d676de8b-f106-4c4a-8786-f21bf0704dba`
- Upload job: `9f32403e-a717-485c-b483-12340a0e4e09`
- Extraction: `f5ff8025-fc5b-472a-be69-f1a1e769ca94` — 2 pages, 280 nodes, 5 tables
- Canonical normalization: `a3b7ddc4-4307-4f25-a378-e83834d9fea3` — `complete`, 1 section, 6/6 critical/high fields confirmed
- V5 revision: `9ffa85c7-2ab4-4663-a0f5-690a0e24a0a1` — `candidate`, payload and lineage hashes stored
- Private pending package created through the real upload compatibility path: `41441e88-097e-4362-89c7-92be9653ce02`
- Shadow snapshot: `654c785b-39a3-46c5-9174-db895e411820` — `blocked`, bound to the same revision
- Snapshot hash: `2c53e63b5a11acb92de0c143b397512786459055f06617ae2d1a6d6c96a2c7a2`

## Browser proof

Both routes were opened with the internal proof header at a 390×844 mobile viewport:

- `/packages/41441e88-097e-4362-89c7-92be9653ce02` — HTTP 200, no application error/not-found, price marker, itinerary marker, readable text: pass
- `/lp/41441e88-097e-4362-89c7-92be9653ce02` — HTTP 200, no application error/not-found, price marker, itinerary marker, readable text: pass

Persisted V5 proof rows, both `passed` and bound to the same snapshot hash:

- `8fc23841-d6b9-478f-915a-c9ec8068e5a4` — `/packages`
- `dbf36984-ce65-4778-a5ad-9a2b01f79900` — `/lp`

## Exposure guard

Final operating DB check:

- Package remains `status=pending`, `publication_state=draft`, `audit_status=blocked`.
- Shadow snapshot remains `status=blocked`.
- V5 publication outbox remains `0`.
- No V5 CAS publication was attempted.
- The public snapshot count increased only by this blocked shadow row; no approved/published row was created for the sample.

The real chain “source archive → extraction → canonical normalization → V5 revision → private snapshot → same-hash browser proof” is now verified. The PowerShell/curl console rendered some JSON text as mojibake, but the stored `raw_text`, normalized title/summary, and browser-visible Korean copy were verified correctly in Supabase and the proof output. Encoding is still covered by the corpus and browser readability gates.
