
// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false,
      message: 'Token d\'accès requis' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise', async (err, user) => {
    if (err) {
      console.error('❌ Erreur de vérification du token:', err.message);
      
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false,
          message: 'Token expiré' 
        });
      }
      
      if (err.name === 'JsonWebTokenError') {
        return res.status(403).json({ 
          success: false,
          message: 'Token invalide' 
        });
      }
      
      return res.status(403).json({ 
        success: false,
        message: 'Erreur d\'authentification' 
      });
    }
    
    req.user = user;
    console.log('✅ Token valide pour l\'utilisateur:', user.id);
    
    try {
      // Charger le profil (id_enseignant ou id_etudiant) depuis la base de données
      const userType = req.user.type_utilisateur;
      req.user.profil = {};

      if (userType === 'enseignant') {
        const [enseignants] = await db.execute(
          'SELECT id_enseignant, niveaux_enseignes, mention_enseignee, parcours_enseignes FROM enseignants WHERE id_utilisateur = ?',
          [user.id]
        );
        if (enseignants.length > 0) {
          // Convertir les chaînes en tableaux
          const niveauxArray = enseignants[0].niveaux_enseignes ? enseignants[0].niveaux_enseignes.split(',') : [];
          const parcoursArray = enseignants[0].parcours_enseignes ? enseignants[0].parcours_enseignes.split(',') : [];
          
          req.user.profil.id_enseignant = enseignants[0].id_enseignant;
          req.user.profil.niveaux_enseignes = niveauxArray;
          req.user.profil.mention_enseignee = enseignants[0].mention_enseignee;
          req.user.profil.parcours_enseignes = parcoursArray;
        }
      } else if (userType === 'etudiant') {
        const [etudiants] = await db.execute(
          'SELECT id_etudiant, niveau, mention, parcours FROM etudiants WHERE id_utilisateur = ?',
          [user.id]
        );
        if (etudiants.length > 0) {
          req.user.profil.id_etudiant = etudiants[0].id_etudiant;
          req.user.profil.niveau = etudiants[0].niveau;
          req.user.profil.mention = etudiants[0].mention;
          req.user.profil.parcours = etudiants[0].parcours;
        }
      }

      console.log(`✅ Profil chargé:`, req.user.profil);
      next();
    } catch (profileError) {
      console.error('Erreur chargement profil:', profileError);
      // Continuer même en cas d'erreur de profil
      req.user.profil = {};
      next();
    }
  });
};

const authorize = (...allowedTypes) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Utilisateur non authentifié' 
      });
    }

    if (!allowedTypes.includes(req.user.type_utilisateur)) {
      console.log(`❌ Accès refusé: ${req.user.type_utilisateur} n'est pas autorisé`);
      return res.status(403).json({ 
        success: false,
        message: 'Accès non autorisé pour votre type d\'utilisateur',
        requiredTypes: allowedTypes,
        userType: req.user.type_utilisateur
      });
    }

    console.log(`✅ Accès autorisé pour: ${req.user.type_utilisateur}`);
    next();
  };
};

// Middleware optionnel pour l'authentification facultative
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise', async (err, user) => {
      if (!err) {
        req.user = user;
        
        try {
          // Charger le profil pour l'auth optionnelle aussi
          const userType = req.user.type_utilisateur;
          req.user.profil = {};

          if (userType === 'enseignant') {
            const [enseignants] = await db.execute(
              'SELECT id_enseignant, niveaux_enseignes, mention_enseignee, parcours_enseignes FROM enseignants WHERE id_utilisateur = ?',
              [user.id]
            );
            if (enseignants.length > 0) {
              const niveauxArray = enseignants[0].niveaux_enseignes ? enseignants[0].niveaux_enseignes.split(',') : [];
              const parcoursArray = enseignants[0].parcours_enseignes ? enseignants[0].parcours_enseignes.split(',') : [];
              
              req.user.profil.id_enseignant = enseignants[0].id_enseignant;
              req.user.profil.niveaux_enseignes = niveauxArray;
              req.user.profil.mention_enseignee = enseignants[0].mention_enseignee;
              req.user.profil.parcours_enseignes = parcoursArray;
            }
          } else if (userType === 'etudiant') {
            const [etudiants] = await db.execute(
              'SELECT id_etudiant, niveau, mention, parcours FROM etudiants WHERE id_utilisateur = ?',
              [user.id]
            );
            if (etudiants.length > 0) {
              req.user.profil.id_etudiant = etudiants[0].id_etudiant;
              req.user.profil.niveau = etudiants[0].niveau;
              req.user.profil.mention = etudiants[0].mention;
              req.user.profil.parcours = etudiants[0].parcours;
            }
          }
        } catch (profileError) {
          console.error('Erreur chargement profil (auth optionnelle):', profileError);
          req.user.profil = {};
        }
      }
      next();
    });
  } else {
    next();
  }
};

// Middleware pour vérifier la présence du profil chargé
const requireProfile = (req, res, next) => {
  if (!req.user || !req.user.profil) {
    return res.status(403).json({
      success: false,
      message: 'Profil utilisateur non chargé'
    });
  }

  const userType = req.user.type_utilisateur;
  
  if (userType === 'enseignant' && !req.user.profil.id_enseignant) {
    return res.status(403).json({
      success: false,
      message: 'Profil enseignant non trouvé'
    });
  }

  if (userType === 'etudiant' && !req.user.profil.id_etudiant) {
    return res.status(403).json({
      success: false,
      message: 'Profil étudiant non trouvé'
    });
  }

  next();
};

module.exports = { 
  authenticateToken, 
  authorize, 
  optionalAuth,
  requireProfile
};
