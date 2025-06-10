#!/usr/bin/env node

import { readdirSync } from 'fs';
import { execSync } from 'child_process';

console.log('📤 Uploading chunked indexes to R2...');

try {
    const files = readdirSync('chunked-indexes');
    console.log(`Found ${files.length} files to upload`);

    let uploadedCount = 0;

    for (const file of files) {
        if (file.endsWith('.json')) {
            console.log(`  Uploading ${file}...`);
            try {
                execSync(`npx wrangler r2 object put miniword/chunked-indexes/${file} --file chunked-indexes/${file}`, { stdio: 'pipe' });
                uploadedCount++;
            } catch (error) {
                console.error(`    Failed to upload ${file}:`, error.message);
            }
        }
    }

    console.log(`✅ Successfully uploaded ${uploadedCount} chunk files`);

} catch (error) {
    console.error('❌ Upload failed:', error.message);
    process.exit(1);
} 