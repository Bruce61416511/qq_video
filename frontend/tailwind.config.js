/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefcf8',
          100: '#d4f5ee',
          200: '#a9ebe0',
          300: '#70dace',
          400: '#3ec0b5',
          500: '#22a59b',
          600: '#17857e',
          700: '#146a67',
          800: '#145554',
          900: '#154745',
          950: '#052927',
          deep: '#005d50',
          ink: '#00473f',
          mist: '#edf7f5',
          line: '#dce9e7',
        },
      },
      boxShadow: {
        'nav': '0 18px 35px rgba(37, 78, 85, 0.18), 0 2px 8px rgba(14, 56, 55, 0.08)',
        'card': '0 12px 26px rgba(38, 74, 78, 0.08)',
        'glass': '0 8px 32px rgba(0, 93, 80, 0.06)',
      },
      fontFamily: {
        sans: [
          'Inter', 'ui-sans-serif', 'system-ui', '-apple-system',
          'BlinkMacSystemFont', '"Segoe UI"', '"Microsoft YaHei"',
          '"PingFang SC"', 'sans-serif',
        ],
        serif: ['"Songti SC"', '"SimSun"', 'serif'],
      },
      borderRadius: {
        '2xl': '14px',
        '3xl': '18px',
      },
    },
  },
  plugins: [],
};
