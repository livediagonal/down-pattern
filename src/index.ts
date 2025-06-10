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
    return c.json({ message: 'Down Pattern API is running', status: 'ok' });
});

// Get answers matching a pattern
app.get('/answers', async (c) => {
    const pattern = c.req.query('pattern') || '';

    // Validate pattern contains only letters and question marks
    if (!pattern || !pattern.match(/^[A-Za-z?]+$/)) {
        return c.json<CrosswordAnswersResponse>({ answers: [] }, 400);
    }

    try {
        const index = getCrosswordIndex(c.env.DATA_BUCKET);
        const answers = await index.findMatchingAnswers(pattern);
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

export default app; 