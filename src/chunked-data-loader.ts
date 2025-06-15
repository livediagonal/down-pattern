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

interface CachedResult {
    results: AnswerMatch[];
    timestamp: number;
}

export class ChunkedCrosswordLoader {
    private manifest: ChunkManifest | null = null;
    private chunkCache = new Map<string, Chunk>();
    private resultCache = new Map<string, CachedResult>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_RESULT_CACHE_SIZE = 100;

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

    private async loadChunksParallel(chunkFiles: string[]): Promise<Chunk[]> {
        const chunkPromises = chunkFiles.map(fileName => this.loadChunk(fileName));
        const chunks = await Promise.allSettled(chunkPromises);

        return chunks
            .filter((result): result is PromiseFulfilledResult<Chunk> => result.status === 'fulfilled')
            .map(result => result.value);
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

    private analyzePattern(pattern: string): {
        wildcardCount: number;
        wildcardPositions: number[];
        startsWithWildcard: boolean;
        isHighCostPattern: boolean;
        searchStrategy: 'direct' | 'parallel-optimized';
    } {
        const wildcardPositions = [];
        let wildcardCount = 0;

        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] === '?') {
                wildcardPositions.push(i);
                wildcardCount++;
            }
        }

        const startsWithWildcard = pattern[0] === '?';
        const wildcardRatio = wildcardCount / pattern.length;

        // High cost patterns are those with many wildcards, especially starting with wildcards
        const isHighCostPattern = startsWithWildcard && (wildcardCount > 3 || wildcardRatio > 0.6);

        const searchStrategy = startsWithWildcard ? 'parallel-optimized' : 'direct';

        return {
            wildcardCount,
            wildcardPositions,
            startsWithWildcard,
            isHighCostPattern,
            searchStrategy
        };
    }

    private getCacheKey(pattern: string): string {
        return `pattern:${pattern.toUpperCase()}`;
    }

    private getCachedResult(pattern: string): AnswerMatch[] | null {
        const cacheKey = this.getCacheKey(pattern);
        const cached = this.resultCache.get(cacheKey);

        if (!cached) return null;

        // Check if cache is still valid
        if (Date.now() - cached.timestamp > this.CACHE_TTL) {
            this.resultCache.delete(cacheKey);
            return null;
        }

        return cached.results;
    }

    private setCachedResult(pattern: string, results: AnswerMatch[]): void {
        const cacheKey = this.getCacheKey(pattern);

        // Keep cache size reasonable
        if (this.resultCache.size >= this.MAX_RESULT_CACHE_SIZE) {
            // Remove oldest entries (simple FIFO approach)
            const oldestKey = this.resultCache.keys().next().value;
            if (oldestKey) {
                this.resultCache.delete(oldestKey);
            }
        }

        this.resultCache.set(cacheKey, {
            results: [...results], // Deep copy to avoid mutations
            timestamp: Date.now()
        });
    }

    async findMatchingAnswers(pattern: string, maxResults: number = 100): Promise<AnswerMatch[]> {
        await this.loadManifest();

        const normalizedPattern = pattern.toUpperCase();

        // Check cache first
        const cachedResult = this.getCachedResult(normalizedPattern);
        if (cachedResult) {
            console.log(`Cache hit for pattern: ${pattern}`);
            return cachedResult.slice(0, maxResults);
        }

        // Analyze pattern for optimization strategy
        const patternAnalysis = this.analyzePattern(normalizedPattern);
        const regex = new RegExp('^' + normalizedPattern.replace(/\?/g, '[A-Z]') + '$');
        const relevantChunks = this.getRelevantChunks(normalizedPattern);

        console.log(`Searching ${relevantChunks.length} relevant chunks for pattern: ${pattern} (strategy: ${patternAnalysis.searchStrategy})`);

        const results: AnswerMatch[] = [];

        switch (patternAnalysis.searchStrategy) {
            case 'direct':
                // Fast path for patterns with known first letter
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
                    }
                }
                break;

            case 'parallel-optimized':
                // Optimized parallel search for wildcard patterns
                console.log(`Using parallel optimization for pattern: ${pattern}`);
                const chunks = await this.loadChunksParallel(relevantChunks);

                for (const chunk of chunks) {
                    for (const answer of chunk.answers) {
                        if (regex.test(answer.answer)) {
                            results.push(answer);

                            // Early stopping when we have enough good results
                            if (results.length >= maxResults * 2) {
                                break;
                            }
                        }
                    }

                    // Stop processing more chunks if we have enough results
                    if (results.length >= maxResults * 2) {
                        console.log(`Early stopping: Found ${results.length} results`);
                        break;
                    }
                }
                break;
        }

        // Sort by count descending and limit results
        const sortedResults = results.sort((a, b) => b.count - a.count).slice(0, maxResults);

        // Cache the result
        this.setCachedResult(normalizedPattern, sortedResults);

        return sortedResults;
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

            // Deduplicate clues first
            const uniqueClues = [...new Set(clues)];

            // Properly shuffle using Fisher-Yates algorithm
            const shuffled = [...uniqueClues];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled.slice(0, maxClues);
        } catch (error) {
            console.error(`Error getting clues for ${answer}:`, error);
            return [];
        }
    }
} 