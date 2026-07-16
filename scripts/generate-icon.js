const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
  if (!fs.existsSync(svgPath)) {
    console.error('Error: Source SVG not found at:', svgPath);
    app.quit();
    return;
  }

  const svgContent = fs.readFileSync(svgPath, 'utf8');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
        svg { width: 512px; height: 512px; }
      </style>
    </head>
    <body>
      ${svgContent}
    </body>
    </html>
  `;

  const tempHtmlPath = path.join(__dirname, 'temp-icon.html');
  fs.writeFileSync(tempHtmlPath, html, 'utf8');
  await win.loadFile(tempHtmlPath);
  
  // Wait a moment for rendering
  await new Promise(resolve => setTimeout(resolve, 500));

  const image = await win.capturePage();
  const pngBuffer = image.toPNG();
  
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.writeFileSync(iconPath, pngBuffer);
  console.log('Icon successfully generated at:', iconPath);

  fs.unlinkSync(tempHtmlPath);
  app.quit();
});
