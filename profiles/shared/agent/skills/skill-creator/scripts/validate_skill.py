#!/usr/bin/env python3
"""Validate a skill's structure and metadata."""

import argparse
import re
import sys
from pathlib import Path

import yaml


def validate_skill(skill_path: Path) -> tuple[bool, list[str]]:
    """Validate skill directory structure and SKILL.md."""
    errors = []

    # Check SKILL.md exists
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        errors.append("Missing SKILL.md")
        return False, errors

    content = skill_md.read_text()

    # Check frontmatter
    if not content.startswith("---"):
        errors.append("SKILL.md must start with YAML frontmatter (---)")
        return False, errors

    parts = content.split("---", 2)
    if len(parts) < 3:
        errors.append("Invalid frontmatter format (missing closing ---)")
        return False, errors

    # Parse YAML
    try:
        frontmatter = yaml.safe_load(parts[1])
    except yaml.YAMLError as e:
        errors.append(f"Invalid YAML: {e}")
        return False, errors

    if not isinstance(frontmatter, dict):
        errors.append("Frontmatter must be a YAML dictionary")
        return False, errors

    # Check required fields
    if "name" not in frontmatter:
        errors.append("Missing required field: name")
    elif not isinstance(frontmatter["name"], str):
        errors.append("Field 'name' must be a string")
    else:
        name = frontmatter["name"]
        pattern = r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
        if not re.match(pattern, name):
            errors.append(f"Invalid name format: {name}")
        if len(name) > 64:
            errors.append("Name exceeds 64 characters")

    if "description" not in frontmatter:
        errors.append("Missing required field: description")
    elif not isinstance(frontmatter["description"], str):
        errors.append("Field 'description' must be a string")
    else:
        desc = frontmatter["description"]
        if "<" in desc or ">" in desc:
            errors.append("Description cannot contain angle brackets")
        if len(desc) > 1024:
            errors.append("Description exceeds 1024 characters")
        if "TODO" in desc:
            errors.append("Description contains TODO placeholder")

    # Check allowed fields
    allowed = {"name", "description", "license", "allowed-tools", "metadata"}
    for key in frontmatter:
        if key not in allowed and key != "metadata":
            errors.append(f"Unknown frontmatter field: {key}")

    # Check body has content
    body = parts[2].strip()
    if not body:
        errors.append("SKILL.md body is empty")
    elif "TODO" in body:
        errors.append("SKILL.md body contains TODO placeholders")

    return len(errors) == 0, errors


def main():
    parser = argparse.ArgumentParser(description="Validate a skill")
    parser.add_argument("path", help="Path to skill directory")
    args = parser.parse_args()

    skill_path = Path(args.path)

    if not skill_path.exists():
        print(f"Error: {skill_path} does not exist")
        sys.exit(1)

    if not skill_path.is_dir():
        print(f"Error: {skill_path} is not a directory")
        sys.exit(1)

    valid, errors = validate_skill(skill_path)

    if valid:
        print(f"✅ {skill_path.name} is valid")
        sys.exit(0)
    else:
        print(f"❌ {skill_path.name} has errors:")
        for error in errors:
            print(f"   - {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
