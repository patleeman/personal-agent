/**
 * Skill app types — shared between components and API.
 */

interface SkillAppNavItem {
  label: string;
  page: string;
}

export interface SkillApp {
  id: string;
  name: string;
  description: string;
  prompt: string;
  entry: string;
  icon: string;
  nav: SkillAppNavItem[];
}
