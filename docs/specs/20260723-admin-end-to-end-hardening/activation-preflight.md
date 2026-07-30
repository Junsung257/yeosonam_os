# Admin dashboard activation preflight

The deployment gate is intentionally read-only. It never runs `supabase db push`.

Run:

```powershell
npm run check:admin-dashboard-activation
npx supabase db advisors --linked --type all --level error --fail-on error
```

The first command compares the eight reviewed dashboard migrations with the linked
project. CI should use the strict form:

```powershell
npm run check:admin-dashboard-activation:ci
```

It exits non-zero while any required migration is local-only. After the reviewed
deployment applies the migrations, rerun the gate, then run the authenticated
dashboard contract audit in strict mode. No product data repair is part of this
activation step.
