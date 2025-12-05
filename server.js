const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const qrRoutes = require('./routes/qr');
const presenceRoutes = require('./routes/presence');
const matiereRoutes = require('./routes/matiere');
const db = require('./config/database');
const { authenticateToken, authorize } = require('./middleware/authMiddleware');

const app = express();

// Configuration CORS CORRIGÉE
const corsOptions = {
  origin: function (origin, callback) {
    // Liste des origines autorisées
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      process.env.CORS_ORIGIN
    ].filter(Boolean); // Retirer les valeurs undefined

    // En développement, autoriser toutes les origines localhost
    if (process.env.NODE_ENV !== 'production') {
      if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // En production, vérification stricte
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers',
    'Cookie',
    'Set-Cookie'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range', 'Set-Cookie'],
  optionsSuccessStatus: 200
};

// Appliquer CORS avant tout autre middleware
app.use(cors(corsOptions));

// Gérer les requêtes OPTIONS (pré-vol) explicitement
app.options('*', cors(corsOptions));

// Middleware pour détecter les requêtes dupliquées
const requestTracker = new Map();
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const requestKey = `${req.method}-${req.originalUrl}-${req.ip}`;
  const requestCount = requestTracker.get(requestKey) || 0;
  
  if (requestCount > 0) {
    console.log(`⚠️  REQUÊTE DUPLIQUÉE DÉTECTÉE: [${timestamp}] ${req.method} ${req.originalUrl} (${requestCount + 1}x)`);
  }
  
  requestTracker.set(requestKey, requestCount + 1);
  
  // Nettoyer après 1 seconde
  setTimeout(() => {
    requestTracker.delete(requestKey);
  }, 1000);
  
  next();
});

// Middleware pour logger les requêtes CORS
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  
  console.log(`🌍 CORS - [${timestamp}] ${req.method} ${req.originalUrl}`);
  console.log(`   Origin: ${req.headers.origin}`);
  console.log(`   Credentials: ${req.headers.cookie ? 'Yes' : 'No'}`);
  
  next();
});

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de logging des requêtes
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  
  // Vérification sécurisée du body
  let bodyLog = '';
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    bodyLog = JSON.stringify(req.body).substring(0, 200); // Limiter la longueur
  }
  
  console.log(`📥 [${timestamp}] ${req.method} ${req.originalUrl}`, bodyLog ? `Body: ${bodyLog}` : '');
  next();
});

// Route racine
app.get('/', (req, res) => {
  res.json({
    message: 'API Server is running! 🚀',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    cors: {
      origin: req.headers.origin || 'Not specified',
      credentials: true
    },
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      qr: '/api/qr',
      presence: '/api/presence',
      matiere: '/api/matiere',
    }
  });
});

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/matiere', matiereRoutes);

// Route de test
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    message: 'Serveur en ligne', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    cors: {
      origin: req.headers.origin,
      allowed: true
    }
  });
});

// Middleware de gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method
  });
});

// Middleware de gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error('❌ Erreur globale:', error);
  
  // Gestion spécifique des erreurs CORS
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({ 
      success: false,
      message: 'Accès interdit par la politique CORS',
      origin: req.headers.origin,
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000']
    });
  }
  
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ 
      success: false,
      message: 'JSON mal formé dans le corps de la requête'
    });
  }
  
  res.status(500).json({ 
    success: false,
    message: 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 CORS configuré pour: http://localhost:3000`);
  console.log(`🔐 Mode credentials: ACTIVÉ`);
  console.log(`🛡️  Détection des doublons: ACTIVÉE`);
  console.log('─────────────────────────────────────');
});

module.exports = app;