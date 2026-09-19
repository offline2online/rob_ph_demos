/* Ant Design theme — ph-designer references/tokens.md §6, verbatim. */
import type { ThemeConfig } from 'antd'

export const phTheme: ThemeConfig = {
  token: {
    colorPrimary: '#169bc2',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorText: '#333333',
    colorTextSecondary: 'rgba(0,0,0,0.45)',
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
    colorSplit: 'rgba(5,5,5,0.06)',
    colorBgLayout: '#ffffff',
    colorBgContainer: '#ffffff',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontSize: 14,
    fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
    controlHeight: 32,
  },
  components: {
    Tabs: { inkBarColor: '#169bc2', itemActiveColor: '#169bc2', itemSelectedColor: '#169bc2', itemColor: '#333333', cardBg: 'transparent' },
    Button: { defaultColor: '#333333', paddingInline: 15 },
    Switch: { handleSize: 18, trackHeight: 22 },
  },
}

/* Tokens used in component code (tokens.md §1). */
export const T = {
  primary: '#169bc2',
  primaryTint: 'rgba(22,155,194,0.10)',
  text: '#333333',
  muted: 'rgba(0,0,0,0.45)',
  micro: '#9ca3af',
  border: '#d9d9d9',
  borderSubtle: '#f0f0f0',
  divider: 'rgba(5,5,5,0.06)',
  surfaceAlt: '#fafafa',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
} as const
