// routes/qr.js
const express = require('express');
const { generateQRCode, verifyQRCode, getTeacherSeances } = require('../controllers/qrController');
const { authenticateToken, authorize } = require('../middleware/authMiddleware');
const db = require('../config/database');

const router = express.Router();

// Route pour générer un QR code
router.post('/generate', authenticateToken, authorize('enseignant', 'admin'), generateQRCode);

// Route pour vérifier un QR code
router.post('/verify', authenticateToken, authorize('etudiant'), verifyQRCode);

// Route pour scanner un QR code (AJOUTÉ)
router.post('/scan', authenticateToken, async (req, res) => {
  try {
    console.log('📥 Scan QR code reçu:', req.body);
    
    const { id_seance, id_etudiant, qr_token, qr_data } = req.body;
    
    // Vérifier les données requises
    if (!id_seance || !id_etudiant) {
      return res.status(400).json({
        success: false,
        message: 'ID séance et ID étudiant sont requis'
      });
    }
    
    // 1. Vérifier la séance
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
    
    // 2. Vérifier l'étudiant
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
    
    // 3. Vérifier si déjà présent
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
    
    // 4. Calculer le statut
    const heureActuelle = new Date();
    const heureSeance = new Date(`${seance.date_seance}T${seance.heure_debut}`);
    const retardMinutes = Math.floor((heureActuelle - heureSeance) / (1000 * 60));
    
    let statut = 'present';
    if (retardMinutes > 15) statut = 'late';
    if (retardMinutes > 60) statut = 'absent';
    
    // 5. Enregistrer la présence
    const [result] = await db.execute(
      'INSERT INTO presence (id_seance, id_etudiant, statut, date_scan) VALUES (?, ?, ?, NOW())',
      [id_seance, id_etudiant, statut]
    );
    
    console.log('✅ Présence enregistrée:', result.insertId);
    
    // 6. Réponse
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
    console.error('❌ Erreur scan QR:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du scan',
      error: error.message
    });
  }
});

// Route pour récupérer les séances d'un enseignant
router.get('/seances', authenticateToken, authorize('enseignant', 'admin'), getTeacherSeances);

module.exports = router;