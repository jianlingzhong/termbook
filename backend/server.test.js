const request = require('supertest');

// Mock uuid before requiring server
jest.mock('uuid', () => ({
  v4: () => 'test-uuid'
}));

const { app } = require('./server');

describe('Backend API', () => {
  test('GET /api/config returns app config', async () => {
    const response = await request(app).get('/api/config');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('appName');
  });

  test('GET /api/history returns history array', async () => {
    const response = await request(app).get('/api/history');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('history');
  });

  test('GET /api/sessions returns sessions list', async () => {
    const response = await request(app).get('/api/sessions');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('sessions');
  });
});
