import type { UseAdminConsole } from './useAdminConsole';
import type { SectionId } from './types';

export interface SectionProps {
  console: UseAdminConsole;
  navigate: (section: SectionId) => void;
}
