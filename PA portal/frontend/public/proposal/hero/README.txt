Nam Kural — /proposal hero images (optional overrides)
======================================================

The hero's smart-classroom and Shore-Temple slides now load from Wikimedia
Commons by default (CC BY-SA 4.0), wired in src/app/proposal/_app/data.jsx
as IMG.smartclass / IMG.shore.

To use the OFFICE'S OWN photography instead, drop files here with these
names and repoint IMG.smartclass / IMG.shore at the local paths:

  public/proposal/hero/smart-class.jpg    ->  IMG.smartclass: '/proposal/hero/smart-class.jpg'
  public/proposal/hero/shore-temple.jpg   ->  IMG.shore:      '/proposal/hero/shore-temple.jpg'

Requirements: JPG, landscape, >= 1600px wide (the hero renders full-screen).
Replace with official Government of Tamil Nadu photography before public
deployment, per the footer disclaimer.
