import 'dotenv/config';
import express from 'express';
import { MongoClient } from 'mongodb';

const app = express();
const port = Number(process.env.PORT || 3001);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE || 'psd_assessment';
const client = mongoUri ? new MongoClient(mongoUri) : null;
let results;

app.use(express.json({ limit: '16kb' }));

app.get('/api/health', (_request, response) => {
  response.status(results ? 200 : 503).json({ database: results ? 'connected' : 'unavailable' });
});

app.get('/api/questions/priorities', async (request, response, next) => {
  const { userId } = request.query;
  if (typeof userId !== 'string' || userId.length < 1 || userId.length > 100) {
    return response.status(400).json({ error: 'A valid userId is required.' });
  }
  if (!results) return response.status(503).json({ error: 'Question results database is unavailable.' });

  try {
    const priorities = await results.aggregate([
      { $match: { userId } },
      { $group: {
        _id: '$questionId',
        attempts: { $sum: 1 },
        failures: { $sum: { $cond: ['$correct', 0, 1] } },
      } },
      { $project: {
        _id: 0,
        questionId: '$_id',
        attempts: 1,
        failures: 1,
        successes: { $subtract: ['$attempts', '$failures'] },
        failurePercent: { $multiply: [{ $divide: ['$failures', '$attempts'] }, 100] },
      } },
      { $sort: { failures: -1, failurePercent: -1, attempts: -1, questionId: 1 } },
    ]).toArray();
    return response.json({ priorities });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/results', async (request, response, next) => {
  const { userId, questionId, mode, correct } = request.body || {};
  if (typeof userId !== 'string' || userId.length < 1 || userId.length > 100
    || !Number.isInteger(questionId) || questionId < 1
    || !['practice', 'quick'].includes(mode)
    || typeof correct !== 'boolean') {
    return response.status(400).json({ error: 'Invalid question result.' });
  }
  if (!results) return response.status(503).json({ error: 'Question results database is unavailable.' });

  try {
    await results.insertOne({ userId, questionId, mode, correct, answeredAt: new Date() });
    return response.status(201).json({ saved: true });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error('API request failed:', error);
  response.status(500).json({ error: 'The request could not be completed.' });
});

if (client) {
  try {
    await client.connect();
    const database = client.db(databaseName);
    results = database.collection('question_results');
    await results.createIndex({ userId: 1, questionId: 1, answeredAt: -1 });
    console.log(`Connected to MongoDB database "${databaseName}".`);
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exitCode = 1;
  }
} else {
  console.warn('MONGODB_URI is not set; result persistence is disabled.');
}

const server = app.listen(port, () => console.log(`Question results API listening on port ${port}.`));

async function shutdown() {
  server.close();
  if (client) await client.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);