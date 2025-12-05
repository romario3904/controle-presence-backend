const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/authMiddleware');

// Validation des mentions et parcours
const validateMentionParcours = (mention, parcours) => {
  const validMentions = ['Informatique', 'Intelligence Artificielle', 'Expertise Digitale'];
  const validParcours = {
    'Informatique': ['GB', 'IG', 'ASR'],
    'Intelligence Artificielle': ['GID', 'OCC'],
    'Expertise Digitale': ['MDI', 'ASI']
  };

  if (mention && !validMentions.includes(mention)) {
    return {
      isValid: false,
      message: `Mention invalide. Les mentions valides sont: ${validMentions.join(', ')}`
    };
  }

  if (mention && parcours) {
    const parcoursValides = validParcours[mention];
    if (!parcoursValides.includes(parcours)) {
      return {
        isValid: false,
        message: `Parcours invalide pour la mention "${mention}". Parcours valides: ${parcoursValides.join(', ')}`
      };
    }
  }

  return { isValid: true };
};

// GET /api/matiere - Récupérer toutes les matières de l'enseignant connecté
router.get('/', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    console.log('🔍 Récupération des matières pour l\'enseignant connecté:', req.user.id);
    
    // Récupérer l'ID de l'enseignant à partir de la table enseignants
    const [enseignants] = await db.execute(
      'SELECT id_enseignant FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      console.log('❌ Aucun profil enseignant trouvé pour l\'utilisateur:', req.user.id);
      return res.status(404).json({
        success: false,
        message: 'Aucun profil enseignant trouvé'
      });
    }

    const id_enseignant = enseignants[0].id_enseignant;
    
    console.log('👨‍🏫 ID enseignant trouvé:', id_enseignant);

    // Récupérer les matières via la table de liaison avec JOIN amélioré
    const [matieres] = await db.execute(
      `SELECT DISTINCT m.* 
       FROM matieres m
       INNER JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       WHERE em.id_enseignant = ?
       ORDER BY m.nom_matiere`,
      [id_enseignant]
    );

    console.log('✅ Matières récupérées:', matieres.length);
    
    res.json({
      success: true,
      count: matieres.length,
      matieres: matieres
    });
  } catch (error) {
    console.error('❌ Erreur récupération matières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des matières'
    });
  }
});

// POST /api/matiere - Créer une nouvelle matière
router.post('/', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    const { 
      nom_matiere, 
      code_matiere, 
      description, 
      credit, 
      niveau_enseignee, 
      mention_enseignee, 
      parcours_enseignee,
      id_enseignant 
    } = req.body;
    
    // Validation des mentions et parcours
    const validation = validateMentionParcours(mention_enseignee, parcours_enseignee);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }
    
    // Si id_enseignant n'est pas fourni, utiliser celui de l'utilisateur connecté
    let enseignantId = id_enseignant;
    
    if (!enseignantId) {
      const [enseignants] = await db.execute(
        'SELECT id_enseignant FROM enseignants WHERE id_utilisateur = ?',
        [req.user.id]
      );
      
      if (enseignants.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Profil enseignant non trouvé'
        });
      }
      enseignantId = enseignants[0].id_enseignant;
    }

    // Validation des données
    if (!nom_matiere || !code_matiere) {
      return res.status(400).json({
        success: false,
        message: 'Le nom et le code de la matière sont obligatoires'
      });
    }

    // Vérifier si le code existe déjà
    const [existing] = await db.execute(
      'SELECT id_matiere FROM matieres WHERE code_matiere = ?',
      [code_matiere]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Une matière avec ce code existe déjà'
      });
    }

    // Démarrer une transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Créer la matière
      const [result] = await connection.execute(
        `INSERT INTO matieres 
         (nom_matiere, code_matiere, description, credit, niveau_enseignee, mention_enseignee, parcours_enseignee, date_creation) 
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          nom_matiere, 
          code_matiere, 
          description || null, 
          credit || null, 
          niveau_enseignee || null, 
          mention_enseignee || null, 
          parcours_enseignee || null
        ]
      );

      // Lier la matière à l'enseignant
      await connection.execute(
        'INSERT INTO enseignant_matiere (id_enseignant, id_matiere) VALUES (?, ?)',
        [enseignantId, result.insertId]
      );

      // Récupérer la matière créée
      const [newMatiere] = await connection.execute(
        'SELECT * FROM matieres WHERE id_matiere = ?',
        [result.insertId]
      );

      // Valider la transaction
      await connection.commit();
      connection.release();

      res.status(201).json({
        success: true,
        message: 'Matière créée avec succès',
        matiere: newMatiere[0]
      });

    } catch (transactionError) {
      // Annuler la transaction en cas d'erreur
      await connection.rollback();
      connection.release();
      throw transactionError;
    }

  } catch (error) {
    console.error('❌ Erreur création matière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la matière'
    });
  }
});

// PUT /api/matiere/:id - Modifier une matière
router.put('/:id', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      nom_matiere, 
      code_matiere, 
      description, 
      credit, 
      niveau_enseignee, 
      mention_enseignee, 
      parcours_enseignee 
    } = req.body;
    
    // Validation des mentions et parcours
    const validation = validateMentionParcours(mention_enseignee, parcours_enseignee);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }
    
    // Récupérer l'ID de l'enseignant
    const [enseignants] = await db.execute(
      'SELECT id_enseignant FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    const id_enseignant = enseignants[0].id_enseignant;

    // Vérifier que l'enseignant possède cette matière
    const [enseignantMatiere] = await db.execute(
      `SELECT em.id_enseignant 
       FROM enseignant_matiere em 
       WHERE em.id_enseignant = ? AND em.id_matiere = ?`,
      [id_enseignant, id]
    );

    if (enseignantMatiere.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas autorisé à modifier cette matière'
      });
    }

    // Vérifier si le nouveau code existe déjà pour une autre matière
    if (code_matiere) {
      const [existingCode] = await db.execute(
        'SELECT id_matiere FROM matieres WHERE code_matiere = ? AND id_matiere != ?',
        [code_matiere, id]
      );

      if (existingCode.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Une autre matière avec ce code existe déjà'
        });
      }
    }

    // Récupérer la matière actuelle pour les valeurs par défaut
    const [currentMatiere] = await db.execute(
      'SELECT * FROM matieres WHERE id_matiere = ?',
      [id]
    );

    if (currentMatiere.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Matière non trouvée'
      });
    }

    // Mettre à jour la matière
    await db.execute(
      `UPDATE matieres 
       SET nom_matiere = COALESCE(?, nom_matiere), 
           code_matiere = COALESCE(?, code_matiere), 
           description = ?, 
           credit = ?, 
           niveau_enseignee = ?, 
           mention_enseignee = ?, 
           parcours_enseignee = ?,
           date_modification = NOW()
       WHERE id_matiere = ?`,
      [
        nom_matiere || currentMatiere[0].nom_matiere,
        code_matiere || currentMatiere[0].code_matiere,
        description !== undefined ? description : currentMatiere[0].description,
        credit !== undefined ? credit : currentMatiere[0].credit,
        niveau_enseignee !== undefined ? niveau_enseignee : currentMatiere[0].niveau_enseignee,
        mention_enseignee !== undefined ? mention_enseignee : currentMatiere[0].mention_enseignee,
        parcours_enseignee !== undefined ? parcours_enseignee : currentMatiere[0].parcours_enseignee,
        id
      ]
    );

    // Récupérer la matière mise à jour
    const [updatedMatiere] = await db.execute(
      'SELECT * FROM matieres WHERE id_matiere = ?',
      [id]
    );

    res.json({
      success: true,
      message: 'Matière mise à jour avec succès',
      matiere: updatedMatiere[0]
    });

  } catch (error) {
    console.error('❌ Erreur modification matière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la modification de la matière'
    });
  }
});

// DELETE /api/matiere/:id - Supprimer une matière
router.delete('/:id', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Récupérer l'ID de l'enseignant
    const [enseignants] = await db.execute(
      'SELECT id_enseignant FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    const id_enseignant = enseignants[0].id_enseignant;

    // Vérifier que l'enseignant possède cette matière
    const [enseignantMatiere] = await db.execute(
      `SELECT em.id_enseignant 
       FROM enseignant_matiere em 
       WHERE em.id_enseignant = ? AND em.id_matiere = ?`,
      [id_enseignant, id]
    );

    if (enseignantMatiere.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas autorisé à supprimer cette matière'
      });
    }

    // Vérifier s'il y a des séances associées à cette matière
    const [seancesAssociees] = await db.execute(
      'SELECT id_seance FROM seances_cours WHERE id_matiere = ?',
      [id]
    );

    if (seancesAssociees.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer cette matière car des séances y sont associées'
      });
    }

    // Démarrer une transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Supprimer les liaisons enseignant-matière
      await connection.execute(
        'DELETE FROM enseignant_matiere WHERE id_matiere = ?',
        [id]
      );

      // Supprimer la matière
      await connection.execute(
        'DELETE FROM matieres WHERE id_matiere = ?',
        [id]
      );

      // Valider la transaction
      await connection.commit();
      connection.release();

      res.json({
        success: true,
        message: 'Matière supprimée avec succès'
      });

    } catch (transactionError) {
      // Annuler la transaction en cas d'erreur
      await connection.rollback();
      connection.release();
      throw transactionError;
    }

  } catch (error) {
    console.error('❌ Erreur suppression matière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la suppression de la matière'
    });
  }
});

// GET /api/matiere/all - Récupérer toutes les matières (pour admin ou besoins spécifiques)
router.get('/all', authenticateToken, authorize(['admin', 'coordinateur']), async (req, res) => {
  try {
    console.log('🔍 Récupération de toutes les matières');
    
    const [matieres] = await db.execute(
      `SELECT m.*, 
              GROUP_CONCAT(DISTINCT e.id_enseignant) as enseignants_ids,
              COUNT(DISTINCT em.id_enseignant) as nombre_enseignants
       FROM matieres m
       LEFT JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       LEFT JOIN enseignants e ON em.id_enseignant = e.id_enseignant
       GROUP BY m.id_matiere
       ORDER BY m.nom_matiere`
    );

    console.log('✅ Toutes les matières récupérées:', matieres.length);
    
    res.json({
      success: true,
      count: matieres.length,
      matieres: matieres
    });
  } catch (error) {
    console.error('❌ Erreur récupération toutes les matières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des matières'
    });
  }
});

// GET /api/matiere/:id - Récupérer une matière spécifique
router.get('/:id', authenticateToken, authorize('enseignant'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Récupérer l'ID de l'enseignant
    const [enseignants] = await db.execute(
      'SELECT id_enseignant FROM enseignants WHERE id_utilisateur = ?',
      [req.user.id]
    );
    
    if (enseignants.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    const id_enseignant = enseignants[0].id_enseignant;

    // Vérifier que l'enseignant possède cette matière
    const [matiere] = await db.execute(
      `SELECT m.* 
       FROM matieres m
       INNER JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       WHERE em.id_enseignant = ? AND m.id_matiere = ?`,
      [id_enseignant, id]
    );

    if (matiere.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Matière non trouvée ou non autorisée'
      });
    }

    res.json({
      success: true,
      matiere: matiere[0]
    });
  } catch (error) {
    console.error('❌ Erreur récupération matière:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la matière'
    });
  }
});

module.exports = router;