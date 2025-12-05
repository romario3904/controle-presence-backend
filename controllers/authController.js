const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const sanitizeLoginPayload = (payload = {}) => ({
  matricule: typeof payload.matricule === 'string' ? payload.matricule.trim() : '',
  mot_de_passe: typeof payload.mot_de_passe === 'string' ? payload.mot_de_passe.trim() : ''
});

const validateLoginPayload = (payload) => {
  const errors = {};

  if (!payload.matricule) {
    errors.matricule = 'Le matricule est requis';
  } else if (payload.matricule.length < 3) {
    errors.matricule = 'Le matricule doit contenir au moins 3 caractères';
  }

  if (!payload.mot_de_passe) {
    errors.mot_de_passe = 'Le mot de passe est requis';
  } else if (payload.mot_de_passe.length < 6) {
    errors.mot_de_passe = 'Le mot de passe doit contenir au moins 6 caractères';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

const handleLoginServerError = (res, error) => {
  console.error('❌ Erreur de connexion:', error);

  const transientErrors = ['ECONNREFUSED', 'ER_HOST_NOT_PRIVILEGED', 'PROTOCOL_CONNECTION_LOST'];
  if (transientErrors.includes(error.code)) {
    return res.status(503).json({
      success: false,
      message: 'Service indisponible. Veuillez réessayer plus tard.'
    });
  }

  return res.status(500).json({
    success: false,
    message: 'Erreur serveur lors de la connexion: ' + (error.message || 'Inconnue')
  });
};

// Controller pour l'inscription
const register = async (req, res) => {
  console.log('📨 Requête d\'inscription reçue:', req.body);
  
  try {
    const { 
      nom, 
      prenom, 
      email, 
      matricule, 
      mot_de_passe, 
      role, 
      niveau, 
      mention, 
      parcours,
      niveaux_enseignes,
      mention_enseignee,
      parcours_enseignes 
    } = req.body;

    // Validation des données obligatoires
    if (!nom || !prenom || !email || !matricule || !mot_de_passe || !role) {
      console.log('❌ Champs obligatoires manquants');
      return res.status(400).json({
        success: false,
        message: 'Tous les champs obligatoires sont requis'
      });
    }

    // Validation spécifique selon le rôle
    if (role === 'etudiant') {
      if (!niveau || !mention || !parcours) {
        return res.status(400).json({
          success: false,
          message: 'Pour un étudiant, les champs niveau, mention et parcours sont requis'
        });
      }
      
      // Validation des combinaisons mention/parcours selon l'ENI
      const parcoursValides = {
        'Informatique': ['GB', 'IG', 'ASR'],
        'Intelligence Artificielle': ['GID', 'OCC'],
        'Expertise Digitale': ['MDI', 'ASI']
      };
      
      if (!parcoursValides[mention] || !parcoursValides[mention].includes(parcours)) {
        return res.status(400).json({
          success: false,
          message: `Combinaison invalide. Pour la mention "${mention}", les parcours valides sont: ${parcoursValides[mention]?.join(', ') || 'aucun'}`
        });
      }
      
    } else if (role === 'enseignant') {
      if (!niveaux_enseignes || !Array.isArray(niveaux_enseignes) || niveaux_enseignes.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Pour un enseignant, veuillez sélectionner au moins un niveau enseigné'
        });
      }
      
      if (!mention_enseignee) {
        return res.status(400).json({
          success: false,
          message: 'Pour un enseignant, la mention enseignée est requise'
        });
      }
      
      if (!parcours_enseignes || !Array.isArray(parcours_enseignes) || parcours_enseignes.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Pour un enseignant, veuillez sélectionner au moins un parcours enseigné'
        });
      }
      
      // Validation des combinaisons mention/parcours selon l'ENI
      const parcoursValides = {
        'Informatique': ['GB', 'IG', 'ASR'],
        'Intelligence Artificielle': ['GID', 'OCC'],
        'Expertise Digitale': ['MDI', 'ASI']
      };
      
      const parcoursInvalides = parcours_enseignes.filter(p => 
        !parcoursValides[mention_enseignee]?.includes(p)
      );
      
      if (parcoursInvalides.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Parcours invalides pour la mention "${mention_enseignee}": ${parcoursInvalides.join(', ')}. Parcours valides: ${parcoursValides[mention_enseignee]?.join(', ') || 'aucun'}`
        });
      }
    }

    // Validation de l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Format d\'email invalide'
      });
    }

    // Validation du mot de passe
    if (mot_de_passe.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères'
      });
    }

    // Validation du rôle
    const rolesValides = ['enseignant', 'etudiant', 'admin'];
    if (!rolesValides.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Rôle invalide. Les rôles valides sont: enseignant, etudiant, admin'
      });
    }

    // Vérifier si l'utilisateur existe déjà
    const checkUserQuery = 'SELECT * FROM utilisateurs WHERE email = ? OR matricule = ?';
    const [existingUsers] = await db.execute(checkUserQuery, [email, matricule]);

    console.log('🔍 Utilisateurs existants:', existingUsers);

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      if (existingUser.email === email) {
        return res.status(400).json({
          success: false,
          message: 'Un utilisateur avec cet email existe déjà'
        });
      }
      if (existingUser.matricule === matricule) {
        return res.status(400).json({
          success: false,
          message: 'Un utilisateur avec ce matricule existe déjà'
        });
      }
    }

    // Hasher le mot de passe
    console.log('🔐 Hashage du mot de passe...');
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
    console.log('✅ Mot de passe hashé');

    // Insérer le nouvel utilisateur
    const insertQuery = `
      INSERT INTO utilisateurs (nom, prenom, email, matricule, mot_de_passe, type_utilisateur, statut) 
      VALUES (?, ?, ?, ?, ?, ?, 'actif')
    `;

    const insertParams = [nom, prenom, email, matricule, hashedPassword, role];

    console.log('🚀 Exécution de la requête d\'insertion');
    const [result] = await db.execute(insertQuery, insertParams);
    
    console.log('✅ Utilisateur créé, ID:', result.insertId);

    // Créer automatiquement le profil (enseignant ou étudiant)
    if (role === 'enseignant') {
      try {
        // Convertir les tableaux en chaînes séparées par des virgules pour la base de données
        const niveauxStr = Array.isArray(niveaux_enseignes) ? niveaux_enseignes.join(',') : niveaux_enseignes;
        const parcoursStr = Array.isArray(parcours_enseignes) ? parcours_enseignes.join(',') : parcours_enseignes;
        
        const [enseignantResult] = await db.execute(
          'INSERT INTO enseignants (matricule, nom, prenom, id_utilisateur, niveaux_enseignes, mention_enseignee, parcours_enseignes) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [matricule, nom, prenom, result.insertId, niveauxStr, mention_enseignee, parcoursStr]
        );
        console.log('✅ Profil enseignant créé, ID:', enseignantResult.insertId);
        console.log('📚 Niveaux enseignés:', niveauxStr);
        console.log('🎯 Parcours enseignés:', parcoursStr);
      } catch (error) {
        console.error('❌ Erreur création profil enseignant:', error);
        // Ne pas bloquer l'inscription si la création du profil échoue
      }
    } else if (role === 'etudiant') {
      try {
        const [etudiantResult] = await db.execute(
          'INSERT INTO etudiants (matricule, nom, prenom, niveau, mention, parcours, id_utilisateur) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [matricule, nom, prenom, niveau, mention, parcours, result.insertId]
        );
        console.log('✅ Profil étudiant créé, ID:', etudiantResult.insertId);
      } catch (error) {
        console.error('❌ Erreur création profil étudiant:', error);
        // Ne pas bloquer l'inscription si la création du profil échoue
      }
    }

    // Récupérer l'utilisateur créé
    const selectQuery = `
      SELECT id_utilisateur, nom, prenom, email, matricule, type_utilisateur, statut, date_creation
      FROM utilisateurs 
      WHERE id_utilisateur = ?
    `;
    
    const [users] = await db.execute(selectQuery, [result.insertId]);
    
    if (users.length === 0) {
      console.error('❌ Erreur récupération utilisateur');
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du profil'
      });
    }

    const user = users[0];
    console.log('✅ Utilisateur récupéré:', user);

    // Générer le token JWT
    const token = jwt.sign(
      { 
        id: user.id_utilisateur,
        matricule: user.matricule,
        type_utilisateur: user.type_utilisateur
      },
      process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise',
      { expiresIn: '24h' }
    );

    console.log('🎉 Inscription réussie pour:', user.email);
    
    return res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      user: {
        id: user.id_utilisateur,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        matricule: user.matricule,
        type_utilisateur: user.type_utilisateur,
        statut: user.statut,
        date_creation: user.date_creation
      },
      token
    });

  } catch (error) {
    console.error('❌ Erreur serveur globale:', error);
    
    // Gestion spécifique des erreurs MySQL
    if (error.code === 'ER_DUP_ENTRY') {
      if (error.sqlMessage.includes('email')) {
        return res.status(400).json({
          success: false,
          message: 'Un utilisateur avec cet email existe déjà'
        });
      }
      if (error.sqlMessage.includes('matricule')) {
        return res.status(400).json({
          success: false,
          message: 'Un utilisateur avec ce matricule existe déjà'
        });
      }
    }
    
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la création du compte: ' + (error.sqlMessage || error.message)
    });
  }
};

// Controller pour la connexion
const login = async (req, res) => {
  try {
    const payload = sanitizeLoginPayload(req.body);
    const { isValid, errors } = validateLoginPayload(payload);

    if (!isValid) {
      return res.status(422).json({
        success: false,
        message: 'Certains champs sont invalides',
        errors
      });
    }

    console.log('🔐 Tentative de connexion pour matricule:', payload.matricule);

    const query = `
      SELECT id_utilisateur, nom, prenom, email, matricule, mot_de_passe, type_utilisateur, statut 
      FROM utilisateurs 
      WHERE matricule = ? AND statut = 'actif'
    `;
    
    const [results] = await db.execute(query, [payload.matricule]);

    if (results.length === 0) {
      console.log('❌ Aucun utilisateur trouvé avec ce matricule');
      return res.status(401).json({
        success: false,
        message: 'Matricule ou mot de passe incorrect'
      });
    }

    const user = results[0];
    console.log('✅ Utilisateur trouvé:', user.email);

    if (!user.mot_de_passe) {
      console.error('❌ Mot de passe absent en base pour l\'utilisateur:', user.id_utilisateur);
      return res.status(500).json({
        success: false,
        message: 'Mot de passe utilisateur manquant. Contactez un administrateur.'
      });
    }

    const isPasswordValid = await bcrypt.compare(payload.mot_de_passe, user.mot_de_passe);
    
    if (!isPasswordValid) {
      console.log('❌ Mot de passe incorrect');
      return res.status(401).json({
        success: false,
        message: 'Matricule ou mot de passe incorrect'
      });
    }

    // Récupérer les informations du profil selon le type d'utilisateur
    let profil = null;
    if (user.type_utilisateur === 'enseignant') {
      const [enseignants] = await db.execute(
        'SELECT id_enseignant, niveaux_enseignes, mention_enseignee, parcours_enseignes FROM enseignants WHERE id_utilisateur = ?',
        [user.id_utilisateur]
      );
      if (enseignants.length > 0) {
        // Convertir les chaînes séparées par des virgules en tableaux
        const niveauxArray = enseignants[0].niveaux_enseignes ? enseignants[0].niveaux_enseignes.split(',') : [];
        const parcoursArray = enseignants[0].parcours_enseignes ? enseignants[0].parcours_enseignes.split(',') : [];
        
        profil = { 
          id_enseignant: enseignants[0].id_enseignant,
          niveaux_enseignes: niveauxArray,
          mention_enseignee: enseignants[0].mention_enseignee,
          parcours_enseignes: parcoursArray
        };
      }
    } else if (user.type_utilisateur === 'etudiant') {
      const [etudiants] = await db.execute(
        'SELECT id_etudiant, niveau, mention, parcours FROM etudiants WHERE id_utilisateur = ?',
        [user.id_utilisateur]
      );
      if (etudiants.length > 0) {
        profil = { 
          id_etudiant: etudiants[0].id_etudiant,
          niveau: etudiants[0].niveau,
          mention: etudiants[0].mention,
          parcours: etudiants[0].parcours
        };
      }
    }

    const token = jwt.sign(
      { 
        id: user.id_utilisateur,
        matricule: user.matricule,
        type_utilisateur: user.type_utilisateur,
        profil: profil
      },
      process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise',
      { expiresIn: '24h' }
    );

    console.log('🎉 Connexion réussie pour:', user.email);

    res.json({
      success: true,
      message: 'Connexion réussie',
      user: {
        id: user.id_utilisateur,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        matricule: user.matricule,
        type_utilisateur: user.type_utilisateur,
        statut: user.statut,
        profil: profil
      },
      token
    });

  } catch (error) {
    return handleLoginServerError(res, error);
  }
};

// Controller pour le profil
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT id_utilisateur, nom, prenom, email, matricule, type_utilisateur, statut, date_creation
      FROM utilisateurs
      WHERE id_utilisateur = ?
    `;
    
    const [results] = await db.execute(query, [userId]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    const user = results[0];
    
    // Récupérer les informations du profil selon le type d'utilisateur
    let profil = null;
    if (user.type_utilisateur === 'enseignant') {
      const [enseignants] = await db.execute(
        'SELECT id_enseignant, matricule, nom, prenom, niveaux_enseignes, mention_enseignee, parcours_enseignes FROM enseignants WHERE id_utilisateur = ?',
        [userId]
      );
      if (enseignants.length > 0) {
        // Convertir en objets avec tableaux
        const enseignant = enseignants[0];
        profil = {
          id_enseignant: enseignant.id_enseignant,
          matricule: enseignant.matricule,
          nom: enseignant.nom,
          prenom: enseignant.prenom,
          niveaux_enseignes: enseignant.niveaux_enseignes ? enseignant.niveaux_enseignes.split(',') : [],
          mention_enseignee: enseignant.mention_enseignee,
          parcours_enseignes: enseignant.parcours_enseignes ? enseignant.parcours_enseignes.split(',') : []
        };
      }
    } else if (user.type_utilisateur === 'etudiant') {
      const [etudiants] = await db.execute(
        'SELECT id_etudiant, matricule, nom, prenom, niveau, mention, parcours FROM etudiants WHERE id_utilisateur = ?',
        [userId]
      );
      if (etudiants.length > 0) {
        profil = etudiants[0];
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id_utilisateur,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        matricule: user.matricule,
        type_utilisateur: user.type_utilisateur,
        statut: user.statut,
        date_creation: user.date_creation,
        profil: profil
      }
    });
  } catch (error) {
    console.error('❌ Erreur de base de données:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération du profil: ' + error.message
    });
  }
};

// Controller pour le profil enseignant spécifique
const getEnseignantProfile = async (req, res) => {
  try {
    console.log('🔍 Récupération du profil enseignant pour:', req.user.id);
    
    const [enseignants] = await db.execute(
      'SELECT id_enseignant, matricule, nom, prenom, niveaux_enseignes, mention_enseignee, parcours_enseignes FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    // Convertir les chaînes en tableaux
    const enseignant = enseignants[0];
    const profil = {
      ...enseignant,
      niveaux_enseignes: enseignant.niveaux_enseignes ? enseignant.niveaux_enseignes.split(',') : [],
      parcours_enseignes: enseignant.parcours_enseignes ? enseignant.parcours_enseignes.split(',') : []
    };

    res.json({
      success: true,
      enseignant: profil
    });

  } catch (error) {
    console.error('❌ Erreur récupération profil enseignant:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil enseignant'
    });
  }
};

// Controller pour la déconnexion
const logout = (req, res) => {
  // Dans une vraie application, vous pourriez blacklister le token
  res.json({
    success: true,
    message: 'Déconnexion réussie'
  });
};

// Controller pour rafraîchir le token
const refreshToken = (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token manquant'
      });
    }

    // Vérifier et décoder le token existant
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise');
    
    // Générer un nouveau token
    const newToken = jwt.sign(
      { 
        id: decoded.id,
        matricule: decoded.matricule,
        type_utilisateur: decoded.type_utilisateur,
        profil: decoded.profil
      },
      process.env.JWT_SECRET || 'votre_secret_jwt_tres_securise',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Token rafraîchi avec succès',
      token: newToken
    });

  } catch (error) {
    console.error('❌ Erreur rafraîchissement token:', error);
    return res.status(401).json({
      success: false,
      message: 'Token invalide ou expiré'
    });
  }
};

module.exports = {
  login,
  register,
  getProfile,
  getEnseignantProfile,
  logout,
  refreshToken
};