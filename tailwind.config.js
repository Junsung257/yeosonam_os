/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // ─── 폰트 패밀리 ───
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Apple SD Gothic Neo"', '"Malgun Gothic"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      // ─── 디자인 토큰: Toss Blue 기반 통합 팔레트 ───
      colors: {
        // 브랜드 (공개 사이트 + 어드민 공통)
        brand: {
          DEFAULT: '#3182F6',
          light:   '#EBF3FE',
          dark:    '#1B64DA',
        },
        // 배경
        'bg-page':    '#FFFFFF',
        'bg-section': '#F2F4F6',
        // 텍스트
        'text-primary':   '#191F28',
        'text-secondary': '#8B95A1',
        'text-body':      '#4E5968',
        // 시스템 색상
        danger: {
          DEFAULT: '#F04452',
          light:   '#FFF1F2',
        },
        success: {
          DEFAULT: '#04C584',
          light:   '#E9FAF4',
        },
        warning: {
          DEFAULT: '#F59E0B',
          light:   '#FFFBEB',
        },
        // 어드민 (Linear/Stripe 톤 — 중성 슬레이트 + Toss Blue 포인트)
        admin: {
          // 표면
          bg:        '#F8FAFC',  // slate-50 톤 (페이지 배경)
          surface:   '#FFFFFF',  // 카드/패널
          'surface-2': '#F1F5F9', // 서브 표면 (탭 선택 안 됨, code block)
          // 경계선 (3단계로 미세 명도차)
          border:    '#EEF2F6',  // hairline (table row, card border)
          'border-mid': '#E5E7EB', // default
          'border-strong': '#CBD5E1', // hover/focus
          borderMid: '#E5E7EB',     // ← 레거시 camelCase alias (점진 deprecate)
          borderStrong: '#CBD5E1',  // ← 레거시 alias
          // 텍스트 (5단계)
          text:      '#0F172A',  // 본문 (slate-900)
          'text-2':  '#334155',  // 보조 (slate-700)
          muted:     '#64748B',  // 라벨/캡션 (slate-500)
          'muted-2': '#94A3B8',  // 비활성 (slate-400)
          textMuted: '#64748B',  // ← 레거시 alias (점진 deprecate)
          textSubtle: '#94A3B8', // ← 레거시 alias → muted-2 와 동일
          'on-brand':'#FFFFFF',  // 브랜드 위 텍스트
          // 회계 (한국 주식 관행: 양수=빨강, 음수=파랑)
          profit:    '#F04452',
          loss:      '#3182F6',
          // 상태 액센트 (Linear 톤 — 채도 낮춤)
          accent:    '#3182F6',  // 브랜드와 동일
          'accent-light': '#EBF3FE',
        },
        // 레거시 status 토큰 (어드민 일부에서 사용 중, 유지)
        status: {
          successBg: '#E9FAF4', successFg: '#04C584',
          warningBg: '#FFFBEB', warningFg: '#F59E0B',
          dangerBg:  '#FFF1F2', dangerFg:  '#F04452',
          infoBg:    '#EBF3FE', infoFg:    '#3182F6',
          neutralBg: '#F2F4F6', neutralFg: '#8B95A1',
        },
      },

      // ─── 타이포그래피 스케일 ───
      // 공개 사이트 토큰은 유지. 어드민은 Linear/Stripe 6단계 + tabular variant.
      fontSize: {
        // 공개 사이트 (유지)
        'h1':    ['22px', { lineHeight: '1.4',  letterSpacing: '-0.02em', fontWeight: '700' }],
        'h2':    ['18px', { lineHeight: '1.4',  letterSpacing: '-0.02em', fontWeight: '600' }],
        'body':  ['14px', { lineHeight: '1.55', letterSpacing: '-0.02em', fontWeight: '500' }],
        'micro': ['12px', { lineHeight: '1.5',  letterSpacing: '-0.01em', fontWeight: '400' }],
        'price': ['20px', { lineHeight: '1.3',  letterSpacing: '-0.02em', fontWeight: '800' }],
        // 어드민 — Linear/Stripe 톤
        // 11/12/13/14/16/20/28 그리드. compact 밀도에선 한 단계 작은 토큰 사용.
        'admin-2xs':    ['11px', { lineHeight: '14px', letterSpacing: '0.01em' }],   // tag, kbd
        'admin-xs':     ['12px', { lineHeight: '16px', letterSpacing: '0' }],         // caption, table small
        'admin-sm':     ['13px', { lineHeight: '18px', letterSpacing: '-0.005em' }],  // table compact, secondary
        'admin-base':   ['14px', { lineHeight: '20px', letterSpacing: '-0.01em' }],   // body default
        'admin-md':     ['15px', { lineHeight: '22px', letterSpacing: '-0.01em' }],   // body comfy
        'admin-lg':     ['16px', { lineHeight: '24px', letterSpacing: '-0.01em' }],   // section subtitle
        'admin-h3':     ['18px', { lineHeight: '24px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'admin-h2':     ['20px', { lineHeight: '28px', letterSpacing: '-0.02em',  fontWeight: '600' }],
        'admin-h1':     ['24px', { lineHeight: '32px', letterSpacing: '-0.02em',  fontWeight: '700' }],
        'admin-display':['28px', { lineHeight: '36px', letterSpacing: '-0.025em', fontWeight: '700' }],
      },

      // ─── Border Radius ───
      // 공개사이트: card 16/btn 12 (Toss 톤, 유지)
      // 어드민: 4/6/8 (Linear 톤)
      borderRadius: {
        'card':       '16px',  // 공개사이트 카드
        'icon':       '16px',
        'pill':       '9999px',
        'btn':        '12px',  // 공개사이트 버튼
        'xl2':        '24px',
        'admin-xs':   '4px',   // tag, badge
        'admin-sm':   '6px',   // input, button (Linear 표준)
        'admin-md':   '8px',   // card, modal
        'admin-lg':   '10px',  // dialog, sheet
      },

      // ─── Box Shadow ───
      // 어드민 — Linear 톤: 부드럽지 않고 crisp, hairline 위주
      boxShadow: {
        'card':       '0 4px 16px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.08)',
        'modal':      '0 16px 48px rgba(0, 0, 0, 0.12)',
        // 어드민 (crisp, hairline + 미세 그림자)
        'admin-xs':   '0 1px 2px rgba(15, 23, 42, 0.04)',
        'admin-sm':   '0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'admin-md':   '0 2px 8px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'admin-lg':   '0 8px 24px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'admin-xl':   '0 16px 48px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        // 레거시 호환
        'admin-card': '0 1px 3px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        'admin-modal':'0 16px 48px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(15, 23, 42, 0.04)',
        // 포커스 링 (어드민)
        'admin-focus':'0 0 0 3px rgba(49, 130, 246, 0.18)',
        'admin-focus-danger': '0 0 0 3px rgba(240, 68, 82, 0.18)',
      },

      // ─── Spacing ───
      // 4px grid 강제 (Tailwind 기본). 어드민 행 높이 + touch target만 확장.
      spacing: {
        'admin-row':       '40px',  // compact 밀도 행 높이
        'admin-row-comfy': '48px',  // comfortable 행 높이 (기본)
        'admin-row-roomy': '56px',  // roomy (모바일·터치)
        'touch':           '44px',  // 터치 타깃 (iOS HIG)
      },

      // ─── 트랜지션 ───
      transitionDuration: {
        '120': '120ms',
        '160': '160ms',
        '240': '240ms',
      },
      transitionTimingFunction: {
        'admin-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      // ─── Ring (포커스 링) ───
      ringWidth: {
        'admin': '3px',
      },
      ringColor: {
        'admin': 'rgba(49, 130, 246, 0.18)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
