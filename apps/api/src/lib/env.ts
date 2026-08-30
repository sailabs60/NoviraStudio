import 'dotenv/config';
import path from 'node:path';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Empty string and unset are both "not configured" — never an error. */
function optional(name: string): string {
  return (process.env[name] ?? '').trim();
}

export const env = {
  port: Number(process.env.PORT ?? 4100),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: required('JWT_SECRET', 'novira-dev-secret'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5174'),
  publicBaseUrl: required('PUBLIC_BASE_URL', 'http://localhost:4100'),
  uploadDir: path.resolve(required('UPLOAD_DIR', './storage/uploads')),
  assetDir: path.resolve(required('ASSET_DIR', './storage/assets')),

  /**
   * Online asset pipeline credentials.
   *
   * Every provider key is optional by design: a provider without a key either
   * falls back to its public endpoint or sits out the aggregation. A missing
   * key narrows the catalogue; it is never a startup error.
   */
  providers: {
    sketchfabToken: optional('SKETCHFAB_API_TOKEN'),
    blenderKitToken: optional('BLENDERKIT_API_KEY'),
    polyPizzaToken: optional('POLYPIZZA_AUTH_TOKEN') || optional('POLYPIZZA_API_KEY'),
    pixabayKey: optional('PIXABAY_API_KEY'),
    pexelsKey: optional('PEXELS_API_KEY'),
    unsplashKey: optional('UNSPLASH_ACCESS_KEY'),
    smithsonianKey: optional('SMITHSONIAN_API_KEY'),
    thingiverseToken: optional('THINGIVERSE_ACCESS_TOKEN'),
    myMiniFactoryKey: optional('MYMINIFACTORY_API_KEY'),
    europeanaKey: optional('EUROPEANA_API_KEY'),
  },

  ai: {
    tripoApiKey: optional('TRIPO_API_KEY'),
    openaiApiKey: optional('OPENAI_API_KEY'),
    nanobananaApiKey: optional('NANOBANANA_API_KEY'),
  },

  cloudinary: {
    cloudName: optional('CLOUDINARY_CLOUD_NAME'),
    apiKey: optional('CLOUDINARY_API_KEY'),
    apiSecret: optional('CLOUDINARY_API_SECRET'),
  },

  maps: {
    googleKey: optional('GOOGLE_MAPS_API_KEY'),
  },

  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },
};

export const cloudinaryConfigured = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);
export const stripeConfigured = Boolean(env.stripe.secretKey);
export const mapsConfigured = Boolean(env.maps.googleKey);
