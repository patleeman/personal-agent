#!/usr/bin/env python3
"""Initialize a new skill with standard directory structure."""

import argparse
import re
import sys
from pathlib import Path

SKILL_TEMPLATE = '''---
name: {skill_name}
description: TODO - Describe what this skill does and when to use it. Include trigger conditions.
---

# {skill_title}

TODO: Write instructions for using this skill.

## Overview

What this skill does.

## Usage

How to use it.

## Resources

- `scripts/` - Executable automation scripts
- `references/` - Documentation loaded as needed
- `assets/` - Templates and files for output
'''

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""Example script - delete or replace with actual implementation."""

def main():
    print("Hello from {skill_name}")

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = '''# Reference

TODO: Add reference documentation here.

This file is loaded into context when Claude needs it.
'''


def validate_skill_name(name: str) -> bool:
    """Validate skill name follows conventions."""
    pattern = r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    if not re.match(pattern, name):
        return False
    if len(name) > 40:
        return False
    return True


def init_skill(skill_name: str, base_path: Path) -> None:
    """Create skill directory structure."""
    skill_path = base_path / skill_name

    if skill_path.exists():
        print(f"Error: {skill_path} already exists")
        sys.exit(1)

    # Create directories
    skill_path.mkdir(parents=True)
    (skill_path / "scripts").mkdir()
    (skill_path / "references").mkdir()
    (skill_path / "assets").mkdir()

    # Create SKILL.md
    skill_title = skill_name.replace("-", " ").title()
    (skill_path / "SKILL.md").write_text(
        SKILL_TEMPLATE.format(skill_name=skill_name, skill_title=skill_title)
    )

    # Create example files
    (skill_path / "scripts" / "example.py").write_text(
        EXAMPLE_SCRIPT.format(skill_name=skill_name)
    )
    (skill_path / "references" / "example.md").write_text(EXAMPLE_REFERENCE)
    (skill_path / "assets" / ".gitkeep").write_text("")

    print(f"Created skill: {skill_path}")
    print(f"\nNext steps:")
    print(f"  1. Edit {skill_path}/SKILL.md")
    print(f"  2. Add scripts, references, assets as needed")
    print(f"  3. Delete example files you don't need")
    print(f"  4. Run validate_skill.py to check")


def main():
    parser = argparse.ArgumentParser(description="Initialize a new skill")
    parser.add_argument("name", help="Skill name (hyphen-case, e.g., 'my-skill')")
    parser.add_argument(
        "--path",
        default="skills",
        help="Base path for skills (default: skills)"
    )
    args = parser.parse_args()

    if not validate_skill_name(args.name):
        print(f"Error: Invalid skill name '{args.name}'")
        print("Requirements:")
        print("  - Lowercase letters, digits, hyphens only")
        print("  - Must start with a letter")
        print("  - No consecutive or trailing hyphens")
        print("  - Maximum 40 characters")
        sys.exit(1)

    base_path = Path(args.path)
    init_skill(args.name, base_path)


if __name__ == "__main__":
    main()
