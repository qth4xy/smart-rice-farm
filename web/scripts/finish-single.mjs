// Rename the single-file build to presentation.html (double-click to open, no server, no internet).
import { renameSync, statSync } from 'node:fs';
renameSync('dist-single/index.html', 'dist-single/presentation.html');
const kb = Math.round(statSync('dist-single/presentation.html').size / 1024);
console.log(`dist-single/presentation.html (${kb} KB)`);