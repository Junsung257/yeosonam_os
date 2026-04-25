/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontSize: {
        'admin-xs':   ['12px', { lineHeight: '16px' }],
        'admin-sm':   ['13px', { lineHeight: '18px' }],
        'admin-base': ['14px', { lineHeight: '20px' }],
        'admin-md':   ['15px', { lineHeight: '22px' }],
        'admin-lg':   ['16px', { lineHeight: '24px' }],
      },
      spacing: {
        'admin-row':       '48px',
        'admin-row-comfy': '56px',
      },
      colors: {
        admin: {
          bg:           '#f8f9ff',
          surface:      '#ffffff',
          border:       '#e2e8f0',
          borderStrong: '#cbd5e1',
          text:         '#0f172a',
          textMuted:    '#64748b',
          textSubtle:   '#94a3b8',
          accent:       '#001f3f',
        },
        status: {
          successBg: '#ecfdf5', successFg: '#047857',
          warningBg: '#fffbeb', warningFg: '#b45309',
          dangerBg:  '#fef2f2', dangerFg:  '#b91c1c',
          infoBg:    '#eff6ff', infoFg:    '#1d4ed8',
          neutralBg: '#f1f5f9', neutralFg: '#475569',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
