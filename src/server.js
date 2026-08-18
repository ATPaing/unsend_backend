import env from './config/env.js';
import app from './app.js';

app.listen(env.port, '127.0.0.1', () => {
    console.log(`Server listening on http://127.0.0.1:${env.port}`);
  });