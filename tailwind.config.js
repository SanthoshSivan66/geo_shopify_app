/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: '#f4f6f8',
        dashboard: '#f4f6f8',
        card: '#ffffff',
        borderglow: 'rgba(0, 0, 0, 0.05)',
        primary: '#18181b',
        secondary: '#f3f4f6',
        gray: {
          100: '#0f172a', // text-gray-100 -> slate-900 (Main dark text)
          200: '#1e293b', 
          300: '#334155', // text-gray-300 -> slate-700
          400: '#475569', // text-gray-400 -> slate-600 (Subdued text)
          500: '#64748b', // text-gray-500 -> slate-500
          600: '#cbd5e1', // bg-gray-600 -> slate-300
          700: '#e2e8f0',
          800: '#f1f5f9', // bg-gray-800 -> slate-100 (light UI element)
          900: '#f8fafc',
        }
      },
      backgroundImage: {
        'primary-gradient': 'linear-gradient(to right, #18181b, #27272a)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
};
