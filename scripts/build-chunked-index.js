#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

console.log('🔄 Building chunked crossword indexes...');

// Ensure output directory exists
mkdirSync('chunked-indexes', { recursive: true });

// Decompress the TSV file if it doesn't exist
try {
    readFileSync('resources/clues.tsv');
    console.log('✓ TSV file already exists');
} catch (error) {
    console.log('📦 Decompressing TSV file...');
    execSync('xz -dc resources/clues.tsv.xv > resources/clues.tsv');
}

// Read and process the TSV data
console.log('📖 Reading TSV data...');
const tsvData = readFileSync('resources/clues.tsv', 'utf-8');
const lines = tsvData.split('\n');

// Data structures organized by length and first letter
const answersByLengthAndLetter = new Map(); // Map<length, Map<letter, {answer, count}[]>>
const cluesByAnswer = new Map(); // Map<answer, string[]>
let totalEntries = 0;

console.log('⚡ Processing entries...');

// Skip header line
for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [answer, clue] = line.split('\t');
    if (answer && clue) {
        const upperAnswer = answer.toUpperCase();
        const length = upperAnswer.length;
        const firstLetter = upperAnswer[0];

        // Skip very long answers (over 20 chars) to keep indexes manageable
        if (length > 20) continue;

        // Organize by length and first letter
        if (!answersByLengthAndLetter.has(length)) {
            answersByLengthAndLetter.set(length, new Map());
        }
        const lengthMap = answersByLengthAndLetter.get(length);

        if (!lengthMap.has(firstLetter)) {
            lengthMap.set(firstLetter, new Map());
        }
        const letterMap = lengthMap.get(firstLetter);

        // Count occurrences
        if (!letterMap.has(upperAnswer)) {
            letterMap.set(upperAnswer, 0);
        }
        letterMap.set(upperAnswer, letterMap.get(upperAnswer) + 1);

        // Store clues (limit to 10 per answer to save space)
        if (!cluesByAnswer.has(upperAnswer)) {
            cluesByAnswer.set(upperAnswer, []);
        }
        const clues = cluesByAnswer.get(upperAnswer);
        if (clues.length < 10) {
            clues.push(clue);
        }

        totalEntries++;
        if (totalEntries % 100000 === 0) {
            console.log(`  Processed ${totalEntries} entries...`);
        }
    }
}

console.log(`✅ Processed ${totalEntries} total entries`);

// Build chunked indexes
console.log('🔨 Building chunked indexes...');
let chunkCount = 0;
const chunkManifest = {};

for (const [length, lengthMap] of answersByLengthAndLetter.entries()) {
    chunkManifest[length] = {};

    for (const [letter, answerCounts] of lengthMap.entries()) {
        // Clean the letter for filename (replace invalid chars)
        const cleanLetter = letter.replace(/[^A-Z0-9]/g, '_');
        const chunkKey = `${length}_${cleanLetter}`;
        const answers = Array.from(answerCounts.entries())
            .map(([answer, count]) => ({ answer, count }))
            .sort((a, b) => b.count - a.count); // Sort by count descending

        // Create chunk with answers and their clues
        const chunk = {
            answers,
            clues: {}
        };

        // Add clues for answers in this chunk
        for (const { answer } of answers) {
            if (cluesByAnswer.has(answer)) {
                chunk.clues[answer] = cluesByAnswer.get(answer);
            }
        }

        // Write chunk file
        const fileName = `chunk_${chunkKey}.json`;
        writeFileSync(`chunked-indexes/${fileName}`, JSON.stringify(chunk));

        chunkManifest[length][cleanLetter] = fileName;
        chunkCount++;

        console.log(`  Created chunk ${chunkKey}: ${answers.length} answers`);
    }
}

// Write manifest
const manifest = {
    totalEntries,
    chunkCount,
    buildTime: new Date().toISOString(),
    chunks: chunkManifest
};
writeFileSync('chunked-indexes/manifest.json', JSON.stringify(manifest, null, 2));

console.log('📋 Chunked Index Statistics:');
console.log(`  📝 Total entries: ${totalEntries.toLocaleString()}`);
console.log(`  📦 Chunks created: ${chunkCount}`);
console.log(`  📄 Files created in chunked-indexes/`);

console.log('🎉 Chunked index build complete!'); 