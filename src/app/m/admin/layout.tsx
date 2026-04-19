import MobileShell from './_shell';

export const metadata = {
  title: '여소남 관리',
};

export default function MobileAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MobileShell>{children}</MobileShell>;
}
