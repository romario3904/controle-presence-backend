const express = require('express');
const { login, register, getProfile, logout, refreshToken, getEnseignantProfile } = require('../controllers/authController');
const { authenticateToken, authorize, optionalAuth } = require('../middleware/authMiddleware');
const db = require('../config/database');

const router = express.Router();

// Routes publiques
router.post('/login', login);
router.post('/register', register);

// Routes protégées
router.post('/logout', authenticateToken, logout);
router.post('/refresh-token', refreshToken);
router.get('/profile', authenticateToken, getProfile);
router.get('/enseignant-profile', authenticateToken, authorize('enseignant'), getEnseignantProfile);
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token valide',
    user: req.user
  });
});

// Route de test publique
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'Auth routes are working',
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'POST /api/auth/login',
      'POST /api/auth/register', 
      'POST /api/auth/logout',
      'POST /api/auth/refresh-token',
      'GET /api/auth/profile',
      'GET /api/auth/enseignant-profile',
      'GET /api/auth/verify',
      'GET /api/auth/status'
    ]
  });
});
// Dans votre backend (ex: routes/auth.js)
router.post('/auth/login', async (req, res) => {
  try {
    const { matricule, mot_de_passe } = req.body;
    // Logique d'authentification
    res.json({ user: userData, token: 'votre-token' });
  } catch (error) {
    res.status(400).json({ message: 'Erreur de connexion' });
  }
});
// Fonction pour récupérer le profil enseignant
router.get('/enseignant-profile', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    console.log('🔍 Récupération du profil enseignant pour:', req.user.id);
    
    const [enseignants] = await db.execute(
      'SELECT id_enseignant, nom, prenom, email, telephone FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    res.json({
      success: true,
      enseignant: enseignants[0]
    });

  } catch (error) {
    console.error('❌ Erreur récupération profil enseignant:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil enseignant'
    });
  }
});

module.exports = router;