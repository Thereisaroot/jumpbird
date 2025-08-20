#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
from PIL import Image

# --- Tweak this value --- #
# Higher value means more pixels will be considered transparent and cropped.
# Start with a low value like 10 and increase if needed.
ALPHA_THRESHOLD = 10
# ---------------------- #

def autocrop_image_advanced(input_path, output_path, padding=5, threshold=ALPHA_THRESHOLD):
    """
    Crops the transparent background from an image using an alpha threshold.

    :param input_path: Path to the input image.
    :param output_path: Path to save the cropped image.
    :param padding: Pixels of padding to add around the content.
    :param threshold: Alpha value (0-255) below which pixels are considered transparent.
    """
    try:
        image = Image.open(input_path)
    except IOError:
        print(f"Error: Cannot open image file {input_path}")
        return

    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()

    min_x, min_y = width, height
    max_x, max_y = -1, -1

    # Find the bounding box by checking pixel alpha values
    for y in range(height):
        for x in range(width):
            # pixels[x, y] is a (R, G, B, A) tuple
            if pixels[x, y][3] > threshold:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

    # Check if any content was found
    if max_x == -1: # Or min_x == width, etc.
        print(f"Skipping image with no content above threshold: {input_path}")
        return

    # The box is a (left, upper, right, lower)-tuple.
    # We add 1 to max_x and max_y because crop works with exclusive upper bounds.
    bbox = (min_x, min_y, max_x + 1, max_y + 1)

    # Create the padded bounding box
    padded_bbox = (
        max(0, bbox[0] - padding),
        max(0, bbox[1] - padding),
        min(width, bbox[2] + padding),
        min(height, bbox[3] + padding)
    )

    cropped_image = image.crop(padded_bbox)
    cropped_image.save(output_path)
    print(f"Successfully cropped {input_path} -> {output_path}")

if __name__ == '__main__':
    input_directory = '.'
    output_directory = 'cropped_output_adv' # Save to a new directory

    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    print(f"Starting advanced crop with Alpha Threshold = {ALPHA_THRESHOLD}...")

    for filename in os.listdir(input_directory):
        if filename.lower().endswith('.png'):
            input_path = os.path.join(input_directory, filename)
            output_path = os.path.join(output_directory, filename)
            autocrop_image_advanced(input_path, output_path)

    print("\nAdvanced processing complete.")
