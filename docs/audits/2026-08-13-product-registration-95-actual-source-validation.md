# Product Registration 95% Actual-Source Validation

Date: 2026-08-13  
Last verified: 2026-08-14  
Status: shadow only; customer publication remains frozen

## Scope

- Local HWP files: 1,171
- Unique source hashes: 1,047
- Travel-product sources: 895
- Product sections: 1,634
- Extraction attempted/succeeded: 961/961
- Filename-preclassified non-travel files: 86
- Frozen holdout sections: 303

All source files, extracted text, review queues, and benchmark artifacts remain outside the repository in private local storage. This audit records aggregate results only.

## Latest conservative result

| Split | All sections | Past-only excluded | Active sections | Terminal verified/degraded | Active safe rate |
|---|---:|---:|---:|---:|---:|
| Development | 1,173 | 364 | 809 | 649 | 80.22% |
| Calibration | 158 | 41 | 117 | 95 | 81.20% |
| Frozen aggregate | 303 | 60 | 243 | 171 | 70.37% |
| Total | 1,634 | 465 | 1,169 | 915 | 78.27% |

The active safe rate is parser/completeness and policy output, not field accuracy. Counting both active verified/degraded candidates and correctly completed past-only exclusions, 1,380/1,634 sections (84.46%) reach an automatic safe terminal outcome. Neither figure is a customer-open accuracy claim.

## Defects found and fixed

- Price evidence that pointed to a generic heading is rejected. Evidence now points to the exact amount line.
- Korean dot-thousands and explicit supplier shorthand are replayed deterministically from their source quote.
- Unscoped bare amounts are no longer treated as a departure-price calendar.
- Cruise capacity and vessel specifications are excluded from selling-price extraction.
- Departure-year evidence is section-local. A current-year guess or an unrelated year elsewhere in a catalog cannot authorize publication.
- Valid compact source dates can contribute year evidence.
- Repeated title cards that split one product's price calendar from its itinerary are merged only under narrow deterministic conditions.
- Multi-source bundle evidence retains the true source document, extraction, node, and hash.
- A Korean full-date departure row and a separate, uniquely labelled `여행경비` row in the same table now resolve to one exact date-price pair. Cells containing multiple grade prices are explicitly rejected instead of selecting the first amount.
- The approved customer-visible cancellation-policy snapshot is now pinned by hash in the private benchmark. This raises terminal coverage without granting terms to a case through mutable live configuration.
- Multi-file upload now carries an explicit batch identifier and stable file order. Batch membership expands the bundle search scope only; it never proves that two files describe the same product.
- Operational pasted text and extracted HWP now receive the same whitespace-tolerant lineage fingerprint. Numbers and punctuation are preserved, so formatting-only copies can match while a changed price cannot.
- The authenticated upload screen now accepts an optional four-digit departure-year context. It is persisted into the append-only upload/job lineage, is used only when the source section and approved bundle filenames omit a year, and is passed into price-date parsing so the generated dates and the year evidence cannot diverge. It never defaults from the clock or file metadata and never overrides an explicit source year.
- Sixteen newly arrived HWP sources added 24 travel sections. Existing split membership is preserved by lineage and source path, while genuinely new lineages receive a deterministic split. Against common non-frozen sources, the year propagation recovered one additional section with zero regressions.
- Monthly supplier grids in the form `month | day list | price | day list | price` are now parsed from adjacent EvidenceIR cells. Row-spanning month labels are preserved, explicitly closed dates are removed, and an arrow price is accepted only as the documented final sale price.
- A date/weekday cell such as `10 월` is no longer mistaken for an October month label. The month column is selected from the dominant month-label column, so day/weekday cells cannot change the active month.
- A price card followed by its itinerary card inside the same HWP is merged only when deterministic product identity agrees, grade markers do not conflict, the price card has no DAY itinerary, and the following card supplies one. This removed three false product sections without enabling directory- or history-based companion-file joins.
- Explicit exclusion dates are removed before special/base price precedence is evaluated. Actual-source checks covered the Zhangjiajie 3U exclusions and special dates, Osaka price/itinerary continuation, 66 Kyushu date-price rows with past-only termination, and Shizuoka closed dates plus final special prices.
- A source weekday is now carried from the price parser into the date policy. If it matches an already-past intake-year date, the schedule is expired instead of being silently rolled to a different weekday next year. A future weekday mismatch blocks.
- A product header with one explicit Korean departure date and one uniquely labelled product price now survives reversed HWP table reading order. Two actual Huangshan files covering four product sections changed from blocked or unsafe next-year inference to correct past-only termination. Competing amounts still fail closed.
- An active-learning cycle now ranks development-only cases by commercial risk and lineage diversity, creates a blind 34-source review queue, and creates 12 dual-model silver candidates. Frozen individual cases are never selected or inspected, and silver output is never counted as ground truth.

## Remaining measured blockers

Development-source counts overlap because one source may have several blockers:

- Price/departure applicability unresolved: 34 sources
- Adult sale price unavailable: 32 sources
- Exact amount evidence still unresolved: 16 sources
- Exclusions unavailable: 14 sources
- DAY itinerary unavailable: 12 sources
- Inclusions unavailable: 11 sources

Many of the leading misses are standalone companion price or itinerary files from historical storage. They have no authenticated upload-batch lineage. They remain blocked because matching by directory, filename similarity, or an old product row would allow cross-product fact mixing.

The private benchmark now uses the explicitly approved immutable cancellation-policy snapshot hash. It does not read mutable `terms_templates` state at benchmark time. The earlier 290-source cancellation cohort was therefore removed only through a pinned reviewed policy, not by weakening the terminal gate.

The missing-year cohort cannot be repaired safely by assuming the upload year, file modification time, or current calendar year. The trusted upload-envelope year contract is now implemented, but historical corpus cases still need a reviewed year value before it may be applied. Until an explicit source/filename year, eligible reviewed companion source, or authenticated confirmed upload year is present, the case remains blocked by design.

## Why customer opening is still blocked

- Completed independent double-reviewed frozen ground truth: 0 sections
- Critical exact-match rate: unmeasured
- Critical false-publication count: unmeasured
- Qualifying operational/manual pasted-text benchmark: below the required 100 sections
- HWP/paste comparable lineages: below the required 100
- Current production inventory contains 0 qualifying operational admin-paste sources; all 16 text sources are legacy backfill, so generated paste candidates cannot satisfy the gate
- The current frozen blind-review queue contains 164 source cases covering the 303 frozen product sections. It excludes engine output and now accepts a separately reviewed source departure year when the supplier document genuinely omits it.
- The latest source-bundle shadow scan classified 643 development sources as 502 combined, 113 itinerary, 20 price, and 8 terms documents, but produced 0 safe pairs. The previous diagnostic review found that 49 of the 50 closest misses lacked sufficient product identity, so loosening the resolver would risk cross-product fact mixing
- Source bundles are shadow candidates and are not yet authoritative workflow input; explicit upload-batch provenance is now available for future evidence-rich pairs
- New benchmark and bundle migrations are not applied to production
- Production remains `authority_mode=shadow` and `publication_freeze=true`

## Verification

- Latest registration/parser regression: 153 files, 1,059 tests passed
- TypeScript: passed
- Product-registration contract: passed
- Authority scan: `authorized=1 legacy=143 unapproved=0`
- Targeted ESLint: passed
- Git diff whitespace validation: passed
- The V3 date-policy migration is covered by a repository authority-contract test. Local SQL application was not run because local Supabase was not running; production was intentionally untouched.
- The earlier full production build remains recorded as passed. This latest corpus-correction pass did not deploy, apply migrations, or move a production publication pointer.

The next promotion step is not to lower blockers. It is to collect trusted departure-year context where the supplier source omitted the year, finish blinded double review, collect at least 100 real operational paste sections and 100 comparable HWP/paste lineages, and activate source bundles only for evidence-rich cohorts. The pinned frozen gate must then pass twice before any publication thaw.
