import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import env from './config/env.js';
import { JSON_BODY_LIMIT } from './config/journalLimits.js';
import routes from './routes/index.js';
import attachServerNow from './middleware/attachServerNow.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(cookieParser());
app.use(attachServerNow);

app.use(routes);

app.use(notFound);
app.use(errorHandler);

export default app;
