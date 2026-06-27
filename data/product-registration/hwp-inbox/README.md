# HWP Inbox

Use this local inbox for supplier HWP batches that should feed the product registration engine.

## Folders

- `raw/`: put the original `.hwp` files here.
- `extracted/`: Hancom-extracted text output.
- `prepared/`: text copied from `extracted/` for registration. Edit here only when the source structure needs operator cleanup.
- `reports/`: extraction and audit reports.

The data folders are ignored by git because supplier files and extracted text can contain sensitive commercial terms.

## Commands

Extract text only:

```powershell
npm run extract:hwp-inbox
```

Extract and run the offline product-registration audit:

```powershell
npm run audit:hwp-inbox
```

After reviewing the offline audit, register and run mobile/A4 checks:

```powershell
npm run register:hwp-inbox
```

Customer-visible publishing still requires the normal mobile browser proof gate. This inbox only automates the source extraction and batch processing path.
