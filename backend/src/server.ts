import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { initializeModels } from './services/auth.service.js';

async function start() {

  const port = Number(process.env.PORT ?? 8080);

  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');

  const app = createApp();

  await connectDB();

  await initializeModels();

  const server = app.listen(port, '127.0.0.1', 
    
    () => console.log(`Development API: http://127.0.0.1:${port}; FAKE OTP enabled`

    ));
  
  server.on('error', () => { console.error('Unable to listen on configured port'); process.exit(1); });
  
  const stop = () => {
    const timeout = setTimeout(() => process.exit(1), 10_000); timeout.unref();
    server.close(() => { void mongoose.disconnect().then(() => process.exit(0)); });
  };

  process.once('SIGTERM', stop); process.once('SIGINT', stop);

}

start().catch(error => { console.error('Startup failed. Check configuration and Atlas access.', error.name); process.exit(1); });
