import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

function source(): string {
  return readFileSync(join(process.cwd(), 'src/components/AdminLayout.tsx'), 'utf8');
}

describe('AdminLayout hydration safety', () => {
  it('defers personalized navigation state until after hydration', () => {
    const code = source();

    expect(code).toContain('const [hasHydrated, setHasHydrated] = useState(false)');
    expect(code).toContain('const navRole = hasHydrated ? userRole : undefined');
    expect(code).toContain('filterNavGroups(adminNavGroups, navRole)');
    expect(code).toContain('const visibleBadges = hasHydrated ? badges : undefined');
    expect(code).toContain('buildAdminMissionItems(visibleBadges)');
    expect(code).toContain('getNavItemBadge(item, visibleBadges)');
    expect(code).not.toContain('Math.random()');
    expect(code).toContain("a.href.localeCompare(b.href, 'ko-KR')");
  });

  it('renders mission timestamps in the same timezone on the server and browser', () => {
    const code = source();

    expect(code).toContain("timeZone: 'Asia/Seoul'");
  });
});
