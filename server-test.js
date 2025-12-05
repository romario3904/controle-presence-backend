const express = require('express');
const app = express();
const PORT = 3001;

// Middlewares basiques uniquement
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route simple de test
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    message: 'Serveur de test fonctionnel',
    expressVersion: '4.21.1'
  });
});

// Route racine
app.get('/', (req, res) => {
  res.json({ 
    message: 'API Test - Contrôle de Présence',
    endpoint: '/api/health'
  });
});

// Démarrage
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🧪 Serveur de Test Express');
  console.log('='.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 URL: http://localhost:${PORT}/api/health`);
  console.log(`🔧 Express: 4.21.1`);
  console.log('='.repeat(50));
});