import { useTheme } from '../theme';

export function ThemeSwitcher() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      className="w-7 h-7 rounded-md flex items-center justify-center text-secondary hover:text-primary hover:bg-elevated transition-colors text-sm"
    >
      {theme === 'light' ? '◐' : '○'}
    </button>
  );
}
