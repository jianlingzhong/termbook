const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'termbook.db');

function openDb(dbPath = process.env.TERMBOOK_DB_PATH || DEFAULT_DB_PATH) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            pwd TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_activity INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cells (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            command TEXT NOT NULL,
            snapshot_ansi TEXT,
            snapshot_cols INTEGER,
            snapshot_rows INTEGER,
            exit_code INTEGER,
            pwd TEXT,
            executable_pwd TEXT,
            used_tui INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER,
            finished_at INTEGER,
            position INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_cells_session_position ON cells(session_id, position);
    `);
    return db;
}

function loadAllSessions(db) {
    const sessRows = db.prepare(`SELECT id, pwd, created_at, last_activity FROM sessions ORDER BY last_activity DESC`).all();
    const cellStmt = db.prepare(`
        SELECT id, command, snapshot_ansi, snapshot_cols, snapshot_rows, exit_code, pwd, executable_pwd, used_tui, started_at, finished_at
        FROM cells WHERE session_id = ? ORDER BY position ASC
    `);
    return sessRows.map(s => ({
        id: s.id,
        pwd: s.pwd,
        createdAt: s.created_at,
        lastActivity: s.last_activity,
        cells: cellStmt.all(s.id).map(c => ({
            id: c.id,
            command: c.command,
            snapshotAnsi: c.snapshot_ansi || '',
            snapshotCols: c.snapshot_cols,
            snapshotRows: c.snapshot_rows,
            exitCode: c.exit_code,
            pwd: c.pwd,
            executablePwd: c.executable_pwd,
            usedTui: !!c.used_tui,
            startedAt: c.started_at,
            finishedAt: c.finished_at,
            isRunning: false,
            output: '',
        })),
    }));
}

const upsertSessionSql = `
    INSERT INTO sessions (id, pwd, created_at, last_activity)
    VALUES (@id, @pwd, @createdAt, @lastActivity)
    ON CONFLICT(id) DO UPDATE SET pwd=excluded.pwd, last_activity=excluded.last_activity
`;

function upsertSession(db, sess) {
    db.prepare(upsertSessionSql).run({
        id: sess.id,
        pwd: sess.pwd || '',
        createdAt: sess.createdAt || Date.now(),
        lastActivity: sess.lastActivity || Date.now(),
    });
}

const upsertCellSql = `
    INSERT INTO cells (id, session_id, command, snapshot_ansi, snapshot_cols, snapshot_rows,
                       exit_code, pwd, executable_pwd, used_tui, started_at, finished_at, position)
    VALUES (@id, @sessionId, @command, @snapshotAnsi, @snapshotCols, @snapshotRows,
            @exitCode, @pwd, @executablePwd, @usedTui, @startedAt, @finishedAt, @position)
    ON CONFLICT(id) DO UPDATE SET
        snapshot_ansi=excluded.snapshot_ansi,
        snapshot_cols=excluded.snapshot_cols,
        snapshot_rows=excluded.snapshot_rows,
        exit_code=excluded.exit_code,
        pwd=excluded.pwd,
        executable_pwd=excluded.executable_pwd,
        used_tui=excluded.used_tui,
        finished_at=excluded.finished_at
`;

function upsertCell(db, sessionId, cell, position) {
    db.prepare(upsertCellSql).run({
        id: cell.id,
        sessionId,
        command: cell.command || '',
        snapshotAnsi: cell.snapshotAnsi || '',
        snapshotCols: cell.snapshotCols || null,
        snapshotRows: cell.snapshotRows || null,
        exitCode: cell.exitCode == null ? null : cell.exitCode,
        pwd: cell.pwd || null,
        executablePwd: cell.executablePwd || null,
        usedTui: cell.usedTui ? 1 : 0,
        startedAt: cell.startedAt || null,
        finishedAt: cell.finishedAt || null,
        position,
    });
}

function deleteSession(db, sessionId) {
    db.prepare(`DELETE FROM cells WHERE session_id = ?`).run(sessionId);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

function clearAll(db) {
    db.prepare(`DELETE FROM cells`).run();
    db.prepare(`DELETE FROM sessions`).run();
}

module.exports = { openDb, loadAllSessions, upsertSession, upsertCell, deleteSession, clearAll, DEFAULT_DB_PATH };
