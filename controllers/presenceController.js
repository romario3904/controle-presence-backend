const pool = require('../config/database');

const getStudentPresence = async (req, res) => {
  try {
    const id_etudiant = req.user.profil?.id_etudiant || req.user.id_etudiant;

    if (!id_etudiant) {
      return res.status(400).json({
        success: false,
        message: 'ID étudiant manquant'
      });
    }

    const [presences] = await pool.execute(
      `SELECT p.*, sc.date_seance, sc.heure_debut, sc.salle,
              m.nom_matiere, m.code_matiere, ens.nom as enseignant_nom, ens.prenom as enseignant_prenom
       FROM presence p
       JOIN seances_cours sc ON p.id_seance = sc.id_seance
       JOIN matieres m ON sc.id_matiere = m.id_matiere
       JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       JOIN enseignants ens ON em.id_enseignant = ens.id_enseignant
       WHERE p.id_etudiant = ?
       ORDER BY sc.date_seance DESC, sc.heure_debut DESC`,
      [id_etudiant]
    );

    res.json({
      success: true,
      presences: presences
    });
  } catch (error) {
    console.error('Erreur récupération présence étudiant:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
};

const getSeancePresence = async (req, res) => {
  try {
    const { id_seance } = req.params;

    // Vérifier que l'enseignant est responsable de la matière
    if (req.user.type_utilisateur === 'enseignant') {
      const [seances] = await pool.execute(
        `SELECT m.id_matiere 
         FROM seances_cours sc
         JOIN matieres m ON sc.id_matiere = m.id_matiere
         JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
         WHERE sc.id_seance = ? AND em.id_enseignant = ?`,
        [id_seance, req.user.profil?.id_enseignant]
      );

      if (seances.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cette séance'
        });
      }
    }

    const [presences] = await pool.execute(
      `SELECT p.*, e.matricule, e.nom, e.prenom, e.niveau, e.mention
       FROM presence p
       JOIN etudiants e ON p.id_etudiant = e.id_etudiant
       WHERE p.id_seance = ?
       ORDER BY e.nom, e.prenom`,
      [id_seance]
    );

    // Récupérer les infos de la séance
    const [seanceInfo] = await pool.execute(
      `SELECT sc.*, m.nom_matiere, m.code_matiere
       FROM seances_cours sc
       JOIN matieres m ON sc.id_matiere = m.id_matiere
       WHERE sc.id_seance = ?`,
      [id_seance]
    );

    res.json({
      success: true,
      seance: seanceInfo[0] || {},
      presences: presences,
      total: presences.length,
      presents: presences.filter(p => p.statut === 'present').length,
      late: presences.filter(p => p.statut === 'late').length,
      absent: presences.filter(p => p.statut === 'absent').length
    });
  } catch (error) {
    console.error('Erreur récupération présence séance:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
};

const getTeacherMatieres = async (req, res) => {
  try {
    const id_enseignant = req.user.profil?.id_enseignant;

    if (!id_enseignant) {
      return res.status(403).json({
        success: false,
        message: 'Profil enseignant non trouvé'
      });
    }

    const [matieres] = await pool.execute(
      `SELECT m.* 
       FROM matieres m
       JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       WHERE em.id_enseignant = ?
       ORDER BY m.nom_matiere`,
      [id_enseignant]
    );

    res.json({
      success: true,
      matieres: matieres
    });
  } catch (error) {
    console.error('Erreur récupération matières:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
};

// Nouvelle fonction pour marquer la présence manuellement
const markPresence = async (req, res) => {
  try {
    const { id_seance, id_etudiant, statut } = req.body;
    
    if (!id_seance || !id_etudiant || !statut) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont requis'
      });
    }
    
    // Vérifier si déjà présent
    const [existing] = await pool.execute(
      'SELECT * FROM presence WHERE id_seance = ? AND id_etudiant = ?',
      [id_seance, id_etudiant]
    );
    
    if (existing.length > 0) {
      // Mettre à jour
      await pool.execute(
        'UPDATE presence SET statut = ?, date_scan = NOW() WHERE id_seance = ? AND id_etudiant = ?',
        [statut, id_seance, id_etudiant]
      );
    } else {
      // Insérer
      await pool.execute(
        'INSERT INTO presence (id_seance, id_etudiant, statut, date_scan) VALUES (?, ?, ?, NOW())',
        [id_seance, id_etudiant, statut]
      );
    }
    
    res.json({
      success: true,
      message: 'Présence mise à jour avec succès'
    });
    
  } catch (error) {
    console.error('Erreur marquage présence:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur'
    });
  }
};

module.exports = { 
  getStudentPresence, 
  getSeancePresence, 
  getTeacherMatieres,
  markPresence 
};