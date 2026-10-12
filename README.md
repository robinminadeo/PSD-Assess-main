# PSD Assessment Practice

## Run locally

Install dependencies with `npm install`. Start a local MongoDB instance, then configure `.env` from `.env.example` with its connection URI and the desired database name. MongoDB creates the `psd_assessment` database and `question_results` collection when the API initializes its index.

Run `npm run api` in one terminal and `npm run dev` in another, then open the Vite URL printed in the terminal. The API listens on port 3001.

## Question results

The browser creates an anonymous user ID and retains it in local storage. Each practice answer is saved when checked. Quick-test outcomes, including unanswered questions as incorrect, are saved on submission. Records include the user ID, question ID, mode, correctness, and timestamp.

`GET /api/questions/priorities?userId=...` aggregates a user's attempts per question, including attempt and failure counts and the failure percentage (`failures / attempts * 100`). Practice and quick modes prioritize never-answered questions first, previously failed questions second, and correctly answered questions last. Within a tier, questions are sampled randomly, with higher failure rates weighted more heavily. Exams remain unchanged.

The API requires `MONGODB_URI`; without a reachable database it returns a service-unavailable response and the client falls back to random question selection. Keep `.env` private. The anonymous ID is browser-specific and can be reset by clearing local storage.