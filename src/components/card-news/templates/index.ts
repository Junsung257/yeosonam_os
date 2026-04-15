/**
 * 카드뉴스 템플릿 라우팅 맵
 *
 * SlideCanvas는 slide.template_id로 적절한 컴포넌트를 라우팅한다.
 * 알 수 없는 id는 DarkCinematic으로 폴백.
 */

import DarkCinematic from './DarkCinematic';
import CleanWhite from './CleanWhite';
import BoldGradient from './BoldGradient';
import Magazine from './Magazine';
import LuxuryGold from './LuxuryGold';
import { TemplateProps } from './types';
import { TemplateId } from '@/lib/card-news/tokens';

export type { TemplateProps };
export { DarkCinematic, CleanWhite, BoldGradient, Magazine, LuxuryGold };

export const TEMPLATE_COMPONENTS: Record<TemplateId, React.FC<TemplateProps>> = {
  dark_cinematic: DarkCinematic,
  clean_white: CleanWhite,
  bold_gradient: BoldGradient,
  magazine: Magazine,
  luxury_gold: LuxuryGold,
};

export function getTemplateComponent(templateId: string | undefined): React.FC<TemplateProps> | null {
  if (!templateId) return null;
  return (TEMPLATE_COMPONENTS as Record<string, React.FC<TemplateProps>>)[templateId] || null;
}
