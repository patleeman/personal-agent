#!/usr/bin/env python3
"""
WCAG Contrast Ratio Checker
Validates color contrast ratios for accessibility compliance.
"""

import sys
from typing import Tuple


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def relative_luminance(rgb: Tuple[int, int, int]) -> float:
    """Calculate relative luminance of an RGB color."""
    def channel_luminance(channel: int) -> float:
        c = channel / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return (
        0.2126 * channel_luminance(r) +
        0.7152 * channel_luminance(g) +
        0.0722 * channel_luminance(b)
    )


def contrast_ratio(color1: str, color2: str) -> float:
    """Calculate WCAG contrast ratio between two hex colors."""
    lum1 = relative_luminance(hex_to_rgb(color1))
    lum2 = relative_luminance(hex_to_rgb(color2))

    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)

    return (lighter + 0.05) / (darker + 0.05)


def check_wcag_compliance(ratio: float, text_size: str = "normal") -> dict:
    """Check WCAG compliance levels for a contrast ratio."""
    if text_size == "large":
        aa = ratio >= 3.0
        aaa = ratio >= 4.5
    else:  # normal text
        aa = ratio >= 4.5
        aaa = ratio >= 7.0

    return {
        "ratio": ratio,
        "aa": aa,
        "aaa": aaa,
        "ui_components": ratio >= 3.0  # WCAG 2.1 for UI components
    }


def main():
    """Main function for command-line usage."""
    if len(sys.argv) < 3:
        print("Usage: python check_contrast.py <foreground-hex> <background-hex> [text-size]")
        print("Example: python check_contrast.py #000000 #FFFFFF normal")
        print("Text size options: normal (default), large")
        sys.exit(1)

    fg_color = sys.argv[1]
    bg_color = sys.argv[2]
    text_size = sys.argv[3] if len(sys.argv) > 3 else "normal"

    ratio = contrast_ratio(fg_color, bg_color)
    compliance = check_wcag_compliance(ratio, text_size)

    print(f"\nContrast Ratio: {ratio:.2f}:1")
    print(f"Text Size: {text_size.capitalize()}")
    print(f"\nWCAG Compliance:")
    print(f"  Level AA: {'PASS' if compliance['aa'] else 'FAIL'}")
    print(f"  Level AAA: {'PASS' if compliance['aaa'] else 'FAIL'}")
    print(f"  UI Components (3:1): {'PASS' if compliance['ui_components'] else 'FAIL'}")

    # Provide recommendations
    if not compliance['aa']:
        print(f"\nWarning: Does not meet WCAG AA minimum requirements")
        if text_size == "normal":
            print(f"   Need at least 4.5:1 for normal text (currently {ratio:.2f}:1)")
        else:
            print(f"   Need at least 3:1 for large text (currently {ratio:.2f}:1)")


if __name__ == "__main__":
    main()
