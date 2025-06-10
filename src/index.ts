import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ChunkedCrosswordLoader } from './chunked-data-loader';
import { CrosswordAnswersResponse, CrosswordCluesResponse } from './types';

type Bindings = {
    DATA_BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for all routes
app.use('*', cors());

// Initialize the crossword index
let crosswordIndex: ChunkedCrosswordLoader | null = null;

function getCrosswordIndex(dataBucket: R2Bucket): ChunkedCrosswordLoader {
    if (!crosswordIndex) {
        crosswordIndex = new ChunkedCrosswordLoader(dataBucket);
    }
    return crosswordIndex;
}

// Health check route
app.get('/', (c) => {
    return c.json({
        message: 'Down Pattern API is running',
        status: 'ok',
        optimizations: [
            'Result caching (5min TTL)',
            'Parallel chunk loading for wildcard patterns',
            'Smart search strategies based on pattern analysis',
            'Early stopping for expensive queries'
        ]
    });
});

// Get answers matching a pattern
app.get('/answers', async (c) => {
    const pattern = c.req.query('pattern') || '';
    const maxResults = parseInt(c.req.query('maxResults') || '50', 10);

    // Validate pattern contains only letters and question marks
    if (!pattern || !pattern.match(/^[A-Za-z?]+$/)) {
        return c.json<CrosswordAnswersResponse>({ answers: [] }, 400);
    }

    // Validate maxResults is reasonable
    if (maxResults < 1 || maxResults > 500) {
        return c.json<CrosswordAnswersResponse>({ answers: [] }, 400);
    }

    const startTime = Date.now();

    try {
        const index = getCrosswordIndex(c.env.DATA_BUCKET);
        const answers = await index.findMatchingAnswers(pattern, maxResults);
        const executionTime = Date.now() - startTime;

        // Add performance headers
        c.header('X-Execution-Time-Ms', executionTime.toString());
        c.header('X-Result-Count', answers.length.toString());
        c.header('X-Pattern-Type', pattern[0] === '?' ? 'wildcard' : 'literal');

        return c.json<CrosswordAnswersResponse>({ answers });
    } catch (error) {
        console.error('Error finding answers:', error);
        return c.json<CrosswordAnswersResponse>({ answers: [] }, 500);
    }
});

// Get clues for a specific answer
app.get('/clues', async (c) => {
    const answer = c.req.query('answer') || '';

    // Validate answer contains only letters
    if (!answer || !answer.match(/^[A-Za-z]+$/)) {
        return c.json<CrosswordCluesResponse>({ clues: [] }, 400);
    }

    try {
        const index = getCrosswordIndex(c.env.DATA_BUCKET);
        const clues = await index.getClues(answer, 10);
        return c.json<CrosswordCluesResponse>({ clues });
    } catch (error) {
        console.error('Error finding clues:', error);
        return c.json<CrosswordCluesResponse>({ clues: [] }, 500);
    }
});

// Debug endpoint to analyze pattern complexity without executing search
app.get('/debug/pattern', async (c) => {
    const pattern = c.req.query('pattern') || '';

    if (!pattern || !pattern.match(/^[A-Za-z?]+$/)) {
        return c.json({ error: 'Invalid pattern' }, 400);
    }

    try {
        const index = getCrosswordIndex(c.env.DATA_BUCKET);
        // Access the private method via casting (for debugging purposes)
        const analysis = (index as any).analyzePattern(pattern.toUpperCase());

        return c.json({
            pattern: pattern.toUpperCase(),
            analysis,
            tips: analysis.isHighCostPattern
                ? ['This pattern may be slow', 'Consider using fewer wildcards', 'Try limiting maxResults parameter']
                : ['This pattern should be fast', 'Direct chunk access available']
        });
    } catch (error) {
        console.error('Error analyzing pattern:', error);
        return c.json({ error: 'Analysis failed' }, 500);
    }
});

export default app; 