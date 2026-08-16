import env from './config/env.js';
import app from './app.js';

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});
