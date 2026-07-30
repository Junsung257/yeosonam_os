export default function GoogleTagManagerNoScript({
  containerId,
  enabled,
}: {
  containerId: string | null;
  enabled: boolean;
}) {
  if (!enabled || !containerId) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`}
        height="0"
        width="0"
        title="Google Tag Manager"
        style={{ display: 'none', visibility: 'hidden' }}
      />
    </noscript>
  );
}
