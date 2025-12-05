// routes/statisticsRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/database'); 
const { authenticateToken } = require('../middleware/authMiddleware'); 

// Route pour les statistiques de l'étudiant
router.get('/student/:id/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const studentId = parseInt(req.params.id);
    
    console.log(`📊 Demande statistiques - User: ${userId}, Étudiant: ${studentId}, Type: ${req.user.type_utilisateur}`);
    
    // Vérifier les permissions
    if (req.user.type_utilisateur === 'enseignant') {
      // Un enseignant peut voir les stats de tous ses étudiants
      const hasAccess = await checkIfStudentInTeacherCourses(userId, studentId);
      if (!hasAccess) {
        return res.status(403).json({ 
          success: false, 
          message: 'Accès limité. Cet étudiant ne fait pas partie de vos cours.' 
        });
      }
    } else if (req.user.type_utilisateur === 'etudiant') {
      // Un étudiant ne peut voir que ses propres stats
      if (userId !== studentId) {
        return res.status(403).json({ 
          success: false, 
          message: 'Accès limité. Vous ne pouvez voir que vos propres statistiques.' 
        });
      }
    }
    
    // Récupérer les statistiques de l'étudiant
    const stats = await getStudentStats(studentId);
    res.json({ 
      success: true, 
      data: stats 
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération statistiques:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur lors de la récupération des statistiques',
      error: error.message
    });
  }
});

// Route pour les statistiques générales de l'enseignant
router.get('/teacher/stats', authenticateToken, async (req, res) => {
  try {
    console.log(`📊 Demande statistiques enseignant - User: ${req.user.id}`);
    
    if (req.user.type_utilisateur !== 'enseignant') {
      return res.status(403).json({ 
        success: false, 
        message: 'Accès réservé aux enseignants' 
      });
    }
    
    const stats = await getTeacherStats(req.user.id);
    res.json({ 
      success: true, 
      data: stats 
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération statistiques enseignant:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// Route pour les statistiques par matière (enseignant)
router.get('/teacher/matiere/:id/stats', authenticateToken, async (req, res) => {
  try {
    if (req.user.type_utilisateur !== 'enseignant') {
      return res.status(403).json({ 
        success: false, 
        message: 'Accès réservé aux enseignants' 
      });
    }
    
    const matiereId = parseInt(req.params.id);
    const stats = await getMatiereStats(matiereId, req.user.id);
    res.json({ 
      success: true, 
      data: stats 
    });
    
  } catch (error) {
    console.error('❌ Erreur récupération stats matière:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

// Fonction pour vérifier si un étudiant est dans les cours d'un enseignant
async function checkIfStudentInTeacherCourses(teacherId, studentId) {
  try {
    // Vérifier si l'étudiant est inscrit dans une matière enseignée par ce prof
    const [results] = await db.query(`
      SELECT COUNT(*) as count
      FROM inscriptions i
      JOIN matieres m ON i.id_matiere = m.id_matiere
      WHERE i.id_etudiant = ? AND m.id_enseignant = ?
    `, [studentId, teacherId]);
    
    return results[0].count > 0;
  } catch (error) {
    console.error('Erreur vérification accès enseignant:', error);
    return false;
  }
}

// Fonction pour récupérer les statistiques d'un étudiant
async function getStudentStats(studentId) {
  try {
    // Récupérer le total des séances pour l'étudiant
    const [totalSeances] = await db.query(`
      SELECT COUNT(DISTINCT s.id_seance) as total
      FROM seances_cours s
      JOIN inscriptions i ON s.id_matiere = i.id_matiere
      WHERE i.id_etudiant = ?
        AND s.date_seance <= NOW()
    `, [studentId]);

    // Récupérer les présences de l'étudiant
    const [presences] = await db.query(`
      SELECT 
        p.id_presence,
        p.statut,
        p.date_scan as date_presence,
        s.date_seance,
        s.heure_debut,
        s.heure_fin,
        m.nom_matiere as matiere_nom,
        m.code_matiere as matiere_code,
        CONCAT(e.nom, ' ', e.prenom) as enseignant_nom
      FROM presence p
      JOIN seances_cours s ON p.id_seance = s.id_seance
      JOIN matieres m ON s.id_matiere = m.id_matiere
      JOIN enseignants e ON m.id_enseignant = e.id_enseignant
      WHERE p.id_etudiant = ?
      ORDER BY s.date_seance DESC
      LIMIT 10
    `, [studentId]);

    // Calculer les statistiques
    const presentCount = presences.filter(p => p.statut === 'present').length;
    const absentCount = presences.filter(p => p.statut === 'absent').length;
    const total = totalSeances[0]?.total || 0;
    const presenceRate = total > 0 ? Math.round((presentCount / total) * 100) : 0;

    // Récupérer les statistiques par matière
    const [statsByMatiere] = await db.query(`
      SELECT 
        m.nom_matiere,
        m.code_matiere,
        COUNT(DISTINCT s.id_seance) as total_seances,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absents,
        ROUND(
          (SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) / 
          COUNT(DISTINCT s.id_seance)) * 100, 1
        ) as taux_presence
      FROM matieres m
      JOIN inscriptions i ON m.id_matiere = i.id_matiere
      LEFT JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance AND p.id_etudiant = ?
      WHERE i.id_etudiant = ?
        AND s.date_seance <= NOW()
      GROUP BY m.id_matiere
      ORDER BY m.nom_matiere
    `, [studentId, studentId]);

    // Récupérer l'évolution sur les 30 derniers jours
    const [evolution] = await db.query(`
      SELECT 
        DATE(s.date_seance) as date,
        COUNT(*) as total_seances,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absents
      FROM seances_cours s
      JOIN inscriptions i ON s.id_matiere = i.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance AND p.id_etudiant = ?
      WHERE i.id_etudiant = ?
        AND s.date_seance >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND s.date_seance <= NOW()
      GROUP BY DATE(s.date_seance)
      ORDER BY date DESC
    `, [studentId, studentId]);

    return {
      summary: {
        totalSeances: total,
        presentCount,
        absentCount,
        presenceRate,
        lastUpdate: new Date().toISOString()
      },
      byMatiere: statsByMatiere,
      recentPresences: presences.map(p => ({
        id: p.id_presence,
        date: p.date_seance,
        heure: `${p.heure_debut} - ${p.heure_fin}`,
        matiere: p.matiere_nom,
        enseignant: p.enseignant_nom,
        status: p.statut,
        dateScan: p.date_presence
      })),
      evolution: evolution.map(e => ({
        date: e.date,
        total: e.total_seances,
        presents: e.presents,
        absents: e.absents,
        rate: e.total_seances > 0 ? Math.round((e.presents / e.total_seances) * 100) : 0
      }))
    };
  } catch (error) {
    console.error('Erreur dans getStudentStats:', error);
    throw error;
  }
}

// Fonction pour récupérer les statistiques d'un enseignant
async function getTeacherStats(teacherId) {
  try {
    // Statistiques générales
    const [generalStats] = await db.query(`
      SELECT 
        COUNT(DISTINCT m.id_matiere) as total_matieres,
        COUNT(DISTINCT s.id_seance) as total_seances,
        COUNT(DISTINCT i.id_etudiant) as total_etudiants,
        COUNT(DISTINCT p.id_presence) as total_presences_enregistrees
      FROM matieres m
      LEFT JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN inscriptions i ON m.id_matiere = i.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance
      WHERE m.id_enseignant = ?
        AND s.date_seance <= NOW()
    `, [teacherId]);

    // Statistiques par matière
    const [statsByMatiere] = await db.query(`
      SELECT 
        m.id_matiere,
        m.nom_matiere,
        m.code_matiere,
        COUNT(DISTINCT s.id_seance) as total_seances,
        COUNT(DISTINCT i.id_etudiant) as total_etudiants,
        COUNT(p.id_presence) as total_presences,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presences,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absences,
        ROUND(
          AVG(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) * 100, 1
        ) as taux_presence_moyen
      FROM matieres m
      LEFT JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN inscriptions i ON m.id_matiere = i.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance
      WHERE m.id_enseignant = ?
        AND s.date_seance <= NOW()
      GROUP BY m.id_matiere
      ORDER BY m.nom_matiere
    `, [teacherId]);

    // Dernières séances
    const [recentSeances] = await db.query(`
      SELECT 
        s.id_seance,
        s.date_seance,
        s.heure_debut,
        s.heure_fin,
        m.nom_matiere,
        COUNT(p.id_presence) as total_presences,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absents
      FROM seances_cours s
      JOIN matieres m ON s.id_matiere = m.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance
      WHERE m.id_enseignant = ?
        AND s.date_seance <= NOW()
      GROUP BY s.id_seance
      ORDER BY s.date_seance DESC
      LIMIT 5
    `, [teacherId]);

    // Top étudiants avec meilleure présence
    const [topStudents] = await db.query(`
      SELECT 
        et.id_etudiant,
        et.nom,
        et.prenom,
        COUNT(DISTINCT s.id_seance) as total_seances,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        ROUND(
          (SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) / 
          COUNT(DISTINCT s.id_seance)) * 100, 1
        ) as taux_presence
      FROM etudiants et
      JOIN inscriptions i ON et.id_etudiant = i.id_etudiant
      JOIN matieres m ON i.id_matiere = m.id_matiere
      JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance AND p.id_etudiant = et.id_etudiant
      WHERE m.id_enseignant = ?
        AND s.date_seance <= NOW()
      GROUP BY et.id_etudiant
      HAVING total_seances > 0
      ORDER BY taux_presence DESC
      LIMIT 5
    `, [teacherId]);

    return {
      summary: {
        ...generalStats[0],
        lastUpdate: new Date().toISOString()
      },
      byMatiere: statsByMatiere,
      recentSeances: recentSeances.map(s => ({
        id: s.id_seance,
        date: s.date_seance,
        heure: `${s.heure_debut} - ${s.heure_fin}`,
        matiere: s.nom_matiere,
        total: s.total_presences,
        presents: s.presents,
        absents: s.absents,
        rate: s.total_presences > 0 ? Math.round((s.presents / s.total_presences) * 100) : 0
      })),
      topStudents: topStudents.map(s => ({
        id: s.id_etudiant,
        nom: `${s.nom} ${s.prenom}`,
        totalSeances: s.total_seances,
        presents: s.presents,
        tauxPresence: s.taux_presence
      }))
    };
  } catch (error) {
    console.error('Erreur dans getTeacherStats:', error);
    throw error;
  }
}

// Fonction pour récupérer les statistiques d'une matière
async function getMatiereStats(matiereId, teacherId) {
  try {
    // Vérifier que la matière appartient à l'enseignant
    const [verification] = await db.query(`
      SELECT COUNT(*) as count 
      FROM matieres 
      WHERE id_matiere = ? AND id_enseignant = ?
    `, [matiereId, teacherId]);

    if (verification[0].count === 0) {
      throw new Error('Matiere non trouvée ou accès non autorisé');
    }

    // Statistiques de la matière
    const [matiereStats] = await db.query(`
      SELECT 
        m.nom_matiere,
        m.code_matiere,
        COUNT(DISTINCT s.id_seance) as total_seances,
        COUNT(DISTINCT i.id_etudiant) as total_etudiants,
        COUNT(p.id_presence) as total_presences,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presences,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absences,
        ROUND(
          AVG(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) * 100, 1
        ) as taux_presence_moyen
      FROM matieres m
      LEFT JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN inscriptions i ON m.id_matiere = i.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance
      WHERE m.id_matiere = ?
        AND s.date_seance <= NOW()
    `, [matiereId]);

    // Liste des étudiants avec leurs statistiques
    const [studentsStats] = await db.query(`
      SELECT 
        et.id_etudiant,
        et.nom,
        et.prenom,
        et.email,
        COUNT(DISTINCT s.id_seance) as total_seances,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absents,
        ROUND(
          (SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) / 
          COUNT(DISTINCT s.id_seance)) * 100, 1
        ) as taux_presence
      FROM etudiants et
      JOIN inscriptions i ON et.id_etudiant = i.id_etudiant
      JOIN matieres m ON i.id_matiere = m.id_matiere
      JOIN seances_cours s ON m.id_matiere = s.id_matiere
      LEFT JOIN presence p ON s.id_seance = p.id_seance AND p.id_etudiant = et.id_etudiant
      WHERE m.id_matiere = ?
        AND s.date_seance <= NOW()
      GROUP BY et.id_etudiant
      ORDER BY et.nom, et.prenom
    `, [matiereId]);

    // Statistiques par séance
    const [seancesStats] = await db.query(`
      SELECT 
        s.id_seance,
        s.date_seance,
        s.heure_debut,
        s.heure_fin,
        COUNT(p.id_presence) as total_presences,
        SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) as presents,
        SUM(CASE WHEN p.statut = 'absent' THEN 1 ELSE 0 END) as absents,
        ROUND(
          (SUM(CASE WHEN p.statut = 'present' THEN 1 ELSE 0 END) / 
          COUNT(p.id_presence)) * 100, 1
        ) as taux_presence
      FROM seances_cours s
      LEFT JOIN presence p ON s.id_seance = p.id_seance
      WHERE s.id_matiere = ?
        AND s.date_seance <= NOW()
      GROUP BY s.id_seance
      ORDER BY s.date_seance DESC
    `, [matiereId]);

    return {
      matiere: matiereStats[0],
      students: studentsStats,
      seances: seancesStats,
      summary: {
        totalStudents: studentsStats.length,
        totalSeances: matiereStats[0]?.total_seances || 0,
        totalPresences: matiereStats[0]?.total_presences || 0,
        averagePresenceRate: matiereStats[0]?.taux_presence_moyen || 0,
        lastUpdate: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error('Erreur dans getMatiereStats:', error);
    throw error;
  }
}

// Route de test simple
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Route statistics fonctionne!',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;