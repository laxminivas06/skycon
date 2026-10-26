import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const frontendDist = path.join(rootDir, 'frontend', 'dist');
const rootDist = path.join(rootDir, 'dist');

if (fs.existsSync(frontendDist)) {
  if (!fs.existsSync(rootDist)) {
    fs.mkdirSync(rootDist, { recursive: true });
  }
  fs.cpSync(frontendDist, rootDist, { recursive: true, force: true });
  console.log(`[SYNC-DIST] Successfully synced ${frontendDist} -> ${rootDist}`);
} else {
  console.warn(`[SYNC-DIST] Source ${frontendDist} does not exist yet.`);
}
