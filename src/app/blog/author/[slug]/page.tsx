import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import GlobalNav from '@/components/customer/GlobalNav';

export const revalidate = 3600;

export default async function BlogAuthorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data, error } = await supabaseAdmin
    .from('blog_author_profiles')
    .select('slug, display_name, bio, verified_experience, credentials, profile_image_url')
    .eq('slug', decodeURIComponent(slug))
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) notFound();
  const experience = Array.isArray(data.verified_experience) ? data.verified_experience : [];
  const credentials = Array.isArray(data.credentials) ? data.credentials : [];
  return (
    <>
      <GlobalNav />
      <main className="mx-auto min-h-screen max-w-3xl px-5 py-16">
        <h1 className="text-3xl font-black text-slate-950">{data.display_name}</h1>
        {data.bio && <p className="mt-5 text-lg leading-8 text-slate-700">{data.bio}</p>}
        {experience.length > 0 && <section className="mt-10"><h2 className="text-xl font-bold">검증된 경력</h2><ul className="mt-4 list-disc space-y-2 pl-6">{experience.map((item, index) => <li key={index}>{String((item as Record<string, unknown>).label || item)}</li>)}</ul></section>}
        {credentials.length > 0 && <section className="mt-10"><h2 className="text-xl font-bold">자격 및 전문 분야</h2><ul className="mt-4 list-disc space-y-2 pl-6">{credentials.map((item, index) => <li key={index}>{String((item as Record<string, unknown>).label || item)}</li>)}</ul></section>}
      </main>
    </>
  );
}
