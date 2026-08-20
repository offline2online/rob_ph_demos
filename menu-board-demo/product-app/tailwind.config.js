/** ph-designer skill §7 */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        primary: '#169bc2',
        'primary-hover': '#38b0cf',
        'primary-active': '#09759c',
        'primary-bg': '#e8fdff',
        'primary-light': '#e6f7ff',
        blueInfo: '#1677ff',
        sidebar: '#333333',
        'sidebar-text': 'rgba(255,255,255,0.75)',
        'sidebar-text-active': '#ffffff',
      },
    },
  },
  plugins: [],
};
