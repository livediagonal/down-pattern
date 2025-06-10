# Down Pattern

A high-performance crossword clue and answer lookup service built with Cloudflare Workers and Hono.

## Overview

Down Pattern (AKA "across-word") provides fast crossword answer pattern matching and clue lookup. It uses a chunked indexing strategy to efficiently serve crossword data from Cloudflare R2 storage.

## Features

- **Pattern Matching**: Find crossword answers matching a pattern (e.g., `A?PLE` finds `APPLE`)
- **Clue Lookup**: Get clues for specific crossword answers
- **High Performance**: Chunked indexes for fast lookups without loading entire datasets
- **Scalable**: Built on Cloudflare Workers with R2 storage

## API Endpoints

### `GET /answers?pattern={pattern}`

Find answers matching a crossword pattern.

- **Pattern format**: Use `?` for unknown letters (e.g., `A?PLE`, `??T`, `HELLO????`)
- **Returns**: Array of matching answers with occurrence counts

Example:
```bash
curl "https://your-worker.your-subdomain.workers.dev/answers?pattern=A?PLE"
```

### `GET /clues?answer={answer}`

Get clues for a specific crossword answer.

- **Answer**: The crossword answer to find clues for
- **Returns**: Array of clues (up to 10 random clues)

Example:
```bash
curl "https://your-worker.your-subdomain.workers.dev/clues?answer=APPLE"
```

## Data Architecture

The service uses a **chunked indexing strategy**:

1. **Source Data**: Large TSV file with crossword answer-clue pairs
2. **Chunked Processing**: Data is split into manageable chunks based on answer patterns
3. **R2 Storage**: Chunks are uploaded to Cloudflare R2 for fast retrieval
4. **Dynamic Loading**: Only relevant chunks are loaded for each query

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account with R2 enabled

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd down-pattern
```

2. Install dependencies:
```bash
npm install
```

3. Set up your crossword data:
   - Place your compressed TSV file at `resources/clues.tsv.xv`
   - The file should contain tab-separated answer-clue pairs

### Building and Deploying

1. **Build chunked indexes**:
```bash
npm run build-chunks
```

2. **Upload chunks to R2**:
```bash
npm run upload-chunks
```

3. **Deploy to Cloudflare Workers**:
```bash
npm run deploy
```

### Development Commands

- `npm run dev` - Start local development server
- `npm run build` - Build the Worker
- `npm run build-chunks` - Build chunked indexes from source data
- `npm run upload-chunks` - Build and upload chunks to R2
- `npm run deploy` - Deploy to Cloudflare Workers

## Configuration

Configure your Cloudflare R2 bucket in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "your-bucket-name"
```

## File Structure

```
├── src/
│   ├── index.ts                 # Main Worker application
│   ├── chunked-data-loader.ts   # Chunked data loading logic
│   └── types.ts                 # TypeScript type definitions
├── scripts/
│   ├── build-chunked-index.js   # Build chunked indexes
│   └── upload-chunks.js         # Upload chunks to R2
├── resources/
│   └── clues.tsv.xv            # Compressed source data
└── chunked-indexes/            # Generated chunk files (gitignored)
```

## Performance

- **Cold start**: ~100-200ms (loads only needed chunks)
- **Warm requests**: ~10-50ms 
- **Memory usage**: Low (chunks loaded on-demand)
- **Storage**: Efficient chunked storage in R2

## License

MIT
