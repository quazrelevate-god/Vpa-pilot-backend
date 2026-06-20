# Sample images for the live test runner

Drop a `.jpg`, `.jpeg`, `.png`, or `.webp` file into this folder and
the test runner (`tests/test_summarisation_live.py`) will automatically
pick up the first one it finds and run an **image + text** scenario
against it.

Good things to try
------------------
- A photo of a broken street light, pothole, or overflowing drain
- A scan/photo of a pension order or hospital bill
- A photograph of a damaged crop or flooded farm

The runner only asserts that `attachment_notes` is populated — the
model should describe what it sees in the image.

Files in this directory are gitignored except this README.
