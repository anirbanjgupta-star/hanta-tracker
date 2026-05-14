import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env.local');
console.log('Loading from:', envPath);
const result = dotenv.config({ path: envPath });
console.log('Result:', result.parsed ? Object.keys(result.parsed) : 'No keys');
console.log('GOOGLE_SHEETS_PRIVATE_KEY exists:', !!process.env.GOOGLE_SHEETS_PRIVATE_KEY);
