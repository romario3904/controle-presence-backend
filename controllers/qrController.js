// controllers/qrController.js
const db = require('../config/database');

// Fonction pour générer un token QR unique
function generateQRToken() {
  return 'qr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Controller pour générer un QR code
const generateQRCode = async (req, res) => {
  try {
    const { id_matiere, date_seance, heure_debut, heure_fin, salle } = req.body;

    console.log('📥 Données reçues pour génération QR:', req.body);

    // Validation des données
    if (!id_matiere || !date_seance || !heure_debut || !heure_fin || !salle) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs sont obligatoires'
      });
    }

    // Récupérer l'ID de l'enseignant connecté
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

    const enseignantConnecteId = enseignants[0].id_enseignant;

    // Vérifier que l'enseignant est bien responsable de cette matière
    const [matiereEnseignant] = await db.execute(
      `SELECT em.id_enseignant 
       FROM enseignant_matiere em 
       WHERE em.id_enseignant = ? AND em.id_matiere = ?`,
      [enseignantConnecteId, id_matiere]
    );

    if (matiereEnseignant.length === 0) {
      console.log(`❌ Enseignant ${enseignantConnecteId} n'est pas responsable de la matière ${id_matiere}`);
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas responsable de cette matière'
      });
    }

    console.log(`✅ Enseignant ${enseignantConnecteId} est responsable de la matière ${id_matiere}`);

    // Vérifier les conflits de séance
    const [seancesConflit] = await db.execute(
      `SELECT id_seance FROM seances_cours 
       WHERE id_matiere = ? AND date_seance = ? AND salle = ?
       AND ((heure_debut BETWEEN ? AND ?) OR (heure_fin BETWEEN ? AND ?))`,
      [id_matiere, date_seance, salle, heure_debut, heure_fin, heure_debut, heure_fin]
    );

    if (seancesConflit.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Conflit de séance : une séance existe déjà pour cette matière, date, salle et créneau horaire'
      });
    }

    // Générer un token unique pour le QR code
    const qrToken = generateQRToken();
    const qrExpire = new Date(Date.now() + 2 * 60 * 60 * 1000); // Expire dans 2 heures

    // Créer la séance
    const [result] = await db.execute(
      `INSERT INTO seances_cours (id_matiere, date_seance, heure_debut, heure_fin, salle, qr_code, qr_expire) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_matiere, date_seance, heure_debut, heure_fin, salle, qrToken, qrExpire]
    );

    // Récupérer les informations complètes de la séance avec l'enseignant
    const [seance] = await db.execute(
      `SELECT s.*, m.nom_matiere, e.nom as enseignant_nom, e.prenom as enseignant_prenom
       FROM seances_cours s 
       JOIN matieres m ON s.id_matiere = m.id_matiere 
       JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       JOIN enseignants e ON em.id_enseignant = e.id_enseignant
       WHERE s.id_seance = ? AND em.id_enseignant = ?`,
      [result.insertId, enseignantConnecteId]
    );

    if (seance.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Séance créée mais informations enseignant non trouvées'
      });
    }

    console.log('✅ QR code généré avec succès pour la séance:', result.insertId);

    res.json({
      success: true,
      message: 'QR code généré avec succès',
      seance: seance[0],
      qrToken: qrToken,
      qrExpire: qrExpire
    });

  } catch (error) {
    console.error('❌ Erreur génération QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du QR code'
    });
  }
};

// Controller pour vérifier un QR code
const verifyQRCode = async (req, res) => {
  try {
    console.log('🔍 Données reçues pour vérification QR:', req.body);
    
    // CORRECTION : Accepter les deux noms de paramètres pour plus de flexibilité
    const qrToken = req.body.qr_token || req.body.qr_data;

    if (!qrToken) {
      return res.status(400).json({
        success: false,
        message: 'Token QR manquant',
        receivedData: req.body
      });
    }

    console.log('🔑 Token QR à vérifier:', qrToken);

    // Vérifier le token QR avec jointure pour récupérer l'enseignant
    const [seances] = await db.execute(
      `SELECT s.*, m.nom_matiere, e.nom as enseignant_nom, e.prenom as enseignant_prenom
       FROM seances_cours s
       JOIN matieres m ON s.id_matiere = m.id_matiere
       JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       JOIN enseignants e ON em.id_enseignant = e.id_enseignant
       WHERE s.qr_code = ? AND s.qr_expire > NOW()`,
      [qrToken]
    );

    if (seances.length === 0) {
      console.log('❌ QR code non trouvé ou expiré:', qrToken);
      return res.status(404).json({
        success: false,
        message: 'QR code invalide ou expiré'
      });
    }

    const seance = seances[0];
    console.log('✅ Séance trouvée:', seance.id_seance, seance.nom_matiere);

    // Récupérer l'ID de l'étudiant connecté
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

    // Vérifier si l'étudiant est déjà marqué présent
    const [presences] = await db.execute(
      'SELECT id_presence FROM presence WHERE id_seance = ? AND id_etudiant = ?',
      [seance.id_seance, etudiantId]
    );

    if (presences.length > 0) {
      console.log(`⚠️ Étudiant ${etudiantId} déjà présent pour la séance ${seance.id_seance}`);
      return res.status(409).json({
        success: false,
        message: 'Vous êtes déjà marqué présent pour cette séance'
      });
    }

    // Calculer le statut
    const heureActuelle = new Date();
    const heureSeance = new Date(`${seance.date_seance}T${seance.heure_debut}`);
    const retardMinutes = Math.floor((heureActuelle - heureSeance) / (1000 * 60));
    
    let statut = 'present';
    if (retardMinutes > 15) statut = 'late';
    if (retardMinutes > 60) statut = 'absent';

    // Marquer la présence
    const [result] = await db.execute(
      'INSERT INTO presence (id_seance, id_etudiant, statut, date_scan) VALUES (?, ?, ?, NOW())',
      [seance.id_seance, etudiantId, statut]
    );

    console.log(`✅ Étudiant ${etudiantId} marqué présent pour la séance ${seance.id_seance}`);

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
        salle: seance.salle,
        enseignant: `${seance.enseignant_prenom} ${seance.enseignant_nom}`
      }
    });

  } catch (error) {
    console.error('❌ Erreur vérification QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du QR code'
    });
  }
};

// Controller pour scanner un QR code (NOUVELLE FONCTION)
const scanQRCode = async (req, res) => {
  try {
    const { id_seance, id_etudiant, qr_data, qr_token } = req.body;
    
    console.log('📥 Scan direct reçu:', req.body);
    
    if (!id_seance || !id_etudiant) {
      return res.status(400).json({
        success: false,
        message: 'ID séance et ID étudiant sont requis'
      });
    }
    
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
    console.error('❌ Erreur scan direct:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du scan',
      error: error.message
    });
  }
};

// Controller pour récupérer les séances d'un enseignant
const getTeacherSeances = async (req, res) => {
  try {
    // Récupérer l'ID de l'enseignant connecté
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

    const enseignantId = enseignants[0].id_enseignant;

    // Récupérer les séances via la table enseignant_matiere
    const [seances] = await db.execute(
      `SELECT s.*, m.nom_matiere, 
              COUNT(p.id_presence) as nombre_presents
       FROM seances_cours s
       JOIN matieres m ON s.id_matiere = m.id_matiere
       JOIN enseignant_matiere em ON m.id_matiere = em.id_matiere
       LEFT JOIN presence p ON s.id_seance = p.id_seance
       WHERE em.id_enseignant = ?
       GROUP BY s.id_seance
       ORDER BY s.date_seance DESC, s.heure_debut DESC`,
      [enseignantId]
    );

    console.log(`✅ ${seances.length} séances récupérées pour l'enseignant ${enseignantId}`);

    res.json({
      success: true,
      seances: seances
    });

  } catch (error) {
    console.error('❌ Erreur récupération séances:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des séances'
    });
  }
};

module.exports = {
  generateQRCode,
  verifyQRCode,
  scanQRCode, // AJOUTÉ
  getTeacherSeances
};