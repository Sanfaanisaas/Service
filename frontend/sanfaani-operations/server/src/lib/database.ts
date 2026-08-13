import mongoose from 'mongoose';
import { env } from '../config/env.js';
export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { autoIndex: env.NODE_ENV !== 'production' });
  return mongoose.connection;
}
export async function disconnectDatabase() { await mongoose.disconnect(); }
