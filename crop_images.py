#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
from PIL import Image

def autocrop_image(input_path, output_path, padding=5):
    """
    Crops the transparent background from an image, adds padding, and saves it.

    :param input_path: Path to the input image.
    :param output_path: Path to save the cropped image.
    :param padding: Pixels of padding to add around the content.
    """
    try:
        image = Image.open(input_path)
    except IOError:
        print(f"Error: Cannot open image file {input_path}")
        return

    # Convert to RGBA to ensure there is an alpha channel
    image = image.convert("RGBA")

    # Get the bounding box of the non-transparent parts of the image
    bbox = image.getbbox()

    if not bbox:
        print(f"Skipping fully transparent image: {input_path}")
        return

    # Create the padded bounding box
    # The box is a (left, upper, right, lower)-tuple.
    left, upper, right, lower = bbox
    padded_bbox = (
        max(0, left - padding),
        max(0, upper - padding),
        min(image.width, right + padding),
        min(image.height, lower + padding)
    )

    # Crop the image to the padded bounding box
    cropped_image = image.crop(padded_bbox)

    # Save the cropped image
    cropped_image.save(output_path)
    print(f"Successfully cropped {input_path} -> {output_path}")

if __name__ == '__main__':
    # Define input and output directories
    input_directory = '.' # Current directory
    output_directory = 'cropped_output'

    # Create the output directory if it doesn't exist
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    # Process all PNG files in the input directory
    for filename in os.listdir(input_directory):
        if filename.lower().endswith('.png'):
            input_path = os.path.join(input_directory, filename)
            output_path = os.path.join(output_directory, filename)
            autocrop_image(input_path, output_path)

    print("\nProcessing complete.")
