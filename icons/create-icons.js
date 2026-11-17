/**
 * Icon Generator Script
 * 
 * Run this with Node.js to generate the PNG icons:
 *   node create-icons.js
 * 
 * Or simply open generate-icons.html in a browser and download the icons.
 */

const fs = require('fs');
const { createCanvas } = require('canvas');

const sizes = [16, 48, 128];

function drawIcon(ctx, size) {
  const scale = size / 128;
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#3b82f6');
  gradient.addColorStop(1, '#1d4ed8');
  
  // Background with rounded corners
  ctx.fillStyle = gradient;
  roundRect(ctx, 0, 0, size, size, 24 * scale);
  ctx.fill();
  
  // Chart bars
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  
  roundRect(ctx, 24 * scale, 70 * scale, 16 * scale, 34 * scale, 4 * scale);
  ctx.fill();
  
  roundRect(ctx, 48 * scale, 50 * scale, 16 * scale, 54 * scale, 4 * scale);
  ctx.fill();
  
  roundRect(ctx, 72 * scale, 36 * scale, 16 * scale, 68 * scale, 4 * scale);
  ctx.fill();
  
  roundRect(ctx, 96 * scale, 56 * scale, 16 * scale, 48 * scale, 4 * scale);
  ctx.fill();
  
  // Clock circle
  ctx.beginPath();
  ctx.arc(100 * scale, 32 * scale, 16 * scale, 0, Math.PI * 2);
  ctx.fill();
  
  // Clock hands
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  ctx.moveTo(100 * scale, 32 * scale);
  ctx.lineTo(100 * scale, 24 * scale);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(100 * scale, 32 * scale);
  ctx.lineTo(108 * scale, 32 * scale);
  ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// Check if canvas module is available
try {
  sizes.forEach(size => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    drawIcon(ctx, size);
    
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(`icon${size}.png`, buffer);
    console.log(`Created icon${size}.png`);
  });
  
  console.log('\\nAll icons created successfully!');
} catch (e) {
  console.log('Canvas module not available. Please use one of these alternatives:\\n');
  console.log('Option 1: Install canvas module');
  console.log('  npm install canvas');
  console.log('  node create-icons.js\\n');
  console.log('Option 2: Open generate-icons.html in a browser');
  console.log('  and click "Download All" to save the PNG files.\\n');
}
