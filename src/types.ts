export interface CrosswordEntry {
    answer: string;
    clue: string;
}

export interface AnswerMatch {
    answer: string;
    count: number;
}

export interface CrosswordAnswersResponse {
    answers: AnswerMatch[];
}

export interface CrosswordCluesResponse {
    clues: string[];
} 