const pool = require('../config/database');

const sanitizeMatierePayload = (payload = {}) => {
  const sanitized = {};

  if ('nom_matiere' in payload) {
    sanitized.nom_matiere = typeof payload.nom_matiere === 'string' ? payload.nom_matiere.trim() : '';
  }
  if ('code_matiere' in payload) {
    const rawCode = typeof payload.code_matiere === 'string' ? payload.code_matiere.trim().toUpperCase() : '';
    sanitized.code_matiere = rawCode;
  }
  if ('description' in payload) {
    sanitized.description = typeof payload.description === 'string' ? payload.description.trim() : '';
  }
  if ('credit' in payload) {
    if (payload.credit === '' || payload.credit === null || payload.credit === undefined) {
      sanitized.credit = null;
    } else {
      sanitized.credit = Number(payload.credit);
    }
  }
  if ('niveau' in payload) {
    sanitized.niveau = typeof payload.niveau === 'string' ? payload.niveau.trim() : '';
  }

  return sanitized;
};

const validateMatierePayload = (payload, { partial = false } = {}) => {
  const errors = {};

  const shouldValidate = (field) => !partial || payload[field] !== undefined;

  if (shouldValidate('nom_matiere')) {
    if (!payload.nom_matiere) {
      errors.nom_matiere = 'Le nom de la matière est obligatoire';
    } else if (payload.nom_matiere.length < 3) {
      errors.nom_matiere = 'Le nom doit contenir au moins 3 caractères';
    }
  }

  if (shouldValidate('code_matiere')) {
    if (!payload.code_matiere) {
      errors.code_matiere = 'Le code de la matière est obligatoire';
    } else if (!/^[A-Z0-9_-]{3,15}$/.test(payload.code_matiere)) {
      errors.code_matiere = 'Le code doit contenir 3 à 15 caractères (A-Z, 0-9, -, _)';
    }
  }

  if (shouldValidate('credit')) {
    if (payload.credit !== undefined && payload.credit !== null) {
      if (Number.isNaN(payload.credit) || payload.credit < 0) {
        errors.credit = 'Le nombre de crédits doit être un nombre positif';
      }
    }
  }

  if (shouldValidate('niveau')) {
    if (payload.niveau && payload.niveau.length > 10) {
      errors.niveau = 'Le niveau ne doit pas dépasser 10 caractères';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

const ensureEnseignantContext = (req, res) => {
  const id = req.user?.profil?.id_enseignant;
  if (!id) {
    res.status(403).json({
      message: 'Profil enseignant introuvable'
    });
    return null;
  }
  return id;
};

const handleMatiereControllerError = (res, error, contextMessage = 'Erreur interne du serveur') => {
  console.error(contextMessage, error);

  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({
      message: 'Une matière avec ce code existe déjà'
    });
  }

  return res.status(500).json({ message: 'Erreur interne du serveur' });
};

// Récupérer toutes les matières d'un enseignant
const getMatieres = async (req, res) => {
  try {
    const id_enseignant = ensureEnseignantContext(req, res);
    if (!id_enseignant) {
      return;
    }

    const [matieres] = await pool.execute(
      'SELECT * FROM matieres WHERE id_enseignant = ? ORDER BY nom_matiere',
      [id_enseignant]
    );

    res.json(matieres);
  } catch (error) {
    console.error('Erreur récupération matières:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};

// Récupérer une matière par son ID
const getMatiereById = async (req, res) => {
  try {
    const { id } = req.params;
    const id_enseignant = ensureEnseignantContext(req, res);
    if (!id_enseignant) {
      return;
    }

    const [matieres] = await pool.execute(
      'SELECT * FROM matieres WHERE id_matiere = ? AND id_enseignant = ?',
      [id, id_enseignant]
    );

    if (matieres.length === 0) {
      return res.status(404).json({ message: 'Matière non trouvée' });
    }

    res.json(matieres[0]);
  } catch (error) {
    console.error('Erreur récupération matière:', error);
    res.status(500).json({ message: 'Erreur interne du serveur' });
  }
};

// Créer une nouvelle matière
const createMatiere = async (req, res) => {
  try {
    const id_enseignant = ensureEnseignantContext(req, res);
    if (!id_enseignant) {
      return;
    }

    const payload = sanitizeMatierePayload(req.body);
    const { isValid, errors } = validateMatierePayload(payload);

    if (!isValid) {
      return res.status(422).json({
        message: 'Certains champs sont invalides',
        errors
      });
    }

    // Vérifier si le code matière existe déjà pour cet enseignant
    const [existing] = await pool.execute(
      'SELECT * FROM matieres WHERE code_matiere = ? AND id_enseignant = ?',
      [payload.code_matiere, id_enseignant]
    );

    if (existing.length > 0) {
      return res.status(400).json({ 
        message: 'Une matière avec ce code existe déjà' 
      });
    }

    // Insérer la nouvelle matière
    const [result] = await pool.execute(
      `INSERT INTO matieres (nom_matiere, code_matiere, description, credit, niveau, id_enseignant) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.nom_matiere,
        payload.code_matiere,
        payload.description || null,
        payload.credit ?? null,
        payload.niveau || null,
        id_enseignant
      ]
    );

    // Récupérer la matière créée
    const [newMatiere] = await pool.execute(
      'SELECT * FROM matieres WHERE id_matiere = ?',
      [result.insertId]
    );

    res.status(201).json({
      message: 'Matière créée avec succès',
      matiere: newMatiere[0]
    });
  } catch (error) {
    return handleMatiereControllerError(res, error, 'Erreur création matière:');
  }
};

// Mettre à jour une matière
const updateMatiere = async (req, res) => {
  try {
    const { id } = req.params;
    const id_enseignant = ensureEnseignantContext(req, res);
    if (!id_enseignant) {
      return;
    }

    const payload = sanitizeMatierePayload(req.body);
    const { isValid, errors } = validateMatierePayload(payload, { partial: true });

    if (!isValid) {
      return res.status(422).json({
        message: 'Certains champs sont invalides',
        errors
      });
    }

    // Vérifier que la matière existe et appartient à l'enseignant
    const [existing] = await pool.execute(
      'SELECT * FROM matieres WHERE id_matiere = ? AND id_enseignant = ?',
      [id, id_enseignant]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Matière non trouvée' });
    }

    // Si le code est modifié, vérifier qu'il n'existe pas déjà
    if (payload.code_matiere && payload.code_matiere !== existing[0].code_matiere) {
      const [codeExists] = await pool.execute(
        'SELECT * FROM matieres WHERE code_matiere = ? AND id_enseignant = ? AND id_matiere != ?',
        [payload.code_matiere, id_enseignant, id]
      );

      if (codeExists.length > 0) {
        return res.status(400).json({ 
          message: 'Une matière avec ce code existe déjà' 
        });
      }
    }

    // Mettre à jour la matière
    await pool.execute(
      `UPDATE matieres 
       SET nom_matiere = COALESCE(?, nom_matiere),
           code_matiere = COALESCE(?, code_matiere),
           description = ?,
           credit = ?,
           niveau = ?
       WHERE id_matiere = ? AND id_enseignant = ?`,
      [
        payload.nom_matiere || existing[0].nom_matiere,
        payload.code_matiere || existing[0].code_matiere,
        payload.description !== undefined ? payload.description : existing[0].description,
        payload.credit !== undefined ? payload.credit : existing[0].credit,
        payload.niveau !== undefined ? payload.niveau : existing[0].niveau,
        id,
        id_enseignant
      ]
    );

    // Récupérer la matière mise à jour
    const [updated] = await pool.execute(
      'SELECT * FROM matieres WHERE id_matiere = ?',
      [id]
    );

    res.json({
      message: 'Matière mise à jour avec succès',
      matiere: updated[0]
    });
  } catch (error) {
    return handleMatiereControllerError(res, error, 'Erreur mise à jour matière:');
  }
};

// Supprimer une matière
const deleteMatiere = async (req, res) => {
  try {
    const { id } = req.params;
    const id_enseignant = ensureEnseignantContext(req, res);
    if (!id_enseignant) {
      return;
    }

    // Vérifier que la matière existe et appartient à l'enseignant
    const [existing] = await pool.execute(
      'SELECT * FROM matieres WHERE id_matiere = ? AND id_enseignant = ?',
      [id, id_enseignant]
    );

    if (existing.length === 0) {
      return res.status(404).json({ message: 'Matière non trouvée' });
    }

    // Vérifier si la matière est utilisée dans des séances
    const [seances] = await pool.execute(
      'SELECT COUNT(*) as count FROM seances_cours WHERE id_matiere = ?',
      [id]
    );

    if (seances[0].count > 0) {
      return res.status(400).json({ 
        message: 'Impossible de supprimer cette matière car elle est utilisée dans des séances de cours' 
      });
    }

    // Supprimer la matière
    await pool.execute(
      'DELETE FROM matieres WHERE id_matiere = ? AND id_enseignant = ?',
      [id, id_enseignant]
    );

    res.json({ message: 'Matière supprimée avec succès' });
  } catch (error) {
    return handleMatiereControllerError(res, error, 'Erreur suppression matière:');
  }
};

module.exports = {
  getMatieres,
  getMatiereById,
  createMatiere,
  updateMatiere,
  deleteMatiere
};

