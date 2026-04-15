/**
 * 카드뉴스 템플릿 공통 Props
 *
 * 모든 5종 템플릿 컴포넌트가 동일한 Props 시그니처를 사용한다.
 * SlideCanvas는 slide.template_id로 적절한 컴포넌트를 라우팅.
 */

export type SlideVariant = 'cover' | 'content' | 'cta';

export interface TemplateProps {
  /** 헤드라인 (15자 이내 권장, 20자 초과 시 자동 truncate) */
  headline: string;
  /** 본문 (40자 이내 권장, 50자 초과 시 자동 truncate) */
  body: string;
  /** 배경 이미지 URL */
  bgImageUrl?: string;
  /** 옵셔널 배지 ("핵심", "TIP", "01" 등) */
  badge?: string | null;
  /** 슬라이드 역할 (디자인 변형용) */
  variant: SlideVariant;
  /** 페이지 번호 (1-indexed) */
  pageIndex?: number;
  /** 전체 페이지 수 */
  totalPages?: number;
  /** 캔버스 크기 */
  ratio: { w: number; h: number };
  /** 작은 미리보기 모드 (목록 썸네일용) */
  isPreview?: boolean;
  /** contentEditable 콜백 (편집 모드) */
  onUpdateHeadline?: (text: string) => void;
  onUpdateBody?: (text: string) => void;
}
