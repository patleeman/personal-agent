#!/usr/bin/env python3
"""
Color Palette Scale Generator
Generates Tailwind-style color scales (50-950) from a base color.
Uses HSL color space for perceptually uniform shades and tints.
"""

import sys
import colorsys
from typing import Tuple, List


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    """Convert RGB tuple to hex color."""
    return '#{:02x}{:02x}{:02x}'.format(
        int(rgb[0]),
        int(rgb[1]),
        int(rgb[2])
    )


def rgb_to_hsl(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    """Convert RGB to HSL."""
    r, g, b = [x / 255.0 for x in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return (h * 360, s, l)


def hsl_to_rgb(hsl: Tuple[float, float, float]) -> Tuple[int, int, int]:
    """Convert HSL to RGB."""
    h, s, l = hsl
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))


def generate_scale(base_hex: str, base_level: int = 500) -> dict:
    """
    Generate a Tailwind-style color scale from a base color.

    Args:
        base_hex: Base color in hex format
        base_level: Which level the base color should be (default 500)

    Returns:
        Dictionary with levels 50-950 as keys and hex colors as values
    """
    rgb = hex_to_rgb(base_hex)
    h, s, l = rgb_to_hsl(rgb)

    # Define lightness values for each level
    # These are calibrated to match Tailwind's perceptual uniformity
    lightness_map = {
        50: 0.97,
        100: 0.94,
        200: 0.86,
        300: 0.77,
        400: 0.65,
        500: 0.50,
        600: 0.42,
        700: 0.34,
        800: 0.27,
        900: 0.23,
        950: 0.15
    }

    # Adjust base lightness if needed
    base_lightness = lightness_map[base_level]
    lightness_offset = l - base_lightness

    scale = {}
    for level, target_lightness in lightness_map.items():
        # Apply offset to maintain relative brightness
        adjusted_lightness = max(0, min(1, target_lightness + lightness_offset))

        # Slightly increase saturation for darker shades
        if level >= 600:
            saturation_boost = 1.0 + (level - 500) * 0.0003
            adjusted_saturation = min(1.0, s * saturation_boost)
        else:
            # Slightly decrease saturation for lighter tints
            saturation_reduction = 1.0 - (500 - level) * 0.0005
            adjusted_saturation = max(0, s * saturation_reduction)

        new_rgb = hsl_to_rgb((h, adjusted_saturation, adjusted_lightness))
        scale[level] = rgb_to_hex(new_rgb)

    return scale


def generate_complementary_palette(base_hex: str) -> dict:
    """Generate a palette with complementary accent color."""
    rgb = hex_to_rgb(base_hex)
    h, s, l = rgb_to_hsl(rgb)

    # Complementary color (opposite on color wheel)
    comp_h = (h + 180) % 360
    comp_rgb = hsl_to_rgb((comp_h, s, l))

    return {
        "primary": base_hex,
        "complementary": rgb_to_hex(comp_rgb)
    }


def generate_triadic_palette(base_hex: str) -> dict:
    """Generate a triadic color palette."""
    rgb = hex_to_rgb(base_hex)
    h, s, l = rgb_to_hsl(rgb)

    # Triadic colors (120 deg apart)
    h2 = (h + 120) % 360
    h3 = (h + 240) % 360

    rgb2 = hsl_to_rgb((h2, s, l))
    rgb3 = hsl_to_rgb((h3, s, l))

    return {
        "primary": base_hex,
        "secondary": rgb_to_hex(rgb2),
        "tertiary": rgb_to_hex(rgb3)
    }


def generate_analogous_palette(base_hex: str) -> dict:
    """Generate an analogous color palette."""
    rgb = hex_to_rgb(base_hex)
    h, s, l = rgb_to_hsl(rgb)

    # Analogous colors (30 deg on each side)
    h_left = (h - 30) % 360
    h_right = (h + 30) % 360

    rgb_left = hsl_to_rgb((h_left, s, l))
    rgb_right = hsl_to_rgb((h_right, s, l))

    return {
        "left": rgb_to_hex(rgb_left),
        "base": base_hex,
        "right": rgb_to_hex(rgb_right)
    }


def main():
    """Main function for command-line usage."""
    if len(sys.argv) < 2:
        print("Usage: python generate_palette.py <base-hex-color> [mode]")
        print("\nModes:")
        print("  scale        - Generate Tailwind-style 50-950 scale (default)")
        print("  complementary - Generate complementary palette")
        print("  triadic      - Generate triadic palette")
        print("  analogous    - Generate analogous palette")
        print("\nExample: python generate_palette.py #3B82F6 scale")
        sys.exit(1)

    base_color = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "scale"

    if mode == "scale":
        scale = generate_scale(base_color)
        print(f"\nColor Scale for {base_color}:")
        print("=" * 40)
        for level, hex_color in scale.items():
            print(f"  {level:>3}: {hex_color}")

    elif mode == "complementary":
        palette = generate_complementary_palette(base_color)
        print(f"\nComplementary Palette:")
        print("=" * 40)
        for name, color in palette.items():
            print(f"  {name:>15}: {color}")

    elif mode == "triadic":
        palette = generate_triadic_palette(base_color)
        print(f"\nTriadic Palette:")
        print("=" * 40)
        for name, color in palette.items():
            print(f"  {name:>15}: {color}")

    elif mode == "analogous":
        palette = generate_analogous_palette(base_color)
        print(f"\nAnalogous Palette:")
        print("=" * 40)
        for name, color in palette.items():
            print(f"  {name:>15}: {color}")

    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)


if __name__ == "__main__":
    main()
