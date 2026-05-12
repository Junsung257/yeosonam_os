import { permanentRedirect } from 'next/navigation';

export default async function ProductsPage(
  props: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
  permanentRedirect(`/packages${suffix}`);
}
