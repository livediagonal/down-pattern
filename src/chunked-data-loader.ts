import { AnswerMatch } from './types';

interface ChunkManifest {
    totalEntries: number;
    chunkCount: number;
    buildTime: string;
    chunks: Record<string, Record<string, string>>; // length -> letter -> filename
}

interface Chunk {
    answers: AnswerMatch[];
    clues: Record<string, string[]>;
}

export class ChunkedCrosswordLoader {
    private manifest: ChunkManifest | null = null;
    private chunkCache = new Map<string, Chunk>();

    constructor(private dataBucket: R2Bucket) { }

    private async loadManifest() {
        if (this.manifest) return;

        console.log('Loading chunk manifest from R2...');

        try {
            const manifestObj = await this.dataBucket.get('chunked-indexes/manifest.json');
            if (!manifestObj) {
                throw new Error('Chunk manifest not found in R2 bucket');
            }
            this.manifest = JSON.parse(await manifestObj.text());
            console.log(`Manifest loaded: ${this.manifest!.chunkCount} chunks available`);
        } catch (error) {
            console.error('Failed to load manifest from R2:', error);
            throw error;
        }
    }

    private async loadChunk(fileName: string): Promise<Chunk> {
        if (this.chunkCache.has(fileName)) {
            return this.chunkCache.get(fileName)!;
        }

        console.log(`Loading chunk: ${fileName}`);

        try {
            const chunkObj = await this.dataBucket.get(`chunked-indexes/${fileName}`);
            if (!chunkObj) {
                throw new Error(`Chunk ${fileName} not found in R2 bucket`);
            }

            const chunk: Chunk = JSON.parse(await chunkObj.text());
            this.chunkCache.set(fileName, chunk);

            // Keep cache size reasonable (max 10 chunks)
            if (this.chunkCache.size > 10) {
                const firstKey = this.chunkCache.keys().next().value;
                if (firstKey) {
                    this.chunkCache.delete(firstKey);
                }
            }

            return chunk;
        } catch (error) {
            console.error(`Failed to load chunk ${fileName}:`, error);
            throw error;
        }
    }

    private getRelevantChunks(pattern: string): string[] {
        if (!this.manifest) return [];

        const length = pattern.length;
        const chunks: string[] = [];

        // If pattern starts with a letter (not ?), we can be specific
        const firstChar = pattern[0];
        if (firstChar !== '?') {
            const lengthChunks = this.manifest.chunks[length];
            const cleanFirstChar = firstChar.replace(/[^A-Z0-9]/g, '_');
            if (lengthChunks && lengthChunks[cleanFirstChar]) {
                chunks.push(lengthChunks[cleanFirstChar]);
            }
        } else {
            // Pattern starts with ?, need to check all letters for this length
            const lengthChunks = this.manifest.chunks[length];
            if (lengthChunks) {
                chunks.push(...Object.values(lengthChunks));
            }
        }

        return chunks;
    }

    async findMatchingAnswers(pattern: string): Promise<AnswerMatch[]> {
        await this.loadManifest();

        const normalizedPattern = pattern.toUpperCase();
        const regex = new RegExp('^' + normalizedPattern.replace(/\?/g, '[A-Z]') + '$');

        const relevantChunks = this.getRelevantChunks(normalizedPattern);
        console.log(`Searching ${relevantChunks.length} relevant chunks for pattern: ${pattern}`);

        const results: AnswerMatch[] = [];

        for (const chunkFile of relevantChunks) {
            try {
                const chunk = await this.loadChunk(chunkFile);

                for (const answer of chunk.answers) {
                    if (regex.test(answer.answer)) {
                        results.push(answer);
                    }
                }
            } catch (error) {
                console.error(`Error processing chunk ${chunkFile}:`, error);
                // Continue with other chunks
            }
        }

        // Sort by count descending
        return results.sort((a, b) => b.count - a.count);
    }

    async getClues(answer: string, maxClues: number = 10): Promise<string[]> {
        await this.loadManifest();

        const normalizedAnswer = answer.toUpperCase();
        const length = normalizedAnswer.length;
        const firstLetter = normalizedAnswer[0];
        const cleanFirstLetter = firstLetter.replace(/[^A-Z0-9]/g, '_');

        // Find the specific chunk for this answer
        const lengthChunks = this.manifest?.chunks[length];
        if (!lengthChunks || !lengthChunks[cleanFirstLetter]) {
            return []; // No chunk found for this answer
        }

        try {
            const chunk = await this.loadChunk(lengthChunks[cleanFirstLetter]);
            const clues = chunk.clues[normalizedAnswer] || [];

            // Randomize and return up to maxClues
            const shuffled = [...clues].sort(() => Math.random() - 0.5);
            return shuffled.slice(0, maxClues);
        } catch (error) {
            console.error(`Error getting clues for ${answer}:`, error);
            return [];
        }
    }
} 