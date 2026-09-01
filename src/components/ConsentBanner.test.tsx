import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ConsentBanner from "./ConsentBanner";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("ConsentBanner first paint", () => {
  it("server-renders the consent decision for a first-time visitor", () => {
    const html = renderToStaticMarkup(
      <ConsentBanner
        initialConsent={{
          decided: false,
          analytics: false,
          advertising: false,
        }}
      />,
    );

    expect(html).toContain("분석·광고 쿠키 설정");
    expect(html).toContain(
      "필수 쿠키는 상담·예약 등 서비스 기능에만 사용합니다.",
    );
  });

  it("does not flash the decision dialog when the server cookie is already decided", () => {
    const html = renderToStaticMarkup(
      <ConsentBanner
        initialConsent={{ decided: true, analytics: false, advertising: false }}
      />,
    );

    expect(html).toContain("쿠키 설정");
    expect(html).not.toContain(
      "필수 쿠키는 상담·예약 등 서비스 기능에만 사용합니다.",
    );
  });
});
