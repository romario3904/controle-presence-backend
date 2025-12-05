const express = require('express');
const { 
  getStudentPresence, 
  getSeancePresence, 
  getTeacherMatieres,
  markPresence,
  scanQRCode 
} = require('../controllers/presenceController');
const { authenticateToken, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// Route pour récupérer les présences d'un étudiant
router.get('/student', authenticateToken, authorize('etudiant'), getStudentPresence);

// Route pour récupérer les présences d'une séance spécifique
router.get('/seance/:id_seance', authenticateToken, authorize('enseignant', 'admin'), getSeancePresence);

// Route pour récupérer les matières d'un enseignant
router.get('/matieres', authenticateToken, authorize('enseignant', 'admin'), getTeacherMatieres);

// Route pour marquer manuellement la présence
router.post('/mark', authenticateToken, authorize('enseignant', 'admin'), markPresence);

// Route pour scanner un QR code
router.post('/scan', authenticateToken, async (req, res) => {
  try {
    console.log('📥 Scan QR via /presence/scan:', req.body);
    
    const { id_seance, id_etudiant, qr_token, qr_data } = req.body;
    
    // Validation des données
    if (!id_seance || !id_etudiant) {
      return res.status(400).json({
        success: false,
        message: 'ID séance et ID étudiant sont requis'
      });
    }
    
    const db = require('../config/database');
    
    // Vérifier la séance
    const [seances] = await db.execute(`
      SELECT s.*, m.nom_matiere, m.code_matiere 
      FROM seances_cours s
      LEFT JOIN matieres m ON s.id_matiere = m.id_matiere
      WHERE s.id_seance = ?
    `, [id_seance]);
    
    if (seances.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Séance non trouvée'
      });
    }
    
    const seance = seances[0];
    
    // Vérifier l'étudiant
    const [etudiants] = await db.execute(
      'SELECT * FROM etudiants WHERE id_etudiant = ?',
      [id_etudiant]
    );
    
    if (etudiants.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Étudiant non trouvé'
      });
    }
    
    // Vérifier si déjà présent
    const [presences] = await db.execute(
      'SELECT * FROM presence WHERE id_seance = ? AND id_etudiant = ?',
      [id_seance, id_etudiant]
    );
    
    if (presences.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Vous avez déjà pointé votre présence pour cette séance',
        seance: seance,
        statut: presences[0].statut,
        heure_pointage: presences[0].date_scan
      });
    }
    
    // Calculer le statut
    const heureActuelle = new Date();
    const heureSeance = new Date(`${seance.date_seance}T${seance.heure_debut}`);
    const retardMinutes = Math.floor((heureActuelle - heureSeance) / (1000 * 60));
    
    let statut = 'present';
    if (retardMinutes > 15) statut = 'late';
    if (retardMinutes > 60) statut = 'absent';
    
    // Enregistrer la présence
    const [result] = await db.execute(
      'INSERT INTO presence (id_seance, id_etudiant, statut, date_scan) VALUES (?, ?, ?, NOW())',
      [id_seance, id_etudiant, statut]
    );
    
    console.log('✅ Présence enregistrée ID:', result.insertId);
    
    // Réponse
    res.json({
      success: true,
      message: 'Présence enregistrée avec succès',
      statut: statut,
      heure_pointage: new Date().toISOString(),
      seance: {
        id_seance: seance.id_seance,
        nom_matiere: seance.nom_matiere,
        code_matiere: seance.code_matiere,
        date_seance: seance.date_seance,
        heure_debut: seance.heure_debut,
        heure_fin: seance.heure_fin,
        salle: seance.salle
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur scan via /presence/scan:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du scan',
      error: error.message
    });
  }
});

// Route pour scanner un QR code via token (alternative)
router.post('/scan-qr', authenticateToken, async (req, res) => {
  try {
    const { qr_token } = req.body;
    
    if (!qr_token) {
      return res.status(400).json({
        success: false,
        message: 'Token QR manquant'
      });
    }
    
    // Si c'est un format SEANCE_ID
    if (qr_token.startsWith('SEANCE_')) {
      const idSeance = qr_token.replace('SEANCE_', '');
      
      // Récupérer l'ID étudiant depuis le token utilisateur
      const db = require('../config/database');
      const [etudiants] = await db.execute(
        'SELECT id_etudiant FROM etudiants WHERE id_utilisateur = ?',
        [req.user.id]
      );
      
      if (etudiants.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Profil étudiant non trouvé'
        });
      }
      
      const etudiantId = etudiants[0].id_etudiant;
      
      // Vérifier la séance
      const [seances] = await db.execute(`
        SELECT s.*, m.nom_matiere, m.code_matiere 
        FROM seances_cours s
        LEFT JOIN matieres m ON s.id_matiere = m.id_matiere
        WHERE s.id_seance = ?
      `, [idSeance]);
      
      if (seances.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Séance non trouvée'
        });
      }
      
      const seance = seances[0];
      
      // Vérifier si déjà présent
      const [presences] = await db.execute(
        'SELECT * FROM presence WHERE id_seance = ? AND id_etudiant = ?',
        [idSeance, etudiantId]
      );
      
      if (presences.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Vous avez déjà pointé votre présence pour cette séance'
        });
      }
      
      // Calculer le statut
      const heureActuelle = new Date();
      const heureSeance = new Date(`${seance.date_seance}T${seance.heure_debut}`);
      const retardMinutes = Math.floor((heureActuelle - heureSeance) / (1000 * 60));
      
      let statut = 'present';
      if (retardMinutes > 15) statut = 'late';
      if (retardMinutes > 60) statut = 'absent';
      
      // Enregistrer la présence
      await db.execute(
        'INSERT INTO presence (id_seance, id_etudiant, statut, date_scan) VALUES (?, ?, ?, NOW())',
        [idSeance, etudiantId, statut]
      );
      
      return res.json({
        success: true,
        message: 'Présence enregistrée avec succès',
        statut: statut,
        heure_pointage: new Date().toISOString(),
        seance: seance
      });
    } else {
      // Pour les autres formats, rediriger vers le contrôleur QR
      const { verifyQRCode } = require('../controllers/qrController');
      return verifyQRCode(req, res);
    }
    
  } catch (error) {
    console.error('❌ Erreur scan QR via token:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du QR code'
    });
  }
});

module.exports = router;