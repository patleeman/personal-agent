import { useTheme } from '../theme';
import { IconButton } from './ui';

export function ThemeSwitcher() {
  const { theme, toggle } = useTheme();

  return (
    <IconButton
      onClick={toggle}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
      compact
    >
      {theme === 'light' ? '◐' : '○'}
    </IconButton>
  );
}
