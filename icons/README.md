# Extension Icons

## Generate PNG Icons

The extension requires PNG icons in these sizes:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)  
- `icon128.png` (128x128 pixels)

### Option 1: Use the Browser Generator (Recommended)

1. Open `generate-icons.html` in any web browser
2. Click "Download All"
3. Save the downloaded files to this `icons/` folder

### Option 2: Use Node.js

1. Install the canvas module: `npm install canvas`
2. Run: `node create-icons.js`

### Option 3: Use Any Image Editor

1. Open `icon.svg` in an image editor (Figma, Illustrator, etc.)
2. Export as PNG in three sizes: 16x16, 48x48, 128x128
3. Save as `icon16.png`, `icon48.png`, `icon128.png`

## Icon Design

The icon features:
- Blue gradient background (#3b82f6 to #1d4ed8)
- White bar chart representing usage tracking
- Small clock indicator for time tracking
