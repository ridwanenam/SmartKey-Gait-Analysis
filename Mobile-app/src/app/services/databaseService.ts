import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

// --- RECORD INTERFACES ---
export interface AuthLogRecord {
  id: string;
  timestamp: string;
  userId: string;
  score: number | string;
  status: 'SUCCESS' | 'FAILED' | 'BYPASS';
  incremental?: string;
  message?: string;
}

export interface RegLogRecord {
  id: string;
  timestamp: string;
  slotUser: string;
  totalJendela: number;
  statusAkhir: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS';
  message?: string;
}

export interface SystemLogRecord {
  id: string;
  timestamp: string;
  status: 'Info' | 'Warning' | 'Error' | 'Success';
  message: string;
}

export interface DebugMLLogRecord {
  id: string;
  timestamp: string;
  vector: string;
  sigma: string;
  zupt: string;
  ghmm: string;
  th: string;
  alpha: string;
  dw: string;
  freq: string;
}

const DB_NAME = 'smart_gait_lock_db';

class DatabaseService {
  private sqlite: SQLiteConnection | null = null;
  private db: SQLiteDBConnection | null = null;
  private isInitialized = false;

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      if (Capacitor.isNativePlatform()) {
        this.sqlite = new SQLiteConnection(CapacitorSQLite);

        const retCC = (await this.sqlite.checkConnectionsConsistency()).result;
        const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;

        if (retCC && isConn) {
          this.db = await this.sqlite.retrieveConnection(DB_NAME, false);
        } else {
          this.db = await this.sqlite.createConnection(
            DB_NAME,
            false,
            'no-encryption',
            1,
            false
          );
        }

        await this.db.open();
        await this.createTablesNative();
      } else {
        console.log('[SQLite Web Fallback] Menggunakan penyimpanan Web Fallback (Browser)');
        this.initWebFallback();
      }

      this.isInitialized = true;
      console.log('Database SQLite berhasil diinisialisasi.');
    } catch (error) {
      console.error('Error saat inisialisasi SQLite:', error);
      this.initWebFallback();
      this.isInitialized = true;
    }
  }

  private async createTablesNative(): Promise<void> {
    if (!this.db) return;

    const schema = `
      -- Tabel 1: Log Autentikasi
      CREATE TABLE IF NOT EXISTS log_autentikasi (
        id TEXT PRIMARY KEY NOT NULL,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        score TEXT NOT NULL,
        status TEXT NOT NULL,
        incremental TEXT,
        message TEXT
      );

      -- Tabel 2: Log Registrasi
      CREATE TABLE IF NOT EXISTS log_registrasi (
        id TEXT PRIMARY KEY NOT NULL,
        timestamp TEXT NOT NULL,
        slot_user TEXT NOT NULL,
        total_jendela INTEGER NOT NULL,
        status_akhir TEXT NOT NULL,
        message TEXT
      );

      -- Tabel 3: Log Sistem
      CREATE TABLE IF NOT EXISTS log_sistem (
        id TEXT PRIMARY KEY NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT NOT NULL
      );

      -- Tabel 4: Log Debug ML & Isyarat
      CREATE TABLE IF NOT EXISTS log_debug_ml (
        id TEXT PRIMARY KEY NOT NULL,
        timestamp TEXT NOT NULL,
        vector TEXT,
        sigma TEXT,
        zupt TEXT,
        ghmm TEXT,
        th TEXT,
        alpha TEXT,
        dw TEXT,
        freq TEXT
      );

      -- Tabel 5: Pengaturan Keamanan & PIN Bypass
      CREATE TABLE IF NOT EXISTS user_security (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `;

    await this.db.execute(schema);
  }

  private initWebFallback(): void {
    if (!localStorage.getItem('sqlite_log_autentikasi')) {
      localStorage.setItem('sqlite_log_autentikasi', JSON.stringify([]));
    }
    if (!localStorage.getItem('sqlite_log_registrasi')) {
      localStorage.setItem('sqlite_log_registrasi', JSON.stringify([]));
    }
    if (!localStorage.getItem('sqlite_log_sistem')) {
      localStorage.setItem('sqlite_log_sistem', JSON.stringify([]));
    }
    if (!localStorage.getItem('sqlite_log_debug_ml')) {
      localStorage.setItem('sqlite_log_debug_ml', JSON.stringify([]));
    }
    if (!localStorage.getItem('sqlite_user_security')) {
      localStorage.setItem('sqlite_user_security', JSON.stringify({ bypass_pin: '123456' }));
    }
  }

  // ==========================================
  // 1. LOG AUTENTIKASI
  // ==========================================
  public async addAuthLog(log: Omit<AuthLogRecord, 'id'>): Promise<AuthLogRecord> {
    await this.initialize();
    const id = `auth_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newLog: AuthLogRecord = { id, ...log };

    if (Capacitor.isNativePlatform() && this.db) {
      const sql = `
        INSERT INTO log_autentikasi (id, timestamp, user_id, score, status, incremental, message)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `;
      await this.db.run(sql, [
        newLog.id,
        newLog.timestamp,
        newLog.userId,
        String(newLog.score),
        newLog.status,
        newLog.incremental || 'Normal',
        newLog.message || '',
      ]);
    } else {
      const logs: AuthLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_autentikasi') || '[]');
      logs.unshift(newLog);
      localStorage.setItem('sqlite_log_autentikasi', JSON.stringify(logs.slice(0, 100)));
    }

    return newLog;
  }

  public async getAuthLogs(limit = 100): Promise<AuthLogRecord[]> {
    await this.initialize();
    if (Capacitor.isNativePlatform() && this.db) {
      const res = await this.db.query(`SELECT * FROM log_autentikasi ORDER BY timestamp DESC LIMIT ?;`, [limit]);
      if (res?.values) {
        return res.values.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          userId: r.user_id,
          score: r.score,
          status: r.status,
          incremental: r.incremental,
          message: r.message,
        }));
      }
      return [];
    } else {
      const logs: AuthLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_autentikasi') || '[]');
      return logs.slice(0, limit);
    }
  }

  // ==========================================
  // 2. LOG REGISTRASI
  // ==========================================
  public async addRegLog(log: Omit<RegLogRecord, 'id'>): Promise<RegLogRecord> {
    await this.initialize();
    const id = `reg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newLog: RegLogRecord = { id, ...log };

    if (Capacitor.isNativePlatform() && this.db) {
      const sql = `
        INSERT INTO log_registrasi (id, timestamp, slot_user, total_jendela, status_akhir, message)
        VALUES (?, ?, ?, ?, ?, ?);
      `;
      await this.db.run(sql, [
        newLog.id,
        newLog.timestamp,
        newLog.slotUser,
        newLog.totalJendela,
        newLog.statusAkhir,
        newLog.message || '',
      ]);
    } else {
      const logs: RegLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_registrasi') || '[]');
      logs.unshift(newLog);
      localStorage.setItem('sqlite_log_registrasi', JSON.stringify(logs.slice(0, 100)));
    }

    return newLog;
  }

  public async getRegLogs(limit = 100): Promise<RegLogRecord[]> {
    await this.initialize();
    if (Capacitor.isNativePlatform() && this.db) {
      const res = await this.db.query(`SELECT * FROM log_registrasi ORDER BY timestamp DESC LIMIT ?;`, [limit]);
      if (res?.values) {
        return res.values.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          slotUser: r.slot_user,
          totalJendela: r.total_jendela,
          statusAkhir: r.status_akhir,
          message: r.message,
        }));
      }
      return [];
    } else {
      const logs: RegLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_registrasi') || '[]');
      return logs.slice(0, limit);
    }
  }

  // ==========================================
  // 3. LOG SISTEM
  // ==========================================
  public async addSystemLog(log: Omit<SystemLogRecord, 'id'>): Promise<SystemLogRecord> {
    await this.initialize();
    const id = `sys_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newLog: SystemLogRecord = { id, ...log };

    if (Capacitor.isNativePlatform() && this.db) {
      const sql = `
        INSERT INTO log_sistem (id, timestamp, status, message)
        VALUES (?, ?, ?, ?);
      `;
      await this.db.run(sql, [newLog.id, newLog.timestamp, newLog.status, newLog.message]);
    } else {
      const logs: SystemLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_sistem') || '[]');
      logs.unshift(newLog);
      localStorage.setItem('sqlite_log_sistem', JSON.stringify(logs.slice(0, 150)));
    }

    return newLog;
  }

  public async getSystemLogs(limit = 100): Promise<SystemLogRecord[]> {
    await this.initialize();
    if (Capacitor.isNativePlatform() && this.db) {
      const res = await this.db.query(`SELECT * FROM log_sistem ORDER BY timestamp DESC LIMIT ?;`, [limit]);
      if (res?.values) {
        return res.values.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          status: r.status,
          message: r.message,
        }));
      }
      return [];
    } else {
      const logs: SystemLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_sistem') || '[]');
      return logs.slice(0, limit);
    }
  }

  // ==========================================
  // 4. LOG DEBUG ML & ISYARAT
  // ==========================================
  public async addDebugMLLog(log: Omit<DebugMLLogRecord, 'id'>): Promise<DebugMLLogRecord> {
    await this.initialize();
    const id = `ml_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newLog: DebugMLLogRecord = { id, ...log };

    if (Capacitor.isNativePlatform() && this.db) {
      const sql = `
        INSERT INTO log_debug_ml (id, timestamp, vector, sigma, zupt, ghmm, th, alpha, dw, freq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;
      await this.db.run(sql, [
        newLog.id,
        newLog.timestamp,
        newLog.vector,
        newLog.sigma,
        newLog.zupt,
        newLog.ghmm,
        newLog.th,
        newLog.alpha,
        newLog.dw,
        newLog.freq,
      ]);
    } else {
      const logs: DebugMLLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_debug_ml') || '[]');
      logs.unshift(newLog);
      localStorage.setItem('sqlite_log_debug_ml', JSON.stringify(logs.slice(0, 100)));
    }

    return newLog;
  }

  public async getDebugMLLogs(limit = 50): Promise<DebugMLLogRecord[]> {
    await this.initialize();
    if (Capacitor.isNativePlatform() && this.db) {
      const res = await this.db.query(`SELECT * FROM log_debug_ml ORDER BY timestamp DESC LIMIT ?;`, [limit]);
      if (res?.values) {
        return res.values.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          vector: r.vector,
          sigma: r.sigma,
          zupt: r.zupt,
          ghmm: r.ghmm,
          th: r.th,
          alpha: r.alpha,
          dw: r.dw,
          freq: r.freq,
        }));
      }
      return [];
    } else {
      const logs: DebugMLLogRecord[] = JSON.parse(localStorage.getItem('sqlite_log_debug_ml') || '[]');
      return logs.slice(0, limit);
    }
  }

  // ==========================================
  // 5. KEAMANAN & PIN BYPASS
  // ==========================================
  public async saveBypassPin(pin: string): Promise<void> {
    await this.initialize();
    const timestamp = new Date().toLocaleTimeString('id-ID');

    if (Capacitor.isNativePlatform() && this.db) {
      const sql = `
        INSERT OR REPLACE INTO user_security (key, value, updated_at)
        VALUES ('bypass_pin', ?, ?);
      `;
      await this.db.run(sql, [pin, timestamp]);
    } else {
      const sec = JSON.parse(localStorage.getItem('sqlite_user_security') || '{}');
      sec['bypass_pin'] = pin;
      sec['updated_at'] = timestamp;
      localStorage.setItem('sqlite_user_security', JSON.stringify(sec));
    }

    // Catat log ke tabel log_sistem dan log_registrasi
    await this.addSystemLog({
      timestamp,
      status: 'Success',
      message: `PIN Emergency Bypass baru berhasil dibuat & disimpan ke SQLite`,
    });

    await this.addRegLog({
      timestamp,
      slotUser: 'Slot 1 (Admin A7)',
      totalJendela: 10,
      statusAkhir: 'SUCCESS',
      message: `Pendaftaran User Selesai & Setup PIN Bypass Berhasil`,
    });
  }

  public async getBypassPin(): Promise<string> {
    await this.initialize();

    if (Capacitor.isNativePlatform() && this.db) {
      const res = await this.db.query(`SELECT value FROM user_security WHERE key = 'bypass_pin';`);
      if (res?.values && res.values.length > 0) {
        return res.values[0].value;
      }
      return '123456'; // Default fallback PIN
    } else {
      const sec = JSON.parse(localStorage.getItem('sqlite_user_security') || '{}');
      return sec['bypass_pin'] || '123456';
    }
  }

  public async isUserRegistered(): Promise<boolean> {
    await this.initialize();
    try {
      if (Capacitor.isNativePlatform() && this.db) {
        const res = await this.db.query(`SELECT value FROM user_security WHERE key = 'bypass_pin';`);
        const regRes = await this.db.query(`SELECT id FROM log_registrasi WHERE status_akhir = 'SUCCESS';`);
        return Boolean((res?.values && res.values.length > 0) || (regRes?.values && regRes.values.length > 0));
      } else {
        const sec = JSON.parse(localStorage.getItem('sqlite_user_security') || '{}');
        const regLogs = JSON.parse(localStorage.getItem('sqlite_log_registrasi') || '[]');
        const hasSuccessReg = Array.isArray(regLogs) && regLogs.some((l: any) => l.statusAkhir === 'SUCCESS' || l.status_akhir === 'SUCCESS');
        return Boolean((sec['bypass_pin'] && sec['updated_at']) || hasSuccessReg);
      }
    } catch (e) {
      console.error('Gagal mengecek status registrasi user:', e);
      return false;
    }
  }

  // ==========================================
  // PENGHAPUSAN / RESET LOG
  // ==========================================
  public async clearLogs(type?: 'autentikasi' | 'registrasi' | 'sistem' | 'debug' | 'all'): Promise<void> {
    await this.initialize();

    if (Capacitor.isNativePlatform() && this.db) {
      if (!type || type === 'all') {
        await this.db.execute(`
          DELETE FROM log_autentikasi;
          DELETE FROM log_registrasi;
          DELETE FROM log_sistem;
          DELETE FROM log_debug_ml;
        `);
      } else if (type === 'autentikasi') {
        await this.db.execute(`DELETE FROM log_autentikasi;`);
      } else if (type === 'registrasi') {
        await this.db.execute(`DELETE FROM log_registrasi;`);
      } else if (type === 'sistem') {
        await this.db.execute(`DELETE FROM log_sistem;`);
      } else if (type === 'debug') {
        await this.db.execute(`DELETE FROM log_debug_ml;`);
      }
    } else {
      if (!type || type === 'all') {
        localStorage.setItem('sqlite_log_autentikasi', JSON.stringify([]));
        localStorage.setItem('sqlite_log_registrasi', JSON.stringify([]));
        localStorage.setItem('sqlite_log_sistem', JSON.stringify([]));
        localStorage.setItem('sqlite_log_debug_ml', JSON.stringify([]));
      } else if (type === 'autentikasi') {
        localStorage.setItem('sqlite_log_autentikasi', JSON.stringify([]));
      } else if (type === 'registrasi') {
        localStorage.setItem('sqlite_log_registrasi', JSON.stringify([]));
      } else if (type === 'sistem') {
        localStorage.setItem('sqlite_log_sistem', JSON.stringify([]));
      } else if (type === 'debug') {
        localStorage.setItem('sqlite_log_debug_ml', JSON.stringify([]));
      }
    }
  }
}

export const databaseService = new DatabaseService();
