const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuration de la connexion à la base de données
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'controle_presence',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // acquireTimeout: 60000, // ⚠️ SUPPRIMER CETTE LIGNE
  connectTimeout: 60000,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(dbConfig);

// Test de la connexion avec gestion d'erreur améliorée
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('✅ Connexion à la base de données réussie');
    
    // Test de requête basique
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Test de requête SQL réussi');
    
  } catch (error) {
    console.error('❌ Erreur de connexion à la base de données:', error.message);
    console.error('💡 Vérifiez que:');
    console.error('   - MySQL est démarré');
    console.error('   - La base de données existe');
    console.error('   - Les identifiants dans .env sont corrects');
    
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('💡 La base de données n\'existe pas. Créez-la avec:');
      console.error(`   CREATE DATABASE ${process.env.DB_NAME};`);
    }
    
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

// Événements du pool
pool.on('connection', (connection) => {
  console.log('🔗 Nouvelle connexion MySQL établie');
});

pool.on('acquire', (connection) => {
  console.log('📥 Connexion MySQL acquise du pool');
});

pool.on('release', (connection) => {
  console.log('📤 Connexion MySQL libérée dans le pool');
});

pool.on('enqueue', () => {
  console.log('⏳ Requête en attente de connexion disponible');
});

// Test au démarrage
testConnection();

module.exports = pool;