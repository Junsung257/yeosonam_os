/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
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
        // 어드민 전용 (Toss 스타일)
        admin: {
          bg:      '#F9FAFB',
          surface: '#FFFFFF',
          border:  '#F2F4F6',
          borderMid: '#E5E7EB',
          text:    '#191F28',
          muted:   '#8B95A1',
          // 수익/손실 — 한국 주식 관행 (양수=빨강, 음수=파랑)
          profit:  '#F04452',
          loss:    '#3182F6',
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

      // ─── 타이포그래피 스케일 (Gemini 스펙) ───
      fontSize: {
        // 공개 사이트
        'h1':    ['22px', { lineHeight: '1.4',  letterSpacing: '-0.02em', fontWeight: '700' }],
        'h2':    ['18px', { lineHeight: '1.4',  letterSpacing: '-0.02em', fontWeight: '600' }],
        'body':  ['14px', { lineHeight: '1.55', letterSpacing: '-0.02em', fontWeight: '500' }],
        'micro': ['12px', { lineHeight: '1.5',  letterSpacing: '-0.01em', fontWeight: '400' }],
        'price': ['20px', { lineHeight: '1.3',  letterSpacing: '-0.02em', fontWeight: '800' }],
        // 어드민 전용
        'admin-xs':   ['12px', { lineHeight: '16px' }],
        'admin-sm':   ['13px', { lineHeight: '18px' }],
        'admin-base': ['14px', { lineHeight: '20px' }],
        'admin-md':   ['15px', { lineHeight: '22px' }],
        'admin-lg':   ['16px', { lineHeight: '24px' }],
      },

      // ─── Border Radius ───
      borderRadius: {
        'card': '16px',
        'icon': '16px',
        'pill': '9999px',
        'btn':  '12px',
        'xl2':  '24px',
      },

      // ─── Box Shadow ───
      boxShadow: {
        'card':       '0 4px 16px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(0, 0, 0, 0.08)',
        'modal':      '0 16px 48px rgba(0, 0, 0, 0.12)',
        'admin-card': '0 2px 12px rgba(0, 0, 0, 0.06)',
        'admin-modal':'0 8px 32px rgba(0, 0, 0, 0.10)',
      },

      // ─── Spacing ───
      spacing: {
        'admin-row':       '48px',
        'admin-row-comfy': '56px',
        'touch':           '48px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
