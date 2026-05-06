import { Resend } from 'resend';
import { marked } from 'marked';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { getSecret } from './secret-registry';

export async function sendVaContentPackage(
  packageId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const vaEmails = getSecret('VA_EMAILS');
  const resendKey = getSecret('RESEND_API_KEY');

  if (!vaEmails || !resendKey) {
    return { sent: false, reason: 'VA_EMAILS or RESEND_API_KEY not configured' };
  }
  if (!isSupabaseConfigured) {
    return { sent: false, reason: 'Supabase not configured' };
  }

  const [pkgsRes, blogDistsRes, cardNewsRes] = await Promise.all([
    // 1. 마케팅 필드만 — 원가/랜드사 정보 제외
    supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, product_summary, short_code')
      .eq('id', packageId)
      .limit(1),

    // 2. 블로그 초안 — content_distributions.naver_blog
    supabaseAdmin
      .from('content_distributions')
      .select('payload')
      .eq('product_id', packageId)
      .eq('platform', 'naver_blog')
      .in('status', ['draft', 'scheduled', 'published'])
      .order('created_at', { ascending: false })
      .limit(1),

    // 3. 카드뉴스 이미지 — card_news.package_id
    supabaseAdmin
      .from('card_news')
      .select('id, title, slide_image_urls, ig_slide_urls')
      .eq('package_id', packageId)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  if (!pkgsRes.data?.[0]) return { sent: false, reason: 'Package not found' };
  const pkg = pkgsRes.data[0];

  let blogHtml = '';
  const payload = blogDistsRes.data?.[0]?.payload as { body?: string; html?: string } | null;
  if (payload?.html) {
    blogHtml = payload.html;
  } else if (payload?.body) {
    const raw = payload.body;
    blogHtml = /<[a-z]/i.test(raw) ? raw : (marked.parse(raw) as string);
  }

  const cardNewsRows = cardNewsRes.data;

  const imageUrls: string[] = [];
  for (const cn of cardNewsRows ?? []) {
    const rendered = (cn.slide_image_urls as string[] | null) ?? (cn.ig_slide_urls as string[] | null) ?? [];
    imageUrls.push(...rendered.slice(0, 6));
  }

  // 4. 이메일 발송
  const recipients = vaEmails.split(',').map(e => e.trim()).filter(Boolean);
  const from = getSecret('VA_EMAIL_FROM') ?? 'noreply@yeosonam.com';
  const adminUrl = (getSecret('NEXT_PUBLIC_BASE_URL') ?? 'https://yeosonam.com').replace(/\/$/, '');

  const resend = new Resend(resendKey);
  const { error } = await resend.emails.send({
    from: `여소남 OS <${from}>`,
    to: recipients,
    subject: `[여소남] Blog Draft Ready — ${pkg.title}`,
    html: buildEmailHtml({ pkg, blogHtml, imageUrls, adminUrl }),
  });

  if (error) return { sent: false, reason: (error as { message: string }).message };
  return { sent: true };
}

function buildEmailHtml(params: {
  pkg: {
    title: string;
    destination: string;
    product_summary?: string | null;
    short_code?: string | null;
  };
  blogHtml: string;
  imageUrls: string[];
  adminUrl: string;
}): string {
  const { pkg, blogHtml, imageUrls, adminUrl } = params;

  const blogSection = blogHtml
    ? `<h3 style="color:#1e293b;margin-top:28px">📝 Blog Post — Copy &amp; Paste into Naver</h3>
       <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;font-size:14px;line-height:1.7;color:#334155">
         ${blogHtml}
       </div>`
    : `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px;margin-top:20px;color:#9a3412">
         ⏳ Blog draft is being generated. Check
         <a href="${adminUrl}/admin/blog" style="color:#1d4ed8">Admin → Blog</a> in a few minutes.
       </div>`;

  const imageSection =
    imageUrls.length > 0
      ? `<h3 style="color:#1e293b;margin-top:28px">📸 Card News Images (${imageUrls.length} slides)</h3>
         <p style="color:#64748b;margin:0 0 10px">Right-click each link → Save image → Upload to Naver Blog post:</p>
         <ul style="padding-left:20px;color:#1d4ed8">
           ${imageUrls.map((url, i) => `<li style="margin-bottom:4px"><a href="${url}" target="_blank" style="color:#1d4ed8">Slide ${i + 1}</a></li>`).join('')}
         </ul>`
      : `<div style="background:#f1f5f9;border-radius:8px;padding:14px;margin-top:20px;color:#64748b">
           ⏳ Card news images are being generated. Check back in 5 minutes.
         </div>`;

  const summarySection = pkg.product_summary
    ? `<h3 style="color:#1e293b;margin-top:28px">💡 Product Summary (reference only)</h3>
       <p style="background:#fefce8;border-left:4px solid #facc15;padding:12px 16px;border-radius:0 6px 6px 0;margin:0;color:#713f12;font-size:14px">${pkg.product_summary}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<body style="font-family:Arial,sans-serif;max-width:740px;margin:0 auto;padding:24px;color:#1e293b;background:#f8fafc">
  <div style="background:#1d4ed8;color:white;padding:18px 24px;border-radius:10px 10px 0 0">
    <h2 style="margin:0;font-size:20px">📢 New Content Ready for Publishing</h2>
  </div>
  <div style="background:white;border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 10px 10px">

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
      <tr>
        <td style="color:#64748b;padding:5px 0;width:130px;font-size:14px">Product</td>
        <td style="font-weight:bold;font-size:15px">${pkg.title}</td>
      </tr>
      <tr>
        <td style="color:#64748b;padding:5px 0;font-size:14px">Destination</td>
        <td style="font-size:14px">${pkg.destination}</td>
      </tr>
    </table>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">

    <h3 style="color:#1e293b;margin-top:0">📋 How to Publish on Naver Blog</h3>
    <ol style="color:#334155;line-height:2;padding-left:20px;font-size:14px">
      <li>Open <a href="https://blog.naver.com/write" target="_blank" style="color:#1d4ed8">Naver Blog → Write New Post</a></li>
      <li>Copy the blog post below → Paste into the editor</li>
      <li>Upload the card news images (download links below)</li>
      <li>Click <strong>Publish</strong> 🎉</li>
    </ol>

    ${blogSection}
    ${imageSection}
    ${summarySection}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 16px">
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin:0">
      Powered by 여소남 OS &nbsp;|&nbsp;
      <a href="${adminUrl}/admin/blog" style="color:#1d4ed8">View Blog Dashboard</a>
    </p>
  </div>
</body>
</html>`;
}
